import type {
  ChangeImpactDirection,
  ChangeImpactPreviewResponseDto,
  ChangeImpactSpecSummaryDto,
  EntityImpactQuery,
  EntityImpactResponseDto,
  ImpactEntitySummaryDto,
  ValidationMessageDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { specEntities, specLinks, validationMessages } from "@specops/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { createImpactService } from "./impact-service.js";

type RelatedTaskLink = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
};

const relatedTaskLinkTypes = ["generated_from", "uses"];
const validationLevelRank: Record<ValidationMessageDto["level"], number> = {
  error: 0,
  warning: 1,
  info: 2
};

export function createChangeImpactPreviewService(db: Db) {
  const impactService = createImpactService(db);

  return {
    async getChangeImpactPreview(input: {
      projectId: string;
      entityId: string;
      query: EntityImpactQuery;
    }): Promise<ChangeImpactPreviewResponseDto> {
      const impact = await impactService.getEntityImpact({
        projectId: input.projectId,
        entityId: input.entityId,
        depth: input.query.depth,
        direction: input.query.direction,
        includeSource: input.query.includeSource
      });
      const impactedEntityIds = specEntityIds(impact);

      const validationRows = await db
        .select()
        .from(validationMessages)
        .where(eq(validationMessages.projectId, input.projectId))
        .orderBy(
          asc(validationMessages.level),
          asc(validationMessages.entityId),
          asc(validationMessages.filePath),
          asc(validationMessages.message)
        );

      const relatedTaskLinks =
        impactedEntityIds.length === 0
          ? []
          : await db
              .select({
                fromEntityId: specLinks.fromEntityId,
                toEntityId: specLinks.toEntityId,
                linkType: specLinks.linkType
              })
              .from(specLinks)
              .where(
                and(
                  eq(specLinks.projectId, input.projectId),
                  inArray(specLinks.linkType, relatedTaskLinkTypes),
                  inArray(specLinks.toEntityId, impactedEntityIds)
                )
              )
              .orderBy(asc(specLinks.fromEntityId), asc(specLinks.linkType), asc(specLinks.toEntityId));

      const taskEntityIds = uniqueSorted(relatedTaskLinks.map((link) => link.fromEntityId));
      const taskEntities =
        taskEntityIds.length === 0
          ? []
          : await db
              .select({
                entityId: specEntities.entityId,
                type: specEntities.type,
                title: specEntities.title,
                status: specEntities.status,
                filePath: specEntities.filePath
              })
              .from(specEntities)
              .where(
                and(
                  eq(specEntities.projectId, input.projectId),
                  eq(specEntities.type, "agent_task"),
                  inArray(specEntities.entityId, taskEntityIds)
                )
              )
              .orderBy(asc(specEntities.entityId));

      return buildChangeImpactPreview({
        impact,
        validationMessages: validationRows.map(mapValidationMessage),
        relatedTaskLinks,
        taskEntities,
        sectionWarnings: []
      });
    }
  };
}

