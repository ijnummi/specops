import { z } from "zod";

export const analyzeRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const analyzeRunStepNameSchema = z.enum([
  "initialize",
  "index",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill",
]);

export const analyzeRunStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "skipped",
  "failed",
]);

export const analyzeRunDiagnosticSchema = z.object({
  level: z.enum(["info", "warning"]),
  message: z.string().min(1),
});

export const analyzeRunSelectionCategorySchema = z.object({
  category: z.enum([
    "entrypoints_routes",
    "services_modules",
    "domain_models",
    "frontend_views",
    "tests_config",
  ]),
  count: z.number().int().min(0),
});

export const analyzeRunSelectionSummarySchema = z.object({
  selectedSourceFileIds: z.array(z.string().min(1)),
  selectedPaths: z.array(z.string().min(1)),
  eligibleHighSignalFileCount: z.number().int().min(0),
  skippedHighSignalFileCount: z.number().int().min(0),
  categories: z.array(analyzeRunSelectionCategorySchema),
  diagnostics: z.array(analyzeRunDiagnosticSchema),
});

export const analyzeRunStepSchema = z.object({
  name: analyzeRunStepNameSchema,
  status: analyzeRunStepStatusSchema,
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  message: z.string().nullable(),
  counts: z.record(z.string(), z.number().min(0)),
});

export const analyzeRunDetailSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: analyzeRunStatusSchema,
  currentStep: analyzeRunStepNameSchema.nullable(),
  steps: z.array(analyzeRunStepSchema),
  selection: analyzeRunSelectionSummarySchema.nullable(),
  proposalIds: z.array(z.string().uuid()),
  sourceProposalCount: z.number().int().min(0),
  aiProposalCount: z.number().int().min(0),
  indexRunId: z.string().uuid().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const activeAnalyzeRunConflictSchema = z.object({
  activeRunId: z.string().uuid(),
});

export type AnalyzeRunStatus = z.infer<typeof analyzeRunStatusSchema>;
export type AnalyzeRunStepName = z.infer<typeof analyzeRunStepNameSchema>;
export type AnalyzeRunStepStatus = z.infer<typeof analyzeRunStepStatusSchema>;
export type AnalyzeRunDiagnostic = z.infer<typeof analyzeRunDiagnosticSchema>;
export type AnalyzeRunSelectionCategory = z.infer<typeof analyzeRunSelectionCategorySchema>;
export type AnalyzeRunSelectionSummary = z.infer<typeof analyzeRunSelectionSummarySchema>;
export type AnalyzeRunStepDto = z.infer<typeof analyzeRunStepSchema>;
export type AnalyzeRunDetailDto = z.infer<typeof analyzeRunDetailSchema>;
export type ActiveAnalyzeRunConflictDto = z.infer<typeof activeAnalyzeRunConflictSchema>;
