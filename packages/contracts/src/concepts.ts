import { z } from "zod";

import { projectGraphNodeSchema } from "./project-graph.js";

export const conceptGraphStatusSchema = z.enum(["building", "ready", "limited", "failed", "superseded"]);
export const conceptTypeSchema = z.enum([
  "workflow",
  "subsystem",
  "domain_concept",
  "interface",
  "data_flow",
  "test_behavior",
  "cross_cutting",
  "unknown"
]);
export const conceptProvenanceSchema = z.enum(["ai"]);
export const conceptStatusSchema = z.enum(["active", "discarded", "superseded"]);
export const conceptMembershipRoleSchema = z.enum(["primary", "supporting", "entrypoint", "data", "test", "spec"]);
export const conceptRelationshipTypeSchema = z.enum(["depends_on", "uses", "implements", "exposes", "tests", "relates_to"]);

export const conceptGraphDiagnosticSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const conceptGraphCoverageSchema = z.object({
  conceptCounts: z.record(z.string(), z.number().int().min(0)),
  membershipCounts: z.record(z.string(), z.number().int().min(0)),
  relationshipCounts: z.record(z.string(), z.number().int().min(0)),
  rejectedConceptCount: z.number().int().min(0),
  rejectedMembershipCount: z.number().int().min(0),
  graphNodeCoverageCount: z.number().int().min(0),
  lowConfidenceConceptCount: z.number().int().min(0)
});

export const projectConceptVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectGraphVersionId: z.string().uuid(),
  status: conceptGraphStatusSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  summary: z.string(),
  coverage: conceptGraphCoverageSchema,
  diagnostics: z.array(conceptGraphDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const projectConceptSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptVersionId: z.string().uuid(),
  conceptKey: z.string().min(1),
  conceptType: conceptTypeSchema,
  name: z.string().min(1),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  provenance: conceptProvenanceSchema,
  evidenceSummary: z.string(),
  status: conceptStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const projectConceptMembershipSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptVersionId: z.string().uuid(),
  conceptId: z.string().uuid(),
  graphNodeId: z.string().uuid(),
  role: conceptMembershipRoleSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  createdAt: z.string().datetime()
});

export const projectConceptRelationshipSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptVersionId: z.string().uuid(),
  fromConceptId: z.string().uuid(),
  toConceptId: z.string().uuid(),
  relationshipType: conceptRelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  createdAt: z.string().datetime()
});

export const buildConceptGraphRequestSchema = z.object({
  provider: z.enum(["ollama", "openai"]),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.1),
  maxGraphNodes: z.number().int().min(1).max(500).default(150),
  maxGraphEdges: z.number().int().min(1).max(1000).default(300)
});

export const conceptGraphLatestResponseSchema = z.object({
  version: projectConceptVersionSchema,
  conceptCounts: z.record(z.string(), z.number().int().min(0)),
  membershipCounts: z.record(z.string(), z.number().int().min(0)),
  relationshipCounts: z.record(z.string(), z.number().int().min(0)),
  concepts: z.array(projectConceptSchema),
  diagnostics: z.array(conceptGraphDiagnosticSchema)
});

export const conceptDetailResponseSchema = z.object({
  concept: projectConceptSchema,
  memberships: z.array(projectConceptMembershipSchema),
  graphNodes: z.array(projectGraphNodeSchema),
  incomingRelationships: z.record(z.string(), z.array(projectConceptRelationshipSchema)),
  outgoingRelationships: z.record(z.string(), z.array(projectConceptRelationshipSchema)),
  relatedConcepts: z.array(projectConceptSchema)
});

export type ConceptGraphStatus = z.infer<typeof conceptGraphStatusSchema>;
export type ConceptType = z.infer<typeof conceptTypeSchema>;
export type ConceptProvenance = z.infer<typeof conceptProvenanceSchema>;
export type ConceptStatus = z.infer<typeof conceptStatusSchema>;
export type ConceptMembershipRole = z.infer<typeof conceptMembershipRoleSchema>;
export type ConceptRelationshipType = z.infer<typeof conceptRelationshipTypeSchema>;
export type ConceptGraphDiagnostic = z.infer<typeof conceptGraphDiagnosticSchema>;
export type ConceptGraphCoverage = z.infer<typeof conceptGraphCoverageSchema>;
export type ProjectConceptVersionDto = z.infer<typeof projectConceptVersionSchema>;
export type ProjectConceptDto = z.infer<typeof projectConceptSchema>;
export type ProjectConceptMembershipDto = z.infer<typeof projectConceptMembershipSchema>;
export type ProjectConceptRelationshipDto = z.infer<typeof projectConceptRelationshipSchema>;
export type BuildConceptGraphRequest = z.infer<typeof buildConceptGraphRequestSchema>;
export type ConceptGraphLatestResponse = z.infer<typeof conceptGraphLatestResponseSchema>;
export type ConceptDetailResponse = z.infer<typeof conceptDetailResponseSchema>;
