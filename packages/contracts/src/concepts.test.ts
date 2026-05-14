import { describe, expect, it } from "vitest";

import {
  buildConceptGraphRequestSchema,
  conceptDetailResponseSchema,
  conceptGraphLatestResponseSchema,
  projectConceptMembershipSchema,
  projectConceptRelationshipSchema,
  projectConceptSchema,
  projectConceptVersionSchema
} from "./concepts.js";

const timestamp = "2026-05-14T10:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000001";
const graphVersionId = "00000000-0000-4000-8000-000000000002";
const conceptVersionId = "00000000-0000-4000-8000-000000000003";
const conceptId = "00000000-0000-4000-8000-000000000004";
const nodeId = "00000000-0000-4000-8000-000000000005";

describe("concept graph contracts", () => {
  it("parses a build request", () => {
    const parsed = buildConceptGraphRequestSchema.parse({
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 120,
      maxGraphEdges: 240
    });

    expect(parsed.provider).toBe("openai");
    expect(parsed.maxGraphNodes).toBe(120);
  });

  it("parses concept version, concept, membership, and relationship DTOs", () => {
    const version = projectConceptVersionSchema.parse({
      id: conceptVersionId,
      projectId,
      projectGraphVersionId: graphVersionId,
      status: "ready",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "concept-graph-v1",
      summary: "Concept graph with one workflow.",
      coverage: {
        conceptCounts: { workflow: 1 },
        membershipCounts: { primary: 1 },
        relationshipCounts: {},
        rejectedConceptCount: 0,
        rejectedMembershipCount: 0,
        graphNodeCoverageCount: 1,
        lowConfidenceConceptCount: 0
      },
      diagnostics: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const concept = projectConceptSchema.parse({
      id: conceptId,
      projectId,
      conceptVersionId,
      conceptKey: "workflow:checkout",
      conceptType: "workflow",
      name: "Checkout",
      summary: "Coordinates checkout behavior.",
      confidence: 0.86,
      provenance: "ai",
      evidenceSummary: "Supported by checkout service graph nodes.",
      status: "active",
      metadata: { source: "provider" },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const membership = projectConceptMembershipSchema.parse({
      id: "00000000-0000-4000-8000-000000000006",
      projectId,
      conceptVersionId,
      conceptId,
      graphNodeId: nodeId,
      role: "primary",
      confidence: 0.9,
      rationale: "Main service node for the concept.",
      createdAt: timestamp
    });
    const relationship = projectConceptRelationshipSchema.parse({
      id: "00000000-0000-4000-8000-000000000007",
      projectId,
      conceptVersionId,
      fromConceptId: conceptId,
      toConceptId: "00000000-0000-4000-8000-000000000008",
      relationshipType: "uses",
      confidence: 0.7,
      rationale: "Workflow calls the downstream concept.",
      createdAt: timestamp
    });

    expect(version.status).toBe("ready");
    expect(concept.conceptType).toBe("workflow");
    expect(membership.role).toBe("primary");
    expect(relationship.relationshipType).toBe("uses");
  });

  it("parses latest and detail responses", () => {
    const version = projectConceptVersionSchema.parse({
      id: conceptVersionId,
      projectId,
      projectGraphVersionId: graphVersionId,
      status: "limited",
      provider: "ollama",
      model: "llama3.2",
      promptVersion: "concept-graph-v1",
      summary: "Limited concept graph.",
      coverage: {
        conceptCounts: { subsystem: 1 },
        membershipCounts: { supporting: 1 },
        relationshipCounts: { relates_to: 1 },
        rejectedConceptCount: 1,
        rejectedMembershipCount: 2,
        graphNodeCoverageCount: 1,
        lowConfidenceConceptCount: 1
      },
      diagnostics: [{ level: "warning", code: "limited_graph_evidence", message: "Only one node was usable." }],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const concept = projectConceptSchema.parse({
      id: conceptId,
      projectId,
      conceptVersionId,
      conceptKey: "subsystem:api",
      conceptType: "subsystem",
      name: "API",
      summary: "HTTP API subsystem.",
      confidence: 0.5,
      provenance: "ai",
      evidenceSummary: "Supported by one route file.",
      status: "active",
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const latest = conceptGraphLatestResponseSchema.parse({
      version,
      conceptCounts: { subsystem: 1 },
      membershipCounts: { supporting: 1 },
      relationshipCounts: { relates_to: 1 },
      concepts: [concept],
      diagnostics: version.diagnostics
    });
    const detail = conceptDetailResponseSchema.parse({
      concept,
      memberships: [],
      graphNodes: [],
      incomingRelationships: {},
      outgoingRelationships: {},
      relatedConcepts: []
    });

    expect(latest.concepts).toHaveLength(1);
    expect(detail.concept.name).toBe("API");
  });
});
