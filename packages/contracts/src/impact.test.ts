import { describe, expect, it } from "vitest";

import {
  entityImpactQuerySchema,
  entityImpactResponseSchema
} from "./impact.js";

describe("entityImpactQuerySchema", () => {
  it("defaults to one-hop bidirectional source-inclusive impact", () => {
    expect(entityImpactQuerySchema.parse({})).toEqual({
      depth: "1",
      direction: "both",
      includeSource: true
    });
  });

  it("coerces includeSource from query-string booleans", () => {
    expect(
      entityImpactQuerySchema.parse({ includeSource: "false" }).includeSource
    ).toBe(false);
    expect(
      entityImpactQuerySchema.parse({ includeSource: "true" }).includeSource
    ).toBe(true);
  });
});

describe("entityImpactResponseSchema", () => {
  it("accepts graph-ready and trace-ready impact responses", () => {
    const parsed = entityImpactResponseSchema.parse({
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
          id: "source:src/domain.ts:Decision:domain.decision",
          kind: "source",
          label: "Decision",
          entityId: "domain.decision",
          filePath: "src/domain.ts",
          symbolName: "Decision",
          symbolKind: "interface",
          symbolLine: 3,
          annotationLine: 2
        }
      ],
      edges: [
        {
          id: "source-evidence:src/domain.ts:Decision:domain.decision",
          from: "spec:domain.decision",
          to: "source:src/domain.ts:Decision:domain.decision",
          kind: "source_evidence",
          label: "@specops",
          entityId: "domain.decision",
          filePath: "src/domain.ts",
          symbolName: "Decision"
        }
      ],
      upstreamPaths: [],
      downstreamPaths: [],
      sourceEvidence: [
        {
          entityId: "domain.decision",
          filePath: "src/domain.ts",
          sourceFileId: "source-file-1",
          symbolName: "Decision",
          symbolKind: "interface",
          symbolLine: 3,
          annotationLine: 2,
          relationshipType: "implements"
        }
      ],
      truncated: {
        isTruncated: false,
        reason: null,
        nodeCount: 2,
        edgeCount: 1,
        sourceEvidenceCount: 1
      }
    });

    expect(parsed.rootEntity.entityId).toBe("domain.decision");
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.sourceEvidence[0]?.relationshipType).toBe("implements");
  });
});
