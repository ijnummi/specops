import { z } from "zod";

export const diffReviewStatusSchema = z.enum([
  "ready_for_review",
  "accepted",
  "needs_followup",
  "superseded"
]);

export const diffReviewUpdateStatusSchema = z.enum([
  "accepted",
  "needs_followup",
  "superseded"
]);

export const diffReviewTypeSchema = z.enum([
  "working_tree",
  "staged",
  "ref_range"
]);

export const diffReviewFindingSeveritySchema = z.enum([
  "blocker",
  "review",
  "context",
  "info"
]);

export const diffReviewFindingKindSchema = z.enum([
  "source_changed_without_spec",
  "unlinked_source_changed",
  "possible_missing_test_change",
  "changed_spec_has_no_task",
  "related_task_may_be_stale",
  "validation_warning",
  "readiness_warning",
  "git_comparison_unavailable"
]);

export const diffReviewChangedFilesSchema = z.object({
  specs: z.array(z.string()),
  source: z.array(z.string()),
  tests: z.array(z.string()),
  other: z.array(z.string())
});

export const diffReviewAffectedSpecSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  filePath: z.string().min(1),
  reason: z.enum(["changed_spec", "linked_source"])
});

export const diffReviewRelatedTaskSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1),
  reason: z.enum(["generated_from", "uses", "changed_task"])
});

export const diffReviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: diffReviewFindingSeveritySchema,
  kind: diffReviewFindingKindSchema,
  message: z.string().min(1),
  suggestedFollowUp: z.string().min(1),
  entityId: z.string().min(1).nullable(),
  filePath: z.string().min(1).nullable()
});

export const diffReviewSummarySchema = z.object({
  changedFiles: diffReviewChangedFilesSchema,
  affectedSpecs: z.array(diffReviewAffectedSpecSchema),
  relatedTasks: z.array(diffReviewRelatedTaskSchema),
  findings: z.array(diffReviewFindingSchema),
  suggestedValidationCommands: z.array(z.string().min(1))
});

export const createDiffReviewRequestSchema = z.discriminatedUnion("reviewType", [
  z.object({
    reviewType: z.literal("working_tree")
  }),
  z.object({
    reviewType: z.literal("staged")
  }),
  z.object({
    reviewType: z.literal("ref_range"),
    baseRef: z.string().min(1),
    headRef: z.string().min(1)
  })
]);

export const updateDiffReviewStatusRequestSchema = z.object({
  status: diffReviewUpdateStatusSchema
});

export const diffReviewSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: diffReviewStatusSchema,
  reviewType: diffReviewTypeSchema,
  baseRef: z.string().nullable(),
  headRef: z.string().nullable(),
  baseCommit: z.string().nullable(),
  headCommit: z.string().nullable(),
  changedFileCount: z.number().int().nonnegative(),
  findingCounts: z.object({
    blocker: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    context: z.number().int().nonnegative(),
    info: z.number().int().nonnegative()
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const diffReviewDetailResponseSchema = diffReviewSummaryResponseSchema.extend({
  changedFiles: diffReviewChangedFilesSchema,
  reviewSummary: diffReviewSummarySchema
});

export const createDiffReviewResponseSchema = diffReviewDetailResponseSchema;
export const updateDiffReviewStatusResponseSchema = diffReviewDetailResponseSchema;

export type DiffReviewStatus = z.infer<typeof diffReviewStatusSchema>;
export type DiffReviewUpdateStatus = z.infer<
  typeof diffReviewUpdateStatusSchema
>;
export type DiffReviewType = z.infer<typeof diffReviewTypeSchema>;
export type DiffReviewFindingSeverity = z.infer<
  typeof diffReviewFindingSeveritySchema
>;
export type DiffReviewFindingKind = z.infer<typeof diffReviewFindingKindSchema>;
export type DiffReviewChangedFiles = z.infer<typeof diffReviewChangedFilesSchema>;
export type DiffReviewAffectedSpec = z.infer<typeof diffReviewAffectedSpecSchema>;
export type DiffReviewRelatedTask = z.infer<typeof diffReviewRelatedTaskSchema>;
export type DiffReviewFinding = z.infer<typeof diffReviewFindingSchema>;
export type DiffReviewSummary = z.infer<typeof diffReviewSummarySchema>;
export type CreateDiffReviewRequest = z.infer<typeof createDiffReviewRequestSchema>;
export type UpdateDiffReviewStatusRequest = z.infer<
  typeof updateDiffReviewStatusRequestSchema
>;
export type DiffReviewSummaryResponse = z.infer<
  typeof diffReviewSummaryResponseSchema
>;
export type DiffReviewDetailResponse = z.infer<
  typeof diffReviewDetailResponseSchema
>;
export type CreateDiffReviewResponse = z.infer<
  typeof createDiffReviewResponseSchema
>;
export type UpdateDiffReviewStatusResponse = z.infer<
  typeof updateDiffReviewStatusResponseSchema
>;
