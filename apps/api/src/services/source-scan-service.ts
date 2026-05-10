import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  SourceAggregateDto,
  SourceFileDetailDto,
  SourceFileListQuery,
  SourceSpecLinkDto,
  SourceFileSummaryDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  validationMessages
} from "@specops/db";
import { scanRepository, type ScanRepositoryResult } from "@specops/repo-scanner";
import { and, asc, count, eq, ilike, inArray, sql } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import {
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";

const MAX_SOURCE_EXCERPT_FILE_BYTES = 256 * 1024;
const SOURCE_EXCERPT_CONCURRENCY = 4;

type SourceScanTransactionDb = Pick<Db, "delete" | "execute" | "insert" | "select">;
type SourceScanDb = SourceScanTransactionDb & {
  transaction?: <T>(callback: (tx: SourceScanTransactionDb) => Promise<T>) => Promise<T>;
};

export type SourceScanCounts = {
  sourceFileCount: number;
  sourceImportCount: number;
  sourceExportCount: number;
  sourceSymbolCount: number;
  warningCount: number;
};

export function createSourceScanService(db: SourceScanDb) {
  return {
    async scanAndPersistProject(input: {
      projectId: string;
      repoPath: string;
      indexRunId: string;
    }): Promise<SourceScanCounts> {
      const result = await scanRepository({ repoPath: input.repoPath });
      return persistSourceScan(db, input.projectId, input.indexRunId, result);
    },

    async listSourceFiles(
      projectId: string,
      query: SourceFileListQuery
    ): Promise<SourceFileSummaryDto[]> {
      return withSourceReadSnapshot(db, (snapshotDb) => listSourceFiles(snapshotDb, projectId, query));
    },

    async getSourceFileDetail(
      projectId: string,
      sourceFileId: string
    ): Promise<SourceFileDetailDto> {
      return withSourceReadSnapshot(db, (snapshotDb) =>
        getSourceFileDetail(snapshotDb, projectId, sourceFileId)
      );
    },

    async getSourceAggregate(projectId: string): Promise<SourceAggregateDto> {
      return withSourceReadSnapshot(db, (snapshotDb) => getSourceAggregate(snapshotDb, projectId));
    },

    async listSourceSpecLinksForEntity(input: {
      projectId: string;
      repoPath: string;
      entityId: string;
    }): Promise<SourceSpecLinkDto[]> {
      return listSourceSpecLinksForEntity(db, input);
    }
  };
}

async function withSourceReadSnapshot<T>(
  db: SourceScanDb,
  callback: (snapshotDb: SourceScanTransactionDb) => Promise<T>
): Promise<T> {
  if (!db.transaction) {
    return callback(db);
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    return callback(tx);
  });
}

