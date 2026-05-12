import {
  createDiffReviewRequestSchema,
  updateDiffReviewStatusRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createDiffReviewService } from "../services/diff-review-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const diffReviewParamsSchema = z.object({
  projectId: z.string().min(1),
  reviewId: z.string().uuid()
});

export const registerDiffReviewRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const diffReviewService = createDiffReviewService(db);

  app.post("/projects/:projectId/diff-reviews", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = createDiffReviewRequestSchema.parse(request.body);
    const review = await diffReviewService.createReview(projectId, input);
    return reply.code(201).send(review);
  });

  app.get("/projects/:projectId/diff-reviews", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return diffReviewService.listReviews(projectId);
  });

  app.get("/projects/:projectId/diff-reviews/:reviewId", async (request) => {
    const { projectId, reviewId } = diffReviewParamsSchema.parse(request.params);
    return diffReviewService.getReview(projectId, reviewId);
  });

  app.patch("/projects/:projectId/diff-reviews/:reviewId", async (request) => {
    const { projectId, reviewId } = diffReviewParamsSchema.parse(request.params);
    const input = updateDiffReviewStatusRequestSchema.parse(request.body);
    return diffReviewService.updateReviewStatus(projectId, reviewId, input);
  });
};
