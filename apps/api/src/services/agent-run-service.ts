import type {
  AgentRunDetail,
  AgentRunStatus,
  AgentRunSummary,
  StartAgentRunRequest,
  UpdateAgentRunStatusRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { agentRuns, projects, specEntities } from "@specops/db";
import { and, desc, eq } from "drizzle-orm";

import { BadRequestError, NotFoundError } from "../lib/http-errors.js";
import { readGitChangedFiles, readGitStatus, type GitStatusEntry } from "./git-service.js";
import {
  buildAgentRunReviewSummary,
  classifyChangedFiles,
  countChangedFiles,
  countFindings,
  EMPTY_CHANGED_FILES,
  EMPTY_REVIEW,
  normalizePath,
  readChangedFiles,
  readRecord,
  readReviewSummary
} from "./review-summary-service.js";

type AgentRunRow = typeof agentRuns.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;

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
      endStatus.isRepo,
      endStatus.headCommit,
      endStatus.entries
    );
    const changedFiles = classifyChangedFiles(project, comparison.paths);
    const reviewSummary = await buildAgentRunReviewSummary({
      db,
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
  endIsRepo: boolean,
  endGitCommit: string | null,
  endDirtyEntries: GitStatusEntry[]
): Promise<{ paths: string[]; gitComparisonUnavailable: boolean }> {
  const paths = new Set<string>();
  let gitComparisonUnavailable = !endIsRepo || !run.startGitCommit || !endGitCommit;

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
