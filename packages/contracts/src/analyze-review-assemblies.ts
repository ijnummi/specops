import { z } from "zod";

import { indexRunSchema } from "./indexing.js";
import { proposalTypeSchema } from "./proposals.js";

export const analyzeReviewAssemblyStatusSchema = z.enum(["draft", "accepted", "discarded"]);
export const analyzeReviewInputRoleSchema = z.enum([
  "primary",
  "supporting",
  "duplicate",
  "evidence_only"
]);
export const analyzeReviewClaimKindSchema = z.enum(["fact", "hypothesis"]);
export const analyzeReviewEvidenceProvenanceSchema = z.enum(["scanner", "ai", "user"]);
export const analyzeReviewInputAssignmentStateSchema = z.enum([
  "assigned",
  "unassigned",
  "discarded"
]);
export const analyzeReviewValidationSeveritySchema = z.enum(["blocker", "warning"]);
export const analyzeReviewValidationStateSchema = z.enum(["blocker", "warning", "ready"]);

export const analyzeReviewEntityTypeSchema = z.enum([
  "domain_entity",
  "interface",
  "use_case"
]);

const validLineRange = (value: { startLine: number | null; endLine: number | null }) =>
  value.startLine === null || value.endLine === null || value.endLine >= value.startLine;

const validLineRangeRefinement = {
  message: "endLine must be greater than or equal to startLine",
  path: ["endLine"]
};

export const analyzeReviewInputSchema = z.object({
  proposalId: z.string().uuid(),
  role: analyzeReviewInputRoleSchema.optional(),
  proposalType: proposalTypeSchema,
  title: z.string().min(1),
  entityType: analyzeReviewEntityTypeSchema,
  entityId: z.string().min(1),
  filePath: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  assignmentState: analyzeReviewInputAssignmentStateSchema,
  evidenceCount: z.number().int().min(0)
});

export const analyzeReviewEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    proposalId: z.string().uuid(),
    sourceFilePath: z.string().min(1),
    symbolName: z.string().min(1).nullable(),
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
    provenance: analyzeReviewEvidenceProvenanceSchema,
    confidence: z.number().min(0).max(1).nullable()
  })
  .refine(
    validLineRange,
    validLineRangeRefinement
  );

export const analyzeReviewClaimSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  kind: analyzeReviewClaimKindSchema,
  confidence: z.number().min(0).max(1).nullable(),
  sortOrder: z.number().int().min(0),
  evidence: z.array(analyzeReviewEvidenceSchema)
});

export const analyzeReviewValidationMessageSchema = z.object({
  severity: analyzeReviewValidationSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().min(1).nullable().default(null)
});

export const analyzeReviewValidationSummarySchema = z.object({
  state: analyzeReviewValidationStateSchema,
  messages: z.array(analyzeReviewValidationMessageSchema)
});

export const analyzeReviewAssemblySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analyzeRunId: z.string().uuid(),
  status: analyzeReviewAssemblyStatusSchema,
  entityType: analyzeReviewEntityTypeSchema,
  entityId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  filePath: z.string().min(1),
  renderedMarkdown: z.string().nullable(),
  inputs: z.array(analyzeReviewInputSchema),
  claims: z.array(analyzeReviewClaimSchema),
  validation: analyzeReviewValidationSummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  discardedAt: z.string().datetime().nullable()
});

export const analyzeReviewCountsSchema = z.object({
  assemblies: z.object({
    draft: z.number().int().min(0),
    accepted: z.number().int().min(0),
    discarded: z.number().int().min(0)
  }),
  inputs: z.object({
    assigned: z.number().int().min(0),
    unassigned: z.number().int().min(0),
    discarded: z.number().int().min(0)
  }),
  validation: z.object({
    blocker: z.number().int().min(0),
    warning: z.number().int().min(0),
    ready: z.number().int().min(0)
  })
});

export const analyzeReviewListResponseSchema = z.object({
  assemblies: z.array(analyzeReviewAssemblySchema),
  unassignedInputs: z.array(analyzeReviewInputSchema),
  counts: analyzeReviewCountsSchema
});

export const analyzeReviewCreateAssemblyRequestSchema = z
  .object({
    proposalIds: z.array(z.string().uuid()).default([]),
    title: z.string().min(1).optional(),
    entityType: analyzeReviewEntityTypeSchema.optional(),
    entityId: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    summary: z.string().optional()
  })
  .refine(
    (value) =>
      value.proposalIds.length > 0 ||
      (value.title !== undefined &&
        value.entityType !== undefined &&
        value.entityId !== undefined &&
        value.filePath !== undefined),
    {
      message:
        "Expected proposalIds or title, entityType, entityId, and filePath"
    }
  );

const analyzeReviewUpdateAssemblyStatusSchema = z.literal("discarded");

export const analyzeReviewUpdateAssemblyRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    entityType: analyzeReviewEntityTypeSchema.optional(),
    entityId: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    summary: z.string().optional(),
    status: analyzeReviewUpdateAssemblyStatusSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one assembly field"
  });

