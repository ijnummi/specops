import { z } from "zod";

import { annotationRelationshipTypeSchema } from "./annotations.js";

export const impactDepthSchema = z.enum(["1", "2", "all"]);
export const impactDirectionSchema = z.enum([
  "both",
  "upstream",
  "downstream"
]);

const queryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => (typeof value === "boolean" ? value : value === "true"));

export const entityImpactQuerySchema = z.object({
  depth: impactDepthSchema.default("1"),
  direction: impactDirectionSchema.default("both"),
  includeSource: queryBooleanSchema.default(true)
});

export const impactEntitySummarySchema = z.object({
  entityId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  filePath: z.string()
});

export const impactSpecNodeSchema = z.object({
  id: z.string(),
  kind: z.literal("spec"),
  label: z.string(),
  entityId: z.string(),
  type: z.string(),
  status: z.string(),
  title: z.string(),
  filePath: z.string()
});

export const impactSourceNodeSchema = z.object({
  id: z.string(),
  kind: z.literal("source"),
  label: z.string(),
  entityId: z.string(),
  filePath: z.string(),
  symbolName: z.string(),
  symbolKind: z.string(),
  symbolLine: z.number().nullable(),
  annotationLine: z.number().nullable()
});

export const impactNodeSchema = z.discriminatedUnion("kind", [
  impactSpecNodeSchema,
  impactSourceNodeSchema
]);

export const impactSpecEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.literal("spec_link"),
  label: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  linkType: z.string(),
  source: z.string()
});

export const impactSourceEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.literal("source_evidence"),
  label: z.string(),
  entityId: z.string(),
  filePath: z.string(),
  symbolName: z.string()
});

export const impactEdgeSchema = z.discriminatedUnion("kind", [
  impactSpecEdgeSchema,
  impactSourceEdgeSchema
]);

export const impactPathStepSchema = z.object({
  entityId: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string()
});

export const impactPathSchema = z.object({
  direction: z.enum(["upstream", "downstream"]),
  entityIds: z.array(z.string()),
  steps: z.array(impactPathStepSchema),
  linkTypes: z.array(z.string())
});

export const impactSourceEvidenceSchema = z.object({
  entityId: z.string(),
  filePath: z.string(),
  sourceFileId: z.string(),
  symbolName: z.string(),
  symbolKind: z.string(),
  symbolLine: z.number().nullable(),
  annotationLine: z.number().nullable(),
  relationshipType: annotationRelationshipTypeSchema.optional()
});

export const impactTruncationSchema = z.object({
  isTruncated: z.boolean(),
  reason: z.string().nullable(),
  nodeCount: z.number(),
  edgeCount: z.number(),
  sourceEvidenceCount: z.number()
});

export const entityImpactResponseSchema = z.object({
  rootEntity: impactEntitySummarySchema,
  nodes: z.array(impactNodeSchema),
  edges: z.array(impactEdgeSchema),
  upstreamPaths: z.array(impactPathSchema),
  downstreamPaths: z.array(impactPathSchema),
  sourceEvidence: z.array(impactSourceEvidenceSchema),
  truncated: impactTruncationSchema
});

export type ImpactDepth = z.infer<typeof impactDepthSchema>;
export type ImpactDirection = z.infer<typeof impactDirectionSchema>;
export type EntityImpactQuery = z.infer<typeof entityImpactQuerySchema>;
export type ImpactEntitySummaryDto = z.infer<
  typeof impactEntitySummarySchema
>;
export type ImpactNodeDto = z.infer<typeof impactNodeSchema>;
export type ImpactEdgeDto = z.infer<typeof impactEdgeSchema>;
export type ImpactPathDto = z.infer<typeof impactPathSchema>;
export type ImpactSourceEvidenceDto = z.infer<
  typeof impactSourceEvidenceSchema
>;
export type EntityImpactResponseDto = z.infer<
  typeof entityImpactResponseSchema
>;
