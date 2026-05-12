import { describe, expect, it } from "vitest";

import {
  activeAnalyzeRunConflictSchema,
  analyzeRunDetailSchema,
  analyzeRunSelectionSummarySchema,
} from "./analyze-runs.js";
import type { AnalyzeRunSelectionCategory } from "./analyze-runs.js";

const analyzeRunId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const indexRunId = "33333333-3333-4333-8333-333333333333";
const sourceProposalId = "44444444-4444-4444-8444-444444444444";
const aiProposalId = "55555555-5555-4555-8555-555555555555";

const categoryTypecheck: AnalyzeRunSelectionCategory = {
  category: "entrypoints_routes",
  count: 1,
};
void categoryTypecheck;

describe("analyze run contracts", () => {
  it("parses analyze run details", () => {
    const parsed = analyzeRunDetailSchema.parse({
      id: analyzeRunId,
      projectId,
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
      proposalIds: [sourceProposalId, aiProposalId],
      sourceProposalCount: 2,
      aiProposalCount: 1,
      indexRunId,
      errorMessage: null,
      createdAt: "2026-05-12T09:59:59.000Z",
      startedAt: "2026-05-12T10:00:00.000Z",
      finishedAt: null,
    });

    expect(parsed.status).toBe("running");
    expect(parsed.steps[0]?.counts.sourceFileCount).toBe(4);
    expect(parsed.selection?.skippedHighSignalFileCount).toBe(2);
    expect(parsed.proposalIds).toEqual([sourceProposalId, aiProposalId]);
  });

  it("allows empty selection diagnostics", () => {
    const parsed = analyzeRunSelectionSummarySchema.parse({
      selectedSourceFileIds: [],
      selectedPaths: [],
      eligibleHighSignalFileCount: 0,
      skippedHighSignalFileCount: 0,
      categories: [],
      diagnostics: [],
    });

    expect(parsed.selectedPaths).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("allows warning selection diagnostics", () => {
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
        activeRunId: analyzeRunId,
      }),
    ).toEqual({ activeRunId: analyzeRunId });
  });

  it("rejects malformed UUIDs", () => {
    expect(() =>
      analyzeRunDetailSchema.parse({
        id: "run-1",
        projectId,
        status: "running",
        currentStep: "index",
        steps: [],
        selection: null,
        proposalIds: [],
        sourceProposalCount: 0,
        aiProposalCount: 0,
        indexRunId,
        errorMessage: null,
        createdAt: "2026-05-12T09:59:59.000Z",
        startedAt: null,
        finishedAt: null,
      }),
    ).toThrow();

    expect(() =>
      activeAnalyzeRunConflictSchema.parse({
        activeRunId: "run-1",
      }),
    ).toThrow();
  });

  it("rejects malformed timestamps", () => {
    expect(() =>
      analyzeRunDetailSchema.parse({
        id: analyzeRunId,
        projectId,
        status: "running",
        currentStep: "index",
        steps: [
          {
            name: "index",
            status: "running",
            startedAt: "not-a-date",
            finishedAt: null,
            message: null,
            counts: {},
          },
        ],
        selection: null,
        proposalIds: [],
        sourceProposalCount: 0,
        aiProposalCount: 0,
        indexRunId: null,
        errorMessage: null,
        createdAt: "2026-05-12T09:59:59.000Z",
        startedAt: "2026-05-12T10:00:00.000Z",
        finishedAt: null,
      }),
    ).toThrow();
  });

  it("rejects invalid statuses", () => {
    expect(() =>
      analyzeRunDetailSchema.parse({
        id: analyzeRunId,
        projectId,
        status: "paused",
        currentStep: "index",
        steps: [],
        selection: null,
        proposalIds: [],
        sourceProposalCount: 0,
        aiProposalCount: 0,
        indexRunId: null,
        errorMessage: null,
        createdAt: "2026-05-12T09:59:59.000Z",
        startedAt: null,
        finishedAt: null,
      }),
    ).toThrow();
  });

  it("rejects empty diagnostic messages", () => {
    expect(() =>
      analyzeRunSelectionSummarySchema.parse({
        selectedSourceFileIds: [],
        selectedPaths: [],
        eligibleHighSignalFileCount: 0,
        skippedHighSignalFileCount: 0,
        categories: [],
        diagnostics: [{ level: "warning", message: "" }],
      }),
    ).toThrow();
  });

  it("rejects negative counts", () => {
    expect(() =>
      analyzeRunSelectionSummarySchema.parse({
        selectedSourceFileIds: [],
        selectedPaths: [],
        eligibleHighSignalFileCount: -1,
        skippedHighSignalFileCount: 0,
        categories: [],
        diagnostics: [],
      }),
    ).toThrow();

    expect(() =>
      analyzeRunDetailSchema.parse({
        id: analyzeRunId,
        projectId,
        status: "running",
        currentStep: "index",
        steps: [
          {
            name: "index",
            status: "succeeded",
            startedAt: "2026-05-12T10:00:00.000Z",
            finishedAt: "2026-05-12T10:00:02.000Z",
            message: null,
            counts: { sourceFileCount: -1 },
          },
        ],
        selection: null,
        proposalIds: [],
        sourceProposalCount: 0,
        aiProposalCount: 0,
        indexRunId: null,
        errorMessage: null,
        createdAt: "2026-05-12T09:59:59.000Z",
        startedAt: "2026-05-12T10:00:00.000Z",
        finishedAt: null,
      }),
    ).toThrow();
  });

  it("rejects malformed proposal IDs", () => {
    expect(() =>
      analyzeRunDetailSchema.parse({
        id: analyzeRunId,
        projectId,
        status: "running",
        currentStep: "index",
        steps: [],
        selection: null,
        proposalIds: ["proposal-1"],
        sourceProposalCount: 0,
        aiProposalCount: 0,
        indexRunId: null,
        errorMessage: null,
        createdAt: "2026-05-12T09:59:59.000Z",
        startedAt: null,
        finishedAt: null,
      }),
    ).toThrow();
  });
});
