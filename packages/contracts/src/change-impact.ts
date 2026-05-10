import { z } from "zod";

import { agentTaskPreviewRequestSchema } from "./agent-tasks.js";
import {
  entityImpactQuerySchema,
  entityImpactResponseSchema,
  impactEntitySummarySchema,
  impactPathSchema,
  impactSourceEvidenceSchema
} from "./impact.js";
import { validationMessageSchema } from "./validation.js";

export const changeImpactDirectionSchema = z.enum([
  "root",
  "upstream",
  "downstream"
]);

export const changeImpactSpecSummarySchema = impactEntitySummarySchema.extend({
  direction: changeImpactDirectionSchema,
  distance: z.number().int().nonnegative()
});

export const changeImpactSpecGroupSchema = z.object({
  direction: changeImpactDirectionSchema,
  type: z.string(),
  specs: z.array(changeImpactSpecSummarySchema)
});

export const changeImpactSourceSymbolSchema = impactSourceEvidenceSchema;

export const changeImpactSourceGroupSchema = z.object({
  filePath: z.string(),
  symbols: z.array(changeImpactSourceSymbolSchema)
});

export const changeImpactRelatedTaskSchema = impactEntitySummarySchema.extend({
  linkTypes: z.array(z.string())
});

export const changeImpactSectionWarningSchema = z.object({
  section: z.enum(["validation", "tasks", "source"]),
  message: z.string().min(1)
});

export const changeImpactOverviewSchema = z.object({
  impactedSpecCount: z.number().int().nonnegative(),
  upstreamSpecCount: z.number().int().nonnegative(),
  downstreamSpecCount: z.number().int().nonnegative(),
  sourceFileCount: z.number().int().nonnegative(),
  sourceSymbolCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  relatedTaskCount: z.number().int().nonnegative(),
  shortestPaths: z.array(impactPathSchema)
});

export const changeImpactPreviewResponseSchema = z.object({
  rootEntity: impactEntitySummarySchema,
  impact: entityImpactResponseSchema,
  overview: changeImpactOverviewSchema,
  impactedSpecs: z.array(changeImpactSpecGroupSchema),
  sourceGroups: z.array(changeImpactSourceGroupSchema),
  validationMessages: z.array(validationMessageSchema),
  relatedTasks: z.array(changeImpactRelatedTaskSchema),
  taskSeed: agentTaskPreviewRequestSchema,
  sectionWarnings: z.array(changeImpactSectionWarningSchema)
});

export const changeImpactPreviewQuerySchema = entityImpactQuerySchema;

export type ChangeImpactDirection = z.infer<
  typeof changeImpactDirectionSchema
>;
export type ChangeImpactPreviewQuery = z.infer<
  typeof changeImpactPreviewQuerySchema
>;
export type ChangeImpactSpecSummaryDto = z.infer<
  typeof changeImpactSpecSummarySchema
>;
export type ChangeImpactSpecGroupDto = z.infer<
  typeof changeImpactSpecGroupSchema
>;
export type ChangeImpactSourceGroupDto = z.infer<
  typeof changeImpactSourceGroupSchema
>;
export type ChangeImpactRelatedTaskDto = z.infer<
  typeof changeImpactRelatedTaskSchema
>;
export type ChangeImpactSectionWarningDto = z.infer<
  typeof changeImpactSectionWarningSchema
>;
export type ChangeImpactOverviewDto = z.infer<
  typeof changeImpactOverviewSchema
>;
export type ChangeImpactPreviewResponseDto = z.infer<
  typeof changeImpactPreviewResponseSchema
>;
