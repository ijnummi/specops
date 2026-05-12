import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiSend: vi.fn()
}));

vi.mock("./client.js", () => ({
  apiGet: mocks.apiGet,
  apiSend: mocks.apiSend
}));

import {
  analyzeRunQuery,
  generateAiPrefillProposals,
  proposalsQuery,
  sourceFilesQuery,
  startAnalyzeRun
} from "./queries.js";

describe("api queries", () => {
  it("serializes proposal type in proposal list requests", async () => {
    mocks.apiGet.mockResolvedValueOnce([]);
    const query = proposalsQuery("project-1", {
      status: "pending",
      proposalType: "ai_spec_entity"
    });

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/proposals?status=pending&proposalType=ai_spec_entity"
    );
  });

  it("serializes source file filters in source file list requests", async () => {
    mocks.apiGet.mockResolvedValueOnce([]);
    const query = sourceFilesQuery("project-1", {
      language: "typescript",
      kind: "source",
      q: "routes",
      limit: 100,
      offset: 20
    });

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/source-files?language=typescript&kind=source&q=routes&limit=100&offset=20"
    );
  });

  it("posts ai prefill generation requests", async () => {
    const input = {
      provider: "ollama" as const,
      model: "qwen2.5-coder:7b",
      sourceFileIds: ["source-file-1"],
      temperature: 0.1
    };

    mocks.apiSend.mockResolvedValueOnce({ proposals: [], diagnostics: [] });

    await generateAiPrefillProposals("project-1", input);

    expect(mocks.apiSend).toHaveBeenCalledWith(
      "POST",
      "/api/projects/project-1/proposals/ai-prefill",
      input
    );
  });

  it("posts analyze run start requests", async () => {
    mocks.apiSend.mockResolvedValueOnce({ runId: "run-1" });

    await startAnalyzeRun("project-1");

    expect(mocks.apiSend).toHaveBeenCalledWith(
      "POST",
      "/api/projects/project-1/analyze-runs"
    );
  });

  it("fetches analyze run details", async () => {
    mocks.apiGet.mockResolvedValueOnce({ runId: "run-1" });
    const query = analyzeRunQuery("project-1", "run-1");

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/analyze-runs/run-1"
    );
  });
});
