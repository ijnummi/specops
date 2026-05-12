// @vitest-environment happy-dom

import type { AnalyzeRunDetailDto, ProposalDetailDto, ProposalSummaryDto } from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptProposals: vi.fn(),
  invalidateQueries: vi.fn(),
  patchProposal: vi.fn(),
  proposalDetailOverride: undefined as unknown,
  proposalQueryOptions: [] as Array<{
    enabled?: boolean;
    queryKey: readonly unknown[];
    queryType?: string;
  }>,
  proposalSummariesOverride: undefined as unknown,
  proposalQuery: vi.fn((projectId: string, proposalId: string) => ({
    queryKey: ["projects", projectId, "proposals", proposalId],
    queryType: "proposal"
  })),
  proposalsQuery: vi.fn((projectId: string, input: Record<string, unknown> = {}) => ({
    queryKey: ["projects", projectId, "proposals", input],
    queryType: "proposals"
  })),
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
  useMutation: (options: {
    mutationFn: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown) => unknown;
  }) => ({
    error: null,
    isPending: false,
    mutate: (variables?: unknown) => {
      const result = options.mutationFn(variables);
      void options.onSuccess?.(result, variables);
      return result;
    }
  }),
  useQuery: (options: Record<string, unknown>) => {
    if (options.queryType === "proposals") {
      return {
        data: mocks.proposalSummariesOverride ?? proposalSummaries(),
        error: null,
        isLoading: false
      };
    }

    if (options.queryType === "proposal") {
      mocks.proposalQueryOptions.push(
        options as { enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }
      );
      const proposalId = String((options.queryKey as readonly unknown[])[3]);

      return {
        data: mocks.proposalDetailOverride ?? proposalDetail(proposalId),
        error: null,
        isLoading: false
      };
    }

    mocks.lastUseQueryOptions = options;
    return mocks.state;
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
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
  acceptProposals: mocks.acceptProposals,
  analyzeRunQuery: mocks.analyzeRunQuery,
  patchProposal: mocks.patchProposal,
  proposalQuery: mocks.proposalQuery,
  proposalsQuery: mocks.proposalsQuery,
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    projectReadiness: (projectId: string) => ["projects", projectId, "readiness"],
    proposal: (projectId: string, proposalId: string) => [
      "projects",
      projectId,
      "proposals",
      proposalId
    ],
    proposalsRoot: (projectId: string) => ["projects", projectId, "proposals"],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  }
}));

import { AnalyzeRunDetailPage } from "./analyze-run-detail.js";
import { AnalyzeRunReviewPage } from "./analyze-run-review.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AnalyzeRunDetailPage", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupRenderedRoots();
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

describe("AnalyzeRunReviewPage", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupRenderedRoots();
  });

  it("renders source and AI proposals together", () => {
    const html = renderToStaticMarkup(
      <AnalyzeRunReviewPage projectId="project-1" runId="run-1" />
    );

    expect(mocks.proposalsQuery).toHaveBeenCalledWith("project-1");
    expect(html).toContain("Analyze review");
    expect(html).toContain("DecisionService");
    expect(html).toContain("Manage projects");
    expect(html).toContain("source_spec_entity");
    expect(html).toContain("ai_spec_entity");
    expect(html).toContain("/projects/project-1/analyze-runs/run-1");
  });

  it("shows source evidence for a source proposal detail", () => {
    const html = renderToStaticMarkup(
      <AnalyzeRunReviewPage projectId="project-1" runId="run-1" />
    );

    expect(mocks.proposalQuery).toHaveBeenCalledWith("project-1", "source-proposal-1");
    expect(html).toContain("Source evidence");
    expect(html).toContain("typescript");
    expect(html).toContain("apps/api/src/decision-service.ts");
    expect(html).toContain("DecisionService");
    expect(html).toContain("class");
    expect(html).toContain("line 12");
    expect(html).toContain("exported");
  });

  it("shows AI evidence after selecting an AI proposal detail", async () => {
    const { container } = await renderAnalyzeRunReviewPage();

    await clickButton(container, "Manage projects");

    expect(container.textContent).toContain("AI evidence");
    expect(container.textContent).toContain("ollama");
    expect(container.textContent).toContain("qwen2.5-coder:7b");
    expect(container.textContent).toContain("ai-prefill-v1");
    expect(container.textContent).toContain("apps/api/src/routes/projects.ts");
    expect(container.textContent).toContain("Project routes create and list projects.");
    expect(container.textContent).toContain("uses -> interface.project-service");
  });

  it("accepts checked pending source and AI proposals by id", async () => {
    const { container } = await renderAnalyzeRunReviewPage();

    await changeCheckbox(container, "Select DecisionService", true);
    await changeCheckbox(container, "Select Manage projects", true);
    await clickButton(container, "Accept selected");

    expect(mocks.acceptProposals).toHaveBeenCalledWith("project-1", {
      proposalIds: ["source-proposal-1", "ai-proposal-1"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "readiness"]
    });
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

function resetMocks() {
  mocks.state = {
    data: null,
    error: null,
    isLoading: false
  };
  mocks.acceptProposals.mockReset();
  mocks.acceptProposals.mockImplementation((_projectId: string, input: unknown) => ({
    acceptedProposalIds: (input as { proposalIds: string[] }).proposalIds
  }));
  mocks.invalidateQueries.mockReset();
  mocks.patchProposal.mockReset();
  mocks.patchProposal.mockImplementation(
    (_projectId: string, proposalId: string, input: { markdown?: string; status?: string }) => {
      const detail = proposalDetail(proposalId);
      return {
        ...detail,
        status: input.status ?? detail.status,
        payload: {
          ...detail.payload,
          markdown: input.markdown ?? detail.payload.markdown
        }
      };
    }
  );
  mocks.lastUseQueryOptions = null;
  mocks.analyzeRunQuery.mockClear();
  mocks.proposalDetailOverride = undefined;
  mocks.proposalQuery.mockClear();
  mocks.proposalQueryOptions = [];
  mocks.proposalSummariesOverride = undefined;
  mocks.proposalsQuery.mockClear();
}

function cleanupRenderedRoots() {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
}

async function renderAnalyzeRunReviewPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(<AnalyzeRunReviewPage projectId="project-1" runId="run-1" />);
  });
  await act(async () => {
    await waitForRender();
  });

  return { container };
}

