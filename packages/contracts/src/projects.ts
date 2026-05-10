import { z } from "zod";

import { indexRunSchema } from "./indexing.js";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  repoPath: z.string(),
  specopsPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const projectSummarySchema = projectSchema.extend({
  entityCount: z.number(),
  linkCount: z.number(),
  validationErrorCount: z.number(),
  validationWarningCount: z.number(),
  lastIndexedAt: z.string().nullable()
});

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  specopsPath: z.string().min(1)
});

export const updateProjectRequestSchema = createProjectRequestSchema.partial();

export const projectOverviewSchema = z.object({
  project: projectSummarySchema,
  latestIndexRun: indexRunSchema.nullable(),
  entityCountsByType: z.array(z.object({ type: z.string(), count: z.number() })),
  entityCountsByStatus: z.array(z.object({ status: z.string(), count: z.number() })),
  validationSummary: z.object({
    errorCount: z.number(),
    warningCount: z.number(),
    samples: z.array(
      z.object({
        level: z.enum(["error", "warning"]),
        code: z.string(),
        message: z.string(),
        entityId: z.string().nullable(),
        filePath: z.string().nullable()
      })
    )
  }),
  sourceInventory: z.object({
    fileCount: z.number(),
    symbolCount: z.number(),
    importCount: z.number(),
    exportCount: z.number()
  }),
  sourceEvidence: z.object({
    eligibleSpecCount: z.number(),
    withSourceEvidenceCount: z.number(),
    withoutSourceEvidenceCount: z.number(),
    missingSamples: z.array(z.object({ entityId: z.string(), title: z.string(), type: z.string() }))
  }),
  agentTasks: z.object({
    totalCount: z.number(),
    recent: z.array(
      z.object({
        entityId: z.string(),
        title: z.string(),
        status: z.string(),
        updatedAt: z.string()
      })
    )
  }),
  attentionItems: z.array(
    z.object({
      kind: z.enum(["validation_error", "validation_warning", "missing_source_evidence"]),
      label: z.string(),
      entityId: z.string().nullable(),
      filePath: z.string().nullable()
    })
  )
});

export type ProjectDto = z.infer<typeof projectSchema>;
export type ProjectSummaryDto = z.infer<typeof projectSummarySchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ProjectOverviewDto = z.infer<typeof projectOverviewSchema>;
