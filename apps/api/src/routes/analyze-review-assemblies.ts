import {
  analyzeReviewAcceptRequestSchema,
  analyzeReviewAttachEvidenceRequestSchema,
  analyzeReviewAttachInputRequestSchema,
  analyzeReviewCreateAssemblyRequestSchema,
  analyzeReviewCreateClaimRequestSchema,
  analyzeReviewUpdateAssemblyRequestSchema,
  analyzeReviewUpdateClaimRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAnalyzeReviewAssemblyService } from "../services/analyze-review-assembly-service.js";

type RouteOptions = {
  db: Db;
};

const reviewRunParamsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid()
});

const reviewAssemblyParamsSchema = reviewRunParamsSchema.extend({
  assemblyId: z.string().uuid()
});

const reviewAssemblyInputParamsSchema = reviewAssemblyParamsSchema.extend({
  proposalId: z.string().uuid()
});

const reviewClaimParamsSchema = reviewAssemblyParamsSchema.extend({
  claimId: z.string().uuid()
});

const reviewEvidenceParamsSchema = reviewClaimParamsSchema.extend({
  evidenceId: z.string().uuid()
});

export const registerAnalyzeReviewAssemblyRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db }
) => {
  const service = createAnalyzeReviewAssemblyService(db);

  app.get("/projects/:projectId/analyze-runs/:runId/review-assemblies", async (request) => {
    const { projectId, runId } = reviewRunParamsSchema.parse(request.params);
    return service.listReviewAssemblies(projectId, runId);
  });

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies",
    async (request, reply) => {
      const { projectId, runId } = reviewRunParamsSchema.parse(request.params);
      const input = analyzeReviewCreateAssemblyRequestSchema.parse(request.body);
      const assembly = await service.createAssembly(projectId, runId, input);
      return reply.code(201).send(assembly);
    }
  );

  app.patch(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId",
    async (request) => {
      const { projectId, runId, assemblyId } = reviewAssemblyParamsSchema.parse(request.params);
      const input = analyzeReviewUpdateAssemblyRequestSchema.parse(request.body);
      return service.patchAssembly(projectId, runId, assemblyId, input);
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/inputs",
    async (request, reply) => {
      const { projectId, runId, assemblyId } = reviewAssemblyParamsSchema.parse(request.params);
      const input = analyzeReviewAttachInputRequestSchema.parse(request.body);
      const assembly = await service.attachInput(projectId, runId, assemblyId, input);
      return reply.code(201).send(assembly);
    }
  );

  app.delete(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/inputs/:proposalId",
    async (request, reply) => {
      const { projectId, runId, assemblyId, proposalId } = reviewAssemblyInputParamsSchema.parse(
        request.params
      );
      await service.removeInput(projectId, runId, assemblyId, proposalId);
      return reply.code(204).send();
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims",
    async (request, reply) => {
      const { projectId, runId, assemblyId } = reviewAssemblyParamsSchema.parse(request.params);
      const input = analyzeReviewCreateClaimRequestSchema.parse(request.body);
      const claim = await service.createClaim(projectId, runId, assemblyId, input);
      return reply.code(201).send(claim);
    }
  );

  app.patch(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId",
    async (request) => {
      const { projectId, runId, assemblyId, claimId } = reviewClaimParamsSchema.parse(
        request.params
      );
      const input = analyzeReviewUpdateClaimRequestSchema.parse(request.body);
      return service.patchClaim(projectId, runId, assemblyId, claimId, input);
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId/evidence",
    async (request, reply) => {
      const { projectId, runId, assemblyId, claimId } = reviewClaimParamsSchema.parse(
        request.params
      );
      const input = analyzeReviewAttachEvidenceRequestSchema.parse(request.body);
      const evidence = await service.attachEvidence(projectId, runId, assemblyId, claimId, input);
      return reply.code(201).send(evidence);
    }
  );

  app.delete(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId/evidence/:evidenceId",
    async (request, reply) => {
      const { projectId, runId, assemblyId, claimId, evidenceId } =
        reviewEvidenceParamsSchema.parse(request.params);
      await service.removeEvidence(projectId, runId, assemblyId, claimId, evidenceId);
      return reply.code(204).send();
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/accept",
    async (request) => {
      const { projectId, runId } = reviewRunParamsSchema.parse(request.params);
      const input = analyzeReviewAcceptRequestSchema.parse(request.body);
      return service.acceptAssemblies(projectId, runId, input);
    }
  );
};