async function persistSourceScan(
  db: SourceScanDb,
  projectId: string,
  indexRunId: string,
  result: ScanRepositoryResult
): Promise<SourceScanCounts> {
  await db.delete(sourceSpecLinks).where(eq(sourceSpecLinks.projectId, projectId));
  await db.delete(sourceSymbols).where(eq(sourceSymbols.projectId, projectId));
  await db.delete(sourceExports).where(eq(sourceExports.projectId, projectId));
  await db.delete(sourceImports).where(eq(sourceImports.projectId, projectId));
  await db.delete(sourceFiles).where(eq(sourceFiles.projectId, projectId));

  const sourceFileIdsByPath = new Map<string, string>();

  if (result.files.length > 0) {
    const insertedFiles = await db
      .insert(sourceFiles)
      .values(
        result.files.map((file) => ({
          projectId,
          path: file.path,
          language: file.language,
          kind: file.kind,
          sizeBytes: file.sizeBytes,
          contentHash: file.contentHash
        }))
      )
      .returning({ id: sourceFiles.id, path: sourceFiles.path });

    for (const file of insertedFiles) {
      sourceFileIdsByPath.set(file.path, file.id);
    }
  }

  const importRows = result.files.flatMap((file) => {
    const sourceFileId = sourceFileIdsByPath.get(file.path);
    if (!sourceFileId) return [];

    return file.imports.map((sourceImport) => ({
      projectId,
      sourceFileId,
      filePath: file.path,
      specifier: sourceImport.specifier,
      importKind: sourceImport.importKind,
      importedNames: sourceImport.importedNames,
      isRelative: sourceImport.isRelative,
      resolvedPath: sourceImport.resolvedPath
    }));
  });

  if (importRows.length > 0) {
    await db.insert(sourceImports).values(importRows);
  }

  const exportRows = result.files.flatMap((file) => {
    const sourceFileId = sourceFileIdsByPath.get(file.path);
    if (!sourceFileId) return [];

    return file.exports.map((sourceExport) => ({
      projectId,
      sourceFileId,
      filePath: file.path,
      exportedName: sourceExport.exportedName,
      exportKind: sourceExport.exportKind,
      sourceSpecifier: sourceExport.sourceSpecifier
    }));
  });

  if (exportRows.length > 0) {
    await db.insert(sourceExports).values(exportRows);
  }

  const symbolRows = result.files.flatMap((file) => {
    const sourceFileId = sourceFileIdsByPath.get(file.path);
    if (!sourceFileId) return [];

    return file.symbols.map((symbol) => ({
      projectId,
      sourceFileId,
      filePath: file.path,
      name: symbol.name,
      symbolKind: symbol.symbolKind,
      isExported: symbol.isExported,
      line: symbol.line,
      metadataJson: symbol.metadata
    }));
  });

  if (symbolRows.length > 0) {
    await db.insert(sourceSymbols).values(symbolRows);
  }

  const existingEntityRows = await db
    .select({ entityId: specEntities.entityId })
    .from(specEntities)
    .where(eq(specEntities.projectId, projectId));
  const existingEntityIds = new Set(existingEntityRows.map((row) => row.entityId));

  const sourceSpecLinkRows = result.files.flatMap((file) => {
    const sourceFileId = sourceFileIdsByPath.get(file.path);
    if (!sourceFileId) return [];

    return file.symbols.flatMap((symbol) =>
      symbol.specopsAnnotations.map((annotation) => ({
        projectId,
        sourceFileId,
        filePath: file.path,
        entityId: annotation.entityId,
        symbolName: symbol.name,
        symbolKind: symbol.symbolKind,
        symbolLine: symbol.line,
        annotationLine: annotation.line,
        contentHash: file.contentHash
      }))
    );
  });

  const invalidAnnotationWarnings = sourceSpecLinkRows
    .filter((link) => !isValidSpecopsEntityId(link.entityId))
    .map((link) => ({
      projectId,
      indexRunId,
      filePath: link.filePath,
      entityId: link.entityId || null,
      level: "warning",
      code: "source_spec_invalid_entity_id",
      message: "Source annotation has an invalid SpecOps entity id."
    }));

  const validSourceSpecLinkRows = sourceSpecLinkRows.filter((link) =>
    isValidSpecopsEntityId(link.entityId)
  );

  if (validSourceSpecLinkRows.length > 0) {
    await db.insert(sourceSpecLinks).values(validSourceSpecLinkRows).onConflictDoNothing();
  }

  const missingEntityWarnings = validSourceSpecLinkRows
    .filter((link) => !existingEntityIds.has(link.entityId))
    .map((link) => ({
      projectId,
      indexRunId,
      filePath: link.filePath,
      entityId: link.entityId,
      level: "warning",
      code: "source_spec_missing_entity",
      message: `Source annotation references missing spec entity "${link.entityId}".`
    }));

  if (missingEntityWarnings.length > 0) {
    await db.insert(validationMessages).values(missingEntityWarnings);
  }

  if (invalidAnnotationWarnings.length > 0) {
    await db.insert(validationMessages).values(invalidAnnotationWarnings);
  }

  if (result.warnings.length > 0) {
    await db.insert(validationMessages).values(
      result.warnings.map((warning) => ({
        projectId,
        indexRunId,
        filePath: warning.filePath,
        entityId: null,
        level: "warning",
        code: warning.code,
        message: warning.message
      }))
    );
  }

  return {
    sourceFileCount: result.files.length,
    sourceImportCount: result.files.reduce((total, file) => total + file.imports.length, 0),
    sourceExportCount: result.files.reduce((total, file) => total + file.exports.length, 0),
    sourceSymbolCount: result.files.reduce((total, file) => total + file.symbols.length, 0),
    warningCount: result.warnings.length + missingEntityWarnings.length + invalidAnnotationWarnings.length
  };
}

