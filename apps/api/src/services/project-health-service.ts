import type { ProjectHealthDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { indexRuns, projects, specEntities, specLinks } from "@specops/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import path from "node:path";

import { NotFoundError } from "../lib/http-errors.js";
import { readGitStatus, type GitStatusEntry } from "./git-service.js";

type StaleReason = ProjectHealthDto["staleTasks"]["samples"][number]["reason"];
type AttentionItem = ProjectHealthDto["attentionItems"][number];
type SpecEntity = typeof specEntities.$inferSelect;

const STALE_REASON_RANK: Record<StaleReason, number> = {
  missing_source_entity: 0,
  tracked_hash_mismatch: 1,
  source_spec_changed: 2,
  context_spec_changed: 3
};

export function createProjectHealthService(db: Db) {
  async function getProjectHealth(projectId: string): Promise<ProjectHealthDto> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }

    const [latestRun] = await db
      .select()
      .from(indexRuns)
      .where(and(eq(indexRuns.projectId, projectId), inArray(indexRuns.status, ["succeeded", "completed"])))
      .orderBy(desc(indexRuns.finishedAt), desc(indexRuns.startedAt), desc(indexRuns.id))
      .limit(1);
    const gitStatus = await readGitStatus(project.repoPath, { includeEntries: true });
    const gitDrift = classifyGitEntries(project.repoPath, project.specopsPath, gitStatus.entries);
    const staleTasks = await findStaleTasks(projectId);
    const indexIsBehindHead =
      gitStatus.isRepo &&
      gitStatus.headCommit !== null &&
      latestRun?.gitCommit !== null &&
      latestRun?.gitCommit !== undefined &&
      gitStatus.headCommit !== latestRun.gitCommit;

    return {
      git: {
        isRepo: gitStatus.isRepo,
        headCommit: gitStatus.headCommit,
        indexedCommit: latestRun?.gitCommit ?? null,
        hasUncommittedChanges: gitStatus.entries.length > 0,
        changedSpecFiles: gitDrift.changedSpecFiles,
        changedSourceFiles: gitDrift.changedSourceFiles,
        untrackedSpecFiles: gitDrift.untrackedSpecFiles,
        untrackedSourceFiles: gitDrift.untrackedSourceFiles
      },
      drift: {
        indexIsBehindHead,
        currentSpecFileChangeCount: gitDrift.changedSpecFiles.length + gitDrift.untrackedSpecFiles.length,
        currentSourceFileChangeCount:
          gitDrift.changedSourceFiles.length + gitDrift.untrackedSourceFiles.length
      },
      staleTasks: {
        count: staleTasks.length,
        samples: staleTasks.slice(0, 5)
      },
      attentionItems: buildAttentionItems({
        indexIsBehindHead,
        changedSpecFiles: [...gitDrift.changedSpecFiles, ...gitDrift.untrackedSpecFiles],
        changedSourceFiles: [...gitDrift.changedSourceFiles, ...gitDrift.untrackedSourceFiles],
        staleTasks
      })
    };
  }

  async function findStaleTasks(projectId: string): Promise<ProjectHealthDto["staleTasks"]["samples"]> {
    const [entities, links] = await Promise.all([
      db.select().from(specEntities).where(eq(specEntities.projectId, projectId)),
      db
        .select()
        .from(specLinks)
        .where(
          and(
            eq(specLinks.projectId, projectId),
            inArray(specLinks.linkType, ["generated_from", "uses"])
          )
        )
    ]);
    const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
    const linkIdsByTaskAndType = new Map<string, Map<string, Set<string>>>();

    for (const link of links) {
      let taskLinks = linkIdsByTaskAndType.get(link.fromEntityId);
      if (!taskLinks) {
        taskLinks = new Map();
        linkIdsByTaskAndType.set(link.fromEntityId, taskLinks);
      }

      let ids = taskLinks.get(link.linkType);
      if (!ids) {
        ids = new Set();
        taskLinks.set(link.linkType, ids);
      }
      ids.add(link.toEntityId);
    }

    return entities
      .filter((entity) => entity.type === "agent_task")
      .map((task) => classifyStaleTask(task, entitiesById, linkIdsByTaskAndType.get(task.entityId)))
      .filter((sample): sample is ProjectHealthDto["staleTasks"]["samples"][number] => sample !== null)
      .sort((left, right) => {
        const severity = STALE_REASON_RANK[left.reason] - STALE_REASON_RANK[right.reason];
        return severity === 0 ? left.entityId.localeCompare(right.entityId) : severity;
      });
  }

  return { getProjectHealth };
}

