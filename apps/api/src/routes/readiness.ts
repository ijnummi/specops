import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createSpecReadinessService } from "../services/spec-readiness-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const entityParamsSchema = z.object({
  projectId: z.string().min(1),
  entityId: z.string().min(1)
});

export const registerReadinessRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const readinessService = createSpecReadinessService(db);

  app.get("/projects/:projectId/readiness", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return readinessService.getProjectReadiness(projectId);
  });

  app.get("/projects/:projectId/entities/:entityId/readiness", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    return readinessService.getEntityReadiness(projectId, entityId);
  });
};
