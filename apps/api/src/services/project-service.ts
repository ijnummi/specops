import type {
  CreateProjectRequest,
  ProjectDto,
  ProjectSummaryDto,
  UpdateProjectRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { indexRuns, projects, specEntities, specLinks, validationMessages } from "@specops/db";
import { and, count, desc, eq } from "drizzle-orm";

import { ConflictError, NotFoundError } from "../lib/http-errors.js";
import { normalizeProjectPathsForPersistence } from "../lib/path-safety.js";

export function createProjectService(db: Db) {
  async function listProjects(): Promise<ProjectDto[]> {
    const rows = await db.select().from(projects).orderBy(projects.name);
    return rows.map(mapProject);
  }

  async function createProject(input: CreateProjectRequest): Promise<ProjectDto> {
    const paths = await normalizeProjectPathsForPersistence({
      repoPath: input.repoPath,
      specopsPath: input.specopsPath
    });

    try {
      const [row] = await db
        .insert(projects)
        .values({
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          repoPath: paths.repoPath,
          specopsPath: paths.specopsPath
        })
        .returning();

      if (!row) {
        throw new Error("Failed to create project");
      }

      return mapProject(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Project slug already exists", { slug: input.slug });
      }

      throw error;
    }
  }

  async function getProject(projectId: string): Promise<ProjectDto> {
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!row) {
      throw new NotFoundError("Project not found", { projectId });
    }

    return mapProject(row);
  }

  async function updateProject(projectId: string, input: UpdateProjectRequest): Promise<ProjectDto> {
    const existing = await getProject(projectId);
    const paths =
      input.repoPath !== undefined || input.specopsPath !== undefined
        ? await normalizeProjectPathsForPersistence({
            repoPath: input.repoPath ?? existing.repoPath,
            specopsPath: input.specopsPath ?? existing.specopsPath
          })
        : null;
    const values: Partial<typeof projects.$inferInsert> = {
      updatedAt: new Date()
    };

    if (input.name !== undefined) values.name = input.name;
    if (input.slug !== undefined) values.slug = input.slug;
    if (input.description !== undefined) values.description = input.description;
    if (paths) {
      values.repoPath = paths.repoPath;
      values.specopsPath = paths.specopsPath;
    }

    try {
      const [row] = await db
        .update(projects)
        .set(values)
        .where(eq(projects.id, projectId))
        .returning();

      if (!row) {
        throw new NotFoundError("Project not found", { projectId });
      }

      return mapProject(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Project slug already exists", { slug: input.slug });
      }

      throw error;
    }
  }

  async function deleteProject(projectId: string): Promise<void> {
    const [row] = await db
      .delete(projects)
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });

    if (!row) {
      throw new NotFoundError("Project not found", { projectId });
    }
  }

  async function getProjectSummary(projectId: string): Promise<ProjectSummaryDto> {
    const project = await getProject(projectId);
    const [entityCount, linkCount, validationErrorCount, validationWarningCount, latestRun] =
      await Promise.all([
        countRows(db, specEntities, projectId),
        countRows(db, specLinks, projectId),
        countValidationRows(db, projectId, "error"),
        countValidationRows(db, projectId, "warning"),
        db
          .select({ finishedAt: indexRuns.finishedAt })
          .from(indexRuns)
          .where(eq(indexRuns.projectId, projectId))
          .orderBy(desc(indexRuns.startedAt), desc(indexRuns.id))
          .limit(1)
      ]);

    return {
      ...project,
      entityCount,
      linkCount,
      validationErrorCount,
      validationWarningCount,
      lastIndexedAt: latestRun[0]?.finishedAt ? latestRun[0].finishedAt.toISOString() : null
    };
  }

  return {
    listProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    getProjectSummary
  };
}

function mapProject(row: typeof projects.$inferSelect): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repoPath: row.repoPath,
    specopsPath: row.specopsPath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function countRows(
  db: Db,
  table: typeof specEntities | typeof specLinks,
  projectId: string
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(eq(table.projectId, projectId));
  return Number(row?.value ?? 0);
}

async function countValidationRows(db: Db, projectId: string, level: "error" | "warning"): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(validationMessages)
    .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, level)));
  return Number(row?.value ?? 0);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
