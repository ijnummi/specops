import { z } from "zod";

export const specReadinessStatusSchema = z.enum([
  "ready",
  "needs_context",
  "needs_review",
  "blocked"
]);

export const specReadinessCheckSeveritySchema = z.enum(["blocker", "review", "context"]);

export const specReadinessCheckSchema = z.object({
  id: z.string().min(1),
  severity: specReadinessCheckSeveritySchema,
  label: z.string().min(1),
  detail: z.string().min(1),
  suggestedFix: z.string().min(1),
  relatedEntityId: z.string().nullable(),
  filePath: z.string().nullable()
});

export const projectReadinessQueueItemSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1),
  readiness: specReadinessStatusSchema,
  highestSeverity: specReadinessCheckSeveritySchema.nullable(),
  failedCheckCount: z.number().int().nonnegative(),
  topChecks: z.array(specReadinessCheckSchema)
});

export const projectReadinessSchema = z.object({
  summary: z.object({
    ready: z.number().int().nonnegative(),
    needsContext: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative()
  }),
  queue: z.array(projectReadinessQueueItemSchema)
});

export const entityReadinessSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1),
  readiness: specReadinessStatusSchema,
  checks: z.array(specReadinessCheckSchema)
});

export type SpecReadinessStatus = z.infer<typeof specReadinessStatusSchema>;
export type SpecReadinessCheckSeverity = z.infer<typeof specReadinessCheckSeveritySchema>;
export type SpecReadinessCheckDto = z.infer<typeof specReadinessCheckSchema>;
export type ProjectReadinessQueueItemDto = z.infer<typeof projectReadinessQueueItemSchema>;
export type ProjectReadinessDto = z.infer<typeof projectReadinessSchema>;
export type EntityReadinessDto = z.infer<typeof entityReadinessSchema>;
