import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  ProjectDto,
  SaveAgentTaskRequest,
  SaveAgentTaskResponse,
  SpecEntityDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { specEntities, specLinks } from "@specops/db";
import { parseSpecMarkdown } from "@specops/markdown";
import { defaultAgentTaskFilePath, generateAgentTaskMarkdown } from "@specops/taskgen";
import type { TaskgenEntity } from "@specops/taskgen";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { parse } from "yaml";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";

const fallbackValidationCommands = ["pnpm typecheck", "pnpm test"];

export function createAgentTaskService(db: Db) {
  const projectService = createProjectService(db);
  const indexerService = createIndexerService(db);

  async function previewAgentTask(
    projectId: string,
    input: AgentTaskPreviewRequest
  ): Promise<AgentTaskPreviewResponse> {
    const project = await projectService.getProject(projectId);
    const source = await getEntity(projectId, input.sourceEntityId);
    const links = await getOneHopLinks(projectId, source.entityId);
    const oneHopContextIds = [
      ...new Set(links.flatMap((link) => [link.fromEntityId, link.toEntityId]))
    ].filter((entityId) => entityId !== source.entityId);
    const contextIds = [...new Set([...oneHopContextIds, ...input.impactedContextEntityIds])]
      .filter((entityId) => entityId !== source.entityId)
      .sort((left, right) => left.localeCompare(right));
    const context = contextIds.length > 0 ? await getEntities(projectId, contextIds) : [];
    const validationCommands = await readValidationCommands(project);

    return generateAgentTaskMarkdown({
      source: toTaskgenEntity(source),
      context: context.map(toTaskgenEntity),
      links: links.map((link) => ({
        fromEntityId: link.fromEntityId,
        toEntityId: link.toEntityId,
        linkType: link.linkType,
        source: link.source
      })),
      targetAgent: input.targetAgent,
      taskId: input.taskId,
      title: input.title,
      validationCommands
    });
  }

  async function saveAgentTask(
    projectId: string,
    input: SaveAgentTaskRequest
  ): Promise<SaveAgentTaskResponse> {
    const project = await projectService.getProject(projectId);
    validateAgentTaskMarkdown(input.markdown, input.taskId, input.filePath);
    validateTaskFilePath(input.taskId, input.filePath);
    const { targetPath } = await resolveAgentTaskSavePath(project, input.filePath);

    try {
      await writeFile(targetPath, input.markdown, { flag: "wx" });
    } catch (error) {
      if (isFileExistsError(error)) {
        throw new ConflictError("Agent task markdown file already exists", {
          filePath: input.filePath
        });
      }

      throw error;
    }

    await indexerService.indexProject(projectId);
    return getEntity(projectId, input.taskId);
  }

  async function getEntity(projectId: string, entityId: string): Promise<SpecEntityDto> {
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

  async function getEntities(projectId: string, entityIds: string[]): Promise<SpecEntityDto[]> {
    const rows = await db
      .select()
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), inArray(specEntities.entityId, entityIds)))
      .orderBy(asc(specEntities.entityId));
    const byId = new Map(rows.map((row) => [row.entityId, mapEntity(row)]));

    return entityIds.flatMap((entityId) => {
      const entity = byId.get(entityId);
      return entity ? [entity] : [];
    });
  }

  async function getOneHopLinks(projectId: string, entityId: string) {
    const endpointPredicate = or(
      eq(specLinks.fromEntityId, entityId),
      eq(specLinks.toEntityId, entityId)
    );

    if (!endpointPredicate) {
      return [];
    }

    return db
      .select()
      .from(specLinks)
      .where(and(eq(specLinks.projectId, projectId), endpointPredicate))
      .orderBy(asc(specLinks.linkType), asc(specLinks.fromEntityId), asc(specLinks.toEntityId));
  }

  return {
    previewAgentTask,
    saveAgentTask
  };
}

function validateTaskFilePath(taskId: string, filePath: string) {
  const expectedFilePath = defaultAgentTaskFilePath(taskId);

  if (filePath !== expectedFilePath) {
    throw new BadRequestError("Agent task file path must match task id", {
      expectedFilePath,
      receivedFilePath: filePath
    });
  }
}

