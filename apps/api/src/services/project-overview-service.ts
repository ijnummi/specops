import type { IndexRunDto, ProjectOverviewDto, ProjectSummaryDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  indexRuns,
  projects,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  specLinks,
  validationMessages
} from "@specops/db";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

const SOURCE_EVIDENCE_ELIGIBLE_TYPES = [
  "data_model",
  "domain_entity",
  "interface",
  "ui_view",
  "use_case"
] as const;

type OverviewTransactionDb = Pick<Db, "execute" | "select">;
type OverviewDb = OverviewTransactionDb & {
  transaction?: <T>(callback: (tx: OverviewTransactionDb) => Promise<T>) => Promise<T>;
};

export function createProjectOverviewService(db: OverviewDb) {
  async function getProjectOverview(projectId: string): Promise<ProjectOverviewDto> {
    return withOverviewReadSnapshot(db, (snapshotDb) => getProjectOverviewFromSnapshot(snapshotDb, projectId));
  }

  async function getProjectOverviewFromSnapshot(
    snapshotDb: OverviewTransactionDb,
    projectId: string
  ): Promise<ProjectOverviewDto> {
    const [projectRow] = await snapshotDb
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!projectRow) {
      throw new NotFoundError("Project not found", { projectId });
    }

    const latestIndexRunRows = await snapshotDb
      .select()
      .from(indexRuns)
      .where(eq(indexRuns.projectId, projectId))
      .orderBy(desc(indexRuns.startedAt), desc(indexRuns.id))
      .limit(1);
    const entityCount = await countSpecEntities(snapshotDb, projectId);
    const linkCount = await countSpecLinks(snapshotDb, projectId);
    const validationErrorCount = await countValidationRows(snapshotDb, projectId, "error");
    const validationWarningCount = await countValidationRows(snapshotDb, projectId, "warning");
    const entityCountsByTypeRows = await snapshotDb
      .select({ type: specEntities.type, count: count() })
      .from(specEntities)
      .where(eq(specEntities.projectId, projectId))
      .groupBy(specEntities.type)
      .orderBy(asc(specEntities.type));
    const entityCountsByStatusRows = await snapshotDb
      .select({ status: specEntities.status, count: count() })
      .from(specEntities)
      .where(eq(specEntities.projectId, projectId))
      .groupBy(specEntities.status)
      .orderBy(asc(specEntities.status));
    const validationErrorSamples = await listValidationSamples(snapshotDb, projectId, "error");
    const validationWarningSamples = await listValidationSamples(snapshotDb, projectId, "warning");
    const sourceFileCount = await countSourceFiles(snapshotDb, projectId);
    const sourceImportCount = await countSourceImports(snapshotDb, projectId);
    const sourceExportCount = await countSourceExports(snapshotDb, projectId);
    const sourceSymbolCount = await countSourceSymbols(snapshotDb, projectId);
    const eligibleEntities = await snapshotDb
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
      .orderBy(asc(specEntities.entityId));
    const sourceEvidenceRows = await snapshotDb
      .select({ entityId: sourceSpecLinks.entityId })
      .from(sourceSpecLinks)
      .where(eq(sourceSpecLinks.projectId, projectId))
      .orderBy(asc(sourceSpecLinks.entityId));
    const agentTaskCount = await countAgentTasks(snapshotDb, projectId);
    const recentAgentTasks = await snapshotDb
      .select({
        entityId: specEntities.entityId,
        title: specEntities.title,
        status: specEntities.status,
        updatedAt: specEntities.updatedAt
      })
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.type, "agent_task")))
      .orderBy(desc(specEntities.updatedAt), asc(specEntities.entityId))
      .limit(5);

    const sourceEvidenceEntityIds = new Set(sourceEvidenceRows.map((row) => row.entityId));
    const missingSourceEvidence = eligibleEntities.filter(
      (entity) => !sourceEvidenceEntityIds.has(entity.entityId)
    );
    const withSourceEvidenceCount = eligibleEntities.length - missingSourceEvidence.length;
    const validationSamples = [...validationErrorSamples, ...validationWarningSamples];
    const latestIndexRun = latestIndexRunRows[0] ?? null;
    const project = mapProjectSummary(projectRow, {
      entityCount,
      linkCount,
      validationErrorCount,
      validationWarningCount,
      latestIndexRun
    });

    return {
      project,
      latestIndexRun: latestIndexRun ? mapIndexRun(latestIndexRun) : null,
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

  async function listValidationSamples(
    snapshotDb: OverviewTransactionDb,
    projectId: string,
    level: "error" | "warning"
  ) {
    return snapshotDb
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

  async function countAgentTasks(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
    const [row] = await snapshotDb
      .select({ value: count() })
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.type, "agent_task")));
    return Number(row?.value ?? 0);
  }

  async function countSourceFiles(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
    const [row] = await snapshotDb
      .select({ value: count() })
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async function countSourceImports(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
    const [row] = await snapshotDb
      .select({ value: count() })
      .from(sourceImports)
      .where(eq(sourceImports.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async function countSourceExports(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
    const [row] = await snapshotDb
      .select({ value: count() })
      .from(sourceExports)
      .where(eq(sourceExports.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  async function countSourceSymbols(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
    const [row] = await snapshotDb
      .select({ value: count() })
      .from(sourceSymbols)
      .where(eq(sourceSymbols.projectId, projectId));
    return Number(row?.value ?? 0);
  }

  return {
    getProjectOverview
  };
}

async function withOverviewReadSnapshot<T>(
  db: OverviewDb,
  callback: (snapshotDb: OverviewTransactionDb) => Promise<T>
): Promise<T> {
  if (!db.transaction) {
    return callback(db);
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    return callback(tx);
  });
}

async function countSpecEntities(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
  const [row] = await snapshotDb
    .select({ value: count() })
    .from(specEntities)
    .where(eq(specEntities.projectId, projectId));
  return Number(row?.value ?? 0);
}

async function countSpecLinks(snapshotDb: OverviewTransactionDb, projectId: string): Promise<number> {
  const [row] = await snapshotDb
    .select({ value: count() })
    .from(specLinks)
    .where(eq(specLinks.projectId, projectId));
  return Number(row?.value ?? 0);
}

async function countValidationRows(
  snapshotDb: OverviewTransactionDb,
  projectId: string,
  level: "error" | "warning"
): Promise<number> {
  const [row] = await snapshotDb
    .select({ value: count() })
    .from(validationMessages)
    .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, level)));
  return Number(row?.value ?? 0);
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

function mapProjectSummary(
  row: typeof projects.$inferSelect,
  counts: {
    entityCount: number;
    linkCount: number;
    validationErrorCount: number;
    validationWarningCount: number;
    latestIndexRun: typeof indexRuns.$inferSelect | null;
  }
): ProjectSummaryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repoPath: row.repoPath,
    specopsPath: row.specopsPath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    entityCount: counts.entityCount,
    linkCount: counts.linkCount,
    validationErrorCount: counts.validationErrorCount,
    validationWarningCount: counts.validationWarningCount,
    lastIndexedAt: counts.latestIndexRun?.finishedAt ? counts.latestIndexRun.finishedAt.toISOString() : null
  };
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