async function listSourceSpecLinksForEntity(
  db: SourceScanDb,
  input: { projectId: string; repoPath: string; entityId: string }
): Promise<SourceSpecLinkDto[]> {
  const rows = await db
    .select()
    .from(sourceSpecLinks)
    .where(and(eq(sourceSpecLinks.projectId, input.projectId), eq(sourceSpecLinks.entityId, input.entityId)))
    .orderBy(asc(sourceSpecLinks.filePath), asc(sourceSpecLinks.symbolName), asc(sourceSpecLinks.id));
  const excerptCache = new Map<string, Promise<SourceSpecLinkDto["excerpt"]>>();

  return mapWithConcurrency(rows, SOURCE_EXCERPT_CONCURRENCY, async (row) => {
    const excerptKey = sourceExcerptCacheKey(row);
    let excerpt = excerptCache.get(excerptKey);
    if (!excerpt) {
      excerpt = readSourceExcerpt(input.repoPath, row);
      excerptCache.set(excerptKey, excerpt);
    }

    return {
      id: row.id,
      projectId: row.projectId,
      sourceFileId: row.sourceFileId,
      filePath: row.filePath,
      entityId: row.entityId,
      symbolName: row.symbolName,
      symbolKind: row.symbolKind,
      symbolLine: row.symbolLine,
      annotationLine: row.annotationLine,
      contentHash: row.contentHash,
      excerpt: await excerpt,
      createdAt: row.createdAt.toISOString()
    };
  });
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await mapper(items[index]);
      }
    })
  );

  return results;
}

function sourceExcerptCacheKey(link: typeof sourceSpecLinks.$inferSelect): string {
  return [link.filePath, link.contentHash, link.annotationLine ?? "", link.symbolLine ?? ""].join("|");
}

async function readSourceExcerpt(
  repoPath: string,
  link: typeof sourceSpecLinks.$inferSelect
): Promise<SourceSpecLinkDto["excerpt"]> {
  try {
    const targetPath = assertInsideDirectory(repoPath, path.join(repoPath, link.filePath));
    const safePath = await assertRealPathInsideDirectory(repoPath, targetPath);
    const fileStats = await stat(safePath);

    if (fileStats.size > MAX_SOURCE_EXCERPT_FILE_BYTES) {
      return {
        status: "unavailable",
        message: "Source file is too large to excerpt."
      };
    }

    const content = await readFile(safePath, "utf8");

    if (sha256(content) !== link.contentHash) {
      return { status: "changed", message: "Source file changed since the last index run." };
    }

    const text = content.replace(/\r?\n$/, "");
    const lines = text.length > 0 ? text.split(/\r?\n/) : [""];
    return {
      status: "available",
      startLine: 1,
      endLine: lines.length,
      text
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        status: "missing",
        message: "Source file is missing."
      };
    }

    return {
      status: "unavailable",
      message: "Source excerpt unavailable."
    };
  }
}

async function listSourceFiles(
  db: SourceScanDb,
  projectId: string,
  query: SourceFileListQuery
): Promise<SourceFileSummaryDto[]> {
  const filters = [eq(sourceFiles.projectId, projectId)];

  if (query.language) {
    filters.push(eq(sourceFiles.language, query.language));
  }

  if (query.kind) {
    filters.push(eq(sourceFiles.kind, query.kind));
  }

  if (query.q) {
    filters.push(ilike(sourceFiles.path, `%${query.q}%`));
  }

  const rows = await db
    .select({
      id: sourceFiles.id,
      projectId: sourceFiles.projectId,
      path: sourceFiles.path,
      language: sourceFiles.language,
      kind: sourceFiles.kind,
      sizeBytes: sourceFiles.sizeBytes,
      contentHash: sourceFiles.contentHash,
      lastSeenAt: sourceFiles.lastSeenAt
    })
    .from(sourceFiles)
    .where(and(...filters))
    .orderBy(asc(sourceFiles.path))
    .limit(query.limit)
    .offset(query.offset);

  if (rows.length === 0) {
    return [];
  }

  const sourceFileIds = rows.map((row) => row.id);
  const importCounts = await countSourceFacts(
    db,
    sourceImports,
    sourceImports.sourceFileId,
    projectId,
    sourceFileIds
  );
  const exportCounts = await countSourceFacts(
    db,
    sourceExports,
    sourceExports.sourceFileId,
    projectId,
    sourceFileIds
  );
  const symbolCounts = await countSourceFacts(
    db,
    sourceSymbols,
    sourceSymbols.sourceFileId,
    projectId,
    sourceFileIds
  );

  return rows.map((row) =>
    mapSourceFileSummary({
      ...row,
      importCount: importCounts.get(row.id) ?? 0,
      exportCount: exportCounts.get(row.id) ?? 0,
      symbolCount: symbolCounts.get(row.id) ?? 0
    })
  );
}