export const analyzeReviewAttachInputRequestSchema = z.object({
  proposalId: z.string().uuid(),
  role: analyzeReviewInputRoleSchema
});

export const analyzeReviewCreateClaimRequestSchema = z.object({
  text: z.string().min(1),
  kind: analyzeReviewClaimKindSchema,
  confidence: z.number().min(0).max(1).nullable().default(null)
});

export const analyzeReviewUpdateClaimRequestSchema = z
  .object({
    text: z.string().min(1).optional(),
    kind: analyzeReviewClaimKindSchema.optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    sortOrder: z.number().int().min(0).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one claim field"
  });

export const analyzeReviewAttachEvidenceRequestSchema = z
  .object({
    proposalId: z.string().uuid(),
    sourceFilePath: z.string().min(1),
    symbolName: z.string().min(1).nullable().default(null),
    startLine: z.number().int().min(1).nullable().default(null),
    endLine: z.number().int().min(1).nullable().default(null),
    provenance: analyzeReviewEvidenceProvenanceSchema,
    confidence: z.number().min(0).max(1).nullable().default(null)
  })
  .refine(
    validLineRange,
    validLineRangeRefinement
  );

export const analyzeReviewAcceptRequestSchema = z.object({
  assemblyIds: z.array(z.string().uuid()).nonempty()
});

export const analyzeReviewAcceptFailureSchema = z.object({
  assemblyId: z.string().uuid(),
  messages: z.array(analyzeReviewValidationMessageSchema)
});

export const analyzeReviewAcceptResponseSchema = z.object({
  acceptedAssemblyIds: z.array(z.string().uuid()),
  annotationCount: z.number().int().min(0).default(0),
  failures: z.array(analyzeReviewAcceptFailureSchema),
  indexRun: indexRunSchema.nullable()
});

export type AnalyzeReviewAssemblyStatus = z.infer<typeof analyzeReviewAssemblyStatusSchema>;
export type AnalyzeReviewInputRole = z.infer<typeof analyzeReviewInputRoleSchema>;
export type AnalyzeReviewClaimKind = z.infer<typeof analyzeReviewClaimKindSchema>;
export type AnalyzeReviewEvidenceProvenance = z.infer<
  typeof analyzeReviewEvidenceProvenanceSchema
>;
export type AnalyzeReviewInputAssignmentState = z.infer<
  typeof analyzeReviewInputAssignmentStateSchema
>;
export type AnalyzeReviewValidationSeverity = z.infer<
  typeof analyzeReviewValidationSeveritySchema
>;
export type AnalyzeReviewValidationState = z.infer<typeof analyzeReviewValidationStateSchema>;
export type AnalyzeReviewEntityType = z.infer<typeof analyzeReviewEntityTypeSchema>;
export type AnalyzeReviewInputDto = z.infer<typeof analyzeReviewInputSchema>;
export type AnalyzeReviewEvidenceDto = z.infer<typeof analyzeReviewEvidenceSchema>;
export type AnalyzeReviewClaimDto = z.infer<typeof analyzeReviewClaimSchema>;
export type AnalyzeReviewValidationMessage = z.infer<
  typeof analyzeReviewValidationMessageSchema
>;
export type AnalyzeReviewValidationSummary = z.infer<
  typeof analyzeReviewValidationSummarySchema
>;
export type AnalyzeReviewAssemblyDto = z.infer<typeof analyzeReviewAssemblySchema>;
export type AnalyzeReviewCounts = z.infer<typeof analyzeReviewCountsSchema>;
export type AnalyzeReviewListResponse = z.infer<typeof analyzeReviewListResponseSchema>;
export type AnalyzeReviewCreateAssemblyRequest = z.infer<
  typeof analyzeReviewCreateAssemblyRequestSchema
>;
export type AnalyzeReviewUpdateAssemblyRequest = z.infer<
  typeof analyzeReviewUpdateAssemblyRequestSchema
>;
export type AnalyzeReviewAttachInputRequest = z.infer<typeof analyzeReviewAttachInputRequestSchema>;
export type AnalyzeReviewCreateClaimRequest = z.infer<typeof analyzeReviewCreateClaimRequestSchema>;
export type AnalyzeReviewUpdateClaimRequest = z.infer<typeof analyzeReviewUpdateClaimRequestSchema>;
export type AnalyzeReviewAttachEvidenceRequest = z.infer<
  typeof analyzeReviewAttachEvidenceRequestSchema
>;
export type AnalyzeReviewAcceptRequest = z.infer<typeof analyzeReviewAcceptRequestSchema>;
export type AnalyzeReviewAcceptFailure = z.infer<typeof analyzeReviewAcceptFailureSchema>;
export type AnalyzeReviewAcceptResponse = z.infer<typeof analyzeReviewAcceptResponseSchema>;