async function clickButton(container: HTMLElement, label: string) {
  const target = button(container, label);

  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();
  });
}

async function changeCheckbox(container: HTMLElement, label: string, checked: boolean) {
  const target = input(container, label);

  await act(async () => {
    if (target.checked !== checked) {
      target.click();
    }
    await waitForRender();
  });
}

function button(container: HTMLElement, label: string) {
  const candidates = Array.from(container.querySelectorAll("button"));
  const target =
    candidates.find((candidate) => candidate.getAttribute("aria-label") === label) ??
    candidates.find((candidate) => candidate.textContent?.trim() === label) ??
    candidates.find((candidate) => candidate.textContent?.includes(label));

  expect(target).toBeDefined();
  return target as HTMLButtonElement;
}

function input(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("input")).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );

  expect(target).toBeDefined();
  return target!;
}

function waitForRender() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function proposalSummaries(): ProposalSummaryDto[] {
  return [sourceProposalSummary(), aiProposalSummary()];
}

function sourceProposalSummary(overrides: Partial<ProposalSummaryDto> = {}): ProposalSummaryDto {
  return {
    id: "source-proposal-1",
    projectId: "project-1",
    proposalType: "source_spec_entity",
    status: "pending",
    title: "DecisionService",
    entityId: "interfaces.decision-service",
    entityType: "interface",
    filePath: "interfaces/decision-service.md",
    confidence: 0.92,
    conflict: { status: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null,
    ...overrides
  } as ProposalSummaryDto;
}

function aiProposalSummary(overrides: Partial<ProposalSummaryDto> = {}): ProposalSummaryDto {
  return {
    id: "ai-proposal-1",
    projectId: "project-1",
    proposalType: "ai_spec_entity",
    status: "pending",
    title: "Manage projects",
    entityId: "uc.manage-projects",
    entityType: "use_case",
    filePath: "use-cases/uc.manage-projects.md",
    confidence: 0.82,
    conflict: { status: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null,
    ...overrides
  } as ProposalSummaryDto;
}

function proposalDetail(proposalId = "source-proposal-1"): ProposalDetailDto {
  return proposalId === "ai-proposal-1" ? aiProposalDetail() : sourceProposalDetail();
}

function sourceProposalDetail(): ProposalDetailDto {
  return {
    ...sourceProposalSummary(),
    payload: {
      entityId: "interfaces.decision-service",
      type: "interface",
      title: "DecisionService",
      status: "draft",
      filePath: "interfaces/decision-service.md",
      generatedMarkdown: "# DecisionService",
      markdown: "# DecisionService\n\nCoordinates policy decisions.",
      sourceFiles: ["apps/api/src/decision-service.ts"],
      symbols: [
        {
          name: "DecisionService",
          kind: "class",
          exported: true,
          file: "apps/api/src/decision-service.ts",
          line: 12
        }
      ]
    },
    evidence: {
      scanner: "typescript",
      sourceFiles: [
        {
          file: "apps/api/src/decision-service.ts",
          symbolName: "DecisionService",
          symbolKind: "class",
          exported: true,
          line: 12
        }
      ]
    }
  } as ProposalDetailDto;
}

function aiProposalDetail(): ProposalDetailDto {
  return {
    ...aiProposalSummary(),
    payload: {
      entityId: "uc.manage-projects",
      type: "use_case",
      title: "Manage projects",
      status: "draft",
      filePath: "use-cases/uc.manage-projects.md",
      generatedMarkdown: "# Manage projects",
      markdown: "# Manage projects\n\nDraft spec.",
      sourceFiles: ["apps/api/src/routes/projects.ts"],
      proposedLinks: [
        {
          linkType: "uses",
          targetEntityId: "interface.project-service",
          targetExists: true,
          rationale: "The selected route delegates project behavior to the project service."
        }
      ]
    },
    evidence: {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      promptVersion: "ai-prefill-v1",
      selectedSourceFiles: [
        {
          file: "apps/api/src/routes/projects.ts",
          contentHash: "hash-1",
          excerptStartLine: 1,
          excerptEndLine: 80
        }
      ],
      claims: [
        {
          text: "Project routes create and list projects.",
          sourceFiles: ["apps/api/src/routes/projects.ts"]
        }
      ],
      warnings: []
    }
  } as ProposalDetailDto;
}
