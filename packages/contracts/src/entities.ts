import { z } from "zod";

export const specEntitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  entityId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  filePath: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  bodyMarkdown: z.string(),
  bodyText: z.string(),
  contentHash: z.string(),
  markdown: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const entitySearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});

export const entitySearchResultSchema = z.object({
  entityId: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  filePath: z.string(),
  rank: z.number(),
  snippet: z.string(),
  matchedFields: z.array(z.enum(["entityId", "title", "type", "status", "bodyText"]))
});

export const specLinkSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  linkType: z.string(),
  source: z.string(),
  confidence: z.number().nullable(),
  createdAt: z.string()
});

export const createEntityRequestSchema = z.object({
  entityId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.string().default("draft")
});

export const updateEntityMarkdownRequestSchema = z.object({
  markdown: z.string(),
  baseContentHash: z.string().min(1)
});

export type SpecEntityDto = z.infer<typeof specEntitySchema>;
export type SpecLinkDto = z.infer<typeof specLinkSchema>;
export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;
export type UpdateEntityMarkdownRequest = z.infer<
  typeof updateEntityMarkdownRequestSchema
>;
export type EntitySearchQuery = z.infer<typeof entitySearchQuerySchema>;
export type EntitySearchResultDto = z.infer<typeof entitySearchResultSchema>;
