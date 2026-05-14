import type {
  AiPrefillProvider,
  AiPrefillProviderName,
  AiPrefillProviderResult
} from "./types.js";

export type CreateAiPrefillProviderInput = {
  provider: AiPrefillProviderName;
  ollamaBaseUrl?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  timeoutMs?: number;
};

const defaultTimeoutMs = 60_000;

export function createAiPrefillProvider(
  input: CreateAiPrefillProviderInput
): AiPrefillProvider {
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;

  if (input.provider === "ollama") {
    const baseUrl = trimTrailingSlash(input.ollamaBaseUrl ?? "http://127.0.0.1:11434");
    return {
      async generateSpecProposals(providerInput) {
        const json = await postJson({
          url: `${baseUrl}/api/chat`,
          timeoutMs,
          body: {
            model: providerInput.model,
            messages: providerInput.packet.messages,
            stream: false,
            format: "json",
            options: { temperature: providerInput.temperature }
          }
        });

        const text = readOllamaMessageContent(json);
        return result(input.provider, providerInput.model, text);
      },
      async generateConceptGraph(providerInput) {
        const json = await postJson({
          url: `${baseUrl}/api/chat`,
          timeoutMs,
          body: {
            model: providerInput.model,
            messages: providerInput.packet.messages,
            stream: false,
            format: "json",
            options: { temperature: providerInput.temperature }
          }
        });

        const text = readOllamaMessageContent(json);
        return result(input.provider, providerInput.model, text);
      }
    };
  }

  const apiKey = input.openAiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI AI Prefill");
  }

  const baseUrl = trimTrailingSlash(input.openAiBaseUrl ?? "https://api.openai.com/v1");
  return {
    async generateSpecProposals(providerInput) {
      const json = await postJson({
        url: `${baseUrl}/chat/completions`,
        timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model: providerInput.model,
          messages: providerInput.packet.messages,
          temperature: providerInput.temperature,
          response_format: { type: "json_object" }
        }
      });

      const text = readOpenAiMessageContent(json);
      return result(input.provider, providerInput.model, text);
    },
    async generateConceptGraph(providerInput) {
      const json = await postJson({
        url: `${baseUrl}/chat/completions`,
        timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model: providerInput.model,
          messages: providerInput.packet.messages,
          temperature: providerInput.temperature,
          response_format: { type: "json_object" }
        }
      });

      const text = readOpenAiMessageContent(json);
      return result(input.provider, providerInput.model, text);
    }
  };
}

async function postJson(input: {
  url: string;
  body: unknown;
  timeoutMs?: number;
  headers?: Record<string, string>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout =
    input.timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...input.headers
      },
      body: JSON.stringify(input.body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI provider request failed with status ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function result(
  provider: AiPrefillProviderName,
  model: string,
  text: string
): AiPrefillProviderResult {
  return { provider, model, text };
}

function readOllamaMessageContent(json: unknown): string {
  if (!isRecord(json)) {
    throw new Error("Ollama response did not include message content");
  }

  const message = json.message;
  if (!isRecord(message) || typeof message.content !== "string") {
    throw new Error("Ollama response did not include message content");
  }

  return message.content;
}

function readOpenAiMessageContent(json: unknown): string {
  if (!isRecord(json) || !Array.isArray(json.choices)) {
    throw new Error("OpenAI response did not include message content");
  }

  const firstChoice = json.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("OpenAI response did not include message content");
  }

  const { content } = firstChoice.message;
  if (typeof content !== "string") {
    throw new Error("OpenAI response did not include message content");
  }

  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
