import { sourceFileListQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectService } from "../services/project-service.js";
import { createSourceScanService } from "../services/source-scan-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const sourceFileParamsSchema = z.object({
  projectId: z.string().min(1),
  sourceFileId: z.string().min(1)
});

export const registerSourceRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const sourceScanService = createSourceScanService(db);

  app.get("/projects/:projectId/source-files", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = sourceFileListQuerySchema.parse(request.query);
    await projectService.getProject(projectId);
    return sourceScanService.listSourceFiles(projectId, query);
  });

  app.get("/projects/:projectId/source-files/:sourceFileId", async (request) => {
    const { projectId, sourceFileId } = sourceFileParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return sourceScanService.getSourceFileDetail(projectId, sourceFileId);
  });
};
