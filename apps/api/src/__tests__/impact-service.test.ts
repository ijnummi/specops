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
      "source:src/domain.ts:Decision:domain.decision"
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

function evidence(entityId: string, filePath: string, symbolName: string) {
  return {
    entityId,
    filePath,
    sourceFileId: `${filePath}-id`,
    symbolName,
    symbolKind: "interface",
    symbolLine: 3,
    annotationLine: 2
  };
}