function classifyGitEntries(repoPath: string, specopsPath: string, entries: GitStatusEntry[]) {
  const specopsPrefix = toRepoRelativePath(repoPath, specopsPath);
  const result = {
    changedSpecFiles: [] as string[],
    changedSourceFiles: [] as string[],
    untrackedSpecFiles: [] as string[],
    untrackedSourceFiles: [] as string[]
  };

  for (const entry of entries) {
    const isUntracked = entry.indexStatus === "?" && entry.workTreeStatus === "?";
    const isSpecFile = isUnderSpecopsPath(entry.path, specopsPrefix);

    if (isUntracked && isSpecFile) result.untrackedSpecFiles.push(entry.path);
    if (isUntracked && !isSpecFile) result.untrackedSourceFiles.push(entry.path);
    if (!isUntracked && isSpecFile) result.changedSpecFiles.push(entry.path);
    if (!isUntracked && !isSpecFile) result.changedSourceFiles.push(entry.path);
  }

  result.changedSpecFiles.sort();
  result.changedSourceFiles.sort();
  result.untrackedSpecFiles.sort();
  result.untrackedSourceFiles.sort();

  return result;
}

function toRepoRelativePath(repoPath: string, specopsPath: string): string {
  const relativePath = path.relative(repoPath, specopsPath);
  return normalizePath(relativePath === "" ? "." : relativePath);
}

function isUnderSpecopsPath(filePath: string, specopsPrefix: string): boolean {
  const normalizedFilePath = normalizePath(filePath);

  if (specopsPrefix === ".") {
    return true;
  }

  return normalizedFilePath === specopsPrefix || normalizedFilePath.startsWith(`${specopsPrefix}/`);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function classifyStaleTask(
  task: SpecEntity,
  entitiesById: Map<string, SpecEntity>,
  linkedIdsByType: Map<string, Set<string>> | undefined
): ProjectHealthDto["staleTasks"]["samples"][number] | null {
  const frontmatter = readFrontmatter(task.frontmatterJson);
  const sourceEntityId = readString(frontmatter.source_entity);
  const sourceIds = sourceEntityId ? [sourceEntityId] : [];
  const contextIds = mergeIds(
    readFrontmatterLinkIds(frontmatter, "generated_from"),
    [...(linkedIdsByType?.get("generated_from") ?? [])],
    readFrontmatterLinkIds(frontmatter, "uses"),
    [...(linkedIdsByType?.get("uses") ?? [])]
  ).filter((entityId) => entityId !== sourceEntityId);
  const trackedHashes = readTrackedSpecHashes(frontmatter.tracked_spec_hashes);
  const reason =
    sourceEntityId && !entitiesById.has(sourceEntityId)
      ? "missing_source_entity"
      : trackedHashes && hasTrackedHashMismatch(trackedHashes, entitiesById)
        ? "tracked_hash_mismatch"
        : !trackedHashes && hasNewerLinkedEntity(sourceIds, entitiesById, task.updatedAt)
          ? "source_spec_changed"
          : !trackedHashes && hasNewerLinkedEntity(contextIds, entitiesById, task.updatedAt)
            ? "context_spec_changed"
            : null;

  if (!reason) {
    return null;
  }

  return {
    entityId: task.entityId,
    title: task.title,
    sourceEntityId,
    reason
  };
}

function readFrontmatter(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readFrontmatterLinkIds(frontmatter: Record<string, unknown>, linkType: string): string[] {
  const links = readFrontmatter(frontmatter.links);
  const value = links[linkType];

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function readTrackedSpecHashes(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function mergeIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((id) => id.length > 0))];
}

function hasTrackedHashMismatch(
  trackedHashes: Record<string, string>,
  entitiesById: Map<string, SpecEntity>
): boolean {
  return Object.entries(trackedHashes).some(([entityId, trackedHash]) => {
    const entity = entitiesById.get(entityId);
    return !entity || entity.contentHash !== trackedHash;
  });
}

function hasNewerLinkedEntity(
  entityIds: string[],
  entitiesById: Map<string, SpecEntity>,
  taskUpdatedAt: Date
): boolean {
  return entityIds.some((entityId) => {
    const entity = entitiesById.get(entityId);
    return entity ? entity.updatedAt.getTime() > taskUpdatedAt.getTime() : false;
  });
}

function buildAttentionItems(input: {
  indexIsBehindHead: boolean;
  changedSpecFiles: string[];
  changedSourceFiles: string[];
  staleTasks: ProjectHealthDto["staleTasks"]["samples"];
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.indexIsBehindHead) {
    items.push({
      kind: "index_behind_head",
      label: "Index is behind the current Git HEAD.",
      entityId: null,
      filePath: null
    });
  }

  for (const filePath of input.changedSpecFiles) {
    items.push({
      kind: "changed_spec_files",
      label: `${filePath} has unindexed spec changes.`,
      entityId: null,
      filePath
    });
  }

  for (const filePath of input.changedSourceFiles) {
    items.push({
      kind: "changed_source_files",
      label: `${filePath} has unindexed source changes.`,
      entityId: null,
      filePath
    });
  }

  for (const task of input.staleTasks) {
    items.push({
      kind: task.reason === "missing_source_entity" ? "missing_task_source" : "stale_agent_task",
      label:
        task.reason === "missing_source_entity"
          ? `${task.title} references a missing source entity.`
          : `${task.title} may need to be refreshed.`,
      entityId: task.entityId,
      filePath: null
    });
  }

  return items.slice(0, 10);
}
