import {
  acceptProposalsRequestSchema,
  aiPrefillGenerateRequestSchema,
  proposalListQuerySchema,
  proposalPatchRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import {
  createAiPrefillService,
  type AiPrefillProviderFactory
} from "../services/ai-prefill-service.js";
import { createProposalService } from "../services/proposal-service.js";

type RouteOptions = {
  db: Db;
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const proposalParamsSchema = z.object({
  projectId: z.string().min(1),
  proposalId: z.string().min(1)
});

export const registerProposalRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db, aiPrefillConfig, aiPrefillProviderFactory }
) => {
  const proposalService = createProposalService(db);
  const aiPrefillService = createAiPrefillService(db, {
    config: aiPrefillConfig,
    providerFactory: aiPrefillProviderFactory
  });

  app.post("/projects/:projectId/proposals/source-import", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const proposals = await proposalService.generateSourceImportProposals(projectId);
    return reply.code(201).send(proposals);
  });

  app.post("/projects/:projectId/proposals/ai-prefill", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = aiPrefillGenerateRequestSchema.parse(request.body);
    const result = await aiPrefillService.generateAiPrefillProposals(projectId, input);
    return reply.code(201).send(result);
  });

  app.get("/projects/:projectId/proposals", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const { status, proposalType } = proposalListQuerySchema.parse(request.query);
    return proposalService.listProposals(projectId, { status, proposalType });
  });

  app.post("/projects/:projectId/proposals/accept", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = acceptProposalsRequestSchema.parse(request.body);
    return proposalService.acceptProposals(projectId, input);
  });

  app.get("/projects/:projectId/proposals/:proposalId", async (request) => {
    const { projectId, proposalId } = proposalParamsSchema.parse(request.params);
    return proposalService.getProposal(projectId, proposalId);
  });

  app.patch("/projects/:projectId/proposals/:proposalId", async (request) => {
    const { projectId, proposalId } = proposalParamsSchema.parse(request.params);
    const input = proposalPatchRequestSchema.parse(request.body);
    return proposalService.patchProposal(projectId, proposalId, input);
  });
};
