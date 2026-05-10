// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChangeImpactPreviewResponseDto } from "@specops/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeImpactPage } from "./change-impact.js";

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
    previewAgentTask: vi.fn(),
    saveAgentTask: vi.fn()
  };
});

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangeImpactPage", () => {
  afterEach(() => {
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
});

async function renderChangeImpactPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChangeImpactPage
          projectId="project-1"
          entityId="domain.decision"
          depth={1}
          direction="both"
          includeSource={true}
        />
      </QueryClientProvider>
    );
  });

  await act(async () => {
    await waitForQueryResult();
  });

  return { container, root };
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
