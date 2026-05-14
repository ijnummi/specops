// @vitest-environment happy-dom

import type { ConceptDetailResponse, ConceptGraphLatestResponse } from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MutationOptions = {
  mutationFn: () => Promise<unknown>;
  onSuccess?: () => unknown;
};

const mocks = vi.hoisted(() => ({
  graphState: {
    data: null as ConceptGraphLatestResponse | null,
    error: null as Error | null,
    isLoading: false
  },
  detailState: {
    data: null as ConceptDetailResponse | null,
    error: null as Error | null,
    isLoading: false
  },
  mutationState: {
    isPending: false,
    error: null as Error | null
  },
  invalidateQueries: vi.fn(),
  conceptGraphQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "concept-graph"],
    queryType: "conceptGraph"
  })),
  conceptDetailQuery: vi.fn((projectId: string, conceptId: string | null) => ({
    enabled: conceptId !== null,
    queryKey: ["projects", projectId, "concepts", conceptId],
    queryType: "conceptDetail"
  })),
  buildConceptGraph: vi.fn(async () => graphFixture()),
  queryKeys: {
    conceptGraph: (projectId: string) => ["projects", projectId, "concept-graph"] as const
  }
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => ({
    error: mocks.mutationState.error,
    isPending: mocks.mutationState.isPending,
    mutate: async () => {
      const result = await options.mutationFn();
      await options.onSuccess?.();
      return result;
    }
  }),
  useQuery: (options: Record<string, unknown>) =>
    options.queryType === "conceptDetail" ? mocks.detailState : mocks.graphState,
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
    <a className={className} href={to.replace("$projectId", params?.projectId ?? "")}>
      {children}
    </a>
  )
}));

vi.mock("../api/queries.js", () => ({
  buildConceptGraph: mocks.buildConceptGraph,
  conceptDetailQuery: mocks.conceptDetailQuery,
  conceptGraphQuery: mocks.conceptGraphQuery,
  queryKeys: mocks.queryKeys
}));

import { ConceptsPage } from "./concepts.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConceptsPage", () => {
  beforeEach(() => {
    mocks.graphState = {
      data: null,
      error: null,
      isLoading: false
    };
    mocks.detailState = {
      data: null,
      error: null,
      isLoading: false
    };
    mocks.mutationState = {
      error: null,
      isPending: false
    };
    mocks.invalidateQueries.mockReset();
    mocks.conceptGraphQuery.mockClear();
    mocks.conceptDetailQuery.mockClear();
    mocks.buildConceptGraph.mockClear();
  });

  afterEach(() => {
    cleanupRenderedRoots();
  });

  it("renders concept graph summary, counts, diagnostics, list, and selected concept detail", () => {
    mocks.graphState = {
      data: graphFixture(),
      error: null,
      isLoading: false
    };
    mocks.detailState = {
      data: conceptDetailFixture(),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ConceptsPage projectId="project-1" />);

    expect(mocks.conceptGraphQuery).toHaveBeenCalledWith("project-1");
    expect(mocks.conceptDetailQuery).toHaveBeenCalledWith(
      "project-1",
      "00000000-0000-4000-8000-000000000101"
    );
    expect(html).toContain("Concepts");
    expect(html).toContain("Concept graph contains 2 concepts.");
    expect(html).toContain("ready");
    expect(html).toContain("openai");
    expect(html).toContain("gpt-4.1-mini");
    expect(html).toContain("00000000-0000-4000-8000-000000000050");
    expect(html).toContain("workflow");
    expect(html).toContain("interface");
    expect(html).toContain("low_confidence_concept");
    expect(html).toContain("Checkout workflow");
    expect(html).toContain("Coordinates checkout validation and payment capture.");
    expect(html).toContain("0.92");
    expect(html).toContain("Evidence from checkout route, service, and tests.");
    expect(html).toContain("primary");
    expect(html).toContain("checkout.ts");
    expect(html).toContain("entrypoint");
    expect(html).toContain("payments.ts");
    expect(html).toContain("Incoming relationships");
    expect(html).toContain("Outgoing relationships");
    expect(html).toContain("relates_to");
    expect(html).toContain("uses");
    expect(html).toContain("Payment interface");
  });

  it("uses routed concept selection when provided", () => {
    mocks.graphState = {
      data: graphFixture(),
      error: null,
      isLoading: false
    };
    mocks.detailState = {
      data: conceptDetailFixture(),
      error: null,
      isLoading: false
    };

    renderToStaticMarkup(
      <ConceptsPage projectId="project-1" conceptId="00000000-0000-4000-8000-000000000102" />
    );

    expect(mocks.conceptDetailQuery).toHaveBeenCalledWith(
      "project-1",
      "00000000-0000-4000-8000-000000000102"
    );
  });

  it("renders a build action when no concept graph exists", async () => {
    mocks.graphState = {
      data: null,
      error: new Error("No concept graph exists for this project."),
      isLoading: false
    };

    const { container } = renderPage();

    expect(container.textContent).toContain("No concept graph exists for this project.");
    expect(container.textContent).toContain("Build concepts");

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Build concepts")
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.buildConceptGraph).toHaveBeenCalledWith("project-1", {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 150,
      maxGraphEdges: 300
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "concept-graph"]
    });
  });
});

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);

  act(() => {
    root.render(<ConceptsPage projectId="project-1" />);
  });

  return { container, root };
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

