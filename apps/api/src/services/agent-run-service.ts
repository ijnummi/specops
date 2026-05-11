import path from "node:path";

import type {
  AgentRunChangedFiles,
  AgentRunDetail,
  AgentRunFinding,
  AgentRunFindingSeverity,
  AgentRunReview,
  AgentRunStatus,
  EntityReadinessDto,
  AgentRunSummary,
  StartAgentRunRequest,
  UpdateAgentRunStatusRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  agentRuns,
  projects,
  sourceSpecLinks,
  specEntities,
  specLinks,
  validationMessages
} from "@specops/db";
import { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "@specops/repo-scanner";
import { and, desc, eq, inArray } from "drizzle-orm";

import { BadRequestError, NotFoundError } from "../lib/http-errors.js";
import { readGitChangedFiles, readGitStatus, type GitStatusEntry } from "./git-service.js";
import { createSpecReadinessService } from "./spec-readiness-service.js";

type AgentRunRow = typeof agentRuns.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;

type AffectedReason = AgentRunReview["affectedSpecs"][number]["reason"];

const EMPTY_CHANGED_FILES: AgentRunChangedFiles = {
  specs: [],
  source: [],
  tests: [],
  other: []
};

const EMPTY_REVIEW: AgentRunReview = {
  changedFiles: EMPTY_CHANGED_FILES,
  affectedSpecs: [],
  taskContext: {
    sourceEntityId: null,
    contextEntityIds: [],
    missingEntityIds: []
  },
  findings: [],
  suggestedValidationCommands: []
};

const TERMINAL_STATUSES = new Set<AgentRunStatus>(["accepted", "needs_followup", "superseded"]);

export function createAgentRunService(db: Db) {
  async function startRun(
    projectId: string,
    input: StartAgentRunRequest
  ): Promise<AgentRunDetail> {
    const [project, task] = await Promise.all([
      loadProject(projectId),
      loadTask(projectId, input.taskEntityId)
    ]);

    if (task.type !== "agent_task") {
      throw new BadRequestError("Agent run must start from an agent_task entity", {
        taskEntityId: input.taskEntityId,
        type: task.type
      });
    }

    const gitStatus = await readGitStatus(project.repoPath);
    const promptMarkdown = formatPromptMarkdown(task);
    const [row] = await db
      .insert(agentRuns)
      .values({
        projectId,
        taskEntityId: input.taskEntityId,
        agent: input.agent,
        status: "running",
        promptMarkdown,
        startGitCommit: gitStatus.headCommit,
        startDirtyFilesJson: gitStatus.entries,
        changedFilesJson: EMPTY_CHANGED_FILES,
        reviewSummaryJson: EMPTY_REVIEW
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create agent run");
    }

    return mapRunDetail(row, task);
  }

  async function listRuns(projectId: string): Promise<AgentRunSummary[]> {
    await loadProject(projectId);
    const [rows, tasks] = await Promise.all([
      db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.projectId, projectId))
        .orderBy(desc(agentRuns.startedAt), desc(agentRuns.createdAt), desc(agentRuns.id)),
      db.select().from(specEntities).where(eq(specEntities.projectId, projectId))
    ]);
    const tasksById = new Map(tasks.map((task) => [task.entityId, task]));

    return rows.map((row) => mapRunSummary(row, tasksById.get(row.taskEntityId)));
  }

  async function getRun(projectId: string, runId: string): Promise<AgentRunDetail> {
    const row = await loadRun(projectId, runId);
    const task = await loadTask(projectId, row.taskEntityId);
    return mapRunDetail(row, task);
  }

  async function finishRun(projectId: string, runId: string): Promise<AgentRunDetail> {
    const [project, row] = await Promise.all([loadProject(projectId), loadRun(projectId, runId)]);

    if (row.status !== "running") {
      throw new BadRequestError("Agent run can only finish while running", {
        runId,
        status: row.status
      });
    }

    const task = await loadTask(projectId, row.taskEntityId);
    const endStatus = await readGitStatus(project.repoPath);
    const comparison = await collectChangedPaths(
      project.repoPath,
      row,
      endStatus.headCommit,
      endStatus.entries
    );
    const changedFiles = classifyChangedFiles(project, comparison.paths);
    const reviewSummary = await buildReviewSummary({
      project,
      task,
      changedFiles,
      gitComparisonUnavailable: comparison.gitComparisonUnavailable
    });
    const [updated] = await db
      .update(agentRuns)
      .set({
        status: "ready_for_review",
        finishedAt: new Date(),
        endGitCommit: endStatus.headCommit,
        endDirtyFilesJson: endStatus.entries,
        changedFilesJson: changedFiles,
        reviewSummaryJson: reviewSummary,
        updatedAt: new Date()
      })
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .returning();

    if (!updated) {
      throw new NotFoundError("Agent run not found", { projectId, runId });
    }

    return mapRunDetail(updated, task);
  }

  async function updateRunStatus(
    projectId: string,
    runId: string,
    input: UpdateAgentRunStatusRequest
  ): Promise<AgentRunDetail> {
    const row = await loadRun(projectId, runId);
    const currentStatus = row.status as AgentRunStatus;

    if (currentStatus === input.status) {
      return getRun(projectId, runId);
    }

    if (TERMINAL_STATUSES.has(currentStatus)) {
      throw new BadRequestError("Agent run already has a terminal status", {
        runId,
        status: currentStatus,
        requestedStatus: input.status
      });
    }

    if (input.status === "superseded") {
      return updateStatus(projectId, runId, input.status);
    }

    if (currentStatus !== "ready_for_review") {
      throw new BadRequestError(
        `Agent run status can only be ${input.status} from ready_for_review`,
        { runId, status: currentStatus, requestedStatus: input.status }
      );
    }

    return updateStatus(projectId, runId, input.status);
  }

  async function updateStatus(
    projectId: string,
    runId: string,
    status: AgentRunStatus
  ): Promise<AgentRunDetail> {
    const [updated] = await db
      .update(agentRuns)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .returning();

    if (!updated) {
      throw new NotFoundError("Agent run not found", { projectId, runId });
    }

    const task = await loadTask(projectId, updated.taskEntityId);
    return mapRunDetail(updated, task);
  }

  async function loadProject(projectId: string): Promise<ProjectRow> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }

    return project;
  }

  async function loadTask(projectId: string, taskEntityId: string): Promise<SpecEntityRow> {
    const [task] = await db
      .select()
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, taskEntityId)))
      .limit(1);

    if (!task) {
      throw new NotFoundError("Spec entity not found", { projectId, entityId: taskEntityId });
    }

    return task;
  }

  async function loadRun(projectId: string, runId: string): Promise<AgentRunRow> {
    const [row] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError("Agent run not found", { projectId, runId });
    }

    return row;
  }

  async function buildReviewSummary(input: {
    project: ProjectRow;
    task: SpecEntityRow;
    changedFiles: AgentRunChangedFiles;
    gitComparisonUnavailable: boolean;
  }): Promise<AgentRunReview> {
    const [entities, sourceLinks, indexedLinks] = await Promise.all([
      db.select().from(specEntities).where(eq(specEntities.projectId, input.project.id)),
      input.changedFiles.source.length > 0
        ? db
            .select()
            .from(sourceSpecLinks)
            .where(
              and(
                eq(sourceSpecLinks.projectId, input.project.id),
                inArray(sourceSpecLinks.filePath, input.changedFiles.source)
              )
            )
        : Promise.resolve([]),
      db
        .select()
        .from(specLinks)
        .where(
          and(
            eq(specLinks.projectId, input.project.id),
            eq(specLinks.fromEntityId, input.task.entityId),
            inArray(specLinks.linkType, ["generated_from", "uses"])
          )
        )
    ]);
    const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
    const taskContext = deriveTaskContext(input.task, indexedLinks, entitiesById);
    const affectedSpecs = collectAffectedSpecs({
      project: input.project,
      changedFiles: input.changedFiles,
      entitiesById,
      sourceLinks,
      taskContext
    });
    const affectedEntityIds = affectedSpecs.map((spec) => spec.entityId);
    const readinessService = createSpecReadinessService(db);
    const [affectedValidationMessages, affectedReadiness] = await Promise.all([
      affectedEntityIds.length > 0
        ? db
            .select()
            .from(validationMessages)
            .where(
              and(
                eq(validationMessages.projectId, input.project.id),
                inArray(validationMessages.entityId, affectedEntityIds)
              )
            )
        : Promise.resolve([]),
      Promise.all(
        affectedSpecs.map((spec) => readinessService.getEntityReadiness(input.project.id, spec.entityId))
      )
    ]);
    const findings = collectFindings({
      project: input.project,
      task: input.task,
      changedFiles: input.changedFiles,
      sourceLinks,
      taskContext,
      affectedSpecs,
      validationMessages: affectedValidationMessages,
      readinessByEntityId: new Map(affectedReadiness.map((readiness) => [readiness.entityId, readiness])),
      gitComparisonUnavailable: input.gitComparisonUnavailable
    });

    return {
      changedFiles: input.changedFiles,
      affectedSpecs,
      taskContext,
      findings,
      suggestedValidationCommands: ["pnpm typecheck", "pnpm test"]
    };
  }

  return {
    startRun,
    listRuns,
    getRun,
    finishRun,
    updateRunStatus
  };
}

