import { z } from "zod";

export const sourceFileKindSchema = z.enum([
  "source",
  "test",
  "config",
  "entrypoint",
  "unknown"
]);
export const sourceLanguageSchema = z.enum([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "unknown"
]);

export const sourceFileListQuerySchema = z.object({
  language: sourceLanguageSchema.optional(),
  kind: sourceFileKindSchema.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const sourceFileSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  path: z.string(),
  language: sourceLanguageSchema.nullable(),
  kind: sourceFileKindSchema,
  sizeBytes: z.number(),
  contentHash: z.string(),
  lastSeenAt: z.string(),
  importCount: z.number(),
  exportCount: z.number(),
  symbolCount: z.number()
});

export const sourceImportSchema = z.object({
  id: z.string(),
  specifier: z.string(),
  importKind: z.string(),
  importedNames: z.array(z.string()),
  isRelative: z.boolean(),
  resolvedPath: z.string().nullable()
});

export const sourceExportSchema = z.object({
  id: z.string(),
  exportedName: z.string(),
  exportKind: z.string(),
  sourceSpecifier: z.string().nullable()
});

export const sourceSymbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbolKind: z.string(),
  isExported: z.boolean(),
  line: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown())
});

export const sourceFileDetailSchema = sourceFileSummarySchema
  .omit({
    importCount: true,
    exportCount: true,
    symbolCount: true
  })
  .extend({
    imports: z.array(sourceImportSchema),
    exports: z.array(sourceExportSchema),
    symbols: z.array(sourceSymbolSchema)
  });

export const sourceAggregateSchema = z.object({
  totalFiles: z.number(),
  byLanguage: z.record(z.string(), z.number()),
  byKind: z.record(z.string(), z.number())
});

export const sourceExcerptSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    startLine: z.number(),
    endLine: z.number(),
    text: z.string()
  }),
  z.object({
    status: z.enum(["missing", "changed", "unavailable"]),
    message: z.string()
  })
]);

export type SourceFileKind = z.infer<typeof sourceFileKindSchema>;
export type SourceLanguage = z.infer<typeof sourceLanguageSchema>;
export type SourceFileListQuery = z.infer<typeof sourceFileListQuerySchema>;
export type SourceFileSummaryDto = z.infer<typeof sourceFileSummarySchema>;
export type SourceImportDto = z.infer<typeof sourceImportSchema>;
export type SourceExportDto = z.infer<typeof sourceExportSchema>;
export type SourceSymbolDto = z.infer<typeof sourceSymbolSchema>;
export type SourceFileDetailDto = z.infer<typeof sourceFileDetailSchema>;
export type SourceAggregateDto = z.infer<typeof sourceAggregateSchema>;
export type SourceExcerptDto = z.infer<typeof sourceExcerptSchema>;
