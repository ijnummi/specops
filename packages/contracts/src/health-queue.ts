import { z } from "zod";

import { conceptGraphStatusSchema } from "./concepts.js";
import { indexRunStatusSchema } from "./indexing.js";
import { projectGraphStatusSchema } from "./project-graph.js";

export const healthQueueFamilySchema = z.enum(["spec", "source", "concept"]);

export const healthQueueSeveritySchema = z.enum(["blocker", "review", "context"]);

export const healthQueueDiagnosticLevelSchema = z.enum(["info", "warning", "error"]);

export const healthQueueKindSchema = z.enum([
  "spec_readiness_failed",
  "spec_missing_source_evidence",
  "spec_orphaned",
  "spec_stale",
  "source_without_spec",
  "source_area_without_spec",
  "concept_without_spec",
  "concept_low_confidence",
  "concept_membership_low_confidence"
]);

export const healthQueueDiagnosticSchema = z.object({
  level: healthQueueDiagnosticLevelSchema,
  code: z.string().min(1),
  message: z.string().min(1)
});

export const healthQueueSourceStateSchema = z.object({
  latestIndexRunId: z.string().uuid().nullable(),
  latestIndexRunStatus: indexRunStatusSchema.nullable(),
  latestProjectGraphVersionId: z.string().uuid().nullable(),
  latestProjectGraphStatus: projectGraphStatusSchema.nullable(),
  latestConceptGraphVersionId: z.string().uuid().nullable(),
  latestConceptGraphStatus: conceptGraphStatusSchema.nullable(),
  hasProjectGraph: z.boolean(),
  hasConceptGraph: z.boolean()
});

export const healthQueuePrimaryTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("spec"),
    entityId: z.string().min(1),
    title: z.string().min(1),
    type: z.string().min(1),
    status: z.string().min(1),
    filePath: z.string().min(1)
  }),
  z.object({
    kind: z.literal("source"),
    graphNodeId: z.string().uuid().nullable(),
    nodeKey: z.string().min(1).nullable(),
    nodeType: z.string().min(1).nullable(),
    path: z.string().min(1),
    symbolName: z.string().min(1).nullable()
  }),
  z.object({
    kind: z.literal("concept"),
    conceptId: z.string().uuid(),
    conceptKey: z.string().min(1),
    conceptType: z.string().min(1),
    name: z.string().min(1)
  })
]);

export const healthQueueEvidenceSchema = z.object({
  kind: z.enum([
    "spec_entity",
    "source_path",
    "graph_node",
    "concept",
    "annotation",
    "readiness_check",
    "diagnostic"
  ]),
  label: z.string().min(1),
  detail: z.string().min(1),
  entityId: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  graphNodeId: z.string().uuid().optional(),
  conceptId: z.string().uuid().optional(),
  annotationId: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const healthQueueActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open_spec"),
    label: z.string().min(1),
    entityId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("open_readiness"),
    label: z.string().min(1),
    entityId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("open_impact"),
    label: z.string().min(1),
    entityId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("open_project_graph"),
    label: z.string().min(1),
    q: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal("open_graph_node"),
    label: z.string().min(1),
    graphNodeId: z.string().uuid()
  }),
  z.object({
    kind: z.literal("open_concept"),
    label: z.string().min(1),
    conceptId: z.string().uuid()
  }),
  z.object({
    kind: z.literal("open_analyze_run"),
    label: z.string().min(1)
  })
]);

export const healthQueueItemSchema = z.object({
  id: z.string().min(1),
  family: healthQueueFamilySchema,
  kind: healthQueueKindSchema,
  severity: healthQueueSeveritySchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  primaryTarget: healthQueuePrimaryTargetSchema,
  evidence: z.array(healthQueueEvidenceSchema),
  actions: z.array(healthQueueActionSchema).min(1),
  diagnostics: z.array(healthQueueDiagnosticSchema)
});

export const healthQueueSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  byFamily: z.object({
    spec: z.number().int().nonnegative(),
    source: z.number().int().nonnegative(),
    concept: z.number().int().nonnegative()
  }),
  bySeverity: z.object({
    blocker: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    context: z.number().int().nonnegative()
  }),
  byKind: z.partialRecord(healthQueueKindSchema, z.number().int().nonnegative())
});

export const healthQueueResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  sourceState: healthQueueSourceStateSchema,
  summary: healthQueueSummarySchema,
  diagnostics: z.array(healthQueueDiagnosticSchema),
  items: z.array(healthQueueItemSchema)
});

export type HealthQueueFamily = z.infer<typeof healthQueueFamilySchema>;
export type HealthQueueSeverity = z.infer<typeof healthQueueSeveritySchema>;
export type HealthQueueDiagnosticLevel = z.infer<typeof healthQueueDiagnosticLevelSchema>;
export type HealthQueueKind = z.infer<typeof healthQueueKindSchema>;
export type HealthQueueDiagnostic = z.infer<typeof healthQueueDiagnosticSchema>;
export type HealthQueueSourceState = z.infer<typeof healthQueueSourceStateSchema>;
export type HealthQueuePrimaryTarget = z.infer<typeof healthQueuePrimaryTargetSchema>;
export type HealthQueueEvidence = z.infer<typeof healthQueueEvidenceSchema>;
export type HealthQueueAction = z.infer<typeof healthQueueActionSchema>;
export type HealthQueueItem = z.infer<typeof healthQueueItemSchema>;
export type HealthQueueSummary = z.infer<typeof healthQueueSummarySchema>;
export type ProjectHealthQueueResponseDto = z.infer<typeof healthQueueResponseSchema>;
