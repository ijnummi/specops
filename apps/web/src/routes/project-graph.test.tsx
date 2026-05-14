// @vitest-environment happy-dom

import type { ProjectGraphListResponse, ProjectGraphNodeDetail } from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  graphState: {
    data: null as ProjectGraphListResponse | null,
    error: null as Error | null,
    isLoading: false
  },
  nodeState: {
    data: null as ProjectGraphNodeDetail | null,
    error: null as Error | null,
    isLoading: false
  },
  projectGraphQuery: vi.fn((projectId: string, input: Record<string, unknown>) => ({
    queryKey: ["projects", projectId, "graph", input],
    queryType: "projectGraph"
  })),
  projectGraphNodeQuery: vi.fn((projectId: string, nodeId: string | null) => ({
    enabled: nodeId !== null,
    queryKey: ["projects", projectId, "graph", "nodes", nodeId],
    queryType: "projectGraphNode"
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) =>
    options.queryType === "projectGraphNode" ? mocks.nodeState : mocks.graphState
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
  projectGraphNodeQuery: mocks.projectGraphNodeQuery,
  projectGraphQuery: mocks.projectGraphQuery
}));

import { ProjectGraphPage } from "./project-graph.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProjectGraphPage", () => {
  beforeEach(() => {
    mocks.graphState = {
      data: null,
      error: null,
      isLoading: false
    };
    mocks.nodeState = {
      data: null,
      error: null,
      isLoading: false
    };
    mocks.projectGraphQuery.mockClear();
    mocks.projectGraphNodeQuery.mockClear();
  });

  afterEach(() => {
    cleanupRenderedRoots();
  });

  it("renders graph counts, empty diagnostics, node sample, and selected node detail", () => {
    mocks.graphState = {
      data: graphFixture(),
      error: null,
      isLoading: false
    };
    mocks.nodeState = {
      data: nodeDetailFixture(),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ProjectGraphPage projectId="project-1" />);

    expect(mocks.projectGraphQuery).toHaveBeenCalledWith("project-1", { limit: 50 });
    expect(mocks.projectGraphNodeQuery).toHaveBeenCalledWith(
      "project-1",
      "00000000-0000-4000-8000-000000000010"
    );
    expect(html).toContain("Project graph");
    expect(html).toContain("Graph contains 2 nodes and 1 edge.");
    expect(html).toContain("ready");
    expect(html).toContain("00000000-0000-4000-8000-000000000003");
    expect(html).toContain("file");
    expect(html).toContain("symbol");
    expect(html).toContain("defines");
    expect(html).toContain("No graph warnings");
    expect(html).toContain("projects.ts");
    expect(html).toContain("apps/api/src/routes/projects.ts");
    expect(html).toContain("Incoming");
    expect(html).toContain("Outgoing");
  });

  it("falls back to a visible node when the selected node is absent after graph refresh", () => {
    mocks.graphState = {
      data: graphFixture(),
      error: null,
      isLoading: false
    };
    mocks.nodeState = {
      data: nodeDetailFixture(graphFixture().nodes[0]!),
      error: null,
      isLoading: false
    };

    const { container, root } = renderPage();

    const secondNodeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("registerProjectRoutes")
    );
    expect(secondNodeButton).toBeTruthy();

    act(() => {
      secondNodeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.projectGraphNodeQuery).toHaveBeenLastCalledWith(
      "project-1",
      "00000000-0000-4000-8000-000000000011"
    );
    expect(secondNodeButton?.getAttribute("aria-pressed")).toBe("true");

    const refreshedGraph = graphFixture({
      nodes: [
        graphNode({
          id: "00000000-0000-4000-8000-000000000012",
          nodeKey: "file:apps/web/src/app.tsx",
          label: "app.tsx",
          path: "apps/web/src/app.tsx"
        })
      ],
      nodeCounts: { file: 1 },
      edgeCounts: {},
      edges: []
    });
    mocks.graphState = {
      data: refreshedGraph,
      error: null,
      isLoading: false
    };
    mocks.nodeState = {
      data: nodeDetailFixture(refreshedGraph.nodes[0]!),
      error: null,
      isLoading: false
    };

    act(() => {
      root.render(<ProjectGraphPage projectId="project-1" />);
    });

    expect(mocks.projectGraphNodeQuery).toHaveBeenLastCalledWith(
      "project-1",
      "00000000-0000-4000-8000-000000000012"
    );
    expect(container.textContent).toContain("app.tsx");
  });
});

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);

  act(() => {
    root.render(<ProjectGraphPage projectId="project-1" />);
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

function graphFixture(
  overrides: Partial<Pick<ProjectGraphListResponse, "edgeCounts" | "edges" | "nodeCounts" | "nodes">> = {}
): ProjectGraphListResponse {
  const nodes =
    overrides.nodes ?? [
      graphNode({
        id: "00000000-0000-4000-8000-000000000010",
        nodeKey: "file:apps/api/src/routes/projects.ts",
        nodeType: "file",
        label: "projects.ts",
        path: "apps/api/src/routes/projects.ts"
      }),
      graphNode({
        id: "00000000-0000-4000-8000-000000000011",
        nodeKey: "symbol:registerProjectRoutes",
        nodeType: "symbol",
        label: "registerProjectRoutes",
        path: "apps/api/src/routes/projects.ts",
        symbolName: "registerProjectRoutes"
      })
    ];
  const edges =
    overrides.edges ?? [
      {
        id: "00000000-0000-4000-8000-000000000020",
        projectId: "00000000-0000-4000-8000-000000000002",
        graphVersionId: "00000000-0000-4000-8000-000000000001",
        fromNodeId: "00000000-0000-4000-8000-000000000010",
        toNodeId: "00000000-0000-4000-8000-000000000011",
        edgeType: "defines",
        provenance: "scanner_symbol",
        sourceRef: {},
        metadata: {},
        confidence: 1,
        createdAt: "2026-05-14T10:00:00.000Z"
      }
    ];
  const nodeCounts = overrides.nodeCounts ?? { file: 1, symbol: 1 };
  const edgeCounts = overrides.edgeCounts ?? { defines: 1 };

  return {
    edgeCounts,
    edges,
    nodeCounts,
    nodes,
    version: {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      indexRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Graph contains 2 nodes and 1 edge.",
      coverage: {
        nodeCounts,
        edgeCounts,
        sourceFileCount: 1,
        specEntityCount: 0,
        unresolvedImportCount: 0,
        heuristicEdgeCount: 0
      },
      diagnostics: [],
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z"
    }
  };
}

function graphNode(
  overrides: Partial<ProjectGraphListResponse["nodes"][number]>
): ProjectGraphListResponse["nodes"][number] {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    projectId: "00000000-0000-4000-8000-000000000002",
    graphVersionId: "00000000-0000-4000-8000-000000000001",
    nodeKey: "file:apps/api/src/routes/projects.ts",
    nodeType: "file",
    label: "projects.ts",
    path: "apps/api/src/routes/projects.ts",
    symbolName: null,
    entityId: null,
    sourceRef: {},
    metadata: { classification: "route" },
    confidence: 1,
    createdAt: "2026-05-14T10:00:00.000Z",
    ...overrides
  };
}

function nodeDetailFixture(
  node: ProjectGraphListResponse["nodes"][number] = graphFixture().nodes[0]!
): ProjectGraphNodeDetail {
  const graph = graphFixture();

  return {
    node,
    incomingEdges: {},
    outgoingEdges: { defines: [graph.edges[0]!] },
    neighboringNodes: [graph.nodes[1]!]
  };
}
