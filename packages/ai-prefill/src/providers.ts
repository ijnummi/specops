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

export function createAiPrefillProvider(
  input: CreateAiPrefillProviderInput
): AiPrefillProvider {
  if (input.provider === "ollama") {
    const baseUrl = trimTrailingSlash(input.ollamaBaseUrl ?? "http://127.0.0.1:11434");
    return {
      async generateSpecProposals(providerInput) {
        const json = await postJson({
          url: `${baseUrl}/api/chat`,
          timeoutMs: input.timeoutMs,
          body: {
            model: providerInput.model,
            messages: providerInput.packet.messages,
            stream: false,
            options: { temperature: providerInput.temperature }
          }
        });

        return result(input.provider, providerInput.model, json.message?.content ?? "");
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
        timeoutMs: input.timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model: providerInput.model,
          messages: providerInput.packet.messages,
          temperature: providerInput.temperature,
          response_format: { type: "json_object" }
        }
      });

      return result(
        input.provider,
        providerInput.model,
        json.choices?.[0]?.message?.content ?? ""
      );
    }
  };
}

async function postJson(input: {
  url: string;
  body: unknown;
  timeoutMs?: number;
  headers?: Record<string, string>;
}): Promise<any> {
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

    return response.json();
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