export function buildChangeImpactPreview(input: {
  impact: EntityImpactResponseDto;
  validationMessages: ValidationMessageDto[];
  relatedTaskLinks: RelatedTaskLink[];
  taskEntities: ImpactEntitySummaryDto[];
  sectionWarnings: ChangeImpactPreviewResponseDto["sectionWarnings"];
}): ChangeImpactPreviewResponseDto {
  const specNodes = input.impact.nodes
    .filter((node) => node.kind === "spec")
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  const specIds = specNodes.map((node) => node.entityId);
  const specIdSet = new Set(specIds);
  const sourceFilePaths = new Set(input.impact.sourceEvidence.map((evidence) => evidence.filePath));
  const directionByEntityId = buildDirectionMap(input.impact);
  const impactedSpecs = buildImpactedSpecs(input.impact, specNodes, directionByEntityId);
  const sourceGroups = buildSourceGroups(input.impact.sourceEvidence);
  const validation = input.validationMessages
    .filter(
      (message) =>
        (message.entityId !== null && specIdSet.has(message.entityId)) ||
        (message.filePath !== null && sourceFilePaths.has(message.filePath))
    )
    .sort(compareValidationMessages);
  const relatedTasks = buildRelatedTasks(input.relatedTaskLinks, input.taskEntities, specIdSet);
  const upstreamEntityIds = new Set(input.impact.upstreamPaths.flatMap((path) => path.entityIds));
  const downstreamEntityIds = new Set(input.impact.downstreamPaths.flatMap((path) => path.entityIds));
  upstreamEntityIds.delete(input.impact.rootEntity.entityId);
  downstreamEntityIds.delete(input.impact.rootEntity.entityId);

  return {
    rootEntity: input.impact.rootEntity,
    impact: input.impact,
    overview: {
      impactedSpecCount: specIds.length,
      upstreamSpecCount: [...upstreamEntityIds].filter((entityId) => specIdSet.has(entityId)).length,
      downstreamSpecCount: [...downstreamEntityIds].filter((entityId) => specIdSet.has(entityId)).length,
      sourceFileCount: sourceGroups.length,
      sourceSymbolCount: input.impact.sourceEvidence.length,
      warningCount: validation.length,
      relatedTaskCount: relatedTasks.length,
      shortestPaths: shortestPaths(input.impact)
    },
    impactedSpecs,
    sourceGroups,
    validationMessages: validation,
    relatedTasks,
    taskSeed: {
      sourceEntityId: input.impact.rootEntity.entityId,
      targetAgent: "codex",
      impactedContextEntityIds: specIds
        .filter((entityId) => entityId !== input.impact.rootEntity.entityId)
        .sort((left, right) => left.localeCompare(right))
    },
    sectionWarnings: input.sectionWarnings
  };
}

function specEntityIds(impact: EntityImpactResponseDto): string[] {
  return impact.nodes
    .filter((node) => node.kind === "spec")
    .map((node) => node.entityId)
    .sort((left, right) => left.localeCompare(right));
}

function buildDirectionMap(impact: EntityImpactResponseDto): Map<string, ChangeImpactSpecSummaryDto> {
  const summaries = new Map<string, ChangeImpactSpecSummaryDto>();
  summaries.set(impact.rootEntity.entityId, {
    ...impact.rootEntity,
    direction: "root",
    distance: 0
  });

  for (const path of impact.upstreamPaths) {
    path.steps.forEach((step, index) => {
      const distance = path.steps.length - 1 - index;
      if (distance > 0) {
        setCloserSummary(summaries, {
          ...step,
          filePath: "",
          direction: "upstream",
          distance
        });
      }
    });
  }

  for (const path of impact.downstreamPaths) {
    path.steps.forEach((step, index) => {
      if (index > 0) {
        setCloserSummary(summaries, {
          ...step,
          filePath: "",
          direction: "downstream",
          distance: index
        });
      }
    });
  }

  return summaries;
}

function setCloserSummary(
  summaries: Map<string, ChangeImpactSpecSummaryDto>,
  summary: ChangeImpactSpecSummaryDto
) {
  const existing = summaries.get(summary.entityId);
  if (!existing || summary.distance < existing.distance) {
    summaries.set(summary.entityId, summary);
  }
}

function buildImpactedSpecs(
  impact: EntityImpactResponseDto,
  specNodes: Extract<EntityImpactResponseDto["nodes"][number], { kind: "spec" }>[],
  directionByEntityId: Map<string, ChangeImpactSpecSummaryDto>
): ChangeImpactPreviewResponseDto["impactedSpecs"] {
  const groups = new Map<string, ChangeImpactPreviewResponseDto["impactedSpecs"][number]>();

  for (const node of specNodes) {
    const direction = directionByEntityId.get(node.entityId)?.direction ?? "root";
    const distance = directionByEntityId.get(node.entityId)?.distance ?? 0;
    const summary = {
      entityId: node.entityId,
      type: node.type,
      title: node.title,
      status: node.status,
      filePath: node.filePath,
      direction,
      distance
    };
    const key = `${direction}:${node.type}`;
    const group = groups.get(key) ?? { direction, type: node.type, specs: [] };
    group.specs.push(summary);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      specs: group.specs.sort(compareSpecSummaries)
    }))
    .sort((left, right) => {
      const directionDelta = directionRank(left.direction) - directionRank(right.direction);
      return directionDelta === 0 ? left.type.localeCompare(right.type) : directionDelta;
    });
}

