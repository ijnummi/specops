// @vitest-environment happy-dom

import type { AnalyzeReviewListResponse, AnalyzeRunDetailDto } from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptAnalyzeReviewAssemblies: vi.fn(),
  analyzeReviewAssembliesQuery: vi.fn((projectId: string, runId: string) => ({
    queryKey: ["projects", projectId, "analyze-runs", runId, "review-assemblies"],
    queryType: "analyzeReviewAssemblies",
    queryFn: vi.fn()
  })),
  analyzeRunQuery: vi.fn((projectId: string, runId: string) => ({
    queryKey: ["projects", projectId, "analyze-runs", runId],
    queryType: "analyzeRun",
    queryFn: vi.fn()
  })),
  attachAnalyzeReviewInput: vi.fn(),
  createAnalyzeReviewAssembly: vi.fn(),
  createAnalyzeReviewClaim: vi.fn(),
  invalidateQueries: vi.fn(),
  lastUseQueryOptions: null as Record<string, unknown> | null,
  patchAnalyzeReviewAssembly: vi.fn(),
  patchAnalyzeReviewClaim: vi.fn(),
  removeAnalyzeReviewInput: vi.fn(),
  reviewState: {
    data: null as AnalyzeReviewListResponse | null,
    error: null as Error | null,
    isLoading: false
  },
  state: {
    data: null as AnalyzeRunDetailDto | null,
    error: null as Error | null,
    isLoading: false
  }
}));

