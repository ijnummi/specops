import { buildConceptGraphRequestSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import type { AiPrefillProviderFactory } from "../services/ai-prefill-service.js";
import { createConceptGraphService } from "../services/concept-graph-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

const conceptParamsSchema = projectParamsSchema.extend({
  conceptId: z.string().uuid()
});

export const registerConceptGraphRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db, aiPrefillConfig, aiPrefillProviderFactory }
) => {
  const projectService = createProjectService(db);
  const conceptService = createConceptGraphService(db, {
    config: aiPrefillConfig,
    providerFactory: aiPrefillProviderFactory
  });

  app.post("/projects/:projectId/concept-graphs", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const body = buildConceptGraphRequestSchema.parse(request.body);
    await projectService.getProject(projectId);
    return conceptService.buildConceptGraph(projectId, body);
  });

  app.get("/projects/:projectId/concept-graphs/latest", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return conceptService.getLatestConceptGraph(projectId);
  });

  app.get("/projects/:projectId/concepts/:conceptId", async (request) => {
    const { projectId, conceptId } = conceptParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return conceptService.getConceptDetail(projectId, conceptId);
  });
};