async function resolveAgentTaskSavePath(
  project: Pick<ProjectDto, "repoPath" | "specopsPath">,
  filePath: string
): Promise<{ targetPath: string }> {
  if (!filePath.startsWith("agent-tasks/")) {
    throw new BadRequestError("Agent task file path must be under agent-tasks", { filePath });
  }

  try {
    const persistedSpecopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
    const specopsPath = await assertRealPathInsideDirectory(project.repoPath, persistedSpecopsPath);
    const agentTasksPath = assertInsideDirectory(specopsPath, path.join(specopsPath, "agent-tasks"));
    const targetPath = assertInsideDirectory(agentTasksPath, path.join(specopsPath, filePath));
    const targetParent = path.dirname(targetPath);

    if (targetParent !== agentTasksPath) {
      throw new BadRequestError("Agent task file path must be a direct child of agent-tasks", {
        filePath
      });
    }

    await mkdir(agentTasksPath, { recursive: true });
    await assertRealPathInsideDirectory(specopsPath, agentTasksPath);
    await assertExistingParentInsideDirectory(agentTasksPath, targetParent);

    return { targetPath };
  } catch (error) {
    if (isPathValidationError(error)) {
      throw new BadRequestError("Agent task file path must stay under agent-tasks", {
        filePath,
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    throw error;
  }
}

async function readValidationCommands(project: ProjectDto): Promise<string[]> {
  const persistedSpecopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
  const specopsPath = await assertRealPathInsideDirectory(project.repoPath, persistedSpecopsPath);
  const projectYamlPath = assertInsideDirectory(specopsPath, path.join(specopsPath, "project.yaml"));

  try {
    const content = await readFile(projectYamlPath, "utf8");
    const parsed = parse(content) as unknown;

    if (!isRecord(parsed)) {
      return fallbackValidationCommands;
    }

    const defaults = parsed.agent_task_defaults;
    if (!isRecord(defaults) || !Array.isArray(defaults.validation_commands)) {
      return fallbackValidationCommands;
    }

    const commands = defaults.validation_commands.filter(
      (command): command is string => typeof command === "string" && command.trim().length > 0
    );

    return commands.length > 0 ? commands : fallbackValidationCommands;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return fallbackValidationCommands;
    }

    throw error;
  }
}

function validateAgentTaskMarkdown(markdown: string, expectedTaskId: string, filePath: string) {
  const parsed = parseSpecMarkdown(filePath, markdown);

  if (parsed.messages.some((message) => message.level === "error") || !parsed.entity) {
    throw new BadRequestError("Invalid agent task markdown", { messages: parsed.messages });
  }

  if (parsed.entity.entityId !== expectedTaskId) {
    throw new BadRequestError("Agent task id mismatch", {
      expectedTaskId,
      receivedEntityId: parsed.entity.entityId
    });
  }

  if (parsed.entity.type !== "agent_task") {
    throw new BadRequestError("Agent task markdown must use type agent_task", {
      receivedType: parsed.entity.type
    });
  }

  if (
    typeof parsed.entity.frontmatter.source_entity !== "string" ||
    parsed.entity.frontmatter.source_entity.trim().length === 0
  ) {
    throw new BadRequestError("Agent task markdown must include source_entity");
  }
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
    frontmatter: row.frontmatterJson as Record<string, unknown>,
    bodyMarkdown: row.bodyMarkdown,
    bodyText: row.bodyText,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toTaskgenEntity(entity: SpecEntityDto): TaskgenEntity {
  return {
    entityId: entity.entityId,
    type: entity.type,
    title: entity.title,
    status: entity.status,
    filePath: entity.filePath,
    contentHash: entity.contentHash,
    frontmatter: entity.frontmatter,
    bodyMarkdown: entity.bodyMarkdown,
    bodyText: entity.bodyText
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isFileNotFoundError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isPathValidationError(error: unknown): boolean {
  if (isNodeError(error) && ["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code ?? "")) {
    return true;
  }

  return (
    error instanceof Error &&
    (error.message.startsWith("Path must be inside ") ||
      error.message.includes(" must be an absolute path"))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