vi.mock("@tanstack/react-query", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    useMutation: (options: {
      mutationFn: (variables?: unknown) => unknown;
      onError?: (error: unknown, variables: unknown) => unknown;
      onSuccess?: (data: unknown, variables: unknown) => unknown;
    }) => {
      const [error, setError] = React.useState<unknown>(null);
      const [isPending, setIsPending] = React.useState(false);

      return {
        error,
        isPending,
        mutate: (variables?: unknown) => {
          setError(null);
          setIsPending(true);
          const result = Promise.resolve()
            .then(() => options.mutationFn(variables))
            .then(
              async (data) => {
                await options.onSuccess?.(data, variables);
                setIsPending(false);
                return data;
              },
              async (mutationError) => {
                setError(mutationError);
                await options.onError?.(mutationError, variables);
                setIsPending(false);
                throw mutationError;
              }
            );
          void result.catch(() => undefined);
          return result;
        }
      };
    },
    useQuery: (options: Record<string, unknown>) => {
      mocks.lastUseQueryOptions = options;
      if (options.queryType === "analyzeReviewAssemblies") {
        return mocks.reviewState;
      }
      return mocks.state;
    },
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries
    })
  };
});

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
  acceptAnalyzeReviewAssemblies: mocks.acceptAnalyzeReviewAssemblies,
  analyzeReviewAssembliesQuery: mocks.analyzeReviewAssembliesQuery,
  analyzeRunQuery: mocks.analyzeRunQuery,
  attachAnalyzeReviewInput: mocks.attachAnalyzeReviewInput,
  createAnalyzeReviewAssembly: mocks.createAnalyzeReviewAssembly,
  createAnalyzeReviewClaim: mocks.createAnalyzeReviewClaim,
  patchAnalyzeReviewAssembly: mocks.patchAnalyzeReviewAssembly,
  patchAnalyzeReviewClaim: mocks.patchAnalyzeReviewClaim,
  queryKeys: {
    analyzeReviewAssemblies: (projectId: string, runId: string) => [
      "projects",
      projectId,
      "analyze-runs",
      runId,
      "review-assemblies"
    ],
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    projectReadiness: (projectId: string) => ["projects", projectId, "readiness"],
    proposalsRoot: (projectId: string) => ["projects", projectId, "proposals"],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  },
  removeAnalyzeReviewInput: mocks.removeAnalyzeReviewInput
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
    mocks.reviewState = {
      data: reviewFixture(),
      error: null,
      isLoading: false
    };
  });

  afterEach(() => {
    cleanupRenderedRoots();
  });

  it("renders the run-scoped assembly workspace", () => {
    const html = renderToStaticMarkup(
      <AnalyzeRunReviewPage projectId="project-1" runId="run-1" />
    );

    expect(mocks.analyzeReviewAssembliesQuery).toHaveBeenCalledWith("project-1", "run-1");
    expect(html).toContain("Draft pool");
    expect(html).toContain("Assembly list");
    expect(html).toContain("Assembly detail");
    expect(html).toContain("fact_missing_evidence");
    expect(html).toContain("Accept selected");
    expect(html).toContain("/projects/project-1/analyze-runs/run-1");
  });

  it("accepts selected ready assemblies and invalidates derived project data", async () => {
    const { container } = await renderAnalyzeRunReviewPage();

    await changeCheckbox(container, "Select assembly Review drafts", true);
    await clickButton(container, "Accept selected");

    expect(mocks.acceptAnalyzeReviewAssemblies).toHaveBeenCalledWith("project-1", "run-1", {
      assemblyIds: ["assembly-ready"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "analyze-runs", "run-1", "review-assemblies"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "proposals"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "entities"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "index-runs"]
    });
    expect(container.textContent).toContain(
      "Saved 1 assembly and 1 source/spec annotation."
    );
  });

  it("surfaces accept response failures", async () => {
    mocks.acceptAnalyzeReviewAssemblies.mockResolvedValue({
      acceptedAssemblyIds: [],
      annotationCount: 0,
      failures: [
        {
          assemblyId: "assembly-ready",
          messages: [
            {
              severity: "blocker",
              code: "fact_missing_evidence",
              message: "Fact claims need evidence before accepting.",
              field: "claims"
            },
            {
              severity: "blocker",
              code: "index_failed",
              message: "Index refresh failed.",
              field: null
            }
          ]
        }
      ],
      indexRun: null
    });
    const { container } = await renderAnalyzeRunReviewPage();

    await changeCheckbox(container, "Select assembly Review drafts", true);
    await clickButton(container, "Accept selected");

    expect(container.textContent).toContain("Accept failures");
    expect(container.textContent).toContain("fact_missing_evidence");
    expect(container.textContent).toContain("index_failed");
    expect(container.textContent).not.toContain("Saved 0 assemblies");
  });

  it("shows a neutral partial accept message when some assemblies fail", async () => {
    mocks.acceptAnalyzeReviewAssemblies.mockResolvedValue({
      acceptedAssemblyIds: ["assembly-ready"],
      annotationCount: 2,
      failures: [
        {
          assemblyId: "assembly-blocked",
          messages: [
            {
              severity: "blocker",
              code: "fact_missing_evidence",
              message: "Fact claims need evidence before accepting.",
              field: "claims"
            }
          ]
        }
      ],
      indexRun: null
    });
    const { container } = await renderAnalyzeRunReviewPage();

    await changeCheckbox(container, "Select assembly Review drafts", true);
    await clickButton(container, "Accept selected");

    expect(container.textContent).toContain(
      "Saved 1 assembly and 2 source/spec annotations. 1 assembly needs review."
    );
    expect(container.textContent).toContain("Accept failures");
    expect(container.textContent).not.toContain(
      "Saved 1 assemblies and 2 source/spec annotations.Accept failures"
    );
  });
});

