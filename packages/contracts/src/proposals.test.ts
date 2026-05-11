import { describe, expect, it } from "vitest";

import {
  acceptProposalsRequestSchema,
  proposalDetailSchema,
  proposalListQuerySchema,
  proposalPatchRequestSchema,
  proposalSummarySchema,
  sourceSpecEntityProposalPayloadSchema
} from "./proposals.js";

describe("proposal contracts", () => {
  it("parses source spec entity proposal payloads", () => {
    const parsed = sourceSpecEntityProposalPayloadSchema.parse(sourceSpecEntityPayload());

    expect(parsed.entityId).toBe("interface.decision-service");
    expect(parsed.type).toBe("interface");
    expect(parsed.symbols[0]?.name).toBe("DecisionService");
  });

  it("parses proposal summaries", () => {
    const parsed = proposalSummarySchema.parse(proposalSummary());

    expect(parsed.proposalType).toBe("source_spec_entity");
    expect(parsed.status).toBe("pending");
    expect(parsed.conflict.type).toBe("none");
  });

  it("parses proposal list queries", () => {
    expect(proposalListQuerySchema.parse({ status: "pending" })).toEqual({
      status: "pending"
    });
  });

  it("parses proposal patch requests", () => {
    expect(proposalPatchRequestSchema.parse({ markdown: "# Edited" })).toEqual({
      markdown: "# Edited"
    });
    expect(proposalPatchRequestSchema.parse({ status: "rejected" })).toEqual({
      status: "rejected"
    });
  });

  it("parses accept proposals requests", () => {
    expect(acceptProposalsRequestSchema.parse({ proposalIds: ["proposal-1"] })).toEqual({
      proposalIds: ["proposal-1"]
    });
  });

  it("parses proposal details with payload and evidence", () => {
    const parsed = proposalDetailSchema.parse({
      ...proposalSummary(),
      payload: sourceSpecEntityPayload(),
      evidence: {
        scanner: "typescript",
        sourceFiles: [
          {
            file: "src/services/decision-service.ts",
            symbolName: "DecisionService",
            symbolKind: "class",
            exported: true,
            line: 4
          }
        ]
      }
    });

    expect(parsed.payload.filePath).toBe("interfaces/decision-service.md");
    expect(parsed.evidence.scanner).toBe("typescript");
  });
});

function proposalSummary() {
  return {
    id: "proposal-1",
    projectId: "project-1",
    proposalType: "source_spec_entity",
    status: "pending",
    title: "DecisionService",
    entityId: "interface.decision-service",
    entityType: "interface",
    filePath: "interfaces/decision-service.md",
    confidence: 0.7,
    conflict: { type: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null
  };
}

function sourceSpecEntityPayload() {
  return {
    entityId: "interface.decision-service",
    type: "interface",
    title: "DecisionService",
    status: "draft",
    filePath: "interfaces/decision-service.md",
    generatedMarkdown: "# DecisionService",
    markdown: "# DecisionService",
    sourceFiles: ["src/services/decision-service.ts"],
    symbols: [
      {
        name: "DecisionService",
        kind: "class",
        exported: true,
        file: "src/services/decision-service.ts",
        line: 4
      }
    ]
  };
}
