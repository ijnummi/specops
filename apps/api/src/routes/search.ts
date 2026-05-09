import type { SpecEntityDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { specEntities } from "@specops/db";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { BadRequestError } from "../lib/http-errors.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const searchParamsSchema = z.object({
  projectId: z.string().min(1)
});

const searchQuerySchema = z.object({
  q: z.string().optional()
});

export const registerSearchRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);

  app.get("/projects/:projectId/search", async (request) => {
    const { projectId } = searchParamsSchema.parse(request.params);
    const { q } = searchQuerySchema.parse(request.query);
    const query = q?.trim();

    if (!query) {
      throw new BadRequestError("Search query is required", { query: "q" });
    }

    await projectService.getProject(projectId);
    const pattern = `%${query}%`;
    const rows = await db
      .select()
      .from(specEntities)
      .where(
        and(
          eq(specEntities.projectId, projectId),
          or(
            ilike(specEntities.entityId, pattern),
            ilike(specEntities.title, pattern),
            ilike(specEntities.type, pattern),
            ilike(specEntities.bodyMarkdown, pattern),
            ilike(specEntities.bodyText, pattern)
          )
        )
      )
      .orderBy(asc(specEntities.entityId));

    return rows.map(mapEntity);
  });
};

function mapEntity(row: typeof specEntities.$inferSelect): SpecEntityDto {
  return {
    id: row.id,
    projectId: row.projectId,
    entityId: row.entityId,
    type: row.type,
    title: row.title,
    status: row.status,
    filePath: row.filePath,
    frontmatter: isRecord(row.frontmatterJson) ? row.frontmatterJson : {},
    bodyMarkdown: row.bodyMarkdown,
    bodyText: row.bodyText,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
