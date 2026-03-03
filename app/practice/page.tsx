"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  getScenarioById,
} from "../lib/scenarios";

type DialogueMessage = {
  role: "user" | "assistant";
  content: string;
};

type DialogueResponse = {
  reply: string;
  suggestions: string[];
};

type AnalysisResponse = {
  score: number;
  grammar: Array<{
    original: string;
    corrected: string;
    reason: string;
  }>;
  naturalness: {
    rewrites: string[];
    notes: string[];
  };
  vocabulary: Array<{
    term: string;
    meaning_zh: string;
    meaning_en: string;
    example: string;
  }>;
};

type AccentPreference = "US" | "UK";

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type SpeechWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

const MESSAGES_STORAGE_KEY = "aed_messages";
const SPEAK_REPLIES_STORAGE_KEY = "aed_speak_replies";
const ACCENT_STORAGE_KEY = "aed_accent";
const SCENARIO_STORAGE_KEY = "aed_scenario_id";
const SCENARIO_INTRO =
  "Choose a speaking scenario and practice a natural multi-turn conversation.";
const MAX_DIALOGUE_PAYLOAD_MESSAGES = 10;
const MAX_DIALOGUE_PAYLOAD_CHARS = 1200;

function isDialogueMessages(value: unknown): value is DialogueMessage[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      (record.role === "user" || record.role === "assistant") &&
      typeof record.content === "string"
    );
  });
}

function buildDialoguePayloadMessages(
  allMessages: DialogueMessage[]
): DialogueMessage[] {
  if (allMessages.length === 0) {
    return [];
  }

  const selected: DialogueMessage[] = [];
  let totalChars = 0;

  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    const message = allMessages[index];
    const isNewest = index === allMessages.length - 1;
    const nextCount = selected.length + 1;
    const nextTotalChars = totalChars + message.content.length;

    if (!isNewest) {
      if (nextCount > MAX_DIALOGUE_PAYLOAD_MESSAGES) {
        break;
      }
      if (nextTotalChars > MAX_DIALOGUE_PAYLOAD_CHARS) {
        break;
      }
    }

    selected.push(message);
    totalChars = nextTotalChars;

    if (selected.length >= MAX_DIALOGUE_PAYLOAD_MESSAGES) {
      break;
    }
  }

  selected.reverse();
  return selected.length > 0 ? selected : [allMessages[allMessages.length - 1]];
}

