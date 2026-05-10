import { z } from "zod";

import { specEntitySchema } from "./entities.js";

export const agentTaskWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  entityId: z.string().nullable().optional()
});

export const agentTaskPreviewRequestSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetAgent: z.string().min(1).default("codex"),
  taskId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  impactedContextEntityIds: z.array(z.string().min(1)).default([])
});

export const agentTaskPreviewResponseSchema = z.object({
  markdown: z.string(),
  taskId: z.string(),
  title: z.string(),
  filePath: z.string(),
  sourceSpecIds: z.array(z.string()),
  contextSpecIds: z.array(z.string()),
  warnings: z.array(agentTaskWarningSchema)
});

export const saveAgentTaskRequestSchema = z.object({
  markdown: z.string().min(1),
  taskId: z.string().min(1),
  filePath: z.string().min(1)
});

export const saveAgentTaskResponseSchema = specEntitySchema;

export type AgentTaskWarningDto = z.infer<typeof agentTaskWarningSchema>;
export type AgentTaskPreviewRequest = z.infer<
  typeof agentTaskPreviewRequestSchema
>;
export type AgentTaskPreviewResponse = z.infer<
  typeof agentTaskPreviewResponseSchema
>;
export type SaveAgentTaskRequest = z.infer<typeof saveAgentTaskRequestSchema>;
export type SaveAgentTaskResponse = z.infer<
  typeof saveAgentTaskResponseSchema
>;
