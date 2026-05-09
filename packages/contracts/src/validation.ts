import { z } from "zod";

export const validationLevelSchema = z.enum(["error", "warning", "info"]);

export const validationMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  indexRunId: z.string().nullable(),
  filePath: z.string().nullable(),
  entityId: z.string().nullable(),
  level: validationLevelSchema,
  code: z.string(),
  message: z.string(),
  createdAt: z.string()
});

export type ValidationMessageDto = z.infer<typeof validationMessageSchema>;
