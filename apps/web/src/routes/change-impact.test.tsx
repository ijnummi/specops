// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChangeImpactPreviewResponseDto } from "@specops/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeImpactPage } from "./change-impact.js";

const mocks = vi.hoisted(() => ({
  previewAgentTask: vi.fn(),
  saveAgentTask: vi.fn()
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, boolean | number | string | undefined>;
    to: string;
  }) => {
    const suffix = search?.depth !== undefined ? `?depth=${String(search.depth)}` : "";
    const href = to
      .replace("$projectId", params?.projectId ?? "")
      .replace("$entityId", params?.entityId ?? "");

    return <a href={`${href}${suffix}`}>{children}</a>;
  },
  useNavigate: () => vi.fn()
}));

vi.mock("../api/queries.js", async () => {
  const actual = await vi.importActual<typeof import("../api/queries.js")>("../api/queries.js");
  return {
    ...actual,
    changeImpactPreviewQuery: () => ({
      queryKey: ["change-impact-test"],
      queryFn: async () => changeImpactPreviewResponse()
    }),
    previewAgentTask: mocks.previewAgentTask,
    saveAgentTask: mocks.saveAgentTask
  };
});

vi.mock("../components/agent-task-preview.js", () => ({
  AgentTaskPreview: ({
    onSave,
    preview
  }: {
    onSave: () => void;
    preview: { markdown: string };
  }) => (
    <section data-testid="agent-task-preview">
      <div>{preview.markdown}</div>
      <button type="button" onClick={onSave}>
        Save Task
      </button>
    </section>
  )
}));

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangeImpactPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    for (const container of containers.splice(0)) {
      container.remove();
    }
  });

  it("renders change impact controls, graph, panel, and navigation", async () => {
    const { container } = await renderChangeImpactPage();

    expect(container.textContent).toContain("Change Impact Preview");
    expect(container.textContent).toContain("Generate task from impact");
    expect(container.querySelector('[data-testid="impact-graph"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="change-impact-preview-panel"]')).not.toBeNull();
    expect(linkHref(container, "Open spec")).toBe("/projects/project-1/entities/domain.decision");
  });

  it("generates a task from the backend-provided impact task seed", async () => {
    mocks.previewAgentTask.mockResolvedValue(agentTaskPreviewResponse());
    const { container } = await renderChangeImpactPage();

    await act(async () => {
      clickButton(container, "Generate task from impact");
      await waitForQueryResult();
    });

    expect(mocks.previewAgentTask).toHaveBeenCalledWith("project-1", {
      sourceEntityId: "domain.decision",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.outcome"]
    });
  });

  it("invalidates the active change impact preview after saving a generated task", async () => {
    mocks.previewAgentTask.mockResolvedValue(agentTaskPreviewResponse());
    mocks.saveAgentTask.mockResolvedValue(savedTaskResponse());
    const { container, queryClient } = await renderChangeImpactPage();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      clickButton(container, "Generate task from impact");
      await waitForQueryResult();
    });

    await act(async () => {
      clickButton(container, "Save Task");
      await waitForQueryResult();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "projects",
        "project-1",
        "entities",
        "domain.decision",
        "change-impact-preview",
        { depth: "1", direction: "both", includeSource: true }
      ]
    });
  });

  it("ignores stale generated task previews after the route entity changes", async () => {
    const deferredPreview = deferred<ReturnType<typeof agentTaskPreviewResponse>>();
    mocks.previewAgentTask.mockReturnValue(deferredPreview.promise);
    const { container, rerender } = await renderChangeImpactPage();

    await act(async () => {
      clickButton(container, "Generate task from impact");
      await waitForQueryResult();
    });

    await act(async () => {
      rerender({ projectId: "project-2", entityId: "domain.other" });
      await waitForQueryResult();
    });

    await act(async () => {
      deferredPreview.resolve(agentTaskPreviewResponse());
      await waitForQueryResult();
    });

    expect(container.querySelector('[data-testid="agent-task-preview"]')).toBeNull();
  });

  it("clears an already-rendered task preview when the route entity changes", async () => {
    mocks.previewAgentTask.mockResolvedValue(agentTaskPreviewResponse());
    const { container, rerender } = await renderChangeImpactPage();

    await act(async () => {
      clickButton(container, "Generate task from impact");
      await waitForQueryResult();
    });

    expect(container.querySelector('[data-testid="agent-task-preview"]')).not.toBeNull();

    await act(async () => {
      rerender({ projectId: "project-2", entityId: "domain.other" });
      await waitForQueryResult();
    });

    expect(container.querySelector('[data-testid="agent-task-preview"]')).toBeNull();
  });

  it("invalidates the original change impact preview when save completes after route change", async () => {
    const deferredSave = deferred<ReturnType<typeof savedTaskResponse>>();
    mocks.previewAgentTask.mockResolvedValue(agentTaskPreviewResponse());
    mocks.saveAgentTask.mockReturnValue(deferredSave.promise);
    const { container, queryClient, rerender } = await renderChangeImpactPage();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      clickButton(container, "Generate task from impact");
      await waitForQueryResult();
    });

    await act(async () => {
      clickButton(container, "Save Task");
      await waitForQueryResult();
    });

    await act(async () => {
      rerender({ projectId: "project-2", entityId: "domain.other" });
      await waitForQueryResult();
    });

    await act(async () => {
      deferredSave.resolve(savedTaskResponse());
      await waitForQueryResult();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "projects",
        "project-1",
        "entities",
        "domain.decision",
        "change-impact-preview",
        { depth: "1", direction: "both", includeSource: true }
      ]
    });
  });
});

