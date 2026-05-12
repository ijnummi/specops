import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import {
  createAnalyzeRunService,
  type AiPrefillProviderFactory
} from "../services/analyze-run-service.js";

type RouteOptions = {
  db: Db;
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const analyzeRunParamsSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().uuid()
});

export const registerAnalyzeRunRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db, aiPrefillConfig, aiPrefillProviderFactory }
) => {
  const service = createAnalyzeRunService(db, { aiPrefillConfig, aiPrefillProviderFactory });

  app.post("/projects/:projectId/analyze-runs", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const run = await service.startAnalyzeRun(projectId);
    return reply.code(201).send(run);
  });

  app.get("/projects/:projectId/analyze-runs/:runId", async (request) => {
    const { projectId, runId } = analyzeRunParamsSchema.parse(request.params);
    return service.getAnalyzeRun(projectId, runId);
  });
};
