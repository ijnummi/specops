import { projectGraphQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectGraphService } from "../services/project-graph-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const nodeParamsSchema = projectParamsSchema.extend({
  nodeId: z.string().min(1)
});

export const registerProjectGraphRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const graphService = createProjectGraphService(db);

  app.get("/projects/:projectId/graph", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = projectGraphQuerySchema.parse(request.query);
    await projectService.getProject(projectId);
    return graphService.getProjectGraph(projectId, query);
  });

  app.get("/projects/:projectId/graph/nodes/:nodeId", async (request) => {
    const { projectId, nodeId } = nodeParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return graphService.getGraphNode(projectId, nodeId);
  });
};
