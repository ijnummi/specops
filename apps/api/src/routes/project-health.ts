import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectHealthService } from "../services/project-health-service.js";

type RouteOptions = {
  db: Db;
};

const projectHealthParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerProjectHealthRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectHealthService = createProjectHealthService(db);

  app.get("/projects/:projectId/health", async (request) => {
    const { projectId } = projectHealthParamsSchema.parse(request.params);
    return projectHealthService.getProjectHealth(projectId);
  });
};
