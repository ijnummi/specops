import type {
  SystemMapAreaType,
  SystemMapCoverage,
  SystemMapDiagnostic,
  SystemMapEvidenceDto,
  SystemMapResponseDto,
} from "@specops/contracts";
import { systemMapResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSymbols,
  systemMapAreas,
  systemMapSnapshots,
} from "@specops/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

type SourceFileRow = typeof sourceFiles.$inferSelect;
type SourceSymbolRow = typeof sourceSymbols.$inferSelect;
type SourceImportRow = typeof sourceImports.$inferSelect;
type SourceExportRow = typeof sourceExports.$inferSelect;
type SystemMapSnapshotRow = typeof systemMapSnapshots.$inferSelect;
type SystemMapAreaRow = typeof systemMapAreas.$inferSelect;

type BuildSystemMapInput = {
  projectId: string;
  analyzeRunId: string;
  indexRunId: string | null;
};

type LinkMapToDraftsInput = {
  projectId: string;
  analyzeRunId: string;
  proposalIds: string[];
};

const areaOrder: SystemMapAreaType[] = [
  "backend_routes",
  "backend_services",
  "frontend_routes",
  "frontend_components",
  "data_models",
  "tests",
  "config",
  "packages",
  "unknown",
];

const areaLabels: Record<SystemMapAreaType, string> = {
  backend_routes: "Backend routes",
  backend_services: "Backend services",
  frontend_routes: "Frontend routes",
  frontend_components: "Frontend components",
  data_models: "Data models",
  tests: "Tests",
  config: "Config",
  packages: "Packages",
  unknown: "Unknown",
};

export function createSystemMapService(db: Db) {
  async function buildSystemMap(input: BuildSystemMapInput): Promise<SystemMapResponseDto> {
    await db
      .delete(systemMapSnapshots)
      .where(
        and(
          eq(systemMapSnapshots.projectId, input.projectId),
          eq(systemMapSnapshots.analyzeRunId, input.analyzeRunId),
        ),
      );

    const files = await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, input.projectId))
      .orderBy(asc(sourceFiles.path), asc(sourceFiles.id));
    const fileIds = files.map((file) => file.id);
    const symbols = fileIds.length > 0 ? await loadSymbols(input.projectId, fileIds) : [];
    const imports = fileIds.length > 0 ? await loadImports(input.projectId, fileIds) : [];
    const exports = fileIds.length > 0 ? await loadExports(input.projectId, fileIds) : [];
    const areas = buildAreas(files, symbols, imports, exports);
    const diagnostics: SystemMapDiagnostic[] =
      files.length === 0
        ? [
            {
              level: "warning",
              code: "no_supported_source",
              message: "No indexed source files were available for the system map.",
            },
          ]
        : [];
    const coverage = buildCoverage(files, areas);
    const [snapshot] = await db
      .insert(systemMapSnapshots)
      .values({
        projectId: input.projectId,
        analyzeRunId: input.analyzeRunId,
        status: files.length === 0 ? "limited" : "ready",
        summary: summarizeMap(files.length, areas),
        coverageJson: coverage,
        diagnosticsJson: diagnostics,
      })
      .returning();

    if (!snapshot) {
      throw new Error("Failed to create system map snapshot");
    }

    if (areas.length > 0) {
      await db.insert(systemMapAreas).values(
        areas.map((area) => ({
          snapshotId: snapshot.id,
          projectId: input.projectId,
          areaType: area.areaType,
          name: area.name,
          summary: area.summary,
          confidence: area.confidence,
          evidenceJson: area.evidence,
          keyFilesJson: area.keyFiles,
          keySymbolsJson: area.keySymbols,
          relatedProposalIdsJson: [],
          diagnosticsJson: area.diagnostics,
          sortOrder: area.sortOrder,
        })),
      );
    }

    return getSystemMap(input.projectId, input.analyzeRunId);
  }

  async function linkMapToDrafts(input: LinkMapToDraftsInput): Promise<SystemMapResponseDto> {
    const snapshot = await getSnapshotRow(input.projectId, input.analyzeRunId);
    const areas = await db
      .select()
      .from(systemMapAreas)
      .where(eq(systemMapAreas.snapshotId, snapshot.id))
      .orderBy(asc(systemMapAreas.sortOrder), asc(systemMapAreas.id));

    if (areas.length === 0 || input.proposalIds.length === 0) {
      return getSystemMap(input.projectId, input.analyzeRunId);
    }

    const proposals = await db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.projectId, input.projectId), inArray(aiProposals.id, input.proposalIds)));

    for (const area of areas) {
      const evidencePaths = new Set(readEvidence(area.evidenceJson).map((item) => item.sourceFilePath));
      const matchedProposalIds = proposals
        .filter((proposal) =>
          proposalEvidencePaths(proposal.evidenceJson).some((filePath) => evidencePaths.has(filePath)),
        )
        .map((proposal) => proposal.id);

      if (matchedProposalIds.length === 0) {
        continue;
      }

      const relatedProposalIds = uniqueStrings([
        ...readStringArray(area.relatedProposalIdsJson),
        ...matchedProposalIds,
      ]);
      await db
        .update(systemMapAreas)
        .set({ relatedProposalIdsJson: relatedProposalIds, updatedAt: new Date() })
        .where(eq(systemMapAreas.id, area.id));
    }

    return getSystemMap(input.projectId, input.analyzeRunId);
  }

  async function getSystemMap(projectId: string, analyzeRunId: string): Promise<SystemMapResponseDto> {
    const snapshot = await getSnapshotRow(projectId, analyzeRunId);
    const areas = await db
      .select()
      .from(systemMapAreas)
      .where(eq(systemMapAreas.snapshotId, snapshot.id))
      .orderBy(asc(systemMapAreas.sortOrder), asc(systemMapAreas.id));

    return systemMapResponseSchema.parse({
      snapshot: mapSnapshot(snapshot),
      areas: areas.map(mapArea),
    });
  }

  async function getSnapshotRow(projectId: string, analyzeRunId: string): Promise<SystemMapSnapshotRow> {
    const [snapshot] = await db
      .select()
      .from(systemMapSnapshots)
      .where(
        and(
          eq(systemMapSnapshots.projectId, projectId),
          eq(systemMapSnapshots.analyzeRunId, analyzeRunId),
        ),
      )
      .limit(1);

    if (!snapshot) {
      throw new NotFoundError("System map not found", { projectId, analyzeRunId });
    }

    return snapshot;
  }

  async function loadSymbols(projectId: string, sourceFileIds: string[]) {
    return db
      .select()
      .from(sourceSymbols)
      .where(and(eq(sourceSymbols.projectId, projectId), inArray(sourceSymbols.sourceFileId, sourceFileIds)))
      .orderBy(asc(sourceSymbols.filePath), asc(sourceSymbols.line), asc(sourceSymbols.name));
  }

  async function loadImports(projectId: string, sourceFileIds: string[]) {
    return db
      .select()
      .from(sourceImports)
      .where(and(eq(sourceImports.projectId, projectId), inArray(sourceImports.sourceFileId, sourceFileIds)))
      .orderBy(asc(sourceImports.filePath), asc(sourceImports.specifier));
  }

  async function loadExports(projectId: string, sourceFileIds: string[]) {
    return db
      .select()
      .from(sourceExports)
      .where(and(eq(sourceExports.projectId, projectId), inArray(sourceExports.sourceFileId, sourceFileIds)))
      .orderBy(asc(sourceExports.filePath), asc(sourceExports.exportedName));
  }

  return {
    buildSystemMap,
    linkMapToDrafts,
    getSystemMap,
  };
}