export default function PracticePage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] =
    useState(false);
  const [isSpeechSynthesisSupported, setIsSpeechSynthesisSupported] =
    useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [accent, setAccent] = useState<AccentPreference>("US");
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    DEFAULT_SCENARIO_ID
  );
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const messagesRef = useRef<DialogueMessage[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);

  const hasDialogue = useMemo(() => messages.length > 0, [messages.length]);
  const activeScenario = useMemo(
    () => getScenarioById(selectedScenarioId),
    [selectedScenarioId]
  );
  const latestUserIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        return index;
      }
    }
    return -1;
  }, [messages]);
  const analysisMessages = useMemo(
    () => (latestUserIndex >= 0 ? messages.slice(0, latestUserIndex + 1) : []),
    [latestUserIndex, messages]
  );
  const canAnalyze =
    !isLoading && !isListening && !isAnalyzing && analysisMessages.length > 0;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    mountedRef.current = true;
    const speechWindow = window as SpeechWindow;
    const speechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    setIsSpeechRecognitionSupported(Boolean(speechRecognition));
    setIsSpeechSynthesisSupported(typeof window.speechSynthesis !== "undefined");

    try {
      const storedMessages = window.localStorage.getItem(MESSAGES_STORAGE_KEY);
      if (storedMessages) {
        const parsed: unknown = JSON.parse(storedMessages);
        if (isDialogueMessages(parsed)) {
          setMessages(parsed);
          messagesRef.current = parsed;
        }
      }
    } catch {
      // Ignore invalid persisted messages and continue with defaults.
    }

    const storedSpeakReplies = window.localStorage.getItem(
      SPEAK_REPLIES_STORAGE_KEY
    );
    if (storedSpeakReplies === "true") {
      setSpeakReplies(true);
    } else if (storedSpeakReplies === "false") {
      setSpeakReplies(false);
    }

    const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (storedAccent === "US" || storedAccent === "UK") {
      setAccent(storedAccent);
    }

    const storedScenarioId = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
    if (storedScenarioId && SCENARIOS.some((item) => item.id === storedScenarioId)) {
      setSelectedScenarioId(storedScenarioId);
    }

    return () => {
      mountedRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore stop failures during unmount cleanup.
        }
      }
      if (typeof window.speechSynthesis !== "undefined") {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!mountedRef.current || typeof window === "undefined") {
      return;
    }

    if (messages.length === 0) {
      window.localStorage.removeItem(MESSAGES_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (!mountedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      SPEAK_REPLIES_STORAGE_KEY,
      speakReplies ? "true" : "false"
    );
  }, [speakReplies]);

  useEffect(() => {
    if (!mountedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  }, [accent]);

  useEffect(() => {
    if (!mountedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SCENARIO_STORAGE_KEY, selectedScenarioId);
  }, [selectedScenarioId]);

  const speakText = useCallback(
    (text: string) => {
      if (!speakReplies || !isSpeechSynthesisSupported || typeof window === "undefined") {
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    },
    [isSpeechSynthesisSupported, speakReplies]
  );

  const sendMessage = useCallback(
    async (messageText: string) => {
      const trimmed = messageText.trim();
      if (!trimmed || isLoading || isListening) {
        return;
      }

      const userMessage: DialogueMessage = { role: "user", content: trimmed };
      const nextMessages = [...messagesRef.current, userMessage];

      setMessages(nextMessages);
      messagesRef.current = nextMessages;
      setIsLoading(true);
      setError(null);

      try {
        const payloadMessages = buildDialoguePayloadMessages(nextMessages);

        const response = await fetch("/api/dialogue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: payloadMessages,
            scenarioId: selectedScenarioId,
          }),
        });

        if (!response.ok) {
          let errorMessage = "Something went wrong. Please try again.";

          try {
            const errorData = (await response.json()) as { error?: string };
            if (typeof errorData.error === "string" && errorData.error) {
              errorMessage = errorData.error;
            }
          } catch {
            // Keep generic error message if response isn't valid JSON.
          }

          throw new Error(errorMessage);
        }

        const data: DialogueResponse = await response.json();
        const assistantMessage: DialogueMessage = {
          role: "assistant",
          content: data.reply,
        };

        setMessages((prev) => {
          const updated: DialogueMessage[] = [...prev, assistantMessage];
          messagesRef.current = updated;
          return updated;
        });
        setSuggestions(data.suggestions);
        setInput("");
        speakText(data.reply);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to send message.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, isListening, selectedScenarioId, speakText]
  );

  const stopRecording = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }
    try {
      recognition.stop();
    } catch {
      // Ignore stop failures from browser speech engine.
    }
    setIsListening(false);
  }, []);

  const startRecording = useCallback(() => {
    if (isLoading || isListening || typeof window === "undefined") {
      return;
    }

    const speechWindow = window as SpeechWindow;
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setIsSpeechRecognitionSupported(false);
      return;
    }

    setError(null);
    transcriptRef.current = "";

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = accent === "UK" ? "en-GB" : "en-US";

    recognition.onresult = (event) => {
      let finalTranscript = transcriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          finalTranscript += `${result[0].transcript} `;
        }
      }
      transcriptRef.current = finalTranscript;
    };

    recognition.onerror = () => {
      setIsListening(false);
      setError("Voice input failed. Please try again.");
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;

      const transcript = transcriptRef.current.trim();
      transcriptRef.current = "";
      if (!transcript) {
        return;
      }

      setInput(transcript);
      void sendMessage(transcript);
    };

    recognitionRef.current = recognition;
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
      setError("Unable to start voice recording in this browser.");
    }
  }, [accent, isListening, isLoading, sendMessage]);

  const toggleRecording = useCallback(() => {
    if (isListening) {
      stopRecording();
      return;
    }
    startRecording();
  }, [isListening, startRecording, stopRecording]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await sendMessage(input);
    },
    [input, sendMessage]
  );

  const handleClearChat = useCallback(() => {
    stopRecording();
    if (typeof window !== "undefined" && isSpeechSynthesisSupported) {
      window.speechSynthesis.cancel();
    }
    setMessages([]);
    messagesRef.current = [];
    setSuggestions([]);
    setAnalysis(null);
    setAnalysisError(null);
    setInput("");
    setError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(MESSAGES_STORAGE_KEY);
    }
  }, [isSpeechSynthesisSupported, stopRecording]);

  const handleScenarioChange = useCallback(
    (nextScenarioId: string) => {
      if (nextScenarioId === selectedScenarioId) {
        return;
      }

      stopRecording();
      if (typeof window !== "undefined" && isSpeechSynthesisSupported) {
        window.speechSynthesis.cancel();
      }

      setSelectedScenarioId(nextScenarioId);
      setMessages([]);
      messagesRef.current = [];
      setSuggestions([]);
      setAnalysis(null);
      setAnalysisError(null);
      setInput("");
      setError(null);

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(MESSAGES_STORAGE_KEY);
      }
    },
    [isSpeechSynthesisSupported, selectedScenarioId, stopRecording]
  );

  const handleAnalyze = useCallback(async () => {
    if (!canAnalyze) {
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: selectedScenarioId,
          messages: analysisMessages,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to analyze message.";

        try {
          const errorData = (await response.json()) as { error?: string };
          if (typeof errorData.error === "string" && errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // Keep generic message if error response is not valid JSON.
        }

        throw new Error(errorMessage);
      }

      const data: AnalysisResponse = await response.json();
      setAnalysis(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze message.";
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [analysisMessages, canAnalyze, selectedScenarioId]);

  const handleSuggestionClick = useCallback(
    (suggestion: string, shouldSend: boolean) => {
      setInput(suggestion);
      inputRef.current?.focus();

      if (shouldSend) {
        void sendMessage(suggestion);
      }
    },
    [sendMessage]
  );

  return (
    <main className="page">
      <section className="card" aria-live="polite">
        <div>
          <p className="muted">Scenario</p>
          <h1 className="title">{activeScenario.title} Conversation</h1>
          <p className="muted">{SCENARIO_INTRO}</p>
        </div>

        <div className="controls-row">
          <label className="toggle-row">
            Scenario
            <select
              className="select-input"
              value={selectedScenarioId}
              onChange={(event) => handleScenarioChange(event.target.value)}
              disabled={isLoading || isListening}
            >
              {SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <h2 className="section-title">Dialogue</h2>
          <div className="dialogue-box">
            {hasDialogue ? (
              messages.map((message, index) => {
                const isUser = message.role === "user";
                const speaker = isUser ? "You" : "Guide";

                return (
                  <div
                    key={`${message.role}-${index}`}
                    className={`bubble ${isUser ? "user" : ""}`}
                  >
                    <strong>{speaker}:</strong> {message.content}
                  </div>
                );
              })
            ) : (
              <p className="muted">
                Start the conversation with a greeting or question.
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <form className="input-row" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="text-input"
            value={input}
            placeholder="Type your message..."
            onChange={(event) => setInput(event.target.value)}
            disabled={isLoading}
            aria-label="Message to send"
          />
          <button
            className="secondary-button btnPrimary"
            type="submit"
            disabled={isLoading || isListening}
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </form>

        <div className="controls-row">
          <button
            className="secondary-button btnPrimary"
            type="button"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
          >
            {isAnalyzing ? "Analyzing..." : "Analyze"}
          </button>

          <button
            className="secondary-button btnPrimary"
            type="button"
            onClick={toggleRecording}
            disabled={isLoading || !isSpeechRecognitionSupported}
          >
            {isListening ? "Stop Recording" : "Start Recording"}
          </button>

          {isSpeechSynthesisSupported && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={speakReplies}
                onChange={(event) => setSpeakReplies(event.target.checked)}
              />
              Speak replies
            </label>
          )}

          <label className="toggle-row">
            Accent
            <select
              className="select-input"
              value={accent}
              onChange={(event) => setAccent(event.target.value as AccentPreference)}
            >
              <option value="US">US</option>
              <option value="UK">UK</option>
            </select>
          </label>

          <button
            className="secondary-button ghost-button btnGhost"
            type="button"
            onClick={handleClearChat}
            disabled={isLoading}
          >
            Clear chat
          </button>
        </div>

        {analysisError && (
          <div className="error" role="alert">
            {analysisError}
          </div>
        )}

        {analysis && (
          <section className="analysis-panel" aria-live="polite">
            <h3 className="section-title">Analysis</h3>
            <p className="analysis-score">Score: {analysis.score}/100</p>

            <div className="analysis-block">
              <h4 className="analysis-subtitle">Grammar</h4>
              {analysis.grammar.length > 0 ? (
                <ul className="analysis-list">
                  {analysis.grammar.map((item, index) => (
                    <li key={`${item.original}-${index}`} className="analysis-item">
                      <p className="analysis-line">
                        <strong>Original:</strong> {item.original}
                      </p>
                      <p className="analysis-line">
                        <strong>Corrected:</strong> {item.corrected}
                      </p>
                      <p className="analysis-line">
                        <strong>Reason:</strong> {item.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No grammar corrections needed.</p>
              )}
            </div>

            <div className="analysis-block">
              <h4 className="analysis-subtitle">Naturalness Rewrites</h4>
              {analysis.naturalness.rewrites.length > 0 ? (
                <ul className="analysis-list">
                  {analysis.naturalness.rewrites.map((rewrite, index) => (
                    <li key={`${rewrite}-${index}`} className="analysis-item">
                      {rewrite}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No rewrite suggestions.</p>
              )}

              {analysis.naturalness.notes.length > 0 && (
                <ul className="analysis-list">
                  {analysis.naturalness.notes.map((note, index) => (
                    <li key={`${note}-${index}`} className="analysis-item">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="analysis-block">
              <h4 className="analysis-subtitle">Vocabulary</h4>
              {analysis.vocabulary.length > 0 ? (
                <div className="vocab-grid">
                  {analysis.vocabulary.map((item, index) => (
                    <article key={`${item.term}-${index}`} className="vocab-card">
                      <p className="analysis-line">
                        <strong>{item.term}</strong>
                      </p>
                      <p className="analysis-line">ZH: {item.meaning_zh}</p>
                      <p className="analysis-line">EN: {item.meaning_en}</p>
                      <p className="analysis-line">Example: {item.example}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No vocabulary suggestions.</p>
              )}
            </div>
          </section>
        )}

        {!isSpeechRecognitionSupported && (
          <p className="support-note">Voice input not supported in this browser.</p>
        )}

        {isListening && (
          <p className="status" role="status">
            Listening...
          </p>
        )}

        {isLoading && (
          <p className="status" role="status">
            Thinking of a helpful reply...
          </p>
        )}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {suggestions.length > 0 && (
          <div>
            <h3 className="section-title">Next steps</h3>
            <ul className="suggestions">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    className="suggestion-button suggestion-chip chip"
                    type="button"
                    disabled={isLoading || isListening}
                    onClick={(event) =>
                      handleSuggestionClick(suggestion, event.shiftKey)
                    }
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
