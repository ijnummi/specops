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
  annotationsQuery,
  analyzeRunQuery,
  createAnnotation,
  deleteAnnotation,
  entitySourceLinksQuery,
  generateAiPrefillProposals,
  patchAnnotation,
  proposalsQuery,
  queryKeys,
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

  it("fetches entity source evidence from active annotations", async () => {
    mocks.apiGet.mockResolvedValueOnce([]);
    const query = entitySourceLinksQuery("project-1", "domain.decision");

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/annotations?entityId=domain.decision&status=active&includeExcerpt=true"
    );
  });

  it("serializes annotation list filters", async () => {
    mocks.apiGet.mockResolvedValueOnce([]);
    const query = annotationsQuery("project-1", {
      entityId: "domain.decision",
      sourceFileId: "00000000-0000-4000-8000-000000000001",
      filePath: "src/domain/decision.ts",
      relationshipType: "implements",
      status: "stale",
      provenance: "ai",
      includeExcerpt: true
    });

    expect(query.queryKey).toEqual([
      "projects",
      "project-1",
      "annotations",
      {
        entityId: "domain.decision",
        sourceFileId: "00000000-0000-4000-8000-000000000001",
        filePath: "src/domain/decision.ts",
        relationshipType: "implements",
        status: "stale",
        provenance: "ai",
        includeExcerpt: true
      }
    ]);

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/annotations?entityId=domain.decision&sourceFileId=00000000-0000-4000-8000-000000000001&filePath=src%2Fdomain%2Fdecision.ts&relationshipType=implements&status=stale&provenance=ai&includeExcerpt=true"
    );
  });

  it("writes annotations through project-scoped mutation helpers", async () => {
    const createInput = {
      sourceFilePath: "src/domain/decision.ts",
      symbolName: null,
      symbolKind: null,
      startLine: null,
      endLine: null,
      annotationLine: null,
      entityId: "domain.decision",
      claimId: null,
      relationshipType: "implements" as const,
      confidence: 0.8
    };
    const patchInput = {
      status: "stale" as const,
      confidence: 0.4
    };

    mocks.apiSend.mockResolvedValue({});

    await createAnnotation("project-1", createInput);
    await patchAnnotation("project-1", "annotation-1", patchInput);
    await deleteAnnotation("project-1", "annotation-1");

    expect(mocks.apiSend).toHaveBeenNthCalledWith(
      1,
      "POST",
      "/api/projects/project-1/annotations",
      createInput
    );
    expect(mocks.apiSend).toHaveBeenNthCalledWith(
      2,
      "PATCH",
      "/api/projects/project-1/annotations/annotation-1",
      patchInput
    );
    expect(mocks.apiSend).toHaveBeenNthCalledWith(
      3,
      "DELETE",
      "/api/projects/project-1/annotations/annotation-1"
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

    expect(query.queryKey).toEqual(["projects", "project-1", "analyze-runs", "run-1"]);
    expect(queryKeys.analyzeRun("project-1", "run-1")).toEqual([
      "projects",
      "project-1",
      "analyze-runs",
      "run-1"
    ]);

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/analyze-runs/run-1"
    );
  });
});
