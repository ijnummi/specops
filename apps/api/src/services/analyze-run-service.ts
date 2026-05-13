import type {
  AnalyzeRunDetailDto,
  AnalyzeRunSelectionSummary,
  AnalyzeRunStepDto,
  AnalyzeRunStepName,
  IndexRunDto
} from "@specops/contracts";
import {
  analyzeRunDetailSchema,
  analyzeRunSelectionSummarySchema,
  analyzeRunStepSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  analyzeRuns,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSymbols
} from "@specops/db";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import { ConflictError, NotFoundError, isHttpError } from "../lib/http-errors.js";
import {
  createAiPrefillService,
  type AiPrefillProviderFactory
} from "./ai-prefill-service.js";
import { selectAnalyzeSourceFiles, type AnalyzeSourceCandidate } from "./analyze-source-selection.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";
import { createProposalService } from "./proposal-service.js";
import { createSpecopsInitializerService } from "./specops-initializer.js";

export type { AiPrefillProviderFactory };

type AnalyzeRunServiceOptions = {
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

type AnalyzeRunRow = typeof analyzeRuns.$inferSelect;
type StepPatch = {
  status: AnalyzeRunStepDto["status"];
  message?: string | null;
  counts?: Record<string, number>;
};

const stepNames: AnalyzeRunStepName[] = [
  "initialize",
  "index",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill"
];
const aiPrefillDefaults = {
  provider: "ollama" as const,
  model: "gemma4",
  temperature: 0.1
};

export function createAnalyzeRunService(db: Db, options: AnalyzeRunServiceOptions) {
  const projectService = createProjectService(db);

  async function startAnalyzeRun(projectId: string): Promise<AnalyzeRunDetailDto> {
    await projectService.getProject(projectId);
    await assertNoActiveRun(projectId);

    const initialRun = {
      projectId,
      status: "queued",
      currentStep: null,
      stepsJson: createInitialSteps()
    } satisfies Partial<typeof analyzeRuns.$inferInsert>;

    let row: AnalyzeRunRow;
    try {
      const [inserted] = await db.insert(analyzeRuns).values(initialRun).returning();
      if (!inserted) {
        throw new Error("Failed to create analyze run");
      }
      row = inserted;
    } catch (error) {
      if (isUniqueViolation(error)) {
        await throwActiveRunConflict(projectId);
      }
      throw error;
    }

    setTimeout(() => {
      void executeAnalyzeRun(projectId, row.id).catch(() => undefined);
    }, 0);

    return mapAnalyzeRun(row);
  }

  async function getAnalyzeRun(
    projectId: string,
    runId: string
  ): Promise<AnalyzeRunDetailDto> {
    const row = await getAnalyzeRunRow(projectId, runId);
    return mapAnalyzeRun(row);
  }

  async function assertNoActiveRun(projectId: string): Promise<void> {
    const active = await findActiveRun(projectId);
    if (active) {
      throw new ConflictError("Analyze run is already active", { activeRunId: active.id });
    }
  }

  async function throwActiveRunConflict(projectId: string): Promise<never> {
    const active = await findActiveRun(projectId);
    if (active) {
      throw new ConflictError("Analyze run is already active", { activeRunId: active.id });
    }

    throw new ConflictError("Analyze run is already active");
  }

  async function findActiveRun(projectId: string): Promise<{ id: string } | null> {
    const [active] = await db
      .select({ id: analyzeRuns.id })
      .from(analyzeRuns)
      .where(
        and(
          eq(analyzeRuns.projectId, projectId),
          inArray(analyzeRuns.status, ["queued", "running"])
        )
      )
      .limit(1);

    return active ?? null;
  }

  async function executeAnalyzeRun(projectId: string, runId: string): Promise<void> {
    let steps = await loadRunSteps(projectId, runId);
    let currentStep: AnalyzeRunStepName | null = null;
    let proposalIds = readProposalIds((await getAnalyzeRunRow(projectId, runId)).proposalIdsJson);

    try {
      await db
        .update(analyzeRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(analyzeRuns.projectId, projectId), eq(analyzeRuns.id, runId)));

      await runStep("initialize", async () => {
        await createSpecopsInitializerService(db).initializeProjectSpecops(projectId);
        return {
          status: "succeeded",
          message: "SpecOps folder initialized"
        };
      });

      await runStep("index", async () => {
        const indexRun = await createIndexerService(db).indexProject(projectId);
        const counts = indexCounts(indexRun);
        await updateRun({
          indexRunId: indexRun.id
        });
        return {
          status: "succeeded",
          counts
        };
      });

      await runStep("source_proposals", async () => {
        try {
          const proposals = await createProposalService(db).generateSourceImportProposals(projectId);
          proposalIds = appendProposalIds(
            proposalIds,
            proposals.map((proposal) => proposal.id)
          );
          await updateRun({
            sourceProposalCount: proposals.length,
            proposalIdsJson: proposalIds
          });
          return {
            status: "succeeded",
            counts: { sourceProposalCount: proposals.length }
          };
        } catch (error) {
          if (!isNoEligibleExportedSourceSymbolsError(error)) {
            throw error;
          }

          await updateRun({ sourceProposalCount: 0 });
          return {
            status: "succeeded",
            message: "No eligible exported source symbols found",
            counts: { sourceProposalCount: 0 }
          };
        }
      });

      let selectedSourceFileIds: string[] = [];
      await runStep("select_ai_sources", async () => {
        const candidates = await loadAnalyzeSourceCandidates(projectId);
        const selection = selectAnalyzeSourceFiles({
          files: candidates,
          maxFiles: options.aiPrefillConfig.maxFiles,
          maxTotalBytes: options.aiPrefillConfig.maxTotalBytes
        });
        selectedSourceFileIds = selection.selectedSourceFileIds;
        await updateRun({ selectionJson: selection });
        return {
          status: "succeeded",
          counts: {
            indexedSourceFileCount: candidates.length,
            selectedSourceFileCount: selection.selectedSourceFileIds.length,
            eligibleHighSignalFileCount: selection.eligibleHighSignalFileCount,
            skippedHighSignalFileCount: selection.skippedHighSignalFileCount
          }
        };
      });

      if (selectedSourceFileIds.length === 0) {
        await skipStep("ai_prefill", "No source files selected for AI Prefill");
      } else {
        await runStep("ai_prefill", async () => {
          const result = await createAiPrefillService(db, {
            config: options.aiPrefillConfig,
            providerFactory: options.aiPrefillProviderFactory
          }).generateAiPrefillProposals(projectId, {
            sourceFileIds: selectedSourceFileIds as [string, ...string[]],
            provider: aiPrefillDefaults.provider,
            model: aiPrefillDefaults.model,
            temperature: aiPrefillDefaults.temperature
          });

          proposalIds = appendProposalIds(
            proposalIds,
            result.proposals.map((proposal) => proposal.id)
          );
          await updateRun({
            aiProposalCount: result.proposals.length,
            proposalIdsJson: proposalIds
          });
          return {
            status: "succeeded",
            counts: {
              aiProposalCount: result.proposals.length,
              aiDiagnosticCount: result.diagnostics.length
            }
          };
        });
      }

      await updateRun({
        status: "succeeded",
        currentStep: null,
        stepsJson: steps,
        finishedAt: new Date()
      });
    } catch (error) {
      const message = errorMessage(error);
      if (currentStep) {
        steps = finishStep(steps, currentStep, {
          status: "failed",
          message
        });
      }

      await updateRun({
        status: "failed",
        currentStep: null,
        stepsJson: steps,
        errorMessage: message,
        finishedAt: new Date()
      });
    }

    async function runStep(
      name: AnalyzeRunStepName,
      callback: () => Promise<StepPatch>
    ): Promise<void> {
      currentStep = name;
      const startedAt = new Date().toISOString();
      steps = steps.map((step) =>
        step.name === name
          ? {
              ...step,
              status: "running",
              startedAt,
              finishedAt: null,
              message: null
            }
          : step
      );
      await updateRun({ currentStep: name, stepsJson: steps });

      const patch = await callback();
      steps = finishStep(steps, name, patch);
      await updateRun({ stepsJson: steps });
      currentStep = null;
    }

    async function skipStep(name: AnalyzeRunStepName, message: string): Promise<void> {
      steps = finishStep(steps, name, {
        status: "skipped",
        message
      });
      await updateRun({ currentStep: null, stepsJson: steps });
    }

    async function updateRun(values: Partial<typeof analyzeRuns.$inferInsert>) {
      await db
        .update(analyzeRuns)
        .set(values)
        .where(and(eq(analyzeRuns.projectId, projectId), eq(analyzeRuns.id, runId)));
    }
  }

  async function getAnalyzeRunRow(projectId: string, runId: string): Promise<AnalyzeRunRow> {
    const [row] = await db
      .select()
      .from(analyzeRuns)
      .where(and(eq(analyzeRuns.projectId, projectId), eq(analyzeRuns.id, runId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError("Analyze run not found", { projectId, runId });
    }

    return row;
  }

  async function loadRunSteps(
    projectId: string,
    runId: string
  ): Promise<AnalyzeRunStepDto[]> {
    return readSteps((await getAnalyzeRunRow(projectId, runId)).stepsJson);
  }

  async function loadAnalyzeSourceCandidates(projectId: string): Promise<AnalyzeSourceCandidate[]> {
    const rows = await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId))
      .orderBy(asc(sourceFiles.path), asc(sourceFiles.id));
    const sourceFileIds = rows.map((row) => row.id);

    if (sourceFileIds.length === 0) {
      return [];
    }

    const [importCounts, exportCounts, symbolCounts] = await Promise.all([
      countSourceImports(projectId, sourceFileIds),
      countSourceExports(projectId, sourceFileIds),
      countSourceSymbols(projectId, sourceFileIds)
    ]);

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      kind: row.kind,
      sizeBytes: row.sizeBytes,
      importCount: importCounts.get(row.id) ?? 0,
      exportCount: exportCounts.get(row.id) ?? 0,
      symbolCount: symbolCounts.get(row.id) ?? 0
    }));
  }

  async function countSourceImports(
    projectId: string,
    sourceFileIds: string[]
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({ sourceFileId: sourceImports.sourceFileId, total: count() })
      .from(sourceImports)
      .where(
        and(
          eq(sourceImports.projectId, projectId),
          inArray(sourceImports.sourceFileId, sourceFileIds)
        )
      )
      .groupBy(sourceImports.sourceFileId);

    return new Map(rows.map((row) => [row.sourceFileId, row.total]));
  }

  async function countSourceExports(
    projectId: string,
    sourceFileIds: string[]
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({ sourceFileId: sourceExports.sourceFileId, total: count() })
      .from(sourceExports)
      .where(
        and(
          eq(sourceExports.projectId, projectId),
          inArray(sourceExports.sourceFileId, sourceFileIds)
        )
      )
      .groupBy(sourceExports.sourceFileId);

    return new Map(rows.map((row) => [row.sourceFileId, row.total]));
  }

  async function countSourceSymbols(
    projectId: string,
    sourceFileIds: string[]
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({ sourceFileId: sourceSymbols.sourceFileId, total: count() })
      .from(sourceSymbols)
      .where(
        and(
          eq(sourceSymbols.projectId, projectId),
          inArray(sourceSymbols.sourceFileId, sourceFileIds)
        )
      )
      .groupBy(sourceSymbols.sourceFileId);

    return new Map(rows.map((row) => [row.sourceFileId, row.total]));
  }

  return {
    startAnalyzeRun,
    getAnalyzeRun
  };
}

