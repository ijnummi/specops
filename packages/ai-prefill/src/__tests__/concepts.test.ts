import { describe, expect, it } from "vitest";

import {
  buildConceptGraphPromptPacket,
  normalizeConceptGraphProviderResponse
} from "../concepts.js";

const graphNode = {
  id: "00000000-0000-4000-8000-000000000001",
  nodeKey: "file:src/checkout.ts",
  nodeType: "file",
  label: "checkout.ts",
  path: "src/checkout.ts"
};

describe("concept graph prompt helpers", () => {
  it("builds a bounded prompt packet from graph facts", () => {
    const packet = buildConceptGraphPromptPacket({
      project: { id: "project-1", name: "Checkout" },
      graph: {
        versionId: "graph-1",
        summary: "Graph with checkout facts.",
        nodes: [graphNode],
        edges: []
      },
      limits: { maxGraphNodes: 10, maxGraphEdges: 20 }
    });

    expect(packet.promptVersion).toBe("concept-graph-v1");
    expect(packet.messages[0]?.role).toBe("system");
    expect(packet.messages[1]?.content).toContain("src/checkout.ts");
  });

  it("normalizes concepts and rejects unsupported memberships", () => {
    const normalized = normalizeConceptGraphProviderResponse({
      text: JSON.stringify({
        concepts: [
          {
            key: "workflow:checkout",
            type: "workflow",
            name: "Checkout",
            summary: "Handles checkout.",
            confidence: 0.92,
            evidenceSummary: "Supported by checkout service.",
            memberships: [
              {
                graphNodeId: graphNode.id,
                role: "primary",
                confidence: 0.9,
                rationale: "Primary implementation file."
              },
              {
                graphNodeId: "missing-node",
                role: "supporting",
                confidence: 0.9,
                rationale: "Unsupported."
              }
            ]
          },
          {
            key: "workflow:unsupported",
            type: "workflow",
            name: "Unsupported",
            summary: "No valid evidence.",
            confidence: 0.9,
            evidenceSummary: "No supported node.",
            memberships: []
          }
        ],
        relationships: []
      }),
      graphNodeIds: new Set([graphNode.id]),
      graphNodeKeys: new Map([[graphNode.nodeKey, graphNode.id]])
    });

    expect(normalized.concepts).toHaveLength(1);
    expect(normalized.concepts[0]?.memberships).toHaveLength(1);
    expect(
      normalized.diagnostics.some((diagnostic) => diagnostic.code === "unsupported_membership")
    ).toBe(true);
    expect(normalized.rejectedConceptCount).toBe(1);
    expect(normalized.rejectedMembershipCount).toBe(1);
  });
});
