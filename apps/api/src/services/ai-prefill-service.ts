import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AiPrefillGenerateRequest,
  AiPrefillDiagnostic,
  ProposalSummaryDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSymbols,
  specEntities
} from "@specops/db";
import {
  buildAiPrefillPromptPacket,
  createAiPrefillProvider,
  normalizeProviderResponse,
  renderAiSpecEntityProposal
} from "@specops/ai-prefill";
import type {
  AiPrefillProvider,
  AiPrefillProviderInput,
  AiPrefillProviderName,
  AiPrefillProviderResult,
  CreateAiPrefillProviderInput,
  NormalizeProviderResponseInput,
  NormalizeProviderResponseResult
} from "@specops/ai-prefill";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { ApiConfig } from "../config.js";
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  GatewayTimeoutError
} from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";
import { createProposalService } from "./proposal-service.js";

type AiPrefillConfig = ApiConfig["aiPrefill"];

export type AiPrefillProviderFactory = (
  input: CreateAiPrefillProviderInput
) => AiPrefillProvider;

type AiPrefillServiceOptions = {
  config: AiPrefillConfig;
  providerFactory?: AiPrefillProviderFactory;
};

const allowedEntityTypes = ["use_case", "domain_entity", "interface"] as const;
const allowedLinkTypes = [
  "uses",
  "depends_on",
  "implements",
  "implemented_by",
  "interfaces",
  "relates_to",
  "generated_from"
];

type SourceFileRow = typeof sourceFiles.$inferSelect;

