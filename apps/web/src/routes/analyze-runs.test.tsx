// @vitest-environment happy-dom

import type { AnalyzeRunDetailDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    data: null as AnalyzeRunDetailDto | null,
    error: null as Error | null,
    isLoading: false
  },
  lastUseQueryOptions: null as Record<string, unknown> | null,
  analyzeRunQuery: vi.fn((projectId: string, runId: string) => ({
    queryKey: ["projects", projectId, "analyze-runs", runId],
    queryFn: vi.fn()
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mocks.lastUseQueryOptions = options;
    return mocks.state;
  }
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to
  }: {
    children: ReactNode;
    className?: string;
    params?: Record<string, string>;
    to: string;
  }) => (
    <a
      className={className}
      href={to
        .replace("$projectId", params?.projectId ?? "")
        .replace("$runId", params?.runId ?? "")}
    >
      {children}
    </a>
  )
}));

vi.mock("../api/queries.js", () => ({
  analyzeRunQuery: mocks.analyzeRunQuery
}));

import { AnalyzeRunDetailPage } from "./analyze-run-detail.js";

describe("AnalyzeRunDetailPage", () => {
  beforeEach(() => {
    mocks.state = {
      data: null,
      error: null,
      isLoading: false
    };
    mocks.lastUseQueryOptions = null;
    mocks.analyzeRunQuery.mockClear();
  });

  it("renders running progress and polls active runs", () => {
    mocks.state = {
      data: analyzeRun({
        status: "running",
        currentStep: "select_ai_sources",
        sourceProposalCount: 4,
        aiProposalCount: 1
      }),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <AnalyzeRunDetailPage projectId="project-1" runId="run-1" />
    );

    expect(mocks.analyzeRunQuery).toHaveBeenCalledWith("project-1", "run-1");
    expect(mocks.lastUseQueryOptions?.queryKey).toEqual([
      "projects",
      "project-1",
      "analyze-runs",
      "run-1"
    ]);
    expect(refetchIntervalFor(mocks.state.data)).toBe(2000);
    expect(html).toContain("Analyze project");
    expect(html).toContain("running");
    expect(html).toContain("Select AI sources");
    expect(html).toContain("4");
    expect(html).toContain("source proposals");
    expect(html).toContain("1");
    expect(html).toContain("AI proposals");
    expect(html).toContain("3");
    expect(html).toContain("selected AI source files");
    expect(html).toContain("/projects/project-1");
  });

  it("links to generated draft review when the run succeeds", () => {
    mocks.state = {
      data: analyzeRun({
        status: "succeeded",
        sourceProposalCount: 5,
        aiProposalCount: 2
      }),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <AnalyzeRunDetailPage projectId="project-1" runId="run-1" />
    );

    expect(refetchIntervalFor(mocks.state.data)).toBe(false);
    expect(html).toContain("Review generated drafts");
    expect(html).toContain("/projects/project-1/analyze-runs/run-1/review");
  });

  it("shows diagnostics and review link when a failed run has partial proposals", () => {
    mocks.state = {
      data: analyzeRun({
        status: "failed",
        sourceProposalCount: 2,
        aiProposalCount: 0,
        errorMessage: "AI prefill failed.",
        selection: {
          selectedSourceFileIds: ["source-1"],
          selectedPaths: ["apps/api/src/routes.ts"],
          eligibleHighSignalFileCount: 6,
          skippedHighSignalFileCount: 5,
          categories: [{ category: "entrypoints_routes", count: 1 }],
          diagnostics: [
            {
              level: "warning",
              message: "Partial coverage: selected 1 of 6 high-signal source files."
            }
          ]
        }
      }),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <AnalyzeRunDetailPage projectId="project-1" runId="run-1" />
    );

    expect(html).toContain("AI prefill failed.");
    expect(html).toContain("Partial coverage");
    expect(html).toContain("selected 1 of 6 high-signal source files");
    expect(html).toContain("Review generated drafts");
    expect(html).toContain("/projects/project-1/analyze-runs/run-1/review");
  });
});

function refetchIntervalFor(data: AnalyzeRunDetailDto | null) {
  const refetchInterval = mocks.lastUseQueryOptions?.refetchInterval;
  expect(refetchInterval).toEqual(expect.any(Function));
  return (refetchInterval as (query: { state: { data: AnalyzeRunDetailDto | null } }) => number | false)({
    state: { data }
  });
}

function analyzeRun(overrides: Partial<AnalyzeRunDetailDto> = {}): AnalyzeRunDetailDto {
  return {
    id: "run-1",
    projectId: "project-1",
    status: "running",
    currentStep: "index",
    steps: [
      {
        name: "initialize",
        status: "succeeded",
        startedAt: "2026-05-12T08:00:00.000Z",
        finishedAt: "2026-05-12T08:00:01.000Z",
        message: null,
        counts: {}
      },
      {
        name: "index",
        status: "succeeded",
        startedAt: "2026-05-12T08:00:01.000Z",
        finishedAt: "2026-05-12T08:00:05.000Z",
        message: "Indexed project.",
        counts: { sourceFileCount: 12 }
      },
      {
        name: "source_proposals",
        status: "succeeded",
        startedAt: "2026-05-12T08:00:05.000Z",
        finishedAt: "2026-05-12T08:00:08.000Z",
        message: null,
        counts: { proposalCount: 4 }
      },
      {
        name: "select_ai_sources",
        status: "running",
        startedAt: "2026-05-12T08:00:08.000Z",
        finishedAt: null,
        message: null,
        counts: {}
      },
      {
        name: "ai_prefill",
        status: "pending",
        startedAt: null,
        finishedAt: null,
        message: null,
        counts: {}
      }
    ],
    selection: {
      selectedSourceFileIds: ["source-1", "source-2", "source-3"],
      selectedPaths: [
        "apps/api/src/routes.ts",
        "apps/api/src/services/analyze.ts",
        "apps/web/src/routes/project-detail.tsx"
      ],
      eligibleHighSignalFileCount: 3,
      skippedHighSignalFileCount: 0,
      categories: [
        { category: "entrypoints_routes", count: 1 },
        { category: "services_modules", count: 1 },
        { category: "frontend_views", count: 1 }
      ],
      diagnostics: []
    },
    sourceProposalCount: 4,
    aiProposalCount: 1,
    indexRunId: "index-run-1",
    errorMessage: null,
    createdAt: "2026-05-12T07:59:59.000Z",
    startedAt: "2026-05-12T08:00:00.000Z",
    finishedAt: null,
    ...overrides
  };
}
