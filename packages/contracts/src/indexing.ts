import { z } from "zod";

export const indexRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  entityCount: z.number(),
  linkCount: z.number(),
  errorCount: z.number(),
  warningCount: z.number(),
  gitCommit: z.string().nullable()
});

export type IndexRunDto = z.infer<typeof indexRunSchema>;
