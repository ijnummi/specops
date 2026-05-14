import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectHealthQueueService } from "../services/project-health-queue-service.js";

type RouteOptions = {
  db: Db;
};

const projectHealthQueueParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const registerProjectHealthQueueRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db }
) => {
  const projectHealthQueueService = createProjectHealthQueueService(db);

  app.get("/projects/:projectId/health-queue", async (request) => {
    const { projectId } = projectHealthQueueParamsSchema.parse(request.params);
    return projectHealthQueueService.getProjectHealthQueue(projectId);
  });
};
