import type {
  EntityReadinessDto,
  ProjectReadinessDto,
  SpecReadinessCheckDto,
  SpecReadinessCheckSeverity,
  SpecReadinessStatus,
  ValidationMessageDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  projects,
  sourceFiles,
  sourceSpecLinks,
  specEntities,
  specLinks,
  validationMessages
} from "@specops/db";
import { asc, eq } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import { createProjectHealthService } from "./project-health-service.js";

export type ReadinessLinkInput = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type ReadinessEntityInput = {
  entityId: string;
  title: string;
  type: string;
  status: string;
  filePath: string;
  frontmatterJson: unknown;
  bodyMarkdown: string;
  bodyText: string;
  validationMessages: ValidationMessageDto[];
  incomingLinks: ReadinessLinkInput[];
  outgoingLinks: ReadinessLinkInput[];
  allEntityIds: string[];
  entityTypesById: Record<string, string>;
  sourceBackedEntityIds: string[];
  hasSourceInventory: boolean;
  staleTaskEntityIds: string[];
};

type IndexedValidationMessage = typeof validationMessages.$inferSelect;

const severityRank: Record<SpecReadinessCheckSeverity, number> = {
  blocker: 0,
  review: 1,
  context: 2
};

const readinessRank: Record<SpecReadinessStatus, number> = {
  blocked: 0,
  needs_review: 1,
  needs_context: 2,
  ready: 3
};

const checkIdRank = [
  "entity_validation_error",
  "broken_outgoing_link",
  "agent_task_source_missing",
  "agent_task_stale",
  "body_too_short",
  "use_case_acceptance_criteria_missing",
  "use_case_goal_missing",
  "use_case_planning_link_missing",
  "model_isolated",
  "interface_context_missing",
  "interface_source_evidence_missing",
  "ui_view_context_missing",
  "ui_view_behavior_missing",
  "agent_task_validation_missing"
];

const planningLinkTargetTypes = new Set(["domain_entity", "interface", "ui_view", "data_model"]);

export function createSpecReadinessService(db: Db) {
  return {
    async getProjectReadiness(projectId: string): Promise<ProjectReadinessDto> {
      await assertProjectExists(db, projectId);
      const entities = await loadReadinessEntityInputs(db, projectId);
      return buildProjectReadiness(entities.map(buildEntityReadiness));
    },

    async getEntityReadiness(projectId: string, entityId: string): Promise<EntityReadinessDto> {
      await assertProjectExists(db, projectId);
      const entities = await loadReadinessEntityInputs(db, projectId);
      const entity = entities.find((item) => item.entityId === entityId);

      if (!entity) {
        throw new NotFoundError("Entity not found", { projectId, entityId });
      }

      return buildEntityReadiness(entity);
    }
  };
}

export function buildEntityReadiness(input: ReadinessEntityInput): EntityReadinessDto {
  const checks: SpecReadinessCheckDto[] = [
    ...allEntityChecks(input),
    ...typeSpecificChecks(input)
  ].sort(compareChecks);

  return {
    entityId: input.entityId,
    title: input.title,
    type: input.type,
    status: input.status,
    filePath: input.filePath,
    readiness: readinessFromChecks(checks),
    checks
  };
}

export function buildProjectReadiness(entities: EntityReadinessDto[]): ProjectReadinessDto {
  const summary = {
    ready: 0,
    needsContext: 0,
    needsReview: 0,
    blocked: 0
  };

  for (const entity of entities) {
    if (entity.readiness === "ready") summary.ready += 1;
    if (entity.readiness === "needs_context") summary.needsContext += 1;
    if (entity.readiness === "needs_review") summary.needsReview += 1;
    if (entity.readiness === "blocked") summary.blocked += 1;
  }

  return {
    summary,
    queue: entities
      .filter((entity) => entity.readiness !== "ready")
      .map((entity) => ({
        entityId: entity.entityId,
        title: entity.title,
        type: entity.type,
        status: entity.status,
        filePath: entity.filePath,
        readiness: entity.readiness,
        highestSeverity: highestSeverity(entity.checks),
        failedCheckCount: entity.checks.length,
        topChecks: entity.checks.slice(0, 3)
      }))
      .sort((left, right) => {
        const severity = readinessRank[left.readiness] - readinessRank[right.readiness];
        if (severity !== 0) return severity;
        const type = left.type.localeCompare(right.type);
        return type === 0 ? left.entityId.localeCompare(right.entityId) : type;
      })
  };
}

