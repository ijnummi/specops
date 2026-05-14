import { z } from "zod";

export const systemMapStatusSchema = z.enum(["building", "ready", "limited", "failed"]);

export const systemMapAreaTypeSchema = z.enum([
  "backend_routes",
  "backend_services",
  "frontend_routes",
  "frontend_components",
  "data_models",
  "tests",
  "config",
  "packages",
  "unknown",
]);

export const systemMapDiagnosticSchema = z.object({
  level: z.enum(["info", "warning"]),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const systemMapAreaCountsSchema = z.record(z.string(), z.number().int().min(0));

export const systemMapCoverageSchema = z.object({
  sourceFileCount: z.number().int().min(0),
  mappedSourceFileCount: z.number().int().min(0),
  unmappedSourceFileCount: z.number().int().min(0),
  areaCounts: systemMapAreaCountsSchema,
});

export const systemMapSnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analyzeRunId: z.string().uuid(),
  status: systemMapStatusSchema,
  summary: z.string(),
  coverage: systemMapCoverageSchema,
  diagnostics: z.array(systemMapDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const systemMapEvidenceSchema = z.object({
  sourceFileId: z.string().uuid().nullable(),
  sourceFilePath: z.string().min(1),
  symbolName: z.string().min(1).nullable(),
  symbolKind: z.string().min(1).nullable(),
  startLine: z.number().int().min(1).nullable(),
  relationship: z.enum(["defines", "uses", "tests", "configures", "references"]),
});

export const systemMapAreaSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  areaType: systemMapAreaTypeSchema,
  name: z.string().min(1),
  summary: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(systemMapEvidenceSchema),
  keyFiles: z.array(z.string().min(1)),
  keySymbols: z.array(z.string().min(1)),
  relatedProposalIds: z.array(z.string().uuid()),
  diagnostics: z.array(systemMapDiagnosticSchema),
  sortOrder: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const systemMapResponseSchema = z.object({
  snapshot: systemMapSnapshotSchema,
  areas: z.array(systemMapAreaSchema),
});

export type SystemMapStatus = z.infer<typeof systemMapStatusSchema>;
export type SystemMapAreaType = z.infer<typeof systemMapAreaTypeSchema>;
export type SystemMapDiagnostic = z.infer<typeof systemMapDiagnosticSchema>;
export type SystemMapCoverage = z.infer<typeof systemMapCoverageSchema>;
export type SystemMapSnapshotDto = z.infer<typeof systemMapSnapshotSchema>;
export type SystemMapEvidenceDto = z.infer<typeof systemMapEvidenceSchema>;
export type SystemMapAreaDto = z.infer<typeof systemMapAreaSchema>;
export type SystemMapResponseDto = z.infer<typeof systemMapResponseSchema>;
