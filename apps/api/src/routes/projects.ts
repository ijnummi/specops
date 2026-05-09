import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectRequestSchema, updateProjectRequestSchema } from "@specops/contracts";
import type { Db } from "@specops/db";

import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";
import { createSpecopsInitializerService } from "../services/specops-initializer.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerProjectRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const initializerService = createSpecopsInitializerService(db);
  const indexerService = createIndexerService(db);

  app.get("/projects", async () => projectService.listProjects());

  app.post("/projects", async (request, reply) => {
    const input = createProjectRequestSchema.parse(request.body);
    const project = await projectService.createProject(input);
    return reply.code(201).send(project);
  });

  app.get("/projects/:projectId", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return projectService.getProjectSummary(projectId);
  });

  app.patch("/projects/:projectId", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = updateProjectRequestSchema.parse(request.body);
    return projectService.updateProject(projectId, input);
  });

  app.delete("/projects/:projectId", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    await projectService.deleteProject(projectId);
    return reply.code(204).send();
  });

  app.post("/projects/:projectId/init-specops", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return initializerService.initializeProjectSpecops(projectId);
  });

  app.post("/projects/:projectId/index", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return indexerService.indexProject(projectId);
  });
};