async function collectChangedPaths(
  repoPath: string,
  run: AgentRunRow,
  endGitCommit: string | null,
  endDirtyEntries: GitStatusEntry[]
): Promise<{ paths: string[]; gitComparisonUnavailable: boolean }> {
  const paths = new Set<string>();
  let gitComparisonUnavailable = false;

  if (run.startGitCommit && endGitCommit && run.startGitCommit !== endGitCommit) {
    try {
      for (const filePath of await readGitChangedFiles(repoPath, run.startGitCommit, endGitCommit)) {
        paths.add(normalizePath(filePath));
      }
    } catch {
      gitComparisonUnavailable = true;
    }
  }

  for (const entry of endDirtyEntries) {
    paths.add(normalizePath(entry.path));
    if (entry.originalPath) {
      paths.add(normalizePath(entry.originalPath));
    }
  }

  return {
    paths: [...paths].filter((filePath) => filePath.length > 0).sort(),
    gitComparisonUnavailable
  };
}

function classifyChangedFiles(project: ProjectRow, paths: string[]): AgentRunChangedFiles {
  const specopsPrefix = toRepoRelativeSpecopsPrefix(project);
  const grouped: AgentRunChangedFiles = {
    specs: [],
    source: [],
    tests: [],
    other: []
  };

  for (const filePath of paths.map(normalizePath)) {
    if (isSpecFile(filePath, specopsPrefix)) {
      grouped.specs.push(filePath);
      continue;
    }

    if (isSupportedSourcePath(filePath) && !shouldExcludePath(filePath)) {
      const classification = classifySourceFile(filePath);
      if (classification.kind === "test") {
        grouped.tests.push(filePath);
      } else {
        grouped.source.push(filePath);
      }
      continue;
    }

    grouped.other.push(filePath);
  }

  return sortChangedFiles(grouped);
}

