import type { ValidationMessageDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { validationMessages } from "@specops/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const validationParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerValidationRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);

  app.get("/projects/:projectId/validation-messages", async (request) => {
    const { projectId } = validationParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    const rows = await db
      .select()
      .from(validationMessages)
      .where(eq(validationMessages.projectId, projectId))
      .orderBy(asc(validationMessages.createdAt), asc(validationMessages.code));

    return rows.map(mapValidationMessage);
  });
};

function mapValidationMessage(row: typeof validationMessages.$inferSelect): ValidationMessageDto {
  return {
    id: row.id,
    projectId: row.projectId,
    indexRunId: row.indexRunId,
    filePath: row.filePath,
    entityId: row.entityId,
    level: row.level as ValidationMessageDto["level"],
    code: row.code,
    message: row.message,
    createdAt: row.createdAt.toISOString()
  };
}