type BuiltArea = {
  areaType: SystemMapAreaType;
  name: string;
  summary: string;
  confidence: number;
  evidence: SystemMapEvidenceDto[];
  keyFiles: string[];
  keySymbols: string[];
  diagnostics: SystemMapDiagnostic[];
  sortOrder: number;
};

function buildAreas(
  files: SourceFileRow[],
  symbols: SourceSymbolRow[],
  imports: SourceImportRow[],
  exports: SourceExportRow[],
): BuiltArea[] {
  const symbolsByFile = groupBy(symbols, (symbol) => symbol.sourceFileId);
  const importsByFile = groupBy(imports, (sourceImport) => sourceImport.sourceFileId);
  const exportsByFile = groupBy(exports, (sourceExport) => sourceExport.sourceFileId);
  const filesByArea = new Map<SystemMapAreaType, SourceFileRow[]>();

  for (const file of files) {
    const areaType = classifyArea(file.path, file.kind);
    filesByArea.set(areaType, [...(filesByArea.get(areaType) ?? []), file]);
  }

  return areaOrder.flatMap((areaType, sortIndex) => {
    const areaFiles = filesByArea.get(areaType) ?? [];
    if (areaFiles.length === 0) {
      return [];
    }

    const evidence = areaFiles.flatMap<SystemMapEvidenceDto>((file) => {
      const fileSymbols = symbolsByFile.get(file.id) ?? [];
      if (fileSymbols.length === 0) {
        return [
          {
            sourceFileId: file.id,
            sourceFilePath: file.path,
            symbolName: null,
            symbolKind: null,
            startLine: null,
            relationship: relationshipForArea(areaType),
          } satisfies SystemMapEvidenceDto,
        ];
      }

      return fileSymbols.slice(0, 8).map((symbol) => ({
        sourceFileId: file.id,
        sourceFilePath: file.path,
        symbolName: symbol.name,
        symbolKind: symbol.symbolKind,
        startLine: symbol.line,
        relationship: relationshipForArea(areaType),
      }) satisfies SystemMapEvidenceDto);
    });

    const keySymbols = uniqueStrings(
      areaFiles.flatMap((file) => (symbolsByFile.get(file.id) ?? []).map((symbol) => symbol.name)),
    ).slice(0, 12);
    const symbolCount = areaFiles.reduce((total, file) => total + (symbolsByFile.get(file.id)?.length ?? 0), 0);
    const importCount = areaFiles.reduce((total, file) => total + (importsByFile.get(file.id)?.length ?? 0), 0);
    const exportCount = areaFiles.reduce((total, file) => total + (exportsByFile.get(file.id)?.length ?? 0), 0);
    const fileWord = areaFiles.length === 1 ? "file" : "files";
    const symbolWord = symbolCount === 1 ? "symbol" : "symbols";

    return [
      {
        areaType,
        name: areaLabels[areaType],
        summary: `${areaLabels[areaType]} include ${areaFiles.length} source ${fileWord}, ${symbolCount} ${symbolWord}, ${importCount} imports, and ${exportCount} exports.`,
        confidence: areaType === "unknown" ? 0.35 : 0.8,
        evidence,
        keyFiles: areaFiles.map((file) => file.path),
        keySymbols,
        diagnostics:
          areaType === "unknown"
            ? [
                {
                  level: "info",
                  code: "unknown_area_classification",
                  message: "These files did not match a stronger system map classification.",
                },
              ]
            : [],
        sortOrder: sortIndex,
      },
    ];
  });
}