function refetchIntervalFor(data: AnalyzeRunDetailDto | null) {
  const refetchInterval = mocks.lastUseQueryOptions?.refetchInterval;
  expect(refetchInterval).toEqual(expect.any(Function));
  return (
    refetchInterval as (query: { state: { data: AnalyzeRunDetailDto | null } }) => number | false
  )({
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
    proposalIds: ["proposal-ready", "proposal-blocked"],
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

function reviewFixture(): AnalyzeReviewListResponse {
  return {
    assemblies: [
      {
        id: "assembly-ready",
        projectId: "project-1",
        analyzeRunId: "run-1",
        status: "draft",
        entityType: "use_case",
        entityId: "uc.review-drafts",
        title: "Review drafts",
        summary: "Review generated analyze drafts.",
        filePath: "use-cases/review-drafts.md",
        renderedMarkdown: "# Review drafts\n\nReview generated analyze drafts.",
        inputs: [
          {
            proposalId: "proposal-ready",
            role: "primary",
            proposalType: "ai_spec_entity",
            title: "Review drafts",
            entityType: "use_case",
            entityId: "uc.review-drafts",
            filePath: "use-cases/review-drafts.md",
            confidence: 0.84,
            assignmentState: "assigned",
            evidenceCount: 1
          }
        ],
        claims: [
          {
            id: "claim-ready",
            text: "Users can accept ready review drafts.",
            kind: "fact",
            confidence: 0.9,
            sortOrder: 0,
            evidence: [
              {
                id: "evidence-ready",
                proposalId: "proposal-ready",
                sourceFilePath: "apps/web/src/routes/analyze-run-review.tsx",
                symbolName: "AnalyzeRunReviewPage",
                startLine: 1,
                endLine: 40,
                provenance: "ai",
                confidence: 0.8
              }
            ]
          }
        ],
        validation: {
          state: "ready",
          messages: []
        },
        createdAt: "2026-05-12T08:00:00.000Z",
        updatedAt: "2026-05-12T08:05:00.000Z",
        acceptedAt: null,
        discardedAt: null
      },
      {
        id: "assembly-blocked",
        projectId: "project-1",
        analyzeRunId: "run-1",
        status: "draft",
        entityType: "interface",
        entityId: "interfaces.blocked",
        title: "Blocked draft",
        summary: "Needs evidence.",
        filePath: "interfaces/blocked.md",
        renderedMarkdown: null,
        inputs: [],
        claims: [
          {
            id: "claim-blocked",
            text: "Blocked facts need evidence.",
            kind: "fact",
            confidence: 0.7,
            sortOrder: 0,
            evidence: []
          }
        ],
        validation: {
          state: "blocker",
          messages: [
            {
              severity: "blocker",
              code: "fact_missing_evidence",
              message: "Fact claims need evidence before accepting.",
              field: "claims"
            }
          ]
        },
        createdAt: "2026-05-12T08:00:00.000Z",
        updatedAt: "2026-05-12T08:05:00.000Z",
        acceptedAt: null,
        discardedAt: null
      }
    ],
    counts: {
      assemblies: {
        accepted: 0,
        discarded: 0,
        draft: 2
      },
      inputs: {
        assigned: 1,
        discarded: 0,
        unassigned: 1
      },
      validation: {
        blocker: 1,
        ready: 1,
        warning: 0
      }
    },
    unassignedInputs: [
      {
        proposalId: "proposal-unassigned",
        role: "primary",
        proposalType: "source_spec_entity",
        title: "Review draft pool",
        entityType: "interface",
        entityId: "interfaces.review-draft-pool",
        filePath: "interfaces/review-draft-pool.md",
        confidence: 0.7,
        assignmentState: "unassigned",
        evidenceCount: 1
      }
    ]
  };
}

function resetMocks() {
  mocks.state = {
    data: null,
    error: null,
    isLoading: false
  };
  mocks.reviewState = {
    data: null,
    error: null,
    isLoading: false
  };
  mocks.lastUseQueryOptions = null;
  mocks.analyzeRunQuery.mockClear();
  mocks.analyzeReviewAssembliesQuery.mockClear();
  mocks.invalidateQueries.mockReset();
  mocks.acceptAnalyzeReviewAssemblies.mockReset();
  mocks.acceptAnalyzeReviewAssemblies.mockImplementation(
    (_projectId: string, _runId: string, input: { assemblyIds: string[] }) => ({
      acceptedAssemblyIds: input.assemblyIds,
      annotationCount: input.assemblyIds.length,
      failures: [],
      indexRun: null
    })
  );
  mocks.attachAnalyzeReviewInput.mockReset();
  mocks.createAnalyzeReviewAssembly.mockReset();
  mocks.createAnalyzeReviewClaim.mockReset();
  mocks.patchAnalyzeReviewAssembly.mockReset();
  mocks.patchAnalyzeReviewClaim.mockReset();
  mocks.removeAnalyzeReviewInput.mockReset();
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