async function assertProjectExists(db: Pick<Db, "select">, projectId: string): Promise<void> {
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);

  if (!project) {
    throw new NotFoundError("Project not found", { projectId });
  }
}

async function loadReadinessEntityInputs(db: Db, projectId: string): Promise<ReadinessEntityInput[]> {
  const [entityRows, linkRows, validationRows, sourceEvidenceRows, sourceFileRows, staleTaskEntityIds] =
    await Promise.all([
      db.select().from(specEntities).where(eq(specEntities.projectId, projectId)).orderBy(asc(specEntities.entityId)),
      db
        .select()
        .from(specLinks)
        .where(eq(specLinks.projectId, projectId))
        .orderBy(
          asc(specLinks.fromEntityId),
          asc(specLinks.toEntityId),
          asc(specLinks.linkType),
          asc(specLinks.source)
        ),
      db
        .select()
        .from(validationMessages)
        .where(eq(validationMessages.projectId, projectId))
        .orderBy(
          asc(validationMessages.entityId),
          asc(validationMessages.level),
          asc(validationMessages.code),
          asc(validationMessages.id)
        ),
      db
        .select({ entityId: sourceSpecLinks.entityId })
        .from(sourceSpecLinks)
        .where(eq(sourceSpecLinks.projectId, projectId))
        .orderBy(asc(sourceSpecLinks.entityId)),
      db.select({ id: sourceFiles.id }).from(sourceFiles).where(eq(sourceFiles.projectId, projectId)).limit(1),
      loadStaleTaskEntityIds(db, projectId)
    ]);

  const allEntityIds = entityRows.map((entity) => entity.entityId);
  const entityTypesById = Object.fromEntries(entityRows.map((entity) => [entity.entityId, entity.type]));
  const sourceBackedEntityIds = [...new Set(sourceEvidenceRows.map((row) => row.entityId))].sort();
  const validationByEntityId = groupValidationByEntityId(validationRows);
  const incomingLinksByEntityId = groupLinks(linkRows, "toEntityId");
  const outgoingLinksByEntityId = groupLinks(linkRows, "fromEntityId");

  return entityRows.map((entity) => ({
    entityId: entity.entityId,
    title: entity.title,
    type: entity.type,
    status: entity.status,
    filePath: entity.filePath,
    frontmatterJson: entity.frontmatterJson,
    bodyMarkdown: entity.bodyMarkdown,
    bodyText: entity.bodyText,
    validationMessages: validationByEntityId.get(entity.entityId) ?? [],
    incomingLinks: incomingLinksByEntityId.get(entity.entityId) ?? [],
    outgoingLinks: outgoingLinksByEntityId.get(entity.entityId) ?? [],
    allEntityIds,
    entityTypesById,
    sourceBackedEntityIds,
    hasSourceInventory: sourceFileRows.length > 0,
    staleTaskEntityIds
  }));
}

async function loadStaleTaskEntityIds(db: Db, projectId: string): Promise<string[]> {
  try {
    const health = await createProjectHealthService(db).getProjectHealth(projectId);
    return health.staleTasks.samples.map((task) => task.entityId).sort();
  } catch {
    return [];
  }
}

function groupValidationByEntityId(rows: IndexedValidationMessage[]): Map<string, ValidationMessageDto[]> {
  const result = new Map<string, ValidationMessageDto[]>();

  for (const row of rows) {
    if (!row.entityId) continue;
    const messages = result.get(row.entityId) ?? [];
    messages.push(mapValidationMessage(row));
    result.set(row.entityId, messages);
  }

  return result;
}

function groupLinks(
  rows: (typeof specLinks.$inferSelect)[],
  key: "fromEntityId" | "toEntityId"
): Map<string, ReadinessLinkInput[]> {
  const result = new Map<string, ReadinessLinkInput[]>();

  for (const row of rows) {
    const links = result.get(row[key]) ?? [];
    links.push({
      id: row.id,
      fromEntityId: row.fromEntityId,
      toEntityId: row.toEntityId,
      linkType: row.linkType,
      source: row.source
    });
    result.set(row[key], links);
  }

  return result;
}

function allEntityChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  const knownEntityIds = entityIdSet(input);
  const checks: SpecReadinessCheckDto[] = [];

  for (const message of input.validationMessages.filter((item) => item.level === "error")) {
    checks.push({
      id: `entity_validation_error:${message.code}:${message.id}`,
      severity: "blocker",
      label: "Validation error",
      detail: message.message,
      suggestedFix: "Resolve the validation error and re-index the project.",
      relatedEntityId: message.entityId,
      filePath: message.filePath
    });
  }

  for (const link of input.outgoingLinks.filter((item) => !knownEntityIds.has(item.toEntityId))) {
    checks.push({
      id: `broken_outgoing_link:${link.toEntityId}:${link.linkType}`,
      severity: "blocker",
      label: "Broken outgoing link",
      detail: `${input.entityId} links to missing entity ${link.toEntityId}.`,
      suggestedFix: "Update the link target or add the missing spec entity.",
      relatedEntityId: link.toEntityId,
      filePath: input.filePath
    });
  }

  if (input.bodyText.trim().length < 80) {
    checks.push({
      id: "body_too_short",
      severity: "context",
      label: "Body is too short",
      detail: "The indexed body text is too short to provide useful implementation context.",
      suggestedFix: "Add concise goals, constraints, behavior, or decisions to the spec body.",
      relatedEntityId: null,
      filePath: input.filePath
    });
  }

  return checks;
}

function typeSpecificChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  if (input.type === "use_case") return useCaseChecks(input);
  if (input.type === "domain_entity" || input.type === "data_model") return modelChecks(input);
  if (input.type === "interface") return interfaceChecks(input);
  if (input.type === "ui_view") return uiViewChecks(input);
  if (input.type === "agent_task") return agentTaskChecks(input);
  return [];
}

function useCaseChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  const knownEntityIds = entityIdSet(input);
  const sourceBackedEntityIds = sourceBackedEntityIdSet(input);
  const checks: SpecReadinessCheckDto[] = [];

  if (!hasMarkdownHeading(input.bodyMarkdown, ["acceptance criteria"])) {
    checks.push(contextCheck(input, "use_case_acceptance_criteria_missing", "Acceptance criteria missing"));
  }

  if (!hasMarkdownHeading(input.bodyMarkdown, ["goal", "objective", "problem", "intent"])) {
    checks.push(contextCheck(input, "use_case_goal_missing", "Goal heading missing"));
  }

  const hasPlanningLink = input.outgoingLinks.some((link) => {
    if (!knownEntityIds.has(link.toEntityId)) return false;
    return (
      planningLinkTargetTypes.has(input.entityTypesById[link.toEntityId] ?? "") ||
      sourceBackedEntityIds.has(link.toEntityId)
    );
  });

  if (!hasPlanningLink) {
    checks.push(contextCheck(input, "use_case_planning_link_missing", "Planning link missing"));
  }

  return checks;
}

function modelChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  if (input.allEntityIds.length <= 1 || input.incomingLinks.length > 0 || input.outgoingLinks.length > 0) {
    return [];
  }

  return [contextCheck(input, "model_isolated", "Model is isolated")];
}

function interfaceChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  const hasSourceEvidence = sourceBackedEntityIdSet(input).has(input.entityId);
  const checks: SpecReadinessCheckDto[] = [];

  if (!hasValidLinkedSpecs(input) && !hasSourceEvidence) {
    checks.push(contextCheck(input, "interface_context_missing", "Interface context missing"));
  }

  if (input.hasSourceInventory && !hasSourceEvidence) {
    checks.push(contextCheck(input, "interface_source_evidence_missing", "Interface source evidence missing"));
  }

  return checks;
}

function uiViewChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  const checks: SpecReadinessCheckDto[] = [];
  const hasUseCaseOrInterfaceLink = [...input.incomingLinks, ...input.outgoingLinks].some((link) => {
    const otherEntityId = link.fromEntityId === input.entityId ? link.toEntityId : link.fromEntityId;
    const otherType = input.entityTypesById[otherEntityId];
    return otherType === "use_case" || otherType === "interface";
  });

  if (!hasUseCaseOrInterfaceLink) {
    checks.push(contextCheck(input, "ui_view_context_missing", "UI view context missing"));
  }

  if (!hasMarkdownHeading(input.bodyMarkdown, ["behavior", "states", "interactions", "acceptance criteria"])) {
    checks.push(contextCheck(input, "ui_view_behavior_missing", "UI behavior heading missing"));
  }

  return checks;
}

