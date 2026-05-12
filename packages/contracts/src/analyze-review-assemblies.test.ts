import { describe, expect, it } from "vitest";

import {
  analyzeReviewAcceptResponseSchema,
  analyzeReviewAttachEvidenceRequestSchema,
  analyzeReviewAssemblySchema,
  analyzeReviewCreateAssemblyRequestSchema,
  analyzeReviewListResponseSchema,
  analyzeReviewUpdateAssemblyRequestSchema,
  analyzeReviewValidationSeveritySchema
} from "./analyze-review-assemblies.js";

describe("analyze review assembly contracts", () => {
  it("parses an assembly with inputs, claims, evidence, and validation", () => {
    const assembly = analyzeReviewAssemblySchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      analyzeRunId: "33333333-3333-4333-8333-333333333333",
      status: "draft",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      filePath: "use-cases/review-drafts.md",
      renderedMarkdown: null,
      inputs: [
        {
          proposalId: "44444444-4444-4444-8444-444444444444",
          role: "primary",
          proposalType: "ai_spec_entity",
          title: "Review drafts",
          entityType: "use_case",
          entityId: "use-case.review-drafts",
          filePath: "use-cases/review-drafts.md",
          confidence: 0.82,
          assignmentState: "assigned",
          evidenceCount: 1
        }
      ],
      claims: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          text: "Users review generated draft inputs before accepting specs.",
          kind: "fact",
          confidence: 0.82,
          sortOrder: 0,
          evidence: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              proposalId: "44444444-4444-4444-8444-444444444444",
              sourceFilePath: "apps/web/src/routes/analyze-run-review.tsx",
              symbolName: "AnalyzeRunReviewPage",
              startLine: 60,
              endLine: 120,
              provenance: "ai",
              confidence: 0.82
            }
          ]
        }
      ],
      validation: {
        state: "ready",
        messages: []
      },
      createdAt: "2026-05-13T12:00:00.000Z",
      updatedAt: "2026-05-13T12:00:00.000Z",
      acceptedAt: null,
      discardedAt: null
    });

    expect(assembly.validation.state).toBe("ready");
    expect(assembly.claims[0]?.evidence).toHaveLength(1);
  });

  it("rejects invalid validation severities", () => {
    expect(() => analyzeReviewValidationSeveritySchema.parse("fatal")).toThrow();
  });

  it("parses a list response with unassigned inputs and counts", () => {
    const response = analyzeReviewListResponseSchema.parse({
      assemblies: [],
      unassignedInputs: [
        {
          proposalId: "44444444-4444-4444-8444-444444444444",
          proposalType: "source_spec_entity",
          title: "Project service",
          entityType: "interface",
          entityId: "interface.project-service",
          filePath: "interfaces/project-service.md",
          confidence: 0.7,
          assignmentState: "unassigned",
          evidenceCount: 2
        }
      ],
      counts: {
        assemblies: { draft: 0, accepted: 0, discarded: 0 },
        inputs: { assigned: 0, unassigned: 1, discarded: 0 },
        validation: { blocker: 0, warning: 0, ready: 0 }
      }
    });

    expect(response.unassignedInputs[0]?.assignmentState).toBe("unassigned");
  });

  it("parses an accept response with partial validation failures", () => {
    const response = analyzeReviewAcceptResponseSchema.parse({
      acceptedAssemblyIds: ["11111111-1111-4111-8111-111111111111"],
      failures: [
        {
          assemblyId: "22222222-2222-4222-8222-222222222222",
          messages: [
            {
              severity: "blocker",
              code: "fact_missing_evidence",
              message: "Fact claims require evidence.",
              field: "claims"
            }
          ]
        }
      ],
      indexRun: null
    });

    expect(response.failures[0]?.messages[0]?.code).toBe("fact_missing_evidence");
  });

  it("rejects attach evidence requests with invalid line ranges", () => {
    expect(() =>
      analyzeReviewAttachEvidenceRequestSchema.parse({
        proposalId: "44444444-4444-4444-8444-444444444444",
        sourceFilePath: "apps/web/src/routes/analyze-run-review.tsx",
        startLine: 20,
        endLine: 10,
        provenance: "user"
      })
    ).toThrow();
  });

  it("rejects empty create assembly requests", () => {
    expect(() => analyzeReviewCreateAssemblyRequestSchema.parse({})).toThrow();
  });

  it("accepts proposal-backed create assembly requests", () => {
    const request = analyzeReviewCreateAssemblyRequestSchema.parse({
      proposalIds: ["44444444-4444-4444-8444-444444444444"]
    });

    expect(request.proposalIds).toHaveLength(1);
  });

  it("accepts manual create assembly requests with identity fields", () => {
    const request = analyzeReviewCreateAssemblyRequestSchema.parse({
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md"
    });

    expect(request.entityId).toBe("use-case.review-drafts");
  });

  it("rejects accepted status in update assembly requests", () => {
    expect(() =>
      analyzeReviewUpdateAssemblyRequestSchema.parse({ status: "accepted" })
    ).toThrow();
  });

  it("accepts discarded status in update assembly requests", () => {
    const request = analyzeReviewUpdateAssemblyRequestSchema.parse({ status: "discarded" });

    expect(request.status).toBe("discarded");
  });
});