function collectAffectedSpecs(input: {
  project: ProjectRow;
  changedFiles: AgentRunChangedFiles;
  entitiesById: Map<string, SpecEntityRow>;
  sourceLinks: Array<typeof sourceSpecLinks.$inferSelect>;
  taskContext: AgentRunReview["taskContext"];
}): AgentRunReview["affectedSpecs"] {
  const affected = new Map<string, AgentRunReview["affectedSpecs"][number]>();
  const specopsPrefix = toRepoRelativeSpecopsPrefix(input.project);
  const add = (entityId: string, reason: AffectedReason) => {
    const entity = input.entitiesById.get(entityId);
    if (!entity || affected.has(entityId)) {
      return;
    }

    affected.set(entityId, {
      entityId: entity.entityId,
      title: entity.title,
      type: entity.type,
      filePath: entity.filePath,
      reason
    });
  };

  for (const changedSpecFile of input.changedFiles.specs) {
    const entity = [...input.entitiesById.values()].find(
      (candidate) => candidate.filePath === stripSpecopsPrefix(changedSpecFile, specopsPrefix)
    );
    if (entity) {
      add(entity.entityId, "changed_spec");
    }
  }

  for (const sourceLink of input.sourceLinks) {
    add(sourceLink.entityId, "linked_source");
  }

  for (const entityId of input.taskContext.contextEntityIds) {
    add(entityId, "task_context");
  }

  return [...affected.values()].sort((left, right) => {
    const reasonRank = reasonRankFor(left.reason) - reasonRankFor(right.reason);
    return reasonRank === 0 ? left.entityId.localeCompare(right.entityId) : reasonRank;
  });
}

