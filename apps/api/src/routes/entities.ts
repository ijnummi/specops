import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createEntityRequestSchema,
  updateEntityMarkdownRequestSchema,
  type SpecEntityDto,
  type SpecLinkDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { specEntities, specLinks } from "@specops/db";
import { createEntityMarkdown } from "@specops/markdown";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const entityParamsSchema = z.object({
  projectId: z.string().min(1),
  entityId: z.string().min(1)
});

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const entityListQuerySchema = z.object({
  type: z.string().min(1).optional()
});

const typeDirectories: Record<string, string> = {
  use_case: "use-cases",
  domain_entity: "domain",
  data_model: "data-model",
  interface: "interfaces",
  ui_view: "ui",
  agent_task: "agent-tasks",
  adr: "decisions"
};

export const registerEntityRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const indexerService = createIndexerService(db);

  app.get("/projects/:projectId/entities", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const { type } = entityListQuerySchema.parse(request.query);
    await projectService.getProject(projectId);

    const rows = type
      ? await db
          .select()
          .from(specEntities)
          .where(and(eq(specEntities.projectId, projectId), eq(specEntities.type, type)))
          .orderBy(asc(specEntities.entityId))
      : await db
          .select()
          .from(specEntities)
          .where(eq(specEntities.projectId, projectId))
          .orderBy(asc(specEntities.entityId));

    return rows.map(mapEntity);
  });

  app.get("/projects/:projectId/entities/:entityId", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    return getEntity(db, projectId, entityId);
  });

  app.post("/projects/:projectId/entities", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = createEntityRequestSchema.parse(request.body);
    const project = await projectService.getProject(projectId);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
    await mkdir(specopsPath, { recursive: true });
    await assertRealPathInsideDirectory(project.repoPath, specopsPath);

    const relativePath = entityRelativePath(input.type, input.entityId);
    const targetPath = assertInsideDirectory(specopsPath, path.join(specopsPath, relativePath));
    const targetParent = path.dirname(targetPath);
    await assertSafePath("Entity markdown parent is outside specopsPath", () =>
      assertExistingParentInsideDirectory(specopsPath, targetParent)
    );
    await mkdir(targetParent, { recursive: true });
    await assertSafePath("Entity markdown parent is outside specopsPath", () =>
      assertRealPathInsideDirectory(specopsPath, targetParent)
    );

    try {
      await writeFile(targetPath, createEntityMarkdown(input), { flag: "wx" });
    } catch (error) {
      if (isFileExistsError(error)) {
        throw new ConflictError("Entity markdown file already exists", { filePath: relativePath });
      }

      throw error;
    }

    await indexerService.indexProject(projectId);
    const entity = await getEntity(db, projectId, input.entityId);
    return reply.code(201).send(entity);
  });

  app.put("/projects/:projectId/entities/:entityId/markdown", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    const input = updateEntityMarkdownRequestSchema.parse(request.body);
    const project = await projectService.getProject(projectId);
    const entity = await getEntity(db, projectId, entityId);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
    await assertRealPathInsideDirectory(project.repoPath, specopsPath);
    const targetPath = assertInsideDirectory(specopsPath, path.join(specopsPath, entity.filePath));
    await assertSafePath("Entity markdown path is outside specopsPath", () =>
      assertExistingParentInsideDirectory(specopsPath, targetPath)
    );

    await writeFile(targetPath, input.markdown, { flag: "w" });
    await indexerService.indexProject(projectId);
    return getEntity(db, projectId, entityId);
  });

  app.get("/projects/:projectId/entities/:entityId/outgoing-links", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    const rows = await db
      .select()
      .from(specLinks)
      .where(and(eq(specLinks.projectId, projectId), eq(specLinks.fromEntityId, entityId)))
      .orderBy(asc(specLinks.toEntityId), asc(specLinks.linkType), asc(specLinks.source));

    return rows.map(mapLink);
  });

  app.get("/projects/:projectId/entities/:entityId/backlinks", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    const rows = await db
      .select()
      .from(specLinks)
      .where(and(eq(specLinks.projectId, projectId), eq(specLinks.toEntityId, entityId)))
      .orderBy(asc(specLinks.fromEntityId), asc(specLinks.linkType), asc(specLinks.source));

    return rows.map(mapLink);
  });
};

async function getEntity(db: Db, projectId: string, entityId: string): Promise<SpecEntityDto> {
  const [row] = await db
    .select()
    .from(specEntities)
    .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, entityId)))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Entity not found", { projectId, entityId });
  }

  return mapEntity(row);
}

function entityRelativePath(type: string, entityId: string): string {
  const directory = typeDirectories[type] ?? sanitizePathPart(type, "all-entities");
  return path.posix.join(directory, `${sanitizePathPart(entityId, "entity")}.md`);
}

function sanitizePathPart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.length > 0 && sanitized !== "." && sanitized !== ".." ? sanitized : fallback;
}

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

function mapLink(row: typeof specLinks.$inferSelect): SpecLinkDto {
  return {
    id: row.id,
    projectId: row.projectId,
    fromEntityId: row.fromEntityId,
    toEntityId: row.toEntityId,
    linkType: row.linkType,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function assertSafePath(message: string, check: () => Promise<string>) {
  try {
    await check();
  } catch (error) {
    throw new BadRequestError(message, { cause: error instanceof Error ? error.message : String(error) });
  }
}
