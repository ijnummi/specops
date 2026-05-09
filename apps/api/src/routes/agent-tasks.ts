import {
  agentTaskPreviewRequestSchema,
  saveAgentTaskRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAgentTaskService } from "../services/agent-task-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerAgentTaskRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const agentTaskService = createAgentTaskService(db);

  app.post("/projects/:projectId/agent-tasks/preview", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = agentTaskPreviewRequestSchema.parse(request.body);
    return agentTaskService.previewAgentTask(projectId, input);
  });

  app.post("/projects/:projectId/agent-tasks", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = saveAgentTaskRequestSchema.parse(request.body);
    const entity = await agentTaskService.saveAgentTask(projectId, input);
    return reply.code(201).send(entity);
  });
};