function graphFixture(): ConceptGraphLatestResponse {
  const checkout = conceptFixture({
    id: "00000000-0000-4000-8000-000000000101",
    conceptKey: "workflow:checkout",
    conceptType: "workflow",
    name: "Checkout workflow",
    summary: "Coordinates checkout validation and payment capture.",
    confidence: 0.92,
    evidenceSummary: "Evidence from checkout route, service, and tests."
  });
  const payment = conceptFixture({
    id: "00000000-0000-4000-8000-000000000102",
    conceptKey: "interface:payments",
    conceptType: "interface",
    name: "Payment interface",
    summary: "External payment provider boundary.",
    confidence: 0.81,
    evidenceSummary: "Evidence from payment client."
  });

  return {
    version: {
      id: "00000000-0000-4000-8000-000000000100",
      projectId: "00000000-0000-4000-8000-000000000001",
      projectGraphVersionId: "00000000-0000-4000-8000-000000000050",
      status: "ready",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "concept-graph-v1",
      summary: "Concept graph contains 2 concepts.",
      coverage: {
        conceptCounts: { interface: 1, workflow: 1 },
        membershipCounts: { entrypoint: 1, primary: 1 },
        relationshipCounts: { uses: 1 },
        rejectedConceptCount: 0,
        rejectedMembershipCount: 0,
        graphNodeCoverageCount: 2,
        lowConfidenceConceptCount: 1
      },
      diagnostics: [
        {
          level: "warning",
          code: "low_confidence_concept",
          message: "One concept has low confidence."
        }
      ],
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z"
    },
    conceptCounts: { interface: 1, workflow: 1 },
    membershipCounts: { entrypoint: 1, primary: 1 },
    relationshipCounts: { uses: 1 },
    concepts: [checkout, payment],
    diagnostics: [
      {
        level: "warning",
        code: "low_confidence_concept",
        message: "One concept has low confidence."
      }
    ]
  };
}

function conceptFixture(
  overrides: Partial<ConceptGraphLatestResponse["concepts"][number]>
): ConceptGraphLatestResponse["concepts"][number] {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    projectId: "00000000-0000-4000-8000-000000000001",
    conceptVersionId: "00000000-0000-4000-8000-000000000100",
    conceptKey: "workflow:checkout",
    conceptType: "workflow",
    name: "Checkout workflow",
    summary: "Coordinates checkout validation and payment capture.",
    confidence: 0.92,
    provenance: "ai",
    evidenceSummary: "Evidence from checkout route, service, and tests.",
    status: "active",
    metadata: {},
    createdAt: "2026-05-14T10:00:00.000Z",
    updatedAt: "2026-05-14T10:00:00.000Z",
    ...overrides
  };
}

