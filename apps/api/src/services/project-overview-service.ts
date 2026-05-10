import type { IndexRunDto, ProjectOverviewDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  indexRuns,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  validationMessages
} from "@specops/db";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { createProjectService } from "./project-service.js";

const SOURCE_EVIDENCE_ELIGIBLE_TYPES = [
  "data_model",
  "domain_entity",
  "interface",
  "ui_view",
  "use_case"
] as const;

export function createProjectOverviewService(db: Db) {
  const projectService = createProjectService(db);

  async function getProjectOverview(projectId: string): Promise<ProjectOverviewDto> {
    const project = await projectService.getProjectSummary(projectId);

    const [
      latestIndexRunRows,
      entityCountsByTypeRows,
      entityCountsByStatusRows,
      validationErrorSamples,
      validationWarningSamples,
      sourceFileCount,
      sourceImportCount,
      sourceExportCount,
      sourceSymbolCount,
      eligibleEntities,
      sourceEvidenceRows,
      agentTaskCount,
      recentAgentTasks
    ] = await Promise.all([
      db
        .select()
        .from(indexRuns)
        .where(eq(indexRuns.projectId, projectId))
        .orderBy(desc(indexRuns.startedAt), desc(indexRuns.id))
        .limit(1),
      db
        .select({ type: specEntities.type, count: count() })
        .from(specEntities)
        .where(eq(specEntities.projectId, projectId))
        .groupBy(specEntities.type)
        .orderBy(asc(specEntities.type)),
      db
        .select({ status: specEntities.status, count: count() })
        .from(specEntities)
        .where(eq(specEntities.projectId, projectId))
        .groupBy(specEntities.status)
        .orderBy(asc(specEntities.status)),
      listValidationSamples(projectId, "error"),
      listValidationSamples(projectId, "warning"),
      countSourceFiles(projectId),
      countSourceImports(projectId),
      countSourceExports(projectId),
      countSourceSymbols(projectId),
      db
        .select({
          entityId: specEntities.entityId,
          title: specEntities.title,
          type: specEntities.type,
          filePath: specEntities.filePath
        })
        .from(specEntities)
        .where(
          and(
            eq(specEntities.projectId, projectId),
            inArray(specEntities.type, SOURCE_EVIDENCE_ELIGIBLE_TYPES)
          )
        )
        .orderBy(asc(specEntities.entityId)),
      db
        .select({ entityId: sourceSpecLinks.entityId })
        .from(sourceSpecLinks)
        .where(eq(sourceSpecLinks.projectId, projectId))
        .orderBy(asc(sourceSpecLinks.entityId)),
      countAgentTasks(projectId),
      db
        .select({
          entityId: specEntities.entityId,
          title: specEntities.title,
          status: specEntities.status,
          updatedAt: specEntities.updatedAt
        })
        .from(specEntities)
        .where(and(eq(specEntities.projectId, projectId), eq(specEntities.type, "agent_task")))
        .orderBy(desc(specEntities.updatedAt), asc(specEntities.entityId))
        .limit(5)
    ]);

    const sourceEvidenceEntityIds = new Set(sourceEvidenceRows.map((row) => row.entityId));
    const missingSourceEvidence = eligibleEntities.filter(
      (entity) => !sourceEvidenceEntityIds.has(entity.entityId)
    );
    const withSourceEvidenceCount = eligibleEntities.length - missingSourceEvidence.length;
    const validationSamples = [...validationErrorSamples, ...validationWarningSamples];

    return {
      project,
      latestIndexRun: latestIndexRunRows[0] ? mapIndexRun(latestIndexRunRows[0]) : null,
      entityCountsByType: entityCountsByTypeRows.map((row) => ({
        type: row.type,
        count: Number(row.count)
      })),
      entityCountsByStatus: entityCountsByStatusRows.map((row) => ({
        status: row.status,
        count: Number(row.count)
      })),
      validationSummary: {
        errorCount: project.validationErrorCount,
        warningCount: project.validationWarningCount,
        samples: validationSamples.map((row) => ({
          level: row.level as "error" | "warning",
          code: row.code,
          message: row.message,
          entityId: row.entityId,
          filePath: row.filePath
        }))
      },
      sourceInventory: {
        fileCount: sourceFileCount,
        symbolCount: sourceSymbolCount,
        importCount: sourceImportCount,
        exportCount: sourceExportCount
      },
      sourceEvidence: {
        eligibleSpecCount: eligibleEntities.length,
        withSourceEvidenceCount,
        withoutSourceEvidenceCount: missingSourceEvidence.length,
        missingSamples: missingSourceEvidence.slice(0, 5).map((entity) => ({
          entityId: entity.entityId,
          title: entity.title,
          type: entity.type
        }))
      },
      agentTasks: {
        totalCount: agentTaskCount,
        recent: recentAgentTasks.map((task) => ({
          entityId: task.entityId,
          title: task.title,
          status: task.status,
          updatedAt: task.updatedAt.toISOString()
        }))
      },
      attentionItems: buildAttentionItems(validationSamples, missingSourceEvidence)
    };
  }

  async function listValidationSamples(projectId: string, level: "error" | "warning") {
    return db
      .select({
        level: validationMessages.level,
        code: validationMessages.code,
        message: validationMessages.message,
        entityId: validationMessages.entityId,
        filePath: validationMessages.filePath,
        createdAt: validationMessages.createdAt
      })
      .from(validationMessages)
      .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, level)))
      .orderBy(
        asc(validationMessages.createdAt),
        asc(validationMessages.code),
        asc(validationMessages.entityId),
        asc(validationMessages.filePath),
        asc(validationMessages.message)
      )
      .limit(5);
  }

  async function countAgentTasks(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.type, "agent_task")));
    return Number(row?.value ?? 0);
  }

  async function countSourceFiles(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async function countSourceImports(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(sourceImports)
      .where(eq(sourceImports.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async function countSourceExports(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(sourceExports)
      .where(eq(sourceExports.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async function countSourceSymbols(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(sourceSymbols)
      .where(eq(sourceSymbols.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  return {
    getProjectOverview
  };
}

function buildAttentionItems(
  validationSamples: Array<{
    level: string;
    message: string;
    entityId: string | null;
    filePath: string | null;
  }>,
  missingSourceEvidence: Array<{
    entityId: string;
    title: string;
    filePath: string;
  }>
): ProjectOverviewDto["attentionItems"] {
  const items: ProjectOverviewDto["attentionItems"] = [];

  for (const message of validationSamples) {
    if (message.level !== "error" && message.level !== "warning") {
      continue;
    }

    items.push({
      kind: message.level === "error" ? "validation_error" : "validation_warning",
      label: message.message,
      entityId: message.entityId,
      filePath: message.filePath
    });
  }

  for (const entity of missingSourceEvidence) {
    items.push({
      kind: "missing_source_evidence",
      label: `${entity.title} is missing source evidence.`,
      entityId: entity.entityId,
      filePath: entity.filePath
    });
  }

  return items.slice(0, 10);
}

function mapIndexRun(row: typeof indexRuns.$inferSelect): IndexRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status as IndexRunDto["status"],
    entityCount: row.entityCount,
    linkCount: row.linkCount,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    gitCommit: row.gitCommit,
    sourceFileCount: row.sourceFileCount,
    sourceImportCount: row.sourceImportCount,
    sourceExportCount: row.sourceExportCount,
    sourceSymbolCount: row.sourceSymbolCount
  };
}