async function renderChangeImpactPage(
  props: Partial<React.ComponentProps<typeof ChangeImpactPage>> = {}
) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const renderProps = (nextProps: Partial<React.ComponentProps<typeof ChangeImpactPage>> = {}) => ({
    projectId: "project-1",
    entityId: "domain.decision",
    depth: 1 as const,
    direction: "both" as const,
    includeSource: true,
    ...props,
    ...nextProps
  });
  const renderPage = (nextProps: Partial<React.ComponentProps<typeof ChangeImpactPage>> = {}) => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChangeImpactPage {...renderProps(nextProps)} />
      </QueryClientProvider>
    );
  };

  await act(async () => {
    renderPage();
  });

  await act(async () => {
    await waitForQueryResult();
  });

  return { container, queryClient, rerender: renderPage, root };
}

function waitForQueryResult() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function linkHref(container: HTMLElement, label: string) {
  const link = Array.from(container.querySelectorAll("a")).find((element) =>
    element.textContent?.includes(label)
  );

  return link?.getAttribute("href");
}

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((element) =>
    element.textContent?.includes(label)
  );

  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  button.click();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function agentTaskPreviewResponse() {
  return {
    markdown: "# Task\n\nGenerated from impact.",
    taskId: "task.domain-decision-impact",
    title: "Change decision",
    filePath: "tasks/domain-decision-impact.md",
    sourceSpecIds: ["domain.decision"],
    contextSpecIds: ["domain.outcome"],
    warnings: []
  };
}

function savedTaskResponse() {
  return {
    id: "entity-task-1",
    projectId: "project-1",
    entityId: "task.domain-decision-impact",
    type: "task",
    title: "Change decision",
    status: "todo",
    filePath: "tasks/domain-decision-impact.md",
    frontmatter: {
      id: "task.domain-decision-impact",
      type: "task",
      title: "Change decision",
      status: "todo"
    },
    bodyMarkdown: "Generated from impact.",
    bodyText: "Generated from impact.",
    contentHash: "hash-task-1",
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z"
  };
}

function changeImpactPreviewResponse(): ChangeImpactPreviewResponseDto {
  return {
    rootEntity: {
      entityId: "domain.decision",
      type: "domain_entity",
      title: "Decision",
      status: "draft",
      filePath: "domain/decision.md"
    },
    impact: {
      rootEntity: {
        entityId: "domain.decision",
        type: "domain_entity",
        title: "Decision",
        status: "draft",
        filePath: "domain/decision.md"
      },
      nodes: [
        {
          id: "spec:domain.decision",
          kind: "spec",
          label: "Decision",
          entityId: "domain.decision",
          type: "domain_entity",
          status: "draft",
          title: "Decision",
          filePath: "domain/decision.md"
        },
        {
          id: "spec:domain.outcome",
          kind: "spec",
          label: "Outcome",
          entityId: "domain.outcome",
          type: "domain_entity",
          status: "draft",
          title: "Outcome",
          filePath: "domain/outcome.md"
        }
      ],
      edges: [
        {
          id: "spec-link:domain-decision-domain-outcome",
          from: "spec:domain.decision",
          to: "spec:domain.outcome",
          kind: "spec_link",
          label: "depends_on",
          fromEntityId: "domain.decision",
          toEntityId: "domain.outcome",
          linkType: "depends_on",
          source: "frontmatter"
        }
      ],
      upstreamPaths: [],
      downstreamPaths: [
        {
          direction: "downstream",
          entityIds: ["domain.decision", "domain.outcome"],
          steps: [
            {
              entityId: "domain.decision",
              title: "Decision",
              type: "domain_entity",
              status: "draft"
            },
            {
              entityId: "domain.outcome",
              title: "Outcome",
              type: "domain_entity",
              status: "draft"
            }
          ],
          linkTypes: ["depends_on"]
        }
      ],
      sourceEvidence: [],
      truncated: {
        isTruncated: false,
        reason: null,
        nodeCount: 2,
        edgeCount: 1,
        sourceEvidenceCount: 0
      }
    },
    overview: {
      impactedSpecCount: 2,
      upstreamSpecCount: 0,
      downstreamSpecCount: 1,
      sourceFileCount: 0,
      sourceSymbolCount: 0,
      warningCount: 0,
      relatedTaskCount: 0,
      shortestPaths: [
        {
          direction: "downstream",
          entityIds: ["domain.decision", "domain.outcome"],
          steps: [
            {
              entityId: "domain.decision",
              title: "Decision",
              type: "domain_entity",
              status: "draft"
            },
            {
              entityId: "domain.outcome",
              title: "Outcome",
              type: "domain_entity",
              status: "draft"
            }
          ],
          linkTypes: ["depends_on"]
        }
      ]
    },
    impactedSpecs: [
      {
        direction: "root",
        type: "domain_entity",
        specs: [
          {
            entityId: "domain.decision",
            type: "domain_entity",
            title: "Decision",
            status: "draft",
            filePath: "domain/decision.md",
            direction: "root",
            distance: 0
          }
        ]
      },
      {
        direction: "downstream",
        type: "domain_entity",
        specs: [
          {
            entityId: "domain.outcome",
            type: "domain_entity",
            title: "Outcome",
            status: "draft",
            filePath: "domain/outcome.md",
            direction: "downstream",
            distance: 1
          }
        ]
      }
    ],
    sourceGroups: [],
    validationMessages: [],
    relatedTasks: [],
    taskSeed: {
      sourceEntityId: "domain.decision",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.outcome"]
    },
    sectionWarnings: []
  };
}
