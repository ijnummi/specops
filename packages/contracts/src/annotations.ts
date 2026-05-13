import { z } from "zod";

import { sourceExcerptSchema } from "./source.js";

export const annotationRelationshipTypeSchema = z.enum([
  "implements",
  "uses",
  "defines",
  "tests",
  "references",
]);

export const annotationProvenanceSchema = z.enum(["scanner", "ai", "user"]);
export const annotationStatusSchema = z.enum(["active", "stale"]);

const validLineRange = (value: { startLine?: number | null; endLine?: number | null }) =>
  value.startLine === undefined ||
  value.startLine === null ||
  value.endLine === undefined ||
  value.endLine === null ||
  value.endLine >= value.startLine;

const lineRangeMessage = {
  message: "endLine must be greater than or equal to startLine",
  path: ["endLine"],
};

const nullableUuid = z.string().uuid().nullable();
const queryBooleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const sourceSpecAnnotationSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    sourceFileId: nullableUuid,
    sourceFilePath: z.string().min(1),
    symbolName: z.string().min(1).nullable(),
    symbolKind: z.string().min(1).nullable(),
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
    annotationLine: z.number().int().min(1).nullable(),
    sourceContentHash: z.string().min(1).nullable(),
    entityId: z.string().min(1),
    specFilePath: z.string().min(1),
    claimId: nullableUuid,
    relationshipType: annotationRelationshipTypeSchema,
    confidence: z.number().min(0).max(1).nullable(),
    provenance: annotationProvenanceSchema,
    status: annotationStatusSchema,
    analyzeRunId: nullableUuid,
    proposalId: nullableUuid,
    assemblyId: nullableUuid,
    claimEvidenceId: nullableUuid,
    indexRunId: nullableUuid,
    excerpt: sourceExcerptSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine(validLineRange, lineRangeMessage);

export const annotationListQuerySchema = z.object({
  entityId: z.string().min(1).optional(),
  sourceFileId: z.string().uuid().optional(),
  filePath: z.string().min(1).optional(),
  relationshipType: annotationRelationshipTypeSchema.optional(),
  status: annotationStatusSchema.optional(),
  provenance: annotationProvenanceSchema.optional(),
  includeExcerpt: queryBooleanSchema.default(false),
});

export const annotationCreateRequestSchema = z
  .object({
    sourceFileId: z.string().uuid().optional(),
    sourceFilePath: z.string().min(1).optional(),
    symbolName: z.string().min(1).nullable().default(null),
    symbolKind: z.string().min(1).nullable().default(null),
    startLine: z.number().int().min(1).nullable().default(null),
    endLine: z.number().int().min(1).nullable().default(null),
    annotationLine: z.number().int().min(1).nullable().default(null),
    entityId: z.string().min(1),
    specFilePath: z.string().min(1).optional(),
    claimId: z.string().uuid().nullable().default(null),
    relationshipType: annotationRelationshipTypeSchema,
    confidence: z.number().min(0).max(1).nullable().default(1),
  })
  .refine((value) => value.sourceFileId !== undefined || value.sourceFilePath !== undefined, {
    message: "Expected sourceFileId or sourceFilePath",
    path: ["sourceFilePath"],
  })
  .refine(validLineRange, lineRangeMessage);

export const sourceSpecAnnotationUpdateRequestSchema = z
  .object({
    relationshipType: annotationRelationshipTypeSchema.optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    status: annotationStatusSchema.optional(),
    claimId: z.string().uuid().nullable().optional(),
    startLine: z.number().int().min(1).nullable().optional(),
    endLine: z.number().int().min(1).nullable().optional(),
    annotationLine: z.number().int().min(1).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one annotation field",
  })
  .refine(validLineRange, lineRangeMessage);

export type AnnotationRelationshipType = z.infer<typeof annotationRelationshipTypeSchema>;
export type AnnotationProvenance = z.infer<typeof annotationProvenanceSchema>;
export type AnnotationStatus = z.infer<typeof annotationStatusSchema>;
export type SourceSpecAnnotationDto = z.infer<typeof sourceSpecAnnotationSchema>;
export type AnnotationListQuery = z.infer<typeof annotationListQuerySchema>;
export type AnnotationCreateRequest = z.infer<typeof annotationCreateRequestSchema>;
export type SourceSpecAnnotationUpdateRequest = z.infer<
  typeof sourceSpecAnnotationUpdateRequestSchema
>;
