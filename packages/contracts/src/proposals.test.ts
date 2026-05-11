import { describe, expect, it } from "vitest";

import {
  acceptProposalsRequestSchema,
  aiPrefillGenerateRequestSchema,
  aiSpecEntityProposalEvidenceSchema,
  aiSpecEntityProposalPayloadSchema,
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
    expect(parsed.conflict.status).toBe("none");
    expect(proposalSummarySchema.parse({ ...proposalSummary(), confidence: null }).confidence).toBe(
      null
    );
  });

  it("rejects source spec entity proposal summaries with use case entity type", () => {
    expect(() =>
      proposalSummarySchema.parse({
        ...proposalSummary(),
        entityType: "use_case"
      })
    ).toThrow();
  });

  it("parses proposal list queries", () => {
    expect(proposalListQuerySchema.parse({ status: "pending" })).toEqual({
      status: "pending"
    });
  });

  it("parses proposal list queries filtered by AI proposal type", () => {
    expect(
      proposalListQuerySchema.parse({ status: "pending", proposalType: "ai_spec_entity" })
    ).toEqual({
      status: "pending",
      proposalType: "ai_spec_entity"
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

    expect(parsed.proposalType).toBe("source_spec_entity");
    if (parsed.proposalType !== "source_spec_entity") {
      throw new Error("Expected source spec entity proposal detail");
    }
    expect(parsed.payload.filePath).toBe("interfaces/decision-service.md");
    expect(parsed.evidence.scanner).toBe("typescript");
  });

  it("parses AI prefill generate requests", () => {
    const parsed = aiPrefillGenerateRequestSchema.parse({
      sourceFileIds: ["source-file-1"],
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      temperature: 0.1
    });

    expect(parsed).toEqual({
      sourceFileIds: ["source-file-1"],
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      temperature: 0.1
    });
  });

  it("defaults AI prefill generate request temperature", () => {
    expect(
      aiPrefillGenerateRequestSchema.parse({
        sourceFileIds: ["source-file-1"],
        provider: "ollama",
        model: "qwen2.5-coder:7b"
      }).temperature
    ).toBe(0.1);
  });

  it("rejects AI prefill generate requests without source file ids", () => {
    expect(() =>
      aiPrefillGenerateRequestSchema.parse({
        sourceFileIds: [],
        provider: "ollama",
        model: "qwen2.5-coder:7b"
      })
    ).toThrow();
  });

  it("rejects AI prefill generate requests with out-of-range temperature", () => {
    expect(() =>
      aiPrefillGenerateRequestSchema.parse({
        sourceFileIds: ["source-file-1"],
        provider: "ollama",
        model: "qwen2.5-coder:7b",
        temperature: 2.1
      })
    ).toThrow();
  });

  it("parses AI spec entity proposal payloads", () => {
    const parsed = aiSpecEntityProposalPayloadSchema.parse(aiPayload());

    expect(parsed.entityId).toBe("uc.manage-projects");
    expect(parsed.type).toBe("use_case");
    expect(parsed.proposedLinks[0]?.targetEntityId).toBe("interface.project-service");
  });

  it("parses AI spec entity proposal evidence", () => {
    const parsed = aiSpecEntityProposalEvidenceSchema.parse(aiEvidence());

    expect(parsed.provider).toBe("ollama");
    expect(parsed.promptVersion).toBe("ai-prefill-v1");
    expect(parsed.selectedSourceFiles[0]?.excerptEndLine).toBe(80);
  });

  it("rejects AI spec entity proposal evidence with inverted excerpt lines", () => {
    expect(() =>
      aiSpecEntityProposalEvidenceSchema.parse({
        ...aiEvidence(),
        selectedSourceFiles: [
          {
            file: "apps/api/src/routes/projects.ts",
            contentHash: "hash-1",
            excerptStartLine: 80,
            excerptEndLine: 1
          }
        ]
      })
    ).toThrow();
  });

  it("parses AI spec entity proposal details", () => {
    const parsed = proposalDetailSchema.parse({
      ...proposalSummary(),
      proposalType: "ai_spec_entity",
      title: "Manage projects",
      entityId: "uc.manage-projects",
      entityType: "use_case",
      filePath: "use-cases/uc.manage-projects.md",
      payload: aiPayload(),
      evidence: aiEvidence()
    });

    expect(parsed.proposalType).toBe("ai_spec_entity");
    if (parsed.proposalType !== "ai_spec_entity") {
      throw new Error("Expected AI spec entity proposal detail");
    }
    expect(parsed.payload.type).toBe("use_case");
    expect(parsed.evidence.provider).toBe("ollama");
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
    conflict: { status: "none" },
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

function aiPayload() {
  return {
    entityId: "uc.manage-projects",
    type: "use_case",
    title: "Manage projects",
    status: "draft",
    filePath: "use-cases/uc.manage-projects.md",
    generatedMarkdown: "# Manage projects",
    markdown: "# Manage projects",
    sourceFiles: ["apps/api/src/routes/projects.ts"],
    proposedLinks: [
      {
        linkType: "uses",
        targetEntityId: "interface.project-service",
        targetExists: true,
        rationale: "The selected route delegates project behavior to the project service."
      }
    ]
  };
}

function aiEvidence() {
  return {
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    promptVersion: "ai-prefill-v1",
    selectedSourceFiles: [
      {
        file: "apps/api/src/routes/projects.ts",
        contentHash: "hash-1",
        excerptStartLine: 1,
        excerptEndLine: 80
      }
    ],
    claims: [
      {
        text: "Project routes expose project creation.",
        sourceFiles: ["apps/api/src/routes/projects.ts"]
      }
    ],
    warnings: []
  };
}
