import { afterEach, describe, expect, it, vi } from "vitest";

import { createAiPrefillProvider } from "../providers.js";
import type { AiPrefillPromptPacket } from "../types.js";

describe("createAiPrefillProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("sends Ollama chat requests and extracts message content", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: "{\"proposals\":[]}" } })
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const provider = createAiPrefillProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434/"
    });
    const result = await provider.generateSpecProposals({
      packet: packet(),
      model: "qwen2.5-coder:7b",
      temperature: 0.2
    });

    expect(result).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      text: "{\"proposals\":[]}"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "qwen2.5-coder:7b",
      messages: packet().messages,
      stream: false,
      format: "json",
      options: { temperature: 0.2 }
    });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it("throws when OpenAI API key is missing", () => {
    expect(() => createAiPrefillProvider({ provider: "openai" })).toThrow(
      "OPENAI_API_KEY is required for OpenAI AI Prefill"
    );
  });

  it("sends OpenAI chat completion requests and extracts first choice content", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "{\"proposals\":[]}" } }]
      })
    });

    const provider = createAiPrefillProvider({
      provider: "openai",
      openAiApiKey: "test-key",
      openAiBaseUrl: "https://example.test/v1/"
    });
    const result = await provider.generateSpecProposals({
      packet: packet(),
      model: "gpt-5-mini",
      temperature: 0.1
    });

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
      text: "{\"proposals\":[]}"
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer test-key"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5-mini",
      messages: packet().messages,
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
  });

  it("throws for non-ok provider responses", async () => {
    mockFetch({ ok: false, status: 503, json: async () => ({}) });

    const provider = createAiPrefillProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434"
    });

    await expect(
      provider.generateSpecProposals({
        packet: packet(),
        model: "qwen2.5-coder:7b",
        temperature: 0.1
      })
    ).rejects.toThrow("AI provider request failed with status 503");
  });

  it("throws for malformed Ollama response envelopes", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ message: {} }) });

    const provider = createAiPrefillProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434"
    });

    await expect(
      provider.generateSpecProposals({
        packet: packet(),
        model: "qwen2.5-coder:7b",
        temperature: 0.1
      })
    ).rejects.toThrow("Ollama response did not include message content");
  });

  it("throws for malformed OpenAI response envelopes", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ choices: [] }) });

    const provider = createAiPrefillProvider({
      provider: "openai",
      openAiApiKey: "test-key"
    });

    await expect(
      provider.generateSpecProposals({
        packet: packet(),
        model: "gpt-5-mini",
        temperature: 0.1
      })
    ).rejects.toThrow("OpenAI response did not include message content");
  });
});

function mockFetch(response: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}) {
  const fetchMock = vi.fn<
    (input: string | URL | Request, init?: RequestInit) => Promise<typeof response>
  >();
  fetchMock.mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function packet(): AiPrefillPromptPacket {
  return {
    promptVersion: "ai-prefill-v1",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user" }
    ],
    selectedSourceFiles: []
  };
}
