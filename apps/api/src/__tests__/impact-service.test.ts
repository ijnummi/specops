import { describe, expect, it } from "vitest";

import { buildEntityImpact } from "../services/impact-service.js";

describe("buildEntityImpact", () => {
  it("returns one-hop upstream, downstream, and source evidence by default", () => {
    const impact = buildEntityImpact({
      rootEntityId: "domain.decision",
      depth: "1",
      direction: "both",
      includeSource: true,
      entities: [
        entity("uc.create-decision", "Create Decision", "use_case"),
        entity("domain.decision", "Decision", "domain_entity"),
        entity("interface.decision-service", "Decision Service", "interface"),
        entity("ui.decision-list", "Decision List", "ui_view")
      ],
      links: [
        link("uc.create-decision", "domain.decision", "uses"),
        link("domain.decision", "interface.decision-service", "documents"),
        link("interface.decision-service", "ui.decision-list", "exposes")
      ],
      sourceEvidence: [
        evidence("domain.decision", "src/domain.ts", "Decision"),
        evidence("ui.decision-list", "src/ui.tsx", "DecisionList")
      ]
    });

    expect(impact.nodes.map((node) => node.id)).toEqual([
      "spec:domain.decision",
      "spec:interface.decision-service",
      "spec:uc.create-decision",
      "source:src/domain.ts:src/domain.ts-id:Decision:3:2:domain.decision"
    ]);
    expect(impact.downstreamPaths.map((path) => path.entityIds)).toEqual([
      ["domain.decision", "interface.decision-service"]
    ]);
    expect(impact.upstreamPaths.map((path) => path.entityIds)).toEqual([
      ["uc.create-decision", "domain.decision"]
    ]);
    expect(impact.sourceEvidence.map((item) => item.symbolName)).toEqual(["Decision"]);
    expect(impact.truncated.isTruncated).toBe(false);
  });

  it("supports two-hop traversal and direction filters", () => {
    const impact = buildEntityImpact({
      rootEntityId: "domain.decision",
      depth: "2",
      direction: "downstream",
      includeSource: false,
      entities: [
        entity("domain.decision", "Decision", "domain_entity"),
        entity("interface.decision-service", "Decision Service", "interface"),
        entity("ui.decision-list", "Decision List", "ui_view")
      ],
      links: [
        link("domain.decision", "interface.decision-service", "documents"),
        link("interface.decision-service", "ui.decision-list", "exposes")
      ],
      sourceEvidence: [evidence("domain.decision", "src/domain.ts", "Decision")]
    });

    expect(impact.nodes.map((node) => node.id)).toEqual([
      "spec:domain.decision",
      "spec:interface.decision-service",
      "spec:ui.decision-list"
    ]);
    expect(impact.upstreamPaths).toEqual([]);
    expect(impact.downstreamPaths.map((path) => path.entityIds)).toEqual([
      ["domain.decision", "interface.decision-service"],
      ["domain.decision", "interface.decision-service", "ui.decision-list"]
    ]);
    expect(impact.sourceEvidence).toEqual([]);
  });

  it("handles cycles and truncates all-depth traversal", () => {
    const impact = buildEntityImpact({
      rootEntityId: "a",
      depth: "all",
      direction: "downstream",
      includeSource: false,
      limits: { maxSpecNodes: 2, maxSpecEdges: 2, maxSourceEvidence: 300 },
      entities: [entity("a", "A"), entity("b", "B"), entity("c", "C")],
      links: [link("a", "b", "uses"), link("b", "c", "uses"), link("c", "a", "uses")],
      sourceEvidence: []
    });

    expect(impact.nodes.map((node) => node.id)).toEqual(["spec:a", "spec:b"]);
    expect(impact.truncated).toMatchObject({
      isTruncated: true,
      reason: "spec_node_limit",
      nodeCount: 2
    });
  });

  it("does not include target nodes or source evidence when the spec edge cap rejects the edge", () => {
    const impact = buildEntityImpact({
      rootEntityId: "a",
      depth: "1",
      direction: "downstream",
      includeSource: true,
      limits: { maxSpecNodes: 3, maxSpecEdges: 0, maxSourceEvidence: 300 },
      entities: [entity("a", "A"), entity("b", "B")],
      links: [link("a", "b", "uses")],
      sourceEvidence: [evidence("b", "src/b.ts", "B")]
    });

    expect(impact.nodes.map((node) => node.id)).toEqual(["spec:a"]);
    expect(impact.edges).toEqual([]);
    expect(impact.downstreamPaths).toEqual([]);
    expect(impact.sourceEvidence).toEqual([]);
    expect(impact.truncated).toMatchObject({
      isTruncated: true,
      reason: "spec_edge_limit",
      nodeCount: 1,
      edgeCount: 0,
      sourceEvidenceCount: 0
    });
  });

  it("generates unique node and edge ids for distinct source evidence rows", () => {
    const impact = buildEntityImpact({
      rootEntityId: "domain.decision",
      depth: "1",
      direction: "both",
      includeSource: true,
      entities: [entity("domain.decision", "Decision", "domain_entity")],
      links: [],
      sourceEvidence: [
        evidence("domain.decision", "src/domain.ts", "Decision", {
          sourceFileId: "source-file-1",
          symbolLine: 3,
          annotationLine: 2
        }),
        evidence("domain.decision", "src/domain.ts", "Decision", {
          sourceFileId: "source-file-2",
          symbolLine: 8,
          annotationLine: 7
        })
      ]
    });

    const sourceNodeIds = impact.nodes
      .filter((node) => node.kind === "source")
      .map((node) => node.id);
    const sourceEdgeIds = impact.edges
      .filter((edge) => edge.kind === "source_evidence")
      .map((edge) => edge.id);

    expect(sourceNodeIds).toHaveLength(2);
    expect(new Set(sourceNodeIds).size).toBe(2);
    expect(sourceEdgeIds).toHaveLength(2);
    expect(new Set(sourceEdgeIds).size).toBe(2);
  });

  it("continues traversal after converging downstream paths", () => {
    const impact = buildEntityImpact({
      rootEntityId: "root",
      depth: "all",
      direction: "downstream",
      includeSource: false,
      entities: [
        entity("root", "Root"),
        entity("a", "A"),
        entity("b", "B"),
        entity("c", "C"),
        entity("d", "D")
      ],
      links: [
        link("root", "a", "uses"),
        link("root", "b", "uses"),
        link("a", "c", "uses"),
        link("b", "c", "uses"),
        link("c", "d", "uses")
      ],
      sourceEvidence: []
    });

    expect(impact.downstreamPaths.map((path) => path.entityIds)).toEqual([
      ["root", "a"],
      ["root", "b"],
      ["root", "a", "c"],
      ["root", "b", "c"],
      ["root", "a", "c", "d"]
    ]);
    expect(impact.nodes.map((node) => node.id)).toEqual([
      "spec:a",
      "spec:b",
      "spec:c",
      "spec:d",
      "spec:root"
    ]);
    expect(impact.edges.map((edge) => edge.id)).toEqual([
      "spec-link:a-c-uses",
      "spec-link:b-c-uses",
      "spec-link:c-d-uses",
      "spec-link:root-a-uses",
      "spec-link:root-b-uses"
    ]);
  });

  it("keeps graph traversal complete when the path cap is reached", () => {
    const impact = buildEntityImpact({
      rootEntityId: "root",
      depth: "all",
      direction: "downstream",
      includeSource: false,
      limits: {
        maxSpecNodes: 150,
        maxSpecEdges: 400,
        maxSourceEvidence: 300,
        maxPaths: 2
      },
      entities: [
        entity("root", "Root"),
        entity("a", "A"),
        entity("b", "B"),
        entity("c", "C"),
        entity("d", "D")
      ],
      links: [
        link("root", "a", "uses"),
        link("root", "b", "uses"),
        link("a", "c", "uses"),
        link("b", "d", "uses")
      ],
      sourceEvidence: []
    });

    expect(impact.downstreamPaths.map((path) => path.entityIds)).toEqual([
      ["root", "a"],
      ["root", "b"]
    ]);
    expect(impact.nodes.map((node) => node.id)).toEqual([
      "spec:a",
      "spec:b",
      "spec:c",
      "spec:d",
      "spec:root"
    ]);
    expect(impact.edges.map((edge) => edge.id)).toEqual([
      "spec-link:a-c-uses",
      "spec-link:b-d-uses",
      "spec-link:root-a-uses",
      "spec-link:root-b-uses"
    ]);
    expect(impact.truncated).toMatchObject({
      isTruncated: true,
      reason: "path_limit"
    });
  });

  it("orders source evidence deterministically by source identity fields", () => {
    const impact = buildEntityImpact({
      rootEntityId: "domain.decision",
      depth: "1",
      direction: "both",
      includeSource: true,
      entities: [entity("domain.decision", "Decision", "domain_entity")],
      links: [],
      sourceEvidence: [
        evidence("domain.decision", "src/domain.ts", "Decision", {
          sourceFileId: "source-file-2",
          symbolLine: 8,
          annotationLine: 7
        }),
        evidence("domain.decision", "src/domain.ts", "Decision", {
          sourceFileId: "source-file-1",
          symbolLine: 4,
          annotationLine: 3
        }),
        evidence("domain.decision", "src/domain.ts", "Decision", {
          sourceFileId: "source-file-1",
          symbolLine: 3,
          annotationLine: 2
        })
      ]
    });

    expect(
      impact.sourceEvidence.map((item) => [
        item.sourceFileId,
        item.symbolLine,
        item.annotationLine
      ])
    ).toEqual([
      ["source-file-1", 3, 2],
      ["source-file-1", 4, 3],
      ["source-file-2", 8, 7]
    ]);
    expect(impact.nodes.filter((node) => node.kind === "source").map((node) => node.id)).toEqual([
      "source:src/domain.ts:source-file-1:Decision:3:2:domain.decision",
      "source:src/domain.ts:source-file-1:Decision:4:3:domain.decision",
      "source:src/domain.ts:source-file-2:Decision:8:7:domain.decision"
    ]);
    expect(impact.edges.filter((edge) => edge.kind === "source_evidence").map((edge) => edge.id)).toEqual([
      "source-evidence:src/domain.ts:source-file-1:Decision:3:2:domain.decision",
      "source-evidence:src/domain.ts:source-file-1:Decision:4:3:domain.decision",
      "source-evidence:src/domain.ts:source-file-2:Decision:8:7:domain.decision"
    ]);
  });
});

function entity(entityId: string, title: string, type = "domain_entity") {
  return {
    entityId,
    type,
    title,
    status: "draft",
    filePath: `${entityId}.md`
  };
}

function link(fromEntityId: string, toEntityId: string, linkType: string) {
  return {
    id: `${fromEntityId}-${toEntityId}-${linkType}`,
    fromEntityId,
    toEntityId,
    linkType,
    source: "frontmatter"
  };
}

function evidence(
  entityId: string,
  filePath: string,
  symbolName: string,
  overrides: Partial<{
    sourceFileId: string;
    symbolKind: string;
    symbolLine: number | null;
    annotationLine: number | null;
  }> = {}
) {
  return {
    entityId,
    filePath,
    sourceFileId: `${filePath}-id`,
    symbolName,
    symbolKind: "interface",
    symbolLine: 3,
    annotationLine: 2,
    ...overrides
  };
}
