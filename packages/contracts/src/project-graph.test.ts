import { describe, expect, it } from "vitest";

import {
  projectGraphListResponseSchema,
  projectGraphNodeDetailSchema,
  projectGraphNodeSchema,
  projectGraphVersionSchema
} from "./project-graph.js";

const timestamp = "2026-05-14T10:00:00.000Z";

describe("project graph contracts", () => {
  it("parses a graph version", () => {
    const parsed = projectGraphVersionSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      indexRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Graph contains 4 nodes and 3 edges.",
      coverage: {
        nodeCounts: { file: 1, symbol: 1, spec_entity: 1, external_dependency: 1 },
        edgeCounts: { defines: 1, imports: 1, supports_spec: 1 },
        sourceFileCount: 1,
        specEntityCount: 1,
        unresolvedImportCount: 1,
        heuristicEdgeCount: 0
      },
      diagnostics: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(parsed.status).toBe("ready");
    expect(parsed.coverage.edgeCounts.imports).toBe(1);
  });

  it("parses graph nodes and list response samples", () => {
    const node = projectGraphNodeSchema.parse({
      id: "00000000-0000-4000-8000-000000000010",
      projectId: "00000000-0000-4000-8000-000000000002",
      graphVersionId: "00000000-0000-4000-8000-000000000001",
      nodeKey: "file:apps/api/src/routes/projects.ts",
      nodeType: "file",
      label: "projects.ts",
      path: "apps/api/src/routes/projects.ts",
      symbolName: null,
      entityId: null,
      sourceRef: { sourceFileId: "00000000-0000-4000-8000-000000000011" },
      metadata: { classification: "route", language: "typescript", kind: "source" },
      confidence: 1,
      createdAt: timestamp
    });

    const parsed = projectGraphListResponseSchema.parse({
      version: {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        indexRunId: "00000000-0000-4000-8000-000000000003",
        status: "ready",
        summary: "Graph contains 1 node and 0 edges.",
        coverage: {
          nodeCounts: { file: 1 },
          edgeCounts: {},
          sourceFileCount: 1,
          specEntityCount: 0,
          unresolvedImportCount: 0,
          heuristicEdgeCount: 0
        },
        diagnostics: [],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      nodeCounts: { file: 1 },
      edgeCounts: {},
      nodes: [node],
      edges: []
    });

    expect(parsed.nodes[0]?.metadata.classification).toBe("route");
  });

  it("parses node detail with grouped edges", () => {
    const parsed = projectGraphNodeDetailSchema.parse({
      node: {
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
        metadata: {},
        confidence: 1,
        createdAt: timestamp
      },
      incomingEdges: {},
      outgoingEdges: {
        defines: [
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
            createdAt: timestamp
          }
        ]
      },
      neighboringNodes: []
    });

    expect(parsed.outgoingEdges.defines).toHaveLength(1);
  });
});
