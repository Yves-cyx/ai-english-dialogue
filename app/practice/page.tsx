"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";

type DialogueMessage = {
  role: "user" | "assistant";
  content: string;
};

type DialogueResponse = {
  reply: string;
  suggestions: string[];
};

const SCENARIO_TITLE = "Hotel Check-in Conversation";
const SCENARIO_INTRO =
  "Practice checking into a hotel after a long trip. Ask about rooms, amenities, and any special requests.";

export default function PracticePage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDialogue = useMemo(() => messages.length > 0, [messages.length]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;

      const userMessage: DialogueMessage = { role: "user", content: trimmed };
      const nextMessages = [...messages, userMessage];

      setMessages(nextMessages);
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/dialogue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages,
            scenarioId: "hotel_checkin",
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

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply },
        ]);
        setSuggestions(data.suggestions);
        setInput("");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to send message.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [input, messages]
  );

  return (
    <main className="page">
      <section className="card" aria-live="polite">
        <div>
          <p className="muted">Scenario</p>
          <h1 className="title">{SCENARIO_TITLE}</h1>
          <p className="muted">{SCENARIO_INTRO}</p>
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
          </div>
        </div>

        <form className="input-row" onSubmit={handleSubmit}>
          <input
            className="text-input"
            value={input}
            placeholder="Type your message..."
            onChange={(event) => setInput(event.target.value)}
            disabled={isLoading}
            aria-label="Message to send"
          />
          <button className="secondary-button" type="submit" disabled={isLoading}>
            {isLoading ? "Sending..." : "Send"}
          </button>
        </form>

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
                <li key={suggestion} className="suggestion-chip">
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
