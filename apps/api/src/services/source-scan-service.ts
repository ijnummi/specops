import type {
  SourceAggregateDto,
  SourceFileDetailDto,
  SourceFileListQuery,
  SourceFileSummaryDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSymbols,
  validationMessages
} from "@specops/db";
import { scanRepository, type ScanRepositoryResult } from "@specops/repo-scanner";
import { and, asc, count, eq, ilike, sql } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

type SourceScanDb = Pick<Db, "delete" | "insert" | "select">;

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
      return listSourceFiles(db, projectId, query);
    },

    async getSourceFileDetail(
      projectId: string,
      sourceFileId: string
    ): Promise<SourceFileDetailDto> {
      return getSourceFileDetail(db, projectId, sourceFileId);
    },

    async getSourceAggregate(projectId: string): Promise<SourceAggregateDto> {
      return getSourceAggregate(db, projectId);
    }
  };
}

async function persistSourceScan(
  db: SourceScanDb,
  projectId: string,
  indexRunId: string,
  result: ScanRepositoryResult
): Promise<SourceScanCounts> {
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
    warningCount: result.warnings.length
  };
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
      lastSeenAt: sourceFiles.lastSeenAt,
      importCount: sql<number>`(
        select count(*)::int from ${sourceImports}
        where ${sourceImports.sourceFileId} = ${sourceFiles.id}
      )`,
      exportCount: sql<number>`(
        select count(*)::int from ${sourceExports}
        where ${sourceExports.sourceFileId} = ${sourceFiles.id}
      )`,
      symbolCount: sql<number>`(
        select count(*)::int from ${sourceSymbols}
        where ${sourceSymbols.sourceFileId} = ${sourceFiles.id}
      )`
    })
    .from(sourceFiles)
    .where(and(...filters))
    .orderBy(asc(sourceFiles.path));

  return rows.map(mapSourceFileSummary);
}

async function getSourceFileDetail(
  db: SourceScanDb,
  projectId: string,
  sourceFileId: string
): Promise<SourceFileDetailDto> {
  const [summary] = await listSourceFiles(db, projectId, {}).then((rows) =>
    rows.filter((row) => row.id === sourceFileId)
  );

  if (!summary) {
    throw new NotFoundError("Source file not found", { projectId, sourceFileId });
  }

  const [imports, exports, symbols] = await Promise.all([
    db
      .select()
      .from(sourceImports)
      .where(and(eq(sourceImports.projectId, projectId), eq(sourceImports.sourceFileId, sourceFileId)))
      .orderBy(asc(sourceImports.specifier), asc(sourceImports.importKind), asc(sourceImports.id)),
    db
      .select()
      .from(sourceExports)
      .where(and(eq(sourceExports.projectId, projectId), eq(sourceExports.sourceFileId, sourceFileId)))
      .orderBy(asc(sourceExports.exportedName), asc(sourceExports.exportKind), asc(sourceExports.id)),
    db
      .select()
      .from(sourceSymbols)
      .where(and(eq(sourceSymbols.projectId, projectId), eq(sourceSymbols.sourceFileId, sourceFileId)))
      .orderBy(asc(sourceSymbols.name), asc(sourceSymbols.symbolKind), asc(sourceSymbols.id))
  ]);

  return {
    id: summary.id,
    projectId: summary.projectId,
    path: summary.path,
    language: summary.language,
    kind: summary.kind,
    sizeBytes: summary.sizeBytes,
    contentHash: summary.contentHash,
    lastSeenAt: summary.lastSeenAt,
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

async function getSourceAggregate(
  db: SourceScanDb,
  projectId: string
): Promise<SourceAggregateDto> {
  const [[totalRow], languageRows, kindRows] = await Promise.all([
    db
      .select({ totalFiles: count() })
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId)),
    db
      .select({ key: sourceFiles.language, total: count() })
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId))
      .groupBy(sourceFiles.language),
    db
      .select({ key: sourceFiles.kind, total: count() })
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId))
      .groupBy(sourceFiles.kind)
  ]);

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
