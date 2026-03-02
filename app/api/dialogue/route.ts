import { NextResponse } from "next/server";
import { getScenarioById } from "../../lib/scenarios";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type DialogueRequestPayload = {
  messages?: unknown;
  scenarioId?: unknown;
};

type DialogueApiResponse = {
  reply: string;
  suggestions: string[];
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

function isDialogueResponse(value: unknown): value is DialogueApiResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.reply === "string" &&
    Array.isArray(record.suggestions) &&
    record.suggestions.length === 3 &&
    record.suggestions.every((item) => typeof item === "string")
  );
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    {
      status: 405,
      headers: { Allow: "POST" },
    }
  );
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

export async function POST(request: Request) {
  let payload: DialogueRequestPayload;

  try {
    payload = (await request.json()) as DialogueRequestPayload;
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

  try {
    const rawScenarioId =
      typeof payload.scenarioId === "string" ? payload.scenarioId : undefined;
    const scenario = getScenarioById(rawScenarioId);

    const deepSeekMessages: DeepSeekMessage[] = [
      {
        role: "system",
        content:
          `${scenario.systemPrompt} Stay in role, keep replies concise and natural, and do not provide meta explanations. Return STRICT JSON only in this exact shape: {"reply":"string","suggestions":["string","string","string"]}. suggestions must contain exactly 3 short strings.`,
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
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
          temperature: 0.7,
        }),
      }
    );

    const responseJson = (await deepSeekResponse.json()) as DeepSeekResponse;

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

    if (!isDialogueResponse(parsed)) {
      throw new Error("DeepSeek returned an unexpected response shape.");
    }

    return NextResponse.json({
      reply: parsed.reply,
      suggestions: parsed.suggestions,
    });
  } catch (error) {
    console.error("Failed to generate dialogue with DeepSeek:", error);
    return NextResponse.json(
      { error: "Failed to generate dialogue." },
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
