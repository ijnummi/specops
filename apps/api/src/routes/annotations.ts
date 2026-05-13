import {
  annotationCreateRequestSchema,
  annotationListQuerySchema,
  sourceSpecAnnotationUpdateRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAnnotationService } from "../services/annotation-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const annotationParamsSchema = z.object({
  projectId: z.string().min(1),
  annotationId: z.string().uuid()
});

export const registerAnnotationRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const annotationService = createAnnotationService(db);
  const projectService = createProjectService(db);

  app.get("/projects/:projectId/annotations", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = annotationListQuerySchema.parse(request.query);
    await projectService.getProject(projectId);
    return annotationService.listAnnotations(projectId, query);
  });

  app.post("/projects/:projectId/annotations", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = annotationCreateRequestSchema.parse(request.body);
    await projectService.getProject(projectId);
    const annotation = await annotationService.createUserAnnotation(projectId, input);
    return reply.code(201).send(annotation);
  });

  app.patch("/projects/:projectId/annotations/:annotationId", async (request) => {
    const { projectId, annotationId } = annotationParamsSchema.parse(request.params);
    const input = sourceSpecAnnotationUpdateRequestSchema.parse(request.body);
    await projectService.getProject(projectId);
    return annotationService.patchAnnotation(projectId, annotationId, input);
  });

  app.delete("/projects/:projectId/annotations/:annotationId", async (request, reply) => {
    const { projectId, annotationId } = annotationParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    await annotationService.deleteAnnotation(projectId, annotationId);
    return reply.code(204).send();
  });
};
