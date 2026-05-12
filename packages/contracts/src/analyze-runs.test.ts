import { describe, expect, it } from "vitest";

import {
  activeAnalyzeRunConflictSchema,
  analyzeRunDetailSchema,
  analyzeRunSelectionSummarySchema,
} from "./analyze-runs.js";

describe("analyze run contracts", () => {
  it("parses analyze run details", () => {
    const parsed = analyzeRunDetailSchema.parse({
      id: "run-1",
      projectId: "project-1",
      status: "running",
      currentStep: "ai_prefill",
      steps: [
        {
          name: "index",
          status: "succeeded",
          startedAt: "2026-05-12T10:00:00.000Z",
          finishedAt: "2026-05-12T10:00:02.000Z",
          message: null,
          counts: { sourceFileCount: 4 },
        },
      ],
      selection: {
        selectedSourceFileIds: ["source-1"],
        selectedPaths: ["apps/api/src/routes/projects.ts"],
        eligibleHighSignalFileCount: 3,
        skippedHighSignalFileCount: 2,
        categories: [{ category: "entrypoints_routes", count: 1 }],
        diagnostics: [{ level: "info", message: "Partial AI coverage." }],
      },
      sourceProposalCount: 2,
      aiProposalCount: 1,
      indexRunId: "index-run-1",
      errorMessage: null,
      createdAt: "2026-05-12T09:59:59.000Z",
      startedAt: "2026-05-12T10:00:00.000Z",
      finishedAt: null,
    });

    expect(parsed.status).toBe("running");
    expect(parsed.steps[0]?.counts.sourceFileCount).toBe(4);
    expect(parsed.selection?.skippedHighSignalFileCount).toBe(2);
  });

  it("allows empty selection diagnostics", () => {
    const parsed = analyzeRunSelectionSummarySchema.parse({
      selectedSourceFileIds: [],
      selectedPaths: [],
      eligibleHighSignalFileCount: 0,
      skippedHighSignalFileCount: 0,
      categories: [],
      diagnostics: [{ level: "warning", message: "No indexed source files were available." }],
    });

    expect(parsed.selectedPaths).toEqual([]);
    expect(parsed.diagnostics[0]?.level).toBe("warning");
  });

  it("parses active run conflict payloads", () => {
    expect(
      activeAnalyzeRunConflictSchema.parse({
        activeRunId: "run-1",
      }),
    ).toEqual({ activeRunId: "run-1" });
  });
});
