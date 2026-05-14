import { z } from "zod";

export const projectGraphStatusSchema = z.enum(["building", "ready", "limited", "failed", "superseded"]);

export const projectGraphNodeTypeSchema = z.enum([
  "package",
  "module",
  "file",
  "symbol",
  "route",
  "data_model",
  "test",
  "spec_entity",
  "external_dependency"
]);

export const projectGraphEdgeTypeSchema = z.enum([
  "contains",
  "defines",
  "imports",
  "exports",
  "depends_on",
  "tests",
  "references",
  "supports_spec"
]);

export const projectGraphProvenanceSchema = z.enum([
  "scanner_path",
  "scanner_import",
  "scanner_export",
  "scanner_symbol",
  "scanner_kind",
  "annotation",
  "heuristic_test"
]);

export const projectGraphDiagnosticSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const projectGraphCountsSchema = z.record(z.string(), z.number().int().min(0));

export const projectGraphCoverageSchema = z.object({
  nodeCounts: projectGraphCountsSchema,
  edgeCounts: projectGraphCountsSchema,
  sourceFileCount: z.number().int().min(0),
  specEntityCount: z.number().int().min(0),
  unresolvedImportCount: z.number().int().min(0),
  heuristicEdgeCount: z.number().int().min(0)
});

export const projectGraphVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  indexRunId: z.string().uuid().nullable(),
  status: projectGraphStatusSchema,
  summary: z.string(),
  coverage: projectGraphCoverageSchema,
  diagnostics: z.array(projectGraphDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const projectGraphNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  graphVersionId: z.string().uuid(),
  nodeKey: z.string().min(1),
  nodeType: projectGraphNodeTypeSchema,
  label: z.string().min(1),
  path: z.string().min(1).nullable(),
  symbolName: z.string().min(1).nullable(),
  entityId: z.string().min(1).nullable(),
  sourceRef: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime()
});

export const projectGraphEdgeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  graphVersionId: z.string().uuid(),
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  edgeType: projectGraphEdgeTypeSchema,
  provenance: projectGraphProvenanceSchema,
  sourceRef: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime()
});

export const projectGraphQuerySchema = z.object({
  nodeType: projectGraphNodeTypeSchema.optional(),
  edgeType: projectGraphEdgeTypeSchema.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const projectGraphListResponseSchema = z.object({
  version: projectGraphVersionSchema,
  nodeCounts: projectGraphCountsSchema,
  edgeCounts: projectGraphCountsSchema,
  nodes: z.array(projectGraphNodeSchema),
  edges: z.array(projectGraphEdgeSchema)
});

export const projectGraphNodeDetailSchema = z.object({
  node: projectGraphNodeSchema,
  incomingEdges: z.record(z.string(), z.array(projectGraphEdgeSchema)),
  outgoingEdges: z.record(z.string(), z.array(projectGraphEdgeSchema)),
  neighboringNodes: z.array(projectGraphNodeSchema)
});

export type ProjectGraphStatus = z.infer<typeof projectGraphStatusSchema>;
export type ProjectGraphNodeType = z.infer<typeof projectGraphNodeTypeSchema>;
export type ProjectGraphEdgeType = z.infer<typeof projectGraphEdgeTypeSchema>;
export type ProjectGraphProvenance = z.infer<typeof projectGraphProvenanceSchema>;
export type ProjectGraphDiagnostic = z.infer<typeof projectGraphDiagnosticSchema>;
export type ProjectGraphCounts = z.infer<typeof projectGraphCountsSchema>;
export type ProjectGraphCoverage = z.infer<typeof projectGraphCoverageSchema>;
export type ProjectGraphVersionDto = z.infer<typeof projectGraphVersionSchema>;
export type ProjectGraphNodeDto = z.infer<typeof projectGraphNodeSchema>;
export type ProjectGraphEdgeDto = z.infer<typeof projectGraphEdgeSchema>;
export type ProjectGraphQuery = z.infer<typeof projectGraphQuerySchema>;
export type ProjectGraphListResponse = z.infer<typeof projectGraphListResponseSchema>;
export type ProjectGraphNodeDetail = z.infer<typeof projectGraphNodeDetailSchema>;
