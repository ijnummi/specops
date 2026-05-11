import { z } from "zod";

export const agentRunStatusSchema = z.enum([
  "running",
  "ready_for_review",
  "accepted",
  "needs_followup",
  "superseded"
]);

export const agentRunUpdateStatusSchema = z.enum([
  "accepted",
  "needs_followup",
  "superseded"
]);

export const agentRunFindingSeveritySchema = z.enum([
  "blocker",
  "review",
  "context",
  "info"
]);

export const agentRunFindingKindSchema = z.enum([
  "source_changed_without_spec",
  "task_context_spec_changed",
  "task_context_missing",
  "unlinked_source_changed",
  "validation_warning",
  "readiness_warning",
  "possible_missing_test_change",
  "task_not_updated",
  "git_comparison_unavailable"
]);

export const agentRunChangedFilesSchema = z.object({
  specs: z.array(z.string()),
  source: z.array(z.string()),
  tests: z.array(z.string()),
  other: z.array(z.string())
});

export const agentRunAffectedSpecSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  filePath: z.string().min(1),
  reason: z.enum(["changed_spec", "linked_source", "task_context"])
});

export const agentRunTaskContextSchema = z.object({
  sourceEntityId: z.string().min(1).nullable(),
  contextEntityIds: z.array(z.string().min(1)),
  missingEntityIds: z.array(z.string().min(1))
});

export const agentRunFindingSchema = z.object({
  id: z.string().min(1),
  severity: agentRunFindingSeveritySchema,
  kind: agentRunFindingKindSchema,
  message: z.string().min(1),
  suggestedFollowUp: z.string().min(1),
  entityId: z.string().min(1).nullable(),
  filePath: z.string().min(1).nullable()
});

export const agentRunReviewSchema = z.object({
  changedFiles: agentRunChangedFilesSchema,
  affectedSpecs: z.array(agentRunAffectedSpecSchema),
  taskContext: agentRunTaskContextSchema,
  findings: z.array(agentRunFindingSchema),
  suggestedValidationCommands: z.array(z.string().min(1))
});

export const startAgentRunRequestSchema = z.object({
  taskEntityId: z.string().min(1),
  agent: z.string().min(1)
});

export const updateAgentRunStatusRequestSchema = z.object({
  status: agentRunUpdateStatusSchema
});

export const agentRunSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  taskEntityId: z.string().min(1),
  taskTitle: z.string().min(1),
  taskFilePath: z.string().min(1),
  agent: z.string().min(1),
  status: agentRunStatusSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  startGitCommit: z.string().nullable(),
  endGitCommit: z.string().nullable(),
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

export const agentRunDetailSchema = agentRunSummarySchema.extend({
  promptMarkdown: z.string(),
  changedFiles: agentRunChangedFilesSchema,
  reviewSummary: agentRunReviewSchema
});

export const startAgentRunResponseSchema = agentRunSummarySchema;
export const finishAgentRunResponseSchema = agentRunDetailSchema;
export const updateAgentRunStatusResponseSchema = agentRunDetailSchema;

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentRunFindingSeverity = z.infer<typeof agentRunFindingSeveritySchema>;
export type AgentRunFindingKind = z.infer<typeof agentRunFindingKindSchema>;
export type AgentRunChangedFiles = z.infer<typeof agentRunChangedFilesSchema>;
export type AgentRunFinding = z.infer<typeof agentRunFindingSchema>;
export type AgentRunReview = z.infer<typeof agentRunReviewSchema>;
export type AgentRunSummary = z.infer<typeof agentRunSummarySchema>;
export type AgentRunDetail = z.infer<typeof agentRunDetailSchema>;
export type StartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;
export type UpdateAgentRunStatusRequest = z.infer<
  typeof updateAgentRunStatusRequestSchema
>;
export type StartAgentRunResponse = z.infer<typeof startAgentRunResponseSchema>;
export type FinishAgentRunResponse = z.infer<typeof finishAgentRunResponseSchema>;
export type UpdateAgentRunStatusResponse = z.infer<
  typeof updateAgentRunStatusResponseSchema
>;
