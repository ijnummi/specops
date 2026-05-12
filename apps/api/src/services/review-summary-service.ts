import path from "node:path";

import type {
  AgentRunChangedFiles,
  AgentRunFinding,
  AgentRunFindingSeverity,
  AgentRunReview,
  AgentRunSummary,
  DiffReviewAffectedSpec,
  DiffReviewChangedFiles,
  DiffReviewFinding,
  DiffReviewFindingSeverity,
  DiffReviewRelatedTask,
  DiffReviewSummary,
  ProjectReadinessQueueItemDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { projects, sourceSpecLinks, specEntities, specLinks, validationMessages } from "@specops/db";
import { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "@specops/repo-scanner";
import { and, eq, inArray } from "drizzle-orm";

import { readValidationCommands } from "./agent-task-defaults.js";
import { createSpecReadinessService } from "./spec-readiness-service.js";

type ProjectRow = typeof projects.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;
type SourceSpecLinkRow = typeof sourceSpecLinks.$inferSelect;
type SpecLinkRow = typeof specLinks.$inferSelect;
type ValidationMessageRow = typeof validationMessages.$inferSelect;

type AffectedReason = AgentRunReview["affectedSpecs"][number]["reason"];
type DiffAffectedReason = DiffReviewAffectedSpec["reason"];
type DiffRelatedTaskReason = DiffReviewRelatedTask["reason"];

export const EMPTY_CHANGED_FILES: AgentRunChangedFiles = {
  specs: [],
  source: [],
  tests: [],
  other: []
};

export const EMPTY_REVIEW: AgentRunReview = {
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

export const EMPTY_DIFF_REVIEW_SUMMARY: DiffReviewSummary = {
  changedFiles: EMPTY_CHANGED_FILES,
  affectedSpecs: [],
  relatedTasks: [],
  findings: [],
  suggestedValidationCommands: []
};

export async function buildAgentRunReviewSummary(input: {
  db: Db;
  project: ProjectRow;
  task: SpecEntityRow;
  changedFiles: AgentRunChangedFiles;
  gitComparisonUnavailable: boolean;
}): Promise<AgentRunReview> {
  const [entities, sourceLinks, indexedLinks] = await Promise.all([
    input.db.select().from(specEntities).where(eq(specEntities.projectId, input.project.id)),
    input.changedFiles.source.length > 0
      ? input.db
          .select()
          .from(sourceSpecLinks)
          .where(
            and(
              eq(sourceSpecLinks.projectId, input.project.id),
              inArray(sourceSpecLinks.filePath, input.changedFiles.source)
            )
          )
      : Promise.resolve([]),
    input.db
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
  const commonInputs = await loadCommonReviewInputs({
    db: input.db,
    project: input.project,
    affectedEntityIds
  });
  const findings = collectAgentRunFindings({
    project: input.project,
    task: input.task,
    changedFiles: input.changedFiles,
    sourceLinks,
    taskContext,
    affectedSpecs,
    validationMessages: commonInputs.validationMessages,
    readinessByEntityId: commonInputs.readinessByEntityId,
    gitComparisonUnavailable: input.gitComparisonUnavailable
  });

  return {
    changedFiles: input.changedFiles,
    affectedSpecs,
    taskContext,
    findings,
    suggestedValidationCommands: commonInputs.suggestedValidationCommands
  };
}

export async function buildDiffReviewSummary(input: {
  db: Db;
  project: ProjectRow;
  changedFiles: DiffReviewChangedFiles;
  gitComparisonUnavailable: boolean;
}): Promise<DiffReviewSummary> {
  const [entities, sourceLinks, taskLinks] = await Promise.all([
    input.db.select().from(specEntities).where(eq(specEntities.projectId, input.project.id)),
    input.changedFiles.source.length > 0
      ? input.db
          .select()
          .from(sourceSpecLinks)
          .where(
            and(
              eq(sourceSpecLinks.projectId, input.project.id),
              inArray(sourceSpecLinks.filePath, input.changedFiles.source)
            )
          )
      : Promise.resolve([]),
    input.db
      .select()
      .from(specLinks)
      .where(
        and(
          eq(specLinks.projectId, input.project.id),
          inArray(specLinks.linkType, ["generated_from", "uses"])
        )
      )
  ]);
  const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const affectedSpecs = collectDiffAffectedSpecs({
    project: input.project,
    changedFiles: input.changedFiles,
    entitiesById,
    sourceLinks
  });
  const relatedTasks = collectDiffRelatedTasks({
    project: input.project,
    changedFiles: input.changedFiles,
    entitiesById,
    affectedSpecs,
    taskLinks
  });
  const commonInputs = await loadCommonReviewInputs({
    db: input.db,
    project: input.project,
    affectedEntityIds: affectedSpecs.map((spec) => spec.entityId)
  });
  const findings = collectDiffReviewFindings({
    changedFiles: input.changedFiles,
    sourceLinks,
    affectedSpecs,
    relatedTasks,
    taskLinks,
    validationMessages: commonInputs.validationMessages,
    readinessByEntityId: commonInputs.readinessByEntityId,
    gitComparisonUnavailable: input.gitComparisonUnavailable
  });

  return {
    changedFiles: input.changedFiles,
    affectedSpecs,
    relatedTasks,
    findings,
    suggestedValidationCommands: commonInputs.suggestedValidationCommands
  };
}

export async function loadCommonReviewInputs(input: {
  db: Db;
  project: ProjectRow;
  affectedEntityIds: string[];
}): Promise<{
  validationMessages: ValidationMessageRow[];
  readinessByEntityId: Map<string, ProjectReadinessQueueItemDto>;
  suggestedValidationCommands: string[];
}> {
  const readinessService = createSpecReadinessService(input.db);
  const [affectedValidationMessages, affectedReadiness, suggestedValidationCommands] =
    await Promise.all([
      input.affectedEntityIds.length > 0
        ? input.db
            .select()
            .from(validationMessages)
            .where(
              and(
                eq(validationMessages.projectId, input.project.id),
                inArray(validationMessages.entityId, input.affectedEntityIds)
              )
            )
        : Promise.resolve([]),
      readinessService.getProjectReadiness(input.project.id),
      readValidationCommands(input.project)
    ]);

  return {
    validationMessages: affectedValidationMessages,
    readinessByEntityId: new Map(
      affectedReadiness.queue.map((readiness) => [readiness.entityId, readiness])
    ),
    suggestedValidationCommands
  };
}

export function classifyChangedFiles(project: ProjectRow, paths: string[]): AgentRunChangedFiles {
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

export function readChangedFiles(value: unknown): AgentRunChangedFiles {
  const record = readRecord(value);
  return sortChangedFiles({
    specs: readStringArray(record.specs),
    source: readStringArray(record.source),
    tests: readStringArray(record.tests),
    other: readStringArray(record.other)
  });
}

export function readReviewSummary(
  value: unknown,
  changedFiles: AgentRunChangedFiles
): AgentRunReview {
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

export function readDiffReviewSummary(
  value: unknown,
  changedFiles: DiffReviewChangedFiles
): DiffReviewSummary {
  const record = readRecord(value);

  return {
    changedFiles: readChangedFiles(record.changedFiles ?? changedFiles),
    affectedSpecs: Array.isArray(record.affectedSpecs)
      ? record.affectedSpecs.filter(isDiffAffectedSpec)
      : [],
    relatedTasks: Array.isArray(record.relatedTasks)
      ? record.relatedTasks.filter(isDiffRelatedTask)
      : [],
    findings: Array.isArray(record.findings)
      ? record.findings.filter(isDiffFinding)
      : [],
    suggestedValidationCommands: readStringArrayInOrder(record.suggestedValidationCommands)
  };
}

export function countChangedFiles(changedFiles: AgentRunChangedFiles): number {
  return (
    changedFiles.specs.length +
    changedFiles.source.length +
    changedFiles.tests.length +
    changedFiles.other.length
  );
}

export function countFindings(findings: AgentRunFinding[]): AgentRunSummary["findingCounts"] {
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

export function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

export function readStringArrayInOrder(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readFrontmatterLinkIds(
  frontmatter: Record<string, unknown>,
  linkType: string
): string[] {
  const links = readRecord(frontmatter.links);
  const value = links[linkType];

  if (typeof value === "string") {
    return [value];
  }

  return readStringArray(value);
}

export function readTrackedSpecHashes(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function mergeIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((item) => item.length > 0))].sort();
}

export function sortChangedFiles(changedFiles: AgentRunChangedFiles): AgentRunChangedFiles {
  return {
    specs: [...new Set(changedFiles.specs)].sort(),
    source: [...new Set(changedFiles.source)].sort(),
    tests: [...new Set(changedFiles.tests)].sort(),
    other: [...new Set(changedFiles.other)].sort()
  };
}

export function toRepoRelativeSpecopsPrefix(project: ProjectRow): string {
  const relativePath = path.relative(project.repoPath, project.specopsPath);
  return normalizePath(relativePath === "" ? "." : relativePath);
}

export function stripSpecopsPrefix(filePath: string, specopsPrefix: string): string {
  if (specopsPrefix === ".") {
    return filePath;
  }

  return filePath.startsWith(`${specopsPrefix}/`) ? filePath.slice(specopsPrefix.length + 1) : filePath;
}

export function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function collectAffectedSpecs(input: {
  project: ProjectRow;
  changedFiles: AgentRunChangedFiles;
  entitiesById: Map<string, SpecEntityRow>;
  sourceLinks: SourceSpecLinkRow[];
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

function collectDiffAffectedSpecs(input: {
  project: ProjectRow;
  changedFiles: DiffReviewChangedFiles;
  entitiesById: Map<string, SpecEntityRow>;
  sourceLinks: SourceSpecLinkRow[];
}): DiffReviewAffectedSpec[] {
  const affected = new Map<string, DiffReviewAffectedSpec>();
  const specopsPrefix = toRepoRelativeSpecopsPrefix(input.project);
  const entitiesByFilePath = new Map(
    [...input.entitiesById.values()].map((entity) => [entity.filePath, entity])
  );
  const add = (entityId: string, reason: DiffAffectedReason) => {
    const entity = input.entitiesById.get(entityId);
    if (!entity) {
      return;
    }

    const existing = affected.get(entity.entityId);
    if (existing && diffAffectedReasonRankFor(existing.reason) <= diffAffectedReasonRankFor(reason)) {
      return;
    }

    affected.set(entity.entityId, {
      entityId: entity.entityId,
      title: entity.title,
      type: entity.type,
      filePath: entity.filePath,
      reason
    });
  };

  for (const changedSpecFile of input.changedFiles.specs) {
    const entity = entitiesByFilePath.get(stripSpecopsPrefix(changedSpecFile, specopsPrefix));
    if (entity) {
      add(entity.entityId, "changed_spec");
    }
  }

  for (const sourceLink of input.sourceLinks) {
    add(sourceLink.entityId, "linked_source");
  }

  return [...affected.values()].sort((left, right) => {
    const reasonRank = diffAffectedReasonRankFor(left.reason) - diffAffectedReasonRankFor(right.reason);
    return reasonRank === 0 ? left.entityId.localeCompare(right.entityId) : reasonRank;
  });
}

function collectDiffRelatedTasks(input: {
  project: ProjectRow;
  changedFiles: DiffReviewChangedFiles;
  entitiesById: Map<string, SpecEntityRow>;
  affectedSpecs: DiffReviewAffectedSpec[];
  taskLinks: SpecLinkRow[];
}): DiffReviewRelatedTask[] {
  const related = new Map<string, DiffReviewRelatedTask>();
  const affectedEntityIds = new Set(input.affectedSpecs.map((spec) => spec.entityId));
  const specopsPrefix = toRepoRelativeSpecopsPrefix(input.project);
  const changedTaskPaths = new Set(
    input.changedFiles.specs.map((filePath) => stripSpecopsPrefix(filePath, specopsPrefix))
  );
  const add = (task: SpecEntityRow, reason: DiffRelatedTaskReason) => {
    related.set(`${task.entityId}:${reason}`, {
      entityId: task.entityId,
      title: task.title,
      status: task.status,
      filePath: task.filePath,
      reason
    });
  };

  for (const link of input.taskLinks) {
    if (!affectedEntityIds.has(link.toEntityId)) {
      continue;
    }

    const task = input.entitiesById.get(link.fromEntityId);
    if (task?.type === "agent_task") {
      add(task, link.linkType as DiffRelatedTaskReason);
    }
  }

  for (const entity of input.entitiesById.values()) {
    if (entity.type === "agent_task" && changedTaskPaths.has(entity.filePath)) {
      add(entity, "changed_task");
    }
  }

  return [...related.values()].sort((left, right) => {
    const entityRank = left.entityId.localeCompare(right.entityId);
    return entityRank === 0 ? left.reason.localeCompare(right.reason) : entityRank;
  });
}

function collectAgentRunFindings(input: {
  project: ProjectRow;
  task: SpecEntityRow;
  changedFiles: AgentRunChangedFiles;
  sourceLinks: SourceSpecLinkRow[];
  taskContext: AgentRunReview["taskContext"];
  affectedSpecs: AgentRunReview["affectedSpecs"];
  validationMessages: ValidationMessageRow[];
  readinessByEntityId: Map<string, ProjectReadinessQueueItemDto>;
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
      "info",
      "Git comparison was unavailable for this run.",
      "Review the dirty file list and rerun from a clean Git state if needed.",
      null,
      null
    );
  }

  if (
    input.changedFiles.source.length > 0 &&
    input.sourceLinks.length > 0 &&
    input.changedFiles.specs.length === 0
  ) {
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

function collectDiffReviewFindings(input: {
  changedFiles: DiffReviewChangedFiles;
  sourceLinks: SourceSpecLinkRow[];
  affectedSpecs: DiffReviewAffectedSpec[];
  relatedTasks: DiffReviewRelatedTask[];
  taskLinks: SpecLinkRow[];
  validationMessages: ValidationMessageRow[];
  readinessByEntityId: Map<string, ProjectReadinessQueueItemDto>;
  gitComparisonUnavailable: boolean;
}): DiffReviewFinding[] {
  const findings: DiffReviewFinding[] = [];
  const addFinding = (
    kind: DiffReviewFinding["kind"],
    severity: DiffReviewFindingSeverity,
    message: string,
    suggestedFollowUp: string,
    entityId: string | null,
    filePath: string | null
  ) => {
    findings.push({
      id: `${kind}:${entityId ?? filePath ?? "project"}`,
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
      "info",
      "Git comparison was unavailable for this diff review.",
      "Review the changed file list manually before accepting this review.",
      null,
      null
    );
  }

  if (
    input.changedFiles.source.length > 0 &&
    input.sourceLinks.length > 0 &&
    input.changedFiles.specs.length === 0
  ) {
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

  const relatedTaskIds = new Set(input.relatedTasks.map((task) => task.entityId));
  const taskLinkedSpecIds = new Set(
    input.taskLinks
      .filter(
        (link) =>
          relatedTaskIds.has(link.fromEntityId) &&
          (link.linkType === "generated_from" || link.linkType === "uses")
      )
      .map((link) => link.toEntityId)
  );
  for (const spec of input.affectedSpecs.filter((item) => item.reason === "changed_spec")) {
    if (spec.type === "agent_task") {
      continue;
    }

    if (!taskLinkedSpecIds.has(spec.entityId)) {
      addFinding(
        "changed_spec_has_no_task",
        "review",
        `Changed spec ${spec.entityId} has no related agent task.`,
        "Create or update an agent task that tracks this spec change.",
        spec.entityId,
        spec.filePath
      );
    }
  }

  const staleTaskIds = new Set<string>();
  for (const task of input.relatedTasks.filter((item) => item.reason !== "changed_task")) {
    if (staleTaskIds.has(task.entityId)) {
      continue;
    }
    staleTaskIds.add(task.entityId);
    addFinding(
      "related_task_may_be_stale",
      "review",
      `Related task ${task.entityId} may be stale after this diff.`,
      "Review the task against the affected specs before accepting this review.",
      task.entityId,
      task.filePath
    );
  }

  for (const message of input.validationMessages) {
    findings.push({
      id: `validation_warning:${message.entityId ?? message.filePath ?? "project"}:${message.id}`,
      severity: message.level === "error" ? "blocker" : "review",
      kind: "validation_warning",
      message: message.message,
      suggestedFollowUp: "Resolve the affected spec validation message before accepting this review.",
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
      "Resolve affected spec readiness checks before accepting this review.",
      spec.entityId,
      spec.filePath
    );
  }

  return findings.sort(compareDiffFindings);
}

function deriveTaskContext(
  task: SpecEntityRow,
  indexedLinks: SpecLinkRow[],
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

function isDiffAffectedSpec(value: unknown): value is DiffReviewAffectedSpec {
  const record = readRecord(value);
  return (
    typeof record.entityId === "string" &&
    typeof record.title === "string" &&
    typeof record.type === "string" &&
    typeof record.filePath === "string" &&
    (record.reason === "changed_spec" || record.reason === "linked_source")
  );
}

function isDiffRelatedTask(value: unknown): value is DiffReviewRelatedTask {
  const record = readRecord(value);
  return (
    typeof record.entityId === "string" &&
    typeof record.title === "string" &&
    typeof record.status === "string" &&
    typeof record.filePath === "string" &&
    (record.reason === "generated_from" ||
      record.reason === "uses" ||
      record.reason === "changed_task")
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

function isDiffFinding(value: unknown): value is DiffReviewFinding {
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

function reasonRankFor(reason: AffectedReason): number {
  if (reason === "changed_spec") return 0;
  if (reason === "linked_source") return 1;
  return 2;
}

function diffAffectedReasonRankFor(reason: DiffAffectedReason): number {
  return reason === "changed_spec" ? 0 : 1;
}

function diffFindingSeverityRankFor(severity: DiffReviewFindingSeverity): number {
  if (severity === "blocker") return 0;
  if (severity === "review") return 1;
  if (severity === "context") return 2;
  return 3;
}

function compareDiffFindings(left: DiffReviewFinding, right: DiffReviewFinding): number {
  return (
    diffFindingSeverityRankFor(left.severity) - diffFindingSeverityRankFor(right.severity) ||
    left.kind.localeCompare(right.kind) ||
    (left.entityId ?? "").localeCompare(right.entityId ?? "") ||
    (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
    left.message.localeCompare(right.message) ||
    left.id.localeCompare(right.id)
  );
}
