import { NextResponse } from "next/server";
import { getScenarioById } from "../../lib/scenarios";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnalyzeRequestPayload = {
  messages?: unknown;
  scenarioId?: unknown;
};

type GrammarItem = {
  original: string;
  corrected: string;
  reason: string;
};

type NaturalnessItem = {
  rewrites: string[];
  notes: string[];
};

type VocabularyItem = {
  term: string;
  meaning_zh: string;
  meaning_en: string;
  example: string;
};

type AnalyzeResponse = {
  score: number;
  grammar: GrammarItem[];
  naturalness: NaturalnessItem;
  vocabulary: VocabularyItem[];
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChoice = {
  message?: {
    content?: string;
  };
};

type DeepSeekResponse = {
  choices?: DeepSeekChoice[];
  error?: {
    message?: string;
  };
};

const MAX_TOTAL_MESSAGE_CHARACTERS = 2000;
const MAX_GRAMMAR_ITEMS = 6;
const MAX_VOCAB_ITEMS = 6;
const MAX_REWRITES = 2;

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    {
      status: 405,
      headers: { Allow: "POST" },
    }
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateAndNormalizeMessages(
  value: unknown
): ConversationMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized: ConversationMessage[] = [];
  let totalCharacters = 0;

  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const record = item as Record<string, unknown>;
    const role = record.role;
    const rawContent = record.content;

    if ((role !== "user" && role !== "assistant") || typeof rawContent !== "string") {
      return null;
    }

    const content = rawContent.trim();

    if (!content) {
      return null;
    }

    totalCharacters += content.length;
    normalized.push({ role, content });
  }

  if (normalized[normalized.length - 1]?.role !== "user") {
    return null;
  }

  if (totalCharacters > MAX_TOTAL_MESSAGE_CHARACTERS) {
    return null;
  }

  return normalized;
}

function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.score !== "number" ||
    Number.isNaN(record.score) ||
    record.score < 0 ||
    record.score > 100
  ) {
    return false;
  }

  if (!Array.isArray(record.grammar) || record.grammar.length > MAX_GRAMMAR_ITEMS) {
    return false;
  }

  const grammarValid = record.grammar.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const grammarRecord = item as Record<string, unknown>;
    return (
      typeof grammarRecord.original === "string" &&
      typeof grammarRecord.corrected === "string" &&
      typeof grammarRecord.reason === "string"
    );
  });

  if (!grammarValid) {
    return false;
  }

  if (!record.naturalness || typeof record.naturalness !== "object") {
    return false;
  }

  const naturalness = record.naturalness as Record<string, unknown>;
  if (
    !isStringArray(naturalness.rewrites) ||
    naturalness.rewrites.length > MAX_REWRITES ||
    !isStringArray(naturalness.notes)
  ) {
    return false;
  }

  if (
    !Array.isArray(record.vocabulary) ||
    record.vocabulary.length > MAX_VOCAB_ITEMS
  ) {
    return false;
  }

  const vocabularyValid = record.vocabulary.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const vocabRecord = item as Record<string, unknown>;
    return (
      typeof vocabRecord.term === "string" &&
      typeof vocabRecord.meaning_zh === "string" &&
      typeof vocabRecord.meaning_en === "string" &&
      typeof vocabRecord.example === "string"
    );
  });

  return vocabularyValid;
}

export async function POST(request: Request) {
  let payload: AnalyzeRequestPayload;

  try {
    payload = (await request.json()) as AnalyzeRequestPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = validateAndNormalizeMessages(payload.messages);

  if (!messages) {
    return NextResponse.json(
      {
        error:
          "Invalid `messages`: provide a non-empty array with non-empty content, last role `user`, and total content <= 2000 characters.",
      },
      { status: 400 }
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing DeepSeek configuration." },
      { status: 500 }
    );
  }

  const scenarioId =
    typeof payload.scenarioId === "string" ? payload.scenarioId : undefined;
  const scenario = getScenarioById(scenarioId);
  const contextMessages = messages.slice(Math.max(messages.length - 3, 0));
  const latestUserMessage = messages[messages.length - 1];

  try {
    const deepSeekMessages: DeepSeekMessage[] = [
      {
        role: "system",
        content:
          `${scenario.systemPrompt} You are now an English speaking coach. Analyze mainly the latest user message and keep feedback concise and practical. Return STRICT JSON ONLY with exactly this shape: {"score":number,"grammar":[{"original":"string","corrected":"string","reason":"string"}],"naturalness":{"rewrites":["string"],"notes":["string"]},"vocabulary":[{"term":"string","meaning_zh":"string","meaning_en":"string","example":"string"}]}. Limits: grammar max 6 items, rewrites max 2 items, vocabulary max 6 items. No markdown or extra text.`,
      },
      ...contextMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: `Analyze this latest user utterance: "${latestUserMessage.content}"`,
      },
    ];

    const deepSeekResponse = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: deepSeekMessages,
          temperature: 0.3,
        }),
      }
    );

    const rawBody = await deepSeekResponse.text();
    let responseJson: DeepSeekResponse = {};

    if (rawBody) {
      try {
        responseJson = JSON.parse(rawBody) as DeepSeekResponse;
      } catch {
        if (!deepSeekResponse.ok) {
          throw new Error("DeepSeek API returned a non-JSON error response.");
        }
      }
    }

    if (!deepSeekResponse.ok) {
      throw new Error(
        responseJson.error?.message ?? "DeepSeek API returned an error."
      );
    }

    const content = responseJson.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      throw new Error("DeepSeek returned an empty response.");
    }

    const parsed: unknown = JSON.parse(content);

    if (!isAnalyzeResponse(parsed)) {
      throw new Error("DeepSeek returned an unexpected analysis shape.");
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Failed to analyze dialogue with DeepSeek:", error);
    return NextResponse.json(
      { error: "Failed to analyze message." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return methodNotAllowed();
}

export async function HEAD() {
  return methodNotAllowed();
}