function agentTaskChecks(input: ReadinessEntityInput): SpecReadinessCheckDto[] {
  const knownEntityIds = entityIdSet(input);
  const sourceEntityId = readSourceEntityId(input);
  const checks: SpecReadinessCheckDto[] = [];

  if (!sourceEntityId || !knownEntityIds.has(sourceEntityId)) {
    checks.push({
      id: "agent_task_source_missing",
      severity: "blocker",
      label: "Agent task source missing",
      detail: sourceEntityId
        ? `The task references missing source entity ${sourceEntityId}.`
        : "The task does not declare a source entity.",
      suggestedFix: "Set frontmatter source_entity or add an outgoing generated_from link to an indexed spec entity.",
      relatedEntityId: sourceEntityId,
      filePath: input.filePath
    });
  }

  if (!hasValidationCommandSignal(input.bodyText) && !hasValidationCommandSignal(input.bodyMarkdown)) {
    checks.push(contextCheck(input, "agent_task_validation_missing", "Validation signal missing"));
  }

  if (new Set(input.staleTaskEntityIds).has(input.entityId)) {
    checks.push({
      id: "agent_task_stale",
      severity: "review",
      label: "Agent task may be stale",
      detail: "Project health indicates this task may need to be refreshed.",
      suggestedFix: "Review the task against its source and context specs before implementation.",
      relatedEntityId: null,
      filePath: input.filePath
    });
  }

  return checks;
}

function readSourceEntityId(input: ReadinessEntityInput): string | null {
  const frontmatter = readObject(input.frontmatterJson);
  const declaredSource = readString(frontmatter.source_entity);
  if (declaredSource) return declaredSource;

  const generatedFromLink = input.outgoingLinks
    .filter((link) => link.linkType === "generated_from")
    .sort(compareLinks)[0];
  return generatedFromLink?.toEntityId ?? null;
}

function hasValidLinkedSpecs(input: ReadinessEntityInput): boolean {
  const knownEntityIds = entityIdSet(input);
  return [...input.incomingLinks, ...input.outgoingLinks].some(
    (link) => knownEntityIds.has(link.fromEntityId) && knownEntityIds.has(link.toEntityId)
  );
}

function hasMarkdownHeading(markdown: string, headings: string[]): boolean {
  return markdown
    .split(/\r?\n/)
    .some((line) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
      if (!match) return false;
      const heading = normalizeHeading(match[2] ?? "");
      return headings.some((candidate) => heading === candidate);
    });
}

function normalizeHeading(value: string): string {
  return value
    .replace(/[`*_~[\]()]/g, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function hasValidationCommandSignal(value: string): boolean {
  return /\b(pnpm|npm|yarn|vitest|jest|pytest|go test|cargo test|gradle test|mvn test|make test)\b/i.test(value);
}

function contextCheck(input: ReadinessEntityInput, id: string, label: string): SpecReadinessCheckDto {
  return {
    id,
    severity: "context",
    label,
    detail: `${input.entityId} is missing context needed for confident implementation.`,
    suggestedFix: "Add the missing context or link this spec to supporting specs/source evidence.",
    relatedEntityId: null,
    filePath: input.filePath
  };
}

function readinessFromChecks(checks: SpecReadinessCheckDto[]): SpecReadinessStatus {
  if (checks.some((check) => check.severity === "blocker")) return "blocked";
  if (checks.some((check) => check.severity === "review")) return "needs_review";
  if (checks.some((check) => check.severity === "context")) return "needs_context";
  return "ready";
}

function highestSeverity(checks: SpecReadinessCheckDto[]): SpecReadinessCheckSeverity | null {
  return checks.slice().sort(compareChecks)[0]?.severity ?? null;
}

function compareChecks(left: SpecReadinessCheckDto, right: SpecReadinessCheckDto): number {
  const severity = severityRank[left.severity] - severityRank[right.severity];
  if (severity !== 0) return severity;
  const category = checkCategoryRank(left.id) - checkCategoryRank(right.id);
  return category === 0 ? left.id.localeCompare(right.id) : category;
}

function checkCategoryRank(id: string): number {
  const index = checkIdRank.findIndex((prefix) => id === prefix || id.startsWith(`${prefix}:`));
  return index === -1 ? checkIdRank.length : index;
}

function compareLinks(left: ReadinessLinkInput, right: ReadinessLinkInput): number {
  const from = left.fromEntityId.localeCompare(right.fromEntityId);
  if (from !== 0) return from;
  const to = left.toEntityId.localeCompare(right.toEntityId);
  if (to !== 0) return to;
  const type = left.linkType.localeCompare(right.linkType);
  return type === 0 ? left.source.localeCompare(right.source) : type;
}

function entityIdSet(input: ReadinessEntityInput): Set<string> {
  return new Set(input.allEntityIds);
}

function sourceBackedEntityIdSet(input: ReadinessEntityInput): Set<string> {
  return new Set(input.sourceBackedEntityIds);
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function mapValidationMessage(row: IndexedValidationMessage): ValidationMessageDto {
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
