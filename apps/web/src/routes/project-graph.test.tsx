// @vitest-environment happy-dom

import type { ProjectGraphListResponse, ProjectGraphNodeDetail } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

function graphFixture(): ProjectGraphListResponse {
  return {
    edgeCounts: { defines: 1 },
    edges: [
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
    ],
    nodeCounts: { file: 1, symbol: 1 },
    nodes: [
      {
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
        createdAt: "2026-05-14T10:00:00.000Z"
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        projectId: "00000000-0000-4000-8000-000000000002",
        graphVersionId: "00000000-0000-4000-8000-000000000001",
        nodeKey: "symbol:registerProjectRoutes",
        nodeType: "symbol",
        label: "registerProjectRoutes",
        path: "apps/api/src/routes/projects.ts",
        symbolName: "registerProjectRoutes",
        entityId: null,
        sourceRef: {},
        metadata: {},
        confidence: 1,
        createdAt: "2026-05-14T10:00:00.000Z"
      }
    ],
    version: {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      indexRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Graph contains 2 nodes and 1 edge.",
      coverage: {
        nodeCounts: { file: 1, symbol: 1 },
        edgeCounts: { defines: 1 },
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

function nodeDetailFixture(): ProjectGraphNodeDetail {
  const graph = graphFixture();

  return {
    node: graph.nodes[0]!,
    incomingEdges: {},
    outgoingEdges: { defines: [graph.edges[0]!] },
    neighboringNodes: [graph.nodes[1]!]
  };
}