function conceptDetailFixture(): ConceptDetailResponse {
  const graph = graphFixture();

  return {
    concept: graph.concepts[0]!,
    memberships: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        projectId: "00000000-0000-4000-8000-000000000001",
        conceptVersionId: "00000000-0000-4000-8000-000000000100",
        conceptId: "00000000-0000-4000-8000-000000000101",
        graphNodeId: "00000000-0000-4000-8000-000000000301",
        role: "primary",
        confidence: 0.9,
        rationale: "Main checkout implementation.",
        createdAt: "2026-05-14T10:00:00.000Z"
      },
      {
        id: "00000000-0000-4000-8000-000000000202",
        projectId: "00000000-0000-4000-8000-000000000001",
        conceptVersionId: "00000000-0000-4000-8000-000000000100",
        conceptId: "00000000-0000-4000-8000-000000000101",
        graphNodeId: "00000000-0000-4000-8000-000000000302",
        role: "entrypoint",
        confidence: 0.8,
        rationale: "Payment provider entrypoint.",
        createdAt: "2026-05-14T10:00:00.000Z"
      }
    ],
    graphNodes: [
      graphNodeFixture({
        id: "00000000-0000-4000-8000-000000000301",
        nodeKey: "file:apps/api/src/checkout.ts",
        label: "checkout.ts",
        path: "apps/api/src/checkout.ts"
      }),
      graphNodeFixture({
        id: "00000000-0000-4000-8000-000000000302",
        nodeKey: "file:apps/api/src/payments.ts",
        label: "payments.ts",
        path: "apps/api/src/payments.ts"
      })
    ],
    incomingRelationships: {
      relates_to: [
        {
          id: "00000000-0000-4000-8000-000000000402",
          projectId: "00000000-0000-4000-8000-000000000001",
          conceptVersionId: "00000000-0000-4000-8000-000000000100",
          fromConceptId: "00000000-0000-4000-8000-000000000102",
          toConceptId: "00000000-0000-4000-8000-000000000101",
          relationshipType: "relates_to",
          confidence: 0.78,
          rationale: "Payment callback returns to checkout.",
          createdAt: "2026-05-14T10:00:00.000Z"
        }
      ]
    },
    outgoingRelationships: {
      uses: [
        {
          id: "00000000-0000-4000-8000-000000000401",
          projectId: "00000000-0000-4000-8000-000000000001",
          conceptVersionId: "00000000-0000-4000-8000-000000000100",
          fromConceptId: "00000000-0000-4000-8000-000000000101",
          toConceptId: "00000000-0000-4000-8000-000000000102",
          relationshipType: "uses",
          confidence: 0.86,
          rationale: "Checkout calls the payment boundary.",
          createdAt: "2026-05-14T10:00:00.000Z"
        }
      ]
    },
    relatedConcepts: [graph.concepts[1]!]
  };
}

function graphNodeFixture(
  overrides: Partial<ConceptDetailResponse["graphNodes"][number]>
): ConceptDetailResponse["graphNodes"][number] {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    projectId: "00000000-0000-4000-8000-000000000001",
    graphVersionId: "00000000-0000-4000-8000-000000000050",
    nodeKey: "file:apps/api/src/checkout.ts",
    nodeType: "file",
    label: "checkout.ts",
    path: "apps/api/src/checkout.ts",
    symbolName: null,
    entityId: null,
    sourceRef: {},
    metadata: {},
    confidence: 1,
    createdAt: "2026-05-14T10:00:00.000Z",
    ...overrides
  };
}