function buildSourceGroups(
  sourceEvidence: EntityImpactResponseDto["sourceEvidence"]
): ChangeImpactPreviewResponseDto["sourceGroups"] {
  const evidence = [...sourceEvidence].sort(compareSourceEvidence);
  const groups = new Map<string, EntityImpactResponseDto["sourceEvidence"]>();

  for (const item of evidence) {
    const group = groups.get(item.filePath) ?? [];
    group.push(item);
    groups.set(item.filePath, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, symbols]) => ({ filePath, symbols }));
}

function buildRelatedTasks(
  links: RelatedTaskLink[],
  taskEntities: ImpactEntitySummaryDto[],
  impactedSpecIds: Set<string>
): ChangeImpactPreviewResponseDto["relatedTasks"] {
  const linkTypesByTaskId = new Map<string, Set<string>>();

  for (const link of links) {
    if (!impactedSpecIds.has(link.toEntityId) || !relatedTaskLinkTypes.includes(link.linkType)) {
      continue;
    }

    const linkTypes = linkTypesByTaskId.get(link.fromEntityId) ?? new Set<string>();
    linkTypes.add(link.linkType);
    linkTypesByTaskId.set(link.fromEntityId, linkTypes);
  }

  return taskEntities
    .filter((task) => task.type === "agent_task" && linkTypesByTaskId.has(task.entityId))
    .sort((left, right) => left.entityId.localeCompare(right.entityId))
    .map((task) => ({
      ...task,
      linkTypes: [...linkTypesByTaskId.get(task.entityId)!].sort((left, right) =>
        left.localeCompare(right)
      )
    }));
}

function shortestPaths(impact: EntityImpactResponseDto): ChangeImpactPreviewResponseDto["overview"]["shortestPaths"] {
  const pathsByTerminalEntityId = new Map<string, EntityImpactResponseDto["upstreamPaths"][number]>();

  for (const path of [...impact.upstreamPaths, ...impact.downstreamPaths]) {
    const terminalEntityId =
      path.direction === "upstream" ? path.entityIds[0] : path.entityIds[path.entityIds.length - 1];
    const existing = pathsByTerminalEntityId.get(terminalEntityId);
    if (!existing || path.entityIds.length < existing.entityIds.length) {
      pathsByTerminalEntityId.set(terminalEntityId, path);
    }
  }

  return [...pathsByTerminalEntityId.values()].sort((left, right) => {
    const directionDelta = directionRank(left.direction) - directionRank(right.direction);
    if (directionDelta !== 0) {
      return directionDelta;
    }

    const leftTerminal =
      left.direction === "upstream" ? left.entityIds[0] : left.entityIds[left.entityIds.length - 1];
    const rightTerminal =
      right.direction === "upstream" ? right.entityIds[0] : right.entityIds[right.entityIds.length - 1];
    return leftTerminal.localeCompare(rightTerminal);
  });
}

function compareSpecSummaries(
  left: ChangeImpactSpecSummaryDto,
  right: ChangeImpactSpecSummaryDto
): number {
  return (
    left.distance - right.distance ||
    left.entityId.localeCompare(right.entityId) ||
    left.title.localeCompare(right.title)
  );
}

function compareSourceEvidence(
  left: EntityImpactResponseDto["sourceEvidence"][number],
  right: EntityImpactResponseDto["sourceEvidence"][number]
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.symbolName.localeCompare(right.symbolName) ||
    left.entityId.localeCompare(right.entityId) ||
    left.sourceFileId.localeCompare(right.sourceFileId) ||
    nullableNumber(left.symbolLine) - nullableNumber(right.symbolLine) ||
    nullableNumber(left.annotationLine) - nullableNumber(right.annotationLine)
  );
}

function compareValidationMessages(
  left: ValidationMessageDto,
  right: ValidationMessageDto
): number {
  return (
    validationLevelRank[left.level] - validationLevelRank[right.level] ||
    nullableString(left.entityId).localeCompare(nullableString(right.entityId)) ||
    nullableString(left.filePath).localeCompare(nullableString(right.filePath)) ||
    left.message.localeCompare(right.message) ||
    left.code.localeCompare(right.code) ||
    left.id.localeCompare(right.id)
  );
}

function directionRank(direction: ChangeImpactDirection | "upstream" | "downstream"): number {
  if (direction === "root") {
    return 0;
  }

  return direction === "upstream" ? 1 : 2;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function nullableNumber(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function nullableString(value: string | null): string {
  return value ?? "";
}

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