function createInitialSteps(): AnalyzeRunStepDto[] {
  return stepNames.map((name) => ({
    name,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    message: null,
    counts: {}
  }));
}

function finishStep(
  steps: AnalyzeRunStepDto[],
  name: AnalyzeRunStepName,
  patch: StepPatch
): AnalyzeRunStepDto[] {
  const finishedAt = new Date().toISOString();

  return steps.map((step) =>
    step.name === name
      ? {
          ...step,
          status: patch.status,
          finishedAt,
          message: patch.message ?? null,
          counts: patch.counts ?? step.counts
        }
      : step
  );
}

function indexCounts(indexRun: IndexRunDto): Record<string, number> {
  return {
    entityCount: indexRun.entityCount,
    linkCount: indexRun.linkCount,
    errorCount: indexRun.errorCount,
    warningCount: indexRun.warningCount,
    sourceFileCount: indexRun.sourceFileCount ?? 0,
    sourceImportCount: indexRun.sourceImportCount ?? 0,
    sourceExportCount: indexRun.sourceExportCount ?? 0,
    sourceSymbolCount: indexRun.sourceSymbolCount ?? 0
  };
}

function mapAnalyzeRun(row: AnalyzeRunRow): AnalyzeRunDetailDto {
  return analyzeRunDetailSchema.parse({
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    currentStep: row.currentStep,
    steps: readSteps(row.stepsJson),
    selection: readSelection(row.selectionJson),
    proposalIds: readProposalIds(row.proposalIdsJson),
    sourceProposalCount: row.sourceProposalCount,
    aiProposalCount: row.aiProposalCount,
    indexRunId: row.indexRunId,
    errorMessage: row.errorMessage,
    createdAt: toIso(row.createdAt),
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt)
  });
}

function readSteps(value: unknown): AnalyzeRunStepDto[] {
  const parsed = z.array(analyzeRunStepSchema).safeParse(value);
  return parsed.success ? parsed.data : createInitialSteps();
}

function readSelection(value: unknown): AnalyzeRunSelectionSummary | null {
  if (value === null) {
    return null;
  }

  return analyzeRunSelectionSummarySchema.parse(value);
}

function readProposalIds(value: unknown): string[] {
  return z.array(z.string().uuid()).parse(value);
}

function appendProposalIds(current: string[], next: string[]): string[] {
  return [...new Set([...current, ...next])];
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isNoEligibleExportedSourceSymbolsError(error: unknown): boolean {
  return (
    isHttpError(error) &&
    error.statusCode === 400 &&
    error.message === "No eligible exported source symbols found"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Analyze run failed";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
