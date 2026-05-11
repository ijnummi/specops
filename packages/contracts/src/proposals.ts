import { z } from "zod";

import { indexRunSchema } from "./indexing.js";

export const proposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "edited_and_accepted",
  "rejected",
  "obsolete"
]);

export const proposalTypeSchema = z.enum(["source_spec_entity", "ai_spec_entity"]);

export const aiProviderSchema = z.enum(["ollama", "openai"]);

export const sourceSpecEntityProposalPayloadSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(["domain_entity", "interface"]),
  title: z.string().min(1),
  status: z.literal("draft"),
  filePath: z.string().min(1),
  generatedMarkdown: z.string().min(1),
  markdown: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)),
  symbols: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.string().min(1),
      exported: z.boolean(),
      file: z.string().min(1),
      line: z.number().int().nullable()
    })
  )
});

export const sourceSpecEntityProposalEvidenceSchema = z.object({
  scanner: z.literal("typescript"),
  sourceFiles: z.array(
    z.object({
      file: z.string().min(1),
      symbolName: z.string().min(1),
      symbolKind: z.string().min(1),
      exported: z.boolean(),
      line: z.number().int().nullable()
    })
  )
});

export const aiSpecEntityProposalPayloadSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(["use_case", "domain_entity", "interface"]),
  title: z.string().min(1),
  status: z.literal("draft"),
  filePath: z.string().min(1),
  generatedMarkdown: z.string().min(1),
  markdown: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)),
  proposedLinks: z.array(
    z.object({
      linkType: z.string().min(1),
      targetEntityId: z.string().min(1),
      targetExists: z.boolean(),
      rationale: z.string().min(1)
    })
  )
});

const aiSpecEntityProposalEvidenceSourceFileSchema = z
  .object({
    file: z.string().min(1),
    contentHash: z.string().min(1),
    excerptStartLine: z.number().int().min(1),
    excerptEndLine: z.number().int().min(1)
  })
  .refine((value) => value.excerptEndLine >= value.excerptStartLine, {
    message: "excerptEndLine must be greater than or equal to excerptStartLine",
    path: ["excerptEndLine"]
  });

export const aiSpecEntityProposalEvidenceSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().min(1),
  promptVersion: z.literal("ai-prefill-v1"),
  selectedSourceFiles: z.array(aiSpecEntityProposalEvidenceSourceFileSchema),
  claims: z.array(
    z.object({
      text: z.string().min(1),
      sourceFiles: z.array(z.string().min(1))
    })
  ),
  warnings: z.array(z.string().min(1))
});

export const aiPrefillGenerateRequestSchema = z.object({
  sourceFileIds: z.array(z.string().min(1)).nonempty(),
  provider: aiProviderSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.1)
});

export const aiPrefillDiagnosticSchema = z.object({
  level: z.enum(["warning", "info"]),
  message: z.string().min(1)
});

export const proposalConflictSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("file_exists"), filePath: z.string().min(1) }),
  z.object({ status: z.literal("entity_exists"), entityId: z.string().min(1) }),
  z.object({ status: z.literal("unavailable"), message: z.string().min(1) })
]);

const proposalSummaryBaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: proposalStatusSchema,
  title: z.string(),
  entityId: z.string(),
  filePath: z.string(),
  confidence: z.number().nullable(),
  conflict: proposalConflictSchema,
  createdAt: z.string(),
  reviewedAt: z.string().nullable()
});

export const sourceSpecEntityProposalSummarySchema = proposalSummaryBaseSchema.extend({
  proposalType: z.literal("source_spec_entity"),
  entityType: z.enum(["domain_entity", "interface"])
});

export const aiSpecEntityProposalSummarySchema = proposalSummaryBaseSchema.extend({
  proposalType: z.literal("ai_spec_entity"),
  entityType: z.enum(["use_case", "domain_entity", "interface"])
});

export const proposalSummarySchema = z.discriminatedUnion("proposalType", [
  sourceSpecEntityProposalSummarySchema,
  aiSpecEntityProposalSummarySchema
]);

export const aiPrefillGenerateResponseSchema = z.object({
  proposals: z.array(proposalSummarySchema),
  diagnostics: z.array(aiPrefillDiagnosticSchema)
});

export const sourceSpecEntityProposalDetailSchema = sourceSpecEntityProposalSummarySchema.extend({
  payload: sourceSpecEntityProposalPayloadSchema,
  evidence: sourceSpecEntityProposalEvidenceSchema
});

export const aiSpecEntityProposalDetailSchema = aiSpecEntityProposalSummarySchema.extend({
  payload: aiSpecEntityProposalPayloadSchema,
  evidence: aiSpecEntityProposalEvidenceSchema
});

export const proposalDetailSchema = z.discriminatedUnion("proposalType", [
  sourceSpecEntityProposalDetailSchema,
  aiSpecEntityProposalDetailSchema
]);

export const proposalListQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  proposalType: proposalTypeSchema.optional()
});

export const proposalPatchRequestSchema = z
  .object({
    markdown: z.string().min(1).optional(),
    status: z.literal("rejected").optional()
  })
  .refine((value) => value.markdown !== undefined || value.status !== undefined, {
    message: "Expected markdown or rejected status"
  });

export const acceptProposalsRequestSchema = z.object({
  proposalIds: z.array(z.string().min(1)).nonempty()
});

export const acceptProposalsResponseSchema = z.object({
  acceptedProposalIds: z.array(z.string().min(1)),
  indexRun: indexRunSchema
});

export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type ProposalType = z.infer<typeof proposalTypeSchema>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type SourceSpecEntityProposalPayload = z.infer<
  typeof sourceSpecEntityProposalPayloadSchema
>;
export type SourceSpecEntityProposalEvidence = z.infer<
  typeof sourceSpecEntityProposalEvidenceSchema
>;
export type AiSpecEntityProposalPayload = z.infer<
  typeof aiSpecEntityProposalPayloadSchema
>;
export type AiSpecEntityProposalEvidence = z.infer<
  typeof aiSpecEntityProposalEvidenceSchema
>;
export type SourceSpecEntityProposalDetail = z.infer<
  typeof sourceSpecEntityProposalDetailSchema
>;
export type AiSpecEntityProposalDetail = z.infer<typeof aiSpecEntityProposalDetailSchema>;
export type AiPrefillGenerateRequest = z.infer<typeof aiPrefillGenerateRequestSchema>;
export type AiPrefillGenerateResponse = z.infer<typeof aiPrefillGenerateResponseSchema>;
export type AiPrefillDiagnostic = z.infer<typeof aiPrefillDiagnosticSchema>;
export type ProposalConflictDto = z.infer<typeof proposalConflictSchema>;
export type ProposalConflict = ProposalConflictDto;
export type ProposalSummaryDto = z.infer<typeof proposalSummarySchema>;
export type ProposalDetailDto = z.infer<typeof proposalDetailSchema>;
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;
export type ProposalPatchRequest = z.infer<typeof proposalPatchRequestSchema>;
export type AcceptProposalsRequest = z.infer<typeof acceptProposalsRequestSchema>;
export type AcceptProposalsResponse = z.infer<typeof acceptProposalsResponseSchema>;
