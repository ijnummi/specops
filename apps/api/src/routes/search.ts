import { entitySearchQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createEntitySearchService } from "../services/entity-search-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const searchParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerSearchRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const entitySearchService = createEntitySearchService(db);

  app.get("/projects/:projectId/search", async (request) => {
    const { projectId } = searchParamsSchema.parse(request.params);
    const query = entitySearchQuerySchema.parse(request.query);

    await projectService.getProject(projectId);
    return entitySearchService.searchEntities(projectId, query);
  });
};
