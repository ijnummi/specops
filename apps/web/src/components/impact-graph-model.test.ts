import type { EntityImpactResponseDto } from "@specops/contracts";
import { describe, expect, it } from "vitest";

import { impactSpecColumns } from "./impact-graph-model.js";

describe("impactSpecColumns", () => {
  it("classifies impacted specs from admitted graph edges instead of capped paths", () => {
    const impact = impactResponse({
      nodes: [
        specNode("root"),
        specNode("a"),
        specNode("b"),
        specNode("c"),
        specNode("d"),
        specNode("orphan")
      ],
      edges: [
        specEdge("root", "a"),
        specEdge("root", "b"),
        specEdge("a", "c"),
        specEdge("b", "d")
      ],
      downstreamPaths: [
        {
          direction: "downstream",
          entityIds: ["root", "a"],
          steps: [],
          linkTypes: ["uses"]
        }
      ]
    });

    expect(impactSpecColumns(impact)).toEqual({
      upstreamEntityIds: [],
      downstreamEntityIds: ["a", "b", "c", "d"],
      otherEntityIds: ["orphan"]
    });
  });
});

function impactResponse(
  overrides: Partial<EntityImpactResponseDto>
): EntityImpactResponseDto {
  return {
    rootEntity: {
      entityId: "root",
      type: "domain_entity",
      title: "Root",
      status: "draft",
      filePath: "root.md"
    },
    nodes: [specNode("root")],
    edges: [],
    upstreamPaths: [],
    downstreamPaths: [],
    sourceEvidence: [],
    truncated: {
      isTruncated: false,
      reason: null,
      nodeCount: 1,
      edgeCount: 0,
      sourceEvidenceCount: 0
    },
    ...overrides
  };
}

function specNode(entityId: string): EntityImpactResponseDto["nodes"][number] {
  return {
    id: `spec:${entityId}`,
    kind: "spec",
    label: entityId,
    entityId,
    type: "domain_entity",
    status: "draft",
    title: entityId,
    filePath: `${entityId}.md`
  };
}

function specEdge(
  fromEntityId: string,
  toEntityId: string
): EntityImpactResponseDto["edges"][number] {
  return {
    id: `spec-link:${fromEntityId}-${toEntityId}`,
    from: `spec:${fromEntityId}`,
    to: `spec:${toEntityId}`,
    kind: "spec_link",
    label: "uses",
    fromEntityId,
    toEntityId,
    linkType: "uses",
    source: "frontmatter"
  };
}
