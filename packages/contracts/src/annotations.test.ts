import { describe, expect, it } from "vitest";

import {
  annotationCreateRequestSchema,
  annotationListQuerySchema,
  sourceSpecAnnotationSchema,
  sourceSpecAnnotationUpdateRequestSchema,
} from "./annotations.js";

describe("annotation contracts", () => {
  it("parses a source/spec annotation DTO", () => {
    const parsed = sourceSpecAnnotationSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      sourceFileId: "00000000-0000-4000-8000-000000000003",
      sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
      symbolName: "registerAnalyzeReviewAssemblyRoutes",
      symbolKind: "function",
      startLine: 10,
      endLine: 42,
      annotationLine: 12,
      sourceContentHash: "hash-source",
      entityId: "use-case.review-drafts",
      specFilePath: "use-cases/review-drafts.md",
      claimId: "00000000-0000-4000-8000-000000000004",
      relationshipType: "implements",
      confidence: 0.82,
      provenance: "ai",
      status: "active",
      analyzeRunId: "00000000-0000-4000-8000-000000000005",
      proposalId: "00000000-0000-4000-8000-000000000006",
      assemblyId: "00000000-0000-4000-8000-000000000007",
      claimEvidenceId: "00000000-0000-4000-8000-000000000008",
      indexRunId: "00000000-0000-4000-8000-000000000009",
      excerpt: {
        status: "available",
        startLine: 8,
        endLine: 44,
        text: "export function registerAnalyzeReviewAssemblyRoutes() {}",
      },
      createdAt: "2026-05-13T10:00:00.000Z",
      updatedAt: "2026-05-13T10:00:00.000Z",
    });

    expect(parsed.relationshipType).toBe("implements");
    expect(parsed.provenance).toBe("ai");
    expect(parsed.status).toBe("active");
  });

  it("parses list filters", () => {
    const parsed = annotationListQuerySchema.parse({
      entityId: "use-case.review-drafts",
      filePath: "apps/api/src/routes/analyze-review-assemblies.ts",
      relationshipType: "implements",
      status: "active",
      provenance: "ai",
    });

    expect(parsed).toMatchObject({
      entityId: "use-case.review-drafts",
      relationshipType: "implements",
      status: "active",
      provenance: "ai",
    });
  });

  it("parses includeExcerpt query booleans explicitly", () => {
    expect(annotationListQuerySchema.parse({}).includeExcerpt).toBe(false);
    expect(annotationListQuerySchema.parse({ includeExcerpt: "false" }).includeExcerpt).toBe(false);
    expect(annotationListQuerySchema.parse({ includeExcerpt: "true" }).includeExcerpt).toBe(true);
  });

  it("requires a source target, entity id, and relationship type to create an annotation", () => {
    const parsed = annotationCreateRequestSchema.parse({
      sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
      entityId: "use-case.review-drafts",
      relationshipType: "implements",
      symbolName: "registerAnalyzeReviewAssemblyRoutes",
      startLine: 10,
      endLine: 42,
      claimId: "00000000-0000-4000-8000-000000000004",
      confidence: 1,
    });

    expect(parsed.sourceFilePath).toBe("apps/api/src/routes/analyze-review-assemblies.ts");
  });

  it("validates update requests", () => {
    const parsed = sourceSpecAnnotationUpdateRequestSchema.parse({
      relationshipType: "references",
      status: "stale",
      confidence: 0.5,
    });

    expect(parsed.status).toBe("stale");
  });
});
