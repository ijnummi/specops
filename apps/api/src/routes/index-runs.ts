import type { IndexRunDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { indexRuns } from "@specops/db";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const indexRunParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerIndexRunRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);

  app.get("/projects/:projectId/index-runs", async (request) => {
    const { projectId } = indexRunParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    const rows = await db
      .select()
      .from(indexRuns)
      .where(eq(indexRuns.projectId, projectId))
      .orderBy(desc(indexRuns.startedAt));

    return rows.map(mapIndexRun);
  });
};

function mapIndexRun(row: typeof indexRuns.$inferSelect): IndexRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status as IndexRunDto["status"],
    entityCount: row.entityCount,
    linkCount: row.linkCount,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    gitCommit: row.gitCommit
  };
}
