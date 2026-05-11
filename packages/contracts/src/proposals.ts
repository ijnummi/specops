import { z } from "zod";

import { indexRunSchema } from "./indexing.js";

export const proposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "edited_and_accepted",
  "rejected",
  "obsolete"
]);

export const proposalTypeSchema = z.enum(["source_spec_entity"]);

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

export const proposalConflictSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("file_exists"), filePath: z.string().min(1) }),
  z.object({ status: z.literal("entity_exists"), entityId: z.string().min(1) }),
  z.object({ status: z.literal("unavailable"), message: z.string().min(1) })
]);

export const proposalSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  proposalType: proposalTypeSchema,
  status: proposalStatusSchema,
  title: z.string(),
  entityId: z.string(),
  entityType: z.enum(["domain_entity", "interface"]),
  filePath: z.string(),
  confidence: z.number().nullable(),
  conflict: proposalConflictSchema,
  createdAt: z.string(),
  reviewedAt: z.string().nullable()
});

export const proposalDetailSchema = proposalSummarySchema.extend({
  payload: sourceSpecEntityProposalPayloadSchema,
  evidence: sourceSpecEntityProposalEvidenceSchema
});

export const proposalListQuerySchema = z.object({
  status: proposalStatusSchema.optional()
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
export type SourceSpecEntityProposalPayload = z.infer<
  typeof sourceSpecEntityProposalPayloadSchema
>;
export type SourceSpecEntityProposalEvidence = z.infer<
  typeof sourceSpecEntityProposalEvidenceSchema
>;
export type ProposalConflictDto = z.infer<typeof proposalConflictSchema>;
export type ProposalConflict = ProposalConflictDto;
export type ProposalSummaryDto = z.infer<typeof proposalSummarySchema>;
export type ProposalDetailDto = z.infer<typeof proposalDetailSchema>;
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;
export type ProposalPatchRequest = z.infer<typeof proposalPatchRequestSchema>;
export type AcceptProposalsRequest = z.infer<typeof acceptProposalsRequestSchema>;
export type AcceptProposalsResponse = z.infer<typeof acceptProposalsResponseSchema>;