function classifyArea(filePath: string, kind: string): SystemMapAreaType {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (kind === "test" || /\.test\.[cm]?[jt]sx?$/.test(normalized) || /\.spec\.[cm]?[jt]sx?$/.test(normalized)) {
    return "tests";
  }
  if (kind === "config" || normalized.includes("config") || normalized.endsWith(".config.ts")) {
    return "config";
  }
  if (normalized.includes("/routes/") && normalized.endsWith(".tsx")) {
    return "frontend_routes";
  }
  if (normalized.includes("/routes/")) {
    return "backend_routes";
  }
  if (normalized.includes("/services/") || normalized.includes("/service")) {
    return "backend_services";
  }
  if (normalized.includes("/components/") || normalized.includes("/pages/")) {
    return "frontend_components";
  }
  if (
    normalized.includes("/schema") ||
    normalized.includes("/model") ||
    normalized.includes("/domain") ||
    normalized.includes("/db/")
  ) {
    return "data_models";
  }
  if (normalized.startsWith("packages/")) {
    return "packages";
  }
  return "unknown";
}

function relationshipForArea(areaType: SystemMapAreaType): SystemMapEvidenceDto["relationship"] {
  if (areaType === "tests") {
    return "tests";
  }
  if (areaType === "config") {
    return "configures";
  }
  if (areaType === "backend_routes" || areaType === "frontend_routes" || areaType === "data_models") {
    return "defines";
  }
  return "references";
}

function buildCoverage(files: SourceFileRow[], areas: BuiltArea[]): SystemMapCoverage {
  const mappedSourceFileCount = uniqueStrings(areas.flatMap((area) => area.keyFiles)).length;
  return {
    sourceFileCount: files.length,
    mappedSourceFileCount,
    unmappedSourceFileCount: Math.max(files.length - mappedSourceFileCount, 0),
    areaCounts: Object.fromEntries(areas.map((area) => [area.areaType, 1])),
  };
}

function summarizeMap(sourceFileCount: number, areas: BuiltArea[]): string {
  if (sourceFileCount === 0) {
    return "No supported source files were available for the system map.";
  }

  const labels = areas.map((area) => area.name.toLowerCase()).join(", ");
  return `Mapped ${sourceFileCount} source files into ${areas.length} system areas: ${labels}.`;
}

function mapSnapshot(row: SystemMapSnapshotRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    analyzeRunId: row.analyzeRunId,
    status: row.status,
    summary: row.summary,
    coverage: row.coverageJson,
    diagnostics: row.diagnosticsJson,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapArea(row: SystemMapAreaRow) {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    areaType: row.areaType,
    name: row.name,
    summary: row.summary,
    confidence: row.confidence,
    evidence: readEvidence(row.evidenceJson),
    keyFiles: readStringArray(row.keyFilesJson),
    keySymbols: readStringArray(row.keySymbolsJson),
    relatedProposalIds: readStringArray(row.relatedProposalIdsJson),
    diagnostics: readDiagnostics(row.diagnosticsJson),
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function proposalEvidencePaths(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const sourceFilesValue = (value as Record<string, unknown>).sourceFiles;
  if (!Array.isArray(sourceFilesValue)) {
    return [];
  }

  return sourceFilesValue.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const pathValue = (item as Record<string, unknown>).path;
    return typeof pathValue === "string" && pathValue.length > 0 ? [pathValue] : [];
  });
}

function readEvidence(value: unknown): SystemMapEvidenceDto[] {
  return Array.isArray(value) ? (value as SystemMapEvidenceDto[]) : [];
}

function readDiagnostics(value: unknown): SystemMapDiagnostic[] {
  return Array.isArray(value) ? (value as SystemMapDiagnostic[]) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
