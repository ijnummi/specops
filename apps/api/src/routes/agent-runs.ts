import {
  startAgentRunRequestSchema,
  updateAgentRunStatusRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAgentRunService } from "../services/agent-run-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const agentRunParamsSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().uuid()
});

export const registerAgentRunRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const agentRunService = createAgentRunService(db);

  app.post("/projects/:projectId/agent-runs", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = startAgentRunRequestSchema.parse(request.body);
    const run = await agentRunService.startRun(projectId, input);
    return reply.code(201).send(run);
  });

  app.get("/projects/:projectId/agent-runs", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return agentRunService.listRuns(projectId);
  });

  app.get("/projects/:projectId/agent-runs/:runId", async (request) => {
    const { projectId, runId } = agentRunParamsSchema.parse(request.params);
    return agentRunService.getRun(projectId, runId);
  });

  app.post("/projects/:projectId/agent-runs/:runId/finish", async (request) => {
    const { projectId, runId } = agentRunParamsSchema.parse(request.params);
    return agentRunService.finishRun(projectId, runId);
  });

  app.patch("/projects/:projectId/agent-runs/:runId", async (request) => {
    const { projectId, runId } = agentRunParamsSchema.parse(request.params);
    const input = updateAgentRunStatusRequestSchema.parse(request.body);
    return agentRunService.updateRunStatus(projectId, runId, input);
  });
};