async function getSourceFileDetail(
  db: SourceScanDb,
  projectId: string,
  sourceFileId: string
): Promise<SourceFileDetailDto> {
  const [sourceFile] = await db
    .select()
    .from(sourceFiles)
    .where(and(eq(sourceFiles.projectId, projectId), eq(sourceFiles.id, sourceFileId)));

  if (!sourceFile) {
    throw new NotFoundError("Source file not found", { projectId, sourceFileId });
  }

  const imports = await db
    .select()
    .from(sourceImports)
    .where(and(eq(sourceImports.projectId, projectId), eq(sourceImports.sourceFileId, sourceFileId)))
    .orderBy(asc(sourceImports.specifier), asc(sourceImports.importKind), asc(sourceImports.id));
  const exports = await db
    .select()
    .from(sourceExports)
    .where(and(eq(sourceExports.projectId, projectId), eq(sourceExports.sourceFileId, sourceFileId)))
    .orderBy(asc(sourceExports.exportedName), asc(sourceExports.exportKind), asc(sourceExports.id));
  const symbols = await db
    .select()
    .from(sourceSymbols)
    .where(and(eq(sourceSymbols.projectId, projectId), eq(sourceSymbols.sourceFileId, sourceFileId)))
    .orderBy(asc(sourceSymbols.name), asc(sourceSymbols.symbolKind), asc(sourceSymbols.id));

  return {
    id: sourceFile.id,
    projectId: sourceFile.projectId,
    path: sourceFile.path,
    language: sourceFile.language as SourceFileDetailDto["language"],
    kind: sourceFile.kind as SourceFileDetailDto["kind"],
    sizeBytes: sourceFile.sizeBytes,
    contentHash: sourceFile.contentHash,
    lastSeenAt: sourceFile.lastSeenAt.toISOString(),
    imports: imports.map((sourceImport) => ({
      id: sourceImport.id,
      specifier: sourceImport.specifier,
      importKind: sourceImport.importKind,
      importedNames: sourceImport.importedNames,
      isRelative: sourceImport.isRelative,
      resolvedPath: sourceImport.resolvedPath
    })),
    exports: exports.map((sourceExport) => ({
      id: sourceExport.id,
      exportedName: sourceExport.exportedName,
      exportKind: sourceExport.exportKind,
      sourceSpecifier: sourceExport.sourceSpecifier
    })),
    symbols: symbols.map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      symbolKind: symbol.symbolKind,
      isExported: symbol.isExported,
      line: symbol.line,
      metadata: toRecord(symbol.metadataJson)
    }))
  };
}

async function countSourceFacts(
  db: SourceScanDb,
  table: typeof sourceImports | typeof sourceExports | typeof sourceSymbols,
  sourceFileIdColumn:
    | typeof sourceImports.sourceFileId
    | typeof sourceExports.sourceFileId
    | typeof sourceSymbols.sourceFileId,
  projectId: string,
  sourceFileIds: string[]
): Promise<Map<string, number>> {
  const rows = await db
    .select({ sourceFileId: sourceFileIdColumn, total: count() })
    .from(table)
    .where(and(eq(table.projectId, projectId), inArray(sourceFileIdColumn, sourceFileIds)))
    .groupBy(sourceFileIdColumn);

  return new Map(rows.map((row) => [row.sourceFileId, row.total]));
}

async function getSourceAggregate(
  db: SourceScanDb,
  projectId: string
): Promise<SourceAggregateDto> {
  const [totalRow] = await db
    .select({ totalFiles: count() })
    .from(sourceFiles)
    .where(eq(sourceFiles.projectId, projectId));
  const languageRows = await db
    .select({ key: sourceFiles.language, total: count() })
    .from(sourceFiles)
    .where(eq(sourceFiles.projectId, projectId))
    .groupBy(sourceFiles.language);
  const kindRows = await db
    .select({ key: sourceFiles.kind, total: count() })
    .from(sourceFiles)
    .where(eq(sourceFiles.projectId, projectId))
    .groupBy(sourceFiles.kind);

  return {
    totalFiles: totalRow?.totalFiles ?? 0,
    byLanguage: Object.fromEntries(
      languageRows.map((row) => [row.key ?? "unknown", row.total])
    ),
    byKind: Object.fromEntries(kindRows.map((row) => [row.key, row.total]))
  };
}

function mapSourceFileSummary(row: {
  id: string;
  projectId: string;
  path: string;
  language: string | null;
  kind: string;
  sizeBytes: number;
  contentHash: string;
  lastSeenAt: Date;
  importCount: number;
  exportCount: number;
  symbolCount: number;
}): SourceFileSummaryDto {
  return {
    id: row.id,
    projectId: row.projectId,
    path: row.path,
    language: row.language as SourceFileSummaryDto["language"],
    kind: row.kind as SourceFileSummaryDto["kind"],
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    lastSeenAt: row.lastSeenAt.toISOString(),
    importCount: row.importCount,
    exportCount: row.exportCount,
    symbolCount: row.symbolCount
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function isValidSpecopsEntityId(value: string): boolean {
  return value.trim().length > 0 && value === value.trim();
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