export function createAiPrefillService(db: Db, options: AiPrefillServiceOptions) {
  const projectService = createProjectService(db);
  const proposalService = createProposalService(db);

  async function generateAiPrefillProposals(
    projectId: string,
    input: AiPrefillGenerateRequest
  ): Promise<{ proposals: ProposalSummaryDto[]; diagnostics: AiPrefillDiagnostic[] }> {
    const uniqueSourceFileIds = [...new Set(input.sourceFileIds)];
    if (uniqueSourceFileIds.length === 0) {
      throw new BadRequestError("Select at least one source file for AI Prefill");
    }
    if (uniqueSourceFileIds.length > options.config.maxFiles) {
      throw new BadRequestError("Selected source file count exceeds AI Prefill limit", {
        maxFiles: options.config.maxFiles,
        selectedFiles: uniqueSourceFileIds.length
      });
    }

    const project = await projectService.getProject(projectId);
    const repoPath = assertAbsolutePath("repoPath", project.repoPath);
    assertAbsolutePath("specopsPath", project.specopsPath);
    await assertRealPathInsideDirectory(repoPath, repoPath);

    const selectedRows = await loadSelectedSourceFiles(projectId, uniqueSourceFileIds);
    const selectedSourceRows = uniqueSourceFileIds.map((sourceFileId) => {
      const row = selectedRows.get(sourceFileId);
      if (!row) {
        throw new BadRequestError("Selected source file does not belong to project", {
          sourceFileId
        });
      }
      return row;
    });

    const selectedBytes = selectedSourceRows.reduce((sum, row) => sum + row.sizeBytes, 0);
    if (selectedBytes > options.config.maxTotalBytes) {
      throw new BadRequestError("Selected source content exceeds AI Prefill limit", {
        maxTotalBytes: options.config.maxTotalBytes,
        selectedBytes
      });
    }

    const selectedFiles = await Promise.all(
      selectedSourceRows.map((row) => loadSourceFileForPrompt(repoPath, row))
    );
    const existingEntities = await loadExistingEntities(projectId);

    let packet;
    try {
      packet = buildAiPrefillPromptPacket({
        project: { id: project.id, name: project.name },
        allowedEntityTypes: [...allowedEntityTypes],
        allowedLinkTypes,
        existingEntities,
        selectedFiles,
        limits: {
          maxFiles: options.config.maxFiles,
          maxTotalBytes: options.config.maxTotalBytes
        }
      });
    } catch (error) {
      throw new BadRequestError(
        error instanceof Error ? error.message : "Invalid AI Prefill selection"
      );
    }

    const provider = createProvider(input);
    const providerResult = await generateProviderResult(provider, {
      packet,
      model: input.model,
      temperature: input.temperature
    });
    const normalized = normalizeProviderOutput({
      text: providerResult.text,
      selectedSourceFiles: selectedFiles.map((file) => file.path),
      existingEntityIds: new Set(existingEntities.map((entity) => entity.entityId))
    });

    if (normalized.candidates.length === 0) {
      throw new BadRequestError("AI provider returned no valid proposals", {
        diagnostics: normalized.diagnostics
      });
    }

    const rendered = normalized.candidates.map((candidate) =>
      renderAiSpecEntityProposal({
        candidate,
        provider: providerResult.provider,
        model: providerResult.model,
        packet,
        warnings: normalized.diagnostics.map((diagnostic) => diagnostic.message)
      })
    );

    const insertedRows = await db.transaction(async (tx) => {
      const now = new Date();
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:ai_spec_entity`}, 0))`
      );
      await revalidateSelectedSourceFiles(repoPath, selectedSourceRows);
      await tx
        .update(aiProposals)
        .set({ status: "obsolete", reviewedAt: now })
        .where(
          and(
            eq(aiProposals.projectId, projectId),
            eq(aiProposals.proposalType, "ai_spec_entity"),
            eq(aiProposals.status, "pending")
          )
        );

      return tx
        .insert(aiProposals)
        .values(
          rendered.map((proposal) => ({
            projectId,
            proposalType: proposal.proposalType,
            title: proposal.title,
            payloadJson: proposal.payload,
            evidenceJson: proposal.evidence,
            confidence: proposal.confidence,
            status: "pending"
          }))
        )
        .returning();
    });

    return {
      proposals: await proposalService.summarizeProposals(projectId, insertedRows),
      diagnostics: normalized.diagnostics
    };
  }

  function createProvider(input: AiPrefillGenerateRequest): AiPrefillProvider {
    try {
      return (options.providerFactory ?? createAiPrefillProvider)({
        provider: input.provider as AiPrefillProviderName,
        ollamaBaseUrl: options.config.ollamaBaseUrl,
        openAiApiKey: options.config.openAiApiKey,
        openAiBaseUrl: options.config.openAiBaseUrl,
        timeoutMs: options.config.timeoutMs
      });
    } catch (error) {
      throw mapProviderSetupError(error);
    }
  }

  async function loadSelectedSourceFiles(
    projectId: string,
    sourceFileIds: string[]
  ): Promise<Map<string, SourceFileRow>> {
    const rows = await db
      .select()
      .from(sourceFiles)
      .where(
        and(eq(sourceFiles.projectId, projectId), inArray(sourceFiles.id, sourceFileIds))
      );

    return new Map(rows.map((row) => [row.id, row]));
  }

  async function loadSourceFileForPrompt(repoPath: string, row: SourceFileRow) {
    const text = await validateSourceFileContent(repoPath, row);

    const [imports, exports, symbols] = await Promise.all([
      db
        .select()
        .from(sourceImports)
        .where(and(eq(sourceImports.projectId, row.projectId), eq(sourceImports.sourceFileId, row.id)))
        .orderBy(asc(sourceImports.specifier), asc(sourceImports.id)),
      db
        .select()
        .from(sourceExports)
        .where(and(eq(sourceExports.projectId, row.projectId), eq(sourceExports.sourceFileId, row.id)))
        .orderBy(asc(sourceExports.exportedName), asc(sourceExports.id)),
      db
        .select()
        .from(sourceSymbols)
        .where(and(eq(sourceSymbols.projectId, row.projectId), eq(sourceSymbols.sourceFileId, row.id)))
        .orderBy(asc(sourceSymbols.name), asc(sourceSymbols.id))
    ]);
    const lines = text.length > 0 ? text.replace(/\r?\n$/, "").split(/\r?\n/) : [""];

    return {
      id: row.id,
      path: row.path,
      contentHash: row.contentHash,
      language: row.language,
      kind: row.kind,
      text,
      startLine: 1,
      endLine: lines.length,
      imports: imports.map((sourceImport) => ({
        specifier: sourceImport.specifier,
        importKind: sourceImport.importKind,
        importedNames: sourceImport.importedNames,
        resolvedPath: sourceImport.resolvedPath
      })),
      exports: exports.map((sourceExport) => ({
        exportedName: sourceExport.exportedName,
        exportKind: sourceExport.exportKind,
        sourceSpecifier: sourceExport.sourceSpecifier
      })),
      symbols: symbols.map((symbol) => ({
        name: symbol.name,
        symbolKind: symbol.symbolKind,
        isExported: symbol.isExported,
        line: symbol.line
      }))
    };
  }

  async function revalidateSelectedSourceFiles(repoPath: string, rows: SourceFileRow[]) {
    await Promise.all(rows.map((row) => validateSourceFileContent(repoPath, row)));
  }

  async function validateSourceFileContent(repoPath: string, row: SourceFileRow) {
    const targetPath = assertInsideDirectory(repoPath, path.join(repoPath, row.path));
    let text: string;
    try {
      const safePath = await assertRealPathInsideDirectory(repoPath, targetPath);
      text = await readFile(safePath, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new ConflictError("Selected source file is missing; re-index before AI Prefill", {
          sourceFileId: row.id,
          path: row.path
        });
      }
      throw error;
    }

    if (sha256(text) !== row.contentHash) {
      throw new ConflictError(
        "Selected source file changed since indexing; re-index before AI Prefill",
        {
          sourceFileId: row.id,
          path: row.path
        }
      );
    }

    return text;
  }

  async function loadExistingEntities(projectId: string) {
    return db
      .select({
        entityId: specEntities.entityId,
        type: specEntities.type,
        title: specEntities.title
      })
      .from(specEntities)
      .where(eq(specEntities.projectId, projectId))
      .orderBy(asc(specEntities.entityId));
  }

  return {
    generateAiPrefillProposals
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function generateProviderResult(
  provider: AiPrefillProvider,
  input: AiPrefillProviderInput
): Promise<AiPrefillProviderResult> {
  try {
    return await provider.generateSpecProposals(input);
  } catch (error) {
    throw mapProviderFailure(error);
  }
}

function normalizeProviderOutput(
  input: NormalizeProviderResponseInput
): NormalizeProviderResponseResult {
  try {
    return normalizeProviderResponse(input);
  } catch (error) {
    throw new BadRequestError(errorMessage(error, "AI provider returned invalid model output"));
  }
}

function mapProviderSetupError(error: unknown): Error {
  const message = errorMessage(error, "AI provider setup failed");
  if (message === "OPENAI_API_KEY is required for OpenAI AI Prefill") {
    return new BadRequestError(message);
  }

  return mapProviderFailure(error);
}

function mapProviderFailure(error: unknown): Error {
  if (isTimeoutError(error)) {
    return new GatewayTimeoutError("AI provider generation timed out", {
      cause: errorMessage(error, "AI provider timed out")
    });
  }

  return new BadGatewayError("AI provider generation failed", {
    cause: errorMessage(error, "AI provider generation failed")
  });
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