function collectFindings(input: {
  project: ProjectRow;
  task: SpecEntityRow;
  changedFiles: AgentRunChangedFiles;
  sourceLinks: Array<typeof sourceSpecLinks.$inferSelect>;
  taskContext: AgentRunReview["taskContext"];
  affectedSpecs: AgentRunReview["affectedSpecs"];
  validationMessages: Array<typeof validationMessages.$inferSelect>;
  readinessByEntityId: Map<string, EntityReadinessDto>;
  gitComparisonUnavailable: boolean;
}): AgentRunFinding[] {
  const findings: AgentRunFinding[] = [];
  const addFinding = (
    kind: AgentRunFinding["kind"],
    severity: AgentRunFindingSeverity,
    message: string,
    suggestedFollowUp: string,
    entityId: string | null,
    filePath: string | null
  ) => {
    const idBase = `${kind}:${entityId ?? filePath ?? "project"}`;
    findings.push({
      id: idBase,
      severity,
      kind,
      message,
      suggestedFollowUp,
      entityId,
      filePath
    });
  };

  if (input.gitComparisonUnavailable) {
    addFinding(
      "git_comparison_unavailable",
      "context",
      "Git comparison was unavailable for this run.",
      "Review the dirty file list and rerun from a clean Git state if needed.",
      null,
      null
    );
  }

  if (input.changedFiles.source.length > 0 && input.changedFiles.specs.length === 0) {
    addFinding(
      "source_changed_without_spec",
      "review",
      "Source files changed without a spec file update.",
      "Confirm the linked spec still reflects the implementation change.",
      null,
      null
    );
  }

  const linkedSourceFiles = new Set(input.sourceLinks.map((link) => link.filePath));
  for (const filePath of input.changedFiles.source) {
    if (!linkedSourceFiles.has(filePath)) {
      addFinding(
        "unlinked_source_changed",
        "context",
        `Source file ${filePath} changed without an indexed spec link.`,
        "Add a source-to-spec annotation or verify the change manually.",
        null,
        filePath
      );
    }
  }

  for (const entityId of input.taskContext.missingEntityIds) {
    addFinding(
      "task_context_missing",
      "context",
      `Task context entity ${entityId} is not indexed.`,
      "Update the task context links or create the missing spec entity.",
      entityId,
      null
    );
  }

  const changedAffectedContext = input.affectedSpecs.filter(
    (spec) => spec.reason === "changed_spec" && input.taskContext.contextEntityIds.includes(spec.entityId)
  );
  for (const spec of changedAffectedContext) {
    addFinding(
      "task_context_spec_changed",
      "review",
      `Task context spec ${spec.entityId} changed during the run.`,
      "Re-check the task output against the updated context spec.",
      spec.entityId,
      spec.filePath
    );
  }

  for (const message of input.validationMessages) {
    findings.push({
      id: `validation_warning:${message.entityId ?? message.filePath ?? "project"}:${message.id}`,
      severity: message.level === "error" ? "blocker" : "review",
      kind: "validation_warning",
      message: message.message,
      suggestedFollowUp: "Resolve the affected spec validation message before accepting this run.",
      entityId: message.entityId,
      filePath: message.filePath
    });
  }

  for (const spec of input.affectedSpecs) {
    const readiness = input.readinessByEntityId.get(spec.entityId);
    if (!readiness || readiness.readiness === "ready") {
      continue;
    }

    addFinding(
      "readiness_warning",
      readiness.readiness === "blocked" ? "blocker" : "review",
      `Affected spec ${spec.entityId} readiness is ${readiness.readiness}.`,
      "Resolve affected spec readiness checks before accepting this run.",
      spec.entityId,
      spec.filePath
    );
  }

  if (input.taskContext.sourceEntityId === null) {
    addFinding(
      "readiness_warning",
      "context",
      "The agent task has no source entity.",
      "Set source_entity on the agent task before accepting the run.",
      input.task.entityId,
      input.task.filePath
    );
  }

  if (input.changedFiles.source.length > 0 && input.changedFiles.tests.length === 0) {
    addFinding(
      "possible_missing_test_change",
      "review",
      "Source files changed without a test file update.",
      "Confirm existing tests cover the change or add focused coverage.",
      null,
      input.changedFiles.source[0] ?? null
    );
  }

  const specopsPrefix = toRepoRelativeSpecopsPrefix(input.project);
  const changedSpecEntityPaths = input.changedFiles.specs.map((filePath) =>
    stripSpecopsPrefix(filePath, specopsPrefix)
  );
  const taskFileChanged = changedSpecEntityPaths.includes(input.task.filePath);
  if (!taskFileChanged) {
    addFinding(
      "task_not_updated",
      "review",
      "The agent task markdown was not updated during the run.",
      "Update the task with review notes, validation results, or follow-up status.",
      input.task.entityId,
      input.task.filePath
    );
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function deriveTaskContext(
  task: SpecEntityRow,
  indexedLinks: Array<typeof specLinks.$inferSelect>,
  entitiesById: Map<string, SpecEntityRow>
): AgentRunReview["taskContext"] {
  const frontmatter = readRecord(task.frontmatterJson);
  const sourceEntityId = readString(frontmatter.source_entity);
  const contextEntityIds = mergeIds(
    sourceEntityId ? [sourceEntityId] : [],
    readFrontmatterLinkIds(frontmatter, "generated_from"),
    readFrontmatterLinkIds(frontmatter, "uses"),
    indexedLinks.map((link) => link.toEntityId),
    Object.keys(readTrackedSpecHashes(frontmatter.tracked_spec_hashes))
  );
  const missingEntityIds = contextEntityIds.filter((entityId) => !entitiesById.has(entityId));

  return {
    sourceEntityId,
    contextEntityIds,
    missingEntityIds
  };
}

function mapRunSummary(row: AgentRunRow, task: SpecEntityRow | undefined): AgentRunSummary {
  const changedFiles = readChangedFiles(row.changedFilesJson);
  const reviewSummary = readReviewSummary(row.reviewSummaryJson, changedFiles);

  return {
    id: row.id,
    projectId: row.projectId,
    taskEntityId: row.taskEntityId,
    taskTitle: task?.title ?? row.taskEntityId,
    taskFilePath: task?.filePath ?? row.taskEntityId,
    agent: row.agent,
    status: row.status as AgentRunStatus,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    startGitCommit: row.startGitCommit,
    endGitCommit: row.endGitCommit,
    changedFileCount: countChangedFiles(changedFiles),
    findingCounts: countFindings(reviewSummary.findings),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapRunDetail(row: AgentRunRow, task: SpecEntityRow | undefined): AgentRunDetail {
  const changedFiles = readChangedFiles(row.changedFilesJson);
  const reviewSummary = readReviewSummary(row.reviewSummaryJson, changedFiles);

  return {
    ...mapRunSummary(row, task),
    promptMarkdown: row.promptMarkdown,
    changedFiles,
    reviewSummary
  };
}

function readChangedFiles(value: unknown): AgentRunChangedFiles {
  const record = readRecord(value);
  return sortChangedFiles({
    specs: readStringArray(record.specs),
    source: readStringArray(record.source),
    tests: readStringArray(record.tests),
    other: readStringArray(record.other)
  });
}

function readReviewSummary(value: unknown, changedFiles: AgentRunChangedFiles): AgentRunReview {
  const record = readRecord(value);
  const fallback = { ...EMPTY_REVIEW, changedFiles };
  const taskContext = readRecord(record.taskContext);

  return {
    changedFiles: readChangedFiles(record.changedFiles ?? changedFiles),
    affectedSpecs: Array.isArray(record.affectedSpecs)
      ? record.affectedSpecs.filter(isAffectedSpec)
      : fallback.affectedSpecs,
    taskContext: {
      sourceEntityId: readString(taskContext.sourceEntityId),
      contextEntityIds: readStringArray(taskContext.contextEntityIds),
      missingEntityIds: readStringArray(taskContext.missingEntityIds)
    },
    findings: Array.isArray(record.findings) ? record.findings.filter(isFinding) : fallback.findings,
    suggestedValidationCommands: readStringArrayInOrder(record.suggestedValidationCommands)
  };
}

function countChangedFiles(changedFiles: AgentRunChangedFiles): number {
  return (
    changedFiles.specs.length +
    changedFiles.source.length +
    changedFiles.tests.length +
    changedFiles.other.length
  );
}

function countFindings(findings: AgentRunFinding[]): AgentRunSummary["findingCounts"] {
  const counts: AgentRunSummary["findingCounts"] = {
    blocker: 0,
    review: 0,
    context: 0,
    info: 0
  };

  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return counts;
}

function formatPromptMarkdown(task: SpecEntityRow): string {
  const frontmatter = readRecord(task.frontmatterJson);
  const frontmatterLines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${formatFrontmatterValue(value)}`
  );

  return ["---", ...frontmatterLines, "---", "", task.bodyMarkdown].join("\n");
}

function formatFrontmatterValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

function readStringArrayInOrder(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readFrontmatterLinkIds(frontmatter: Record<string, unknown>, linkType: string): string[] {
  const links = readRecord(frontmatter.links);
  const value = links[linkType];

  if (typeof value === "string") {
    return [value];
  }

  return readStringArray(value);
}

function readTrackedSpecHashes(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function mergeIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((item) => item.length > 0))].sort();
}

function isAffectedSpec(value: unknown): value is AgentRunReview["affectedSpecs"][number] {
  const record = readRecord(value);
  return (
    typeof record.entityId === "string" &&
    typeof record.title === "string" &&
    typeof record.type === "string" &&
    typeof record.filePath === "string" &&
    (record.reason === "changed_spec" ||
      record.reason === "linked_source" ||
      record.reason === "task_context")
  );
}

function isFinding(value: unknown): value is AgentRunFinding {
  const record = readRecord(value);
  return (
    typeof record.id === "string" &&
    isFindingSeverity(record.severity) &&
    typeof record.kind === "string" &&
    typeof record.message === "string" &&
    typeof record.suggestedFollowUp === "string" &&
    (typeof record.entityId === "string" || record.entityId === null) &&
    (typeof record.filePath === "string" || record.filePath === null)
  );
}

function isFindingSeverity(value: unknown): value is AgentRunFindingSeverity {
  return value === "blocker" || value === "review" || value === "context" || value === "info";
}

function sortChangedFiles(changedFiles: AgentRunChangedFiles): AgentRunChangedFiles {
  return {
    specs: [...new Set(changedFiles.specs)].sort(),
    source: [...new Set(changedFiles.source)].sort(),
    tests: [...new Set(changedFiles.tests)].sort(),
    other: [...new Set(changedFiles.other)].sort()
  };
}

function toRepoRelativeSpecopsPrefix(project: ProjectRow): string {
  const relativePath = path.relative(project.repoPath, project.specopsPath);
  return normalizePath(relativePath === "" ? "." : relativePath);
}

function isSpecFile(filePath: string, specopsPrefix: string): boolean {
  return (
    isUnderSpecopsPath(filePath, specopsPrefix) &&
    filePath.endsWith(".md") &&
    !filePath.endsWith(".template.md")
  );
}

function isUnderSpecopsPath(filePath: string, specopsPrefix: string): boolean {
  if (specopsPrefix === ".") {
    return true;
  }

  return filePath === specopsPrefix || filePath.startsWith(`${specopsPrefix}/`);
}

function stripSpecopsPrefix(filePath: string, specopsPrefix: string): string {
  if (specopsPrefix === ".") {
    return filePath;
  }

  return filePath.startsWith(`${specopsPrefix}/`) ? filePath.slice(specopsPrefix.length + 1) : filePath;
}

function reasonRankFor(reason: AffectedReason): number {
  if (reason === "changed_spec") return 0;
  if (reason === "linked_source") return 1;
  return 2;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
