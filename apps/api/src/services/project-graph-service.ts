import type {
  ProjectGraphCoverage,
  ProjectGraphDiagnostic,
  ProjectGraphEdgeDto,
  ProjectGraphEdgeType,
  ProjectGraphListResponse,
  ProjectGraphNodeDetail,
  ProjectGraphNodeDto,
  ProjectGraphNodeType,
  ProjectGraphProvenance,
  ProjectGraphQuery,
  ProjectGraphVersionDto,
} from "@specops/contracts";
import {
  projectGraphListResponseSchema,
  projectGraphNodeDetailSchema,
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecAnnotations,
  sourceSymbols,
  specEntities,
} from "@specops/db";
import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

type SourceFileRow = typeof sourceFiles.$inferSelect;
type SourceImportRow = typeof sourceImports.$inferSelect;
type SourceExportRow = typeof sourceExports.$inferSelect;
type SourceSymbolRow = typeof sourceSymbols.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;
type SourceSpecAnnotationRow = typeof sourceSpecAnnotations.$inferSelect;
type ProjectGraphVersionRow = typeof projectGraphVersions.$inferSelect;
type ProjectGraphNodeRow = typeof projectGraphNodes.$inferSelect;
type ProjectGraphEdgeRow = typeof projectGraphEdges.$inferSelect;

type BuildProjectGraphInput = {
  projectId: string;
  indexRunId: string | null;
};

type RecordFailedGraphVersionInput = {
  projectId: string;
  indexRunId: string | null;
  error: unknown;
};

type NodeDraft = {
  nodeKey: string;
  nodeType: ProjectGraphNodeType;
  label: string;
  path: string | null;
  symbolName: string | null;
  entityId: string | null;
  sourceRef: Record<string, unknown>;
  metadata: Record<string, unknown>;
  confidence: number | null;
};

type EdgeDraft = {
  fromNodeKey: string;
  toNodeKey: string;
  edgeType: ProjectGraphEdgeType;
  provenance: ProjectGraphProvenance;
  sourceRef: Record<string, unknown>;
  metadata: Record<string, unknown>;
  confidence: number | null;
};

type IndexedFacts = {
  files: SourceFileRow[];
  imports: SourceImportRow[];
  exports: SourceExportRow[];
  symbols: SourceSymbolRow[];
  specs: SpecEntityRow[];
  annotations: SourceSpecAnnotationRow[];
};

const insertChunkSize = 500;
const nodeDetailEdgeLimit = 100;

export function createProjectGraphService(db: Db) {
  async function buildProjectGraph(input: BuildProjectGraphInput): Promise<ProjectGraphListResponse> {
    const facts = await loadIndexedFacts(input.projectId);
    const drafts = buildGraphDrafts(facts);
    const diagnostics = [...buildDiagnostics(facts), ...drafts.diagnostics];
    const coverage = buildCoverage(drafts.nodes, drafts.edges, facts);
    const status = facts.files.length === 0 ? "limited" : "ready";
    const summary =
      status === "limited"
        ? "Limited project graph: no indexed source files were available."
        : `Project graph with ${facts.files.length} source files and ${facts.specs.length} spec entities.`;

    const graphVersionId = await db.transaction(async (tx) => {
      const indexRunFilter =
        input.indexRunId === null
          ? isNull(projectGraphVersions.indexRunId)
          : eq(projectGraphVersions.indexRunId, input.indexRunId);

      await tx
        .update(projectGraphVersions)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(and(eq(projectGraphVersions.projectId, input.projectId), indexRunFilter));

      const [version] = await tx
        .insert(projectGraphVersions)
        .values({
          projectId: input.projectId,
          indexRunId: input.indexRunId,
          status,
          summary,
          coverageJson: coverage,
          diagnosticsJson: diagnostics,
        })
        .returning({ id: projectGraphVersions.id });

      if (!version) {
        throw new Error("Failed to create project graph version");
      }

      if (drafts.nodes.length === 0) {
        return version.id;
      }

      const insertedNodes: Array<{ id: string; nodeKey: string }> = [];
      for (const nodeChunk of chunk(drafts.nodes, insertChunkSize)) {
        const insertedChunk = await tx
          .insert(projectGraphNodes)
          .values(
            nodeChunk.map((node) => ({
            projectId: input.projectId,
            graphVersionId: version.id,
            nodeKey: node.nodeKey,
            nodeType: node.nodeType,
            label: node.label,
            path: node.path,
            symbolName: node.symbolName,
            entityId: node.entityId,
            sourceRefJson: node.sourceRef,
            metadataJson: node.metadata,
            confidence: node.confidence,
            })),
          )
          .returning({ id: projectGraphNodes.id, nodeKey: projectGraphNodes.nodeKey });
        insertedNodes.push(...insertedChunk);
      }
      const nodeIdsByKey = new Map(insertedNodes.map((node) => [node.nodeKey, node.id]));
      const edgeRows = drafts.edges
        .map((edge) => {
          const fromNodeId = nodeIdsByKey.get(edge.fromNodeKey);
          const toNodeId = nodeIdsByKey.get(edge.toNodeKey);
          if (!fromNodeId || !toNodeId) {
            return null;
          }

          return {
            projectId: input.projectId,
            graphVersionId: version.id,
            fromNodeId,
            toNodeId,
            edgeType: edge.edgeType,
            provenance: edge.provenance,
            sourceRefJson: edge.sourceRef,
            metadataJson: edge.metadata,
            confidence: edge.confidence,
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

      if (edgeRows.length > 0) {
        for (const edgeChunk of chunk(edgeRows, insertChunkSize)) {
          await tx.insert(projectGraphEdges).values(edgeChunk);
        }
      }

      return version.id;
    });

    return getProjectGraph(input.projectId, undefined, graphVersionId);
  }

  async function recordFailedGraphVersion(
    input: RecordFailedGraphVersionInput,
  ): Promise<ProjectGraphVersionDto> {
    const diagnostics: ProjectGraphDiagnostic[] = [
      {
        level: "error",
        code: "graph_build_failed",
        message: errorMessage(input.error),
      },
    ];
    const emptyCoverage = buildCoverage([], [], {
      files: [],
      imports: [],
      exports: [],
      symbols: [],
      specs: [],
      annotations: [],
    });
    const [version] = await db
      .insert(projectGraphVersions)
      .values({
        projectId: input.projectId,
        indexRunId: input.indexRunId,
        status: "failed",
        summary: "Project graph build failed.",
        coverageJson: emptyCoverage,
        diagnosticsJson: diagnostics,
      })
      .returning();

    if (!version) {
      throw new Error("Failed to record failed project graph version");
    }

    return mapVersion(version);
  }

  async function getProjectGraph(
    projectId: string,
    query?: ProjectGraphQuery,
    versionId?: string,
  ): Promise<ProjectGraphListResponse> {
    const version = versionId
      ? await getVersionRow(projectId, versionId)
      : await getLatestVersionRow(projectId);
    const limit = query?.limit ?? 50;
    const nodeFilters = [eq(projectGraphNodes.graphVersionId, version.id)];

    if (query?.nodeType) {
      nodeFilters.push(eq(projectGraphNodes.nodeType, query.nodeType));
    }

    if (query?.q) {
      const pattern = `%${query.q}%`;
      nodeFilters.push(
        or(
          ilike(projectGraphNodes.label, pattern),
          ilike(projectGraphNodes.nodeKey, pattern),
          ilike(projectGraphNodes.path, pattern),
          ilike(projectGraphNodes.symbolName, pattern),
          ilike(projectGraphNodes.entityId, pattern),
        )!,
      );
    }

    const nodes = await db
      .select()
      .from(projectGraphNodes)
      .where(and(...nodeFilters))
      .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.label), asc(projectGraphNodes.id))
      .limit(limit);
    let responseNodes = nodes;
    let nodeIds = responseNodes.map((node) => node.id);

    const edgeFilters = [eq(projectGraphEdges.graphVersionId, version.id)];
    if (query?.edgeType) {
      edgeFilters.push(eq(projectGraphEdges.edgeType, query.edgeType));
    }
    if (nodeIds.length > 0) {
      edgeFilters.push(
        or(
          inArray(projectGraphEdges.fromNodeId, nodeIds),
          inArray(projectGraphEdges.toNodeId, nodeIds),
        )!,
      );
    }

    let edges =
      nodes.length === 0
        ? []
        : await db
          .select()
          .from(projectGraphEdges)
          .where(and(...edgeFilters))
          .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
          .limit(limit * 2);
    const missingEndpointIds = uniqueStrings(
      edges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]).filter((nodeId) => !nodeIds.includes(nodeId)),
    );
    const remainingNodeBudget = Math.max(0, limit - responseNodes.length);
    if (missingEndpointIds.length > 0 && remainingNodeBudget > 0) {
      const endpointNodes = await db
        .select()
        .from(projectGraphNodes)
        .where(
          and(
            eq(projectGraphNodes.graphVersionId, version.id),
            inArray(projectGraphNodes.id, missingEndpointIds.slice(0, remainingNodeBudget)),
          ),
        )
        .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.label), asc(projectGraphNodes.id));
      responseNodes = [...responseNodes, ...endpointNodes];
      nodeIds = responseNodes.map((node) => node.id);
    }
    const responseNodeIds = new Set(nodeIds);
    edges = edges.filter(
      (edge) => responseNodeIds.has(edge.fromNodeId) && responseNodeIds.has(edge.toNodeId),
    );

    return projectGraphListResponseSchema.parse({
      version: mapVersion(version),
      nodeCounts: readCoverage(version.coverageJson).nodeCounts,
      edgeCounts: readCoverage(version.coverageJson).edgeCounts,
      nodes: responseNodes.map(mapNode),
      edges: edges.map(mapEdge),
    });
  }

  async function getGraphNode(projectId: string, nodeId: string): Promise<ProjectGraphNodeDetail> {
    const [node] = await db
      .select()
      .from(projectGraphNodes)
      .where(and(eq(projectGraphNodes.projectId, projectId), eq(projectGraphNodes.id, nodeId)))
      .limit(1);

    if (!node) {
      throw new NotFoundError("Project graph node not found", { projectId, nodeId });
    }

    const incomingEdges = await db
      .select()
      .from(projectGraphEdges)
      .where(
        and(
          eq(projectGraphEdges.projectId, projectId),
          eq(projectGraphEdges.graphVersionId, node.graphVersionId),
          eq(projectGraphEdges.toNodeId, nodeId),
        ),
      )
      .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
      .limit(nodeDetailEdgeLimit);
    const outgoingEdges = await db
      .select()
      .from(projectGraphEdges)
      .where(
        and(
          eq(projectGraphEdges.projectId, projectId),
          eq(projectGraphEdges.graphVersionId, node.graphVersionId),
          eq(projectGraphEdges.fromNodeId, nodeId),
        ),
      )
      .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
      .limit(nodeDetailEdgeLimit);
    const edges = [...incomingEdges, ...outgoingEdges];
    const neighborIds = uniqueStrings(
      edges.map((edge) => (edge.fromNodeId === nodeId ? edge.toNodeId : edge.fromNodeId)),
    );
    const neighboringNodes =
      neighborIds.length === 0
        ? []
        : await db
          .select()
          .from(projectGraphNodes)
          .where(
            and(
              eq(projectGraphNodes.projectId, projectId),
              eq(projectGraphNodes.graphVersionId, node.graphVersionId),
              inArray(projectGraphNodes.id, neighborIds),
            ),
          )
          .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.label), asc(projectGraphNodes.id));

    return projectGraphNodeDetailSchema.parse({
      node: mapNode(node),
      incomingEdges: groupEdges(incomingEdges),
      outgoingEdges: groupEdges(outgoingEdges),
      neighboringNodes: neighboringNodes.map(mapNode),
    });
  }

  async function getLatestVersionRow(projectId: string): Promise<ProjectGraphVersionRow> {
    const [version] = await db
      .select()
      .from(projectGraphVersions)
      .where(
        and(
          eq(projectGraphVersions.projectId, projectId),
          or(eq(projectGraphVersions.status, "ready"), eq(projectGraphVersions.status, "limited")),
        ),
      )
      .orderBy(desc(projectGraphVersions.createdAt), desc(projectGraphVersions.id))
      .limit(1);

    if (!version) {
      throw new NotFoundError("Project graph not found", { projectId });
    }

    return version;
  }

  async function getVersionRow(projectId: string, versionId: string): Promise<ProjectGraphVersionRow> {
    const [version] = await db
      .select()
      .from(projectGraphVersions)
      .where(and(eq(projectGraphVersions.projectId, projectId), eq(projectGraphVersions.id, versionId)))
      .limit(1);

    if (!version) {
      throw new NotFoundError("Project graph not found", { projectId, versionId });
    }

    return version;
  }

  async function loadIndexedFacts(projectId: string): Promise<IndexedFacts> {
    const files = await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, projectId))
      .orderBy(asc(sourceFiles.path), asc(sourceFiles.id));
    const [imports, exports, symbols, specs, annotations] = await Promise.all([
      db
        .select()
        .from(sourceImports)
        .where(eq(sourceImports.projectId, projectId))
        .orderBy(asc(sourceImports.filePath), asc(sourceImports.specifier), asc(sourceImports.id)),
      db
        .select()
        .from(sourceExports)
        .where(eq(sourceExports.projectId, projectId))
        .orderBy(asc(sourceExports.filePath), asc(sourceExports.exportedName), asc(sourceExports.id)),
      db
        .select()
        .from(sourceSymbols)
        .where(eq(sourceSymbols.projectId, projectId))
        .orderBy(asc(sourceSymbols.filePath), asc(sourceSymbols.line), asc(sourceSymbols.name)),
      db
        .select()
        .from(specEntities)
        .where(eq(specEntities.projectId, projectId))
        .orderBy(asc(specEntities.entityId), asc(specEntities.id)),
      db
        .select()
        .from(sourceSpecAnnotations)
        .where(and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.status, "active")))
        .orderBy(asc(sourceSpecAnnotations.sourceFilePath), asc(sourceSpecAnnotations.entityId), asc(sourceSpecAnnotations.id)),
    ]);

    return { files, imports, exports, symbols, specs, annotations };
  }

  return {
    buildProjectGraph,
    getProjectGraph,
    getGraphNode,
    recordFailedGraphVersion,
  };
}

function buildGraphDrafts(facts: IndexedFacts): {
  nodes: NodeDraft[];
  edges: EdgeDraft[];
  diagnostics: ProjectGraphDiagnostic[];
} {
  const nodes = new Map<string, NodeDraft>();
  const edges = new Map<string, EdgeDraft>();
  const diagnostics: ProjectGraphDiagnostic[] = [];
  const fileByPath = new Map(facts.files.map((file) => [file.path, file]));
  const symbolsByFileAndName = new Map(facts.symbols.map((symbol) => [symbolKey(symbol.filePath, symbol.name), symbol]));
  const specByEntityId = new Map(facts.specs.map((spec) => [spec.entityId, spec]));

  const addNode = (node: NodeDraft) => {
    if (!nodes.has(node.nodeKey)) {
      nodes.set(node.nodeKey, node);
    }
  };
  const addEdge = (edge: EdgeDraft) => {
    const key = [
      edge.fromNodeKey,
      edge.toNodeKey,
      edge.edgeType,
      edge.provenance,
      JSON.stringify(edge.sourceRef),
    ].join("\0");
    if (!edges.has(key) && edge.fromNodeKey !== edge.toNodeKey) {
      edges.set(key, edge);
    }
  };

  for (const file of facts.files) {
    addPathBoundaryNodes(file, addNode);
    for (const edge of pathBoundaryEdges(file)) {
      addEdge(edge);
    }
    addNode(fileNode(file));
    const parentKey = nearestBoundaryNodeKey(file.path);
    if (parentKey) {
      addEdge({
        fromNodeKey: parentKey,
        toNodeKey: fileKey(file.path),
        edgeType: "contains",
        provenance: "scanner_path",
        sourceRef: { sourceFileId: file.id, path: file.path },
        metadata: {},
        confidence: 1,
      });
    }
  }

  for (const symbol of facts.symbols) {
    addNode(symbolNode(symbol));
    addEdge({
      fromNodeKey: fileKey(symbol.filePath),
      toNodeKey: symbolNodeKey(symbol.filePath, symbol.name),
      edgeType: "defines",
      provenance: "scanner_symbol",
      sourceRef: { sourceSymbolId: symbol.id, sourceFileId: symbol.sourceFileId, path: symbol.filePath },
      metadata: { symbolKind: symbol.symbolKind, line: symbol.line },
      confidence: 1,
    });
  }

  for (const spec of facts.specs) {
    addNode(specNode(spec));
  }

  for (const sourceExport of facts.exports) {
    const symbol = symbolsByFileAndName.get(symbolKey(sourceExport.filePath, sourceExport.exportedName));
    if (!symbol) {
      continue;
    }

    addEdge({
      fromNodeKey: fileKey(sourceExport.filePath),
      toNodeKey: symbolNodeKey(symbol.filePath, symbol.name),
      edgeType: "exports",
      provenance: "scanner_export",
      sourceRef: { sourceExportId: sourceExport.id, sourceFileId: sourceExport.sourceFileId },
      metadata: { exportKind: sourceExport.exportKind, exportedName: sourceExport.exportedName },
      confidence: 1,
    });
  }

  for (const sourceImport of facts.imports) {
    const targetFile = sourceImport.resolvedPath ? fileByPath.get(sourceImport.resolvedPath) : undefined;
    const toNodeKey = targetFile ? fileKey(targetFile.path) : externalDependencyKey(sourceImport.specifier);
    if (!targetFile) {
      addNode(externalDependencyNode(sourceImport.specifier));
    }

    addEdge({
      fromNodeKey: fileKey(sourceImport.filePath),
      toNodeKey,
      edgeType: "imports",
      provenance: "scanner_import",
      sourceRef: {
        sourceImportId: sourceImport.id,
        sourceFileId: sourceImport.sourceFileId,
        specifier: sourceImport.specifier,
      },
      metadata: {
        importKind: sourceImport.importKind,
        importedNames: sourceImport.importedNames,
        resolvedPath: sourceImport.resolvedPath,
      },
      confidence: targetFile ? 1 : 0.8,
    });
  }

  for (const edge of buildTestEdges(facts.files)) {
    addEdge(edge);
  }

  for (const annotation of facts.annotations) {
    const spec = specByEntityId.get(annotation.entityId);
    if (!spec) {
      continue;
    }

    let sourceNodeKey: string | null = null;
    if (annotation.symbolName) {
      const symbol = symbolsByFileAndName.get(symbolKey(annotation.sourceFilePath, annotation.symbolName));
      if (!symbol) {
        diagnostics.push({
          level: "warning",
          code: "missing_annotation_symbol",
          message: `Active source/spec annotation references missing symbol ${annotation.symbolName} in ${annotation.sourceFilePath}.`,
        });
        continue;
      }
      sourceNodeKey = symbolNodeKey(symbol.filePath, symbol.name);
    } else if (fileByPath.has(annotation.sourceFilePath)) {
      sourceNodeKey = fileKey(annotation.sourceFilePath);
    }
    if (!sourceNodeKey) {
      continue;
    }

    addEdge({
      fromNodeKey: sourceNodeKey,
      toNodeKey: specNodeKey(spec.entityId),
      edgeType: "supports_spec",
      provenance: "annotation",
      sourceRef: {
        sourceSpecAnnotationId: annotation.id,
        entityId: annotation.entityId,
        sourceFilePath: annotation.sourceFilePath,
      },
      metadata: {
        relationshipType: annotation.relationshipType,
        provenance: annotation.provenance,
        symbolName: annotation.symbolName,
      },
      confidence: annotation.confidence,
    });
  }

  return {
    nodes: [...nodes.values()].sort(compareNodes),
    edges: [...edges.values()].sort(compareEdges),
    diagnostics,
  };
}

function addPathBoundaryNodes(file: SourceFileRow, addNode: (node: NodeDraft) => void) {
  const packagePath = packagePathFor(file.path);
  if (packagePath) {
    addNode({
      nodeKey: packageKey(packagePath),
      nodeType: "package",
      label: packagePath,
      path: packagePath,
      symbolName: null,
      entityId: null,
      sourceRef: { path: packagePath },
      metadata: {},
      confidence: 0.9,
    });
  }

  for (const modulePath of modulePathsFor(file.path)) {
    addNode({
      nodeKey: moduleKey(modulePath),
      nodeType: "module",
      label: basename(modulePath),
      path: modulePath,
      symbolName: null,
      entityId: null,
      sourceRef: { path: modulePath },
      metadata: {},
      confidence: 0.85,
    });
  }
}

function pathBoundaryEdges(file: SourceFileRow): EdgeDraft[] {
  const packagePath = packagePathFor(file.path);
  const modules = modulePathsFor(file.path);
  const edges: EdgeDraft[] = [];

  if (!packagePath || modules.length === 0) {
    return edges;
  }

  edges.push({
    fromNodeKey: packageKey(packagePath),
    toNodeKey: moduleKey(modules[0]!),
    edgeType: "contains",
    provenance: "scanner_path",
    sourceRef: { path: modules[0] },
    metadata: { boundary: "package_module" },
    confidence: 0.9,
  });

  for (let index = 1; index < modules.length; index += 1) {
    edges.push({
      fromNodeKey: moduleKey(modules[index - 1]!),
      toNodeKey: moduleKey(modules[index]!),
      edgeType: "contains",
      provenance: "scanner_path",
      sourceRef: { path: modules[index] },
      metadata: { boundary: "module_module" },
      confidence: 0.9,
    });
  }

  return edges;
}

function fileNode(file: SourceFileRow): NodeDraft {
  return {
    nodeKey: fileKey(file.path),
    nodeType: "file",
    label: basename(file.path),
    path: file.path,
    symbolName: null,
    entityId: null,
    sourceRef: { sourceFileId: file.id, contentHash: file.contentHash },
    metadata: {
      classification: classifyFile(file),
      language: file.language,
      kind: file.kind,
      sizeBytes: file.sizeBytes,
    },
    confidence: 1,
  };
}

function symbolNode(symbol: SourceSymbolRow): NodeDraft {
  return {
    nodeKey: symbolNodeKey(symbol.filePath, symbol.name),
    nodeType: "symbol",
    label: symbol.name,
    path: symbol.filePath,
    symbolName: symbol.name,
    entityId: null,
    sourceRef: { sourceSymbolId: symbol.id, sourceFileId: symbol.sourceFileId, line: symbol.line },
    metadata: { symbolKind: symbol.symbolKind, isExported: symbol.isExported, ...readRecord(symbol.metadataJson) },
    confidence: 1,
  };
}

function specNode(spec: SpecEntityRow): NodeDraft {
  return {
    nodeKey: specNodeKey(spec.entityId),
    nodeType: "spec_entity",
    label: spec.title,
    path: spec.filePath,
    symbolName: null,
    entityId: spec.entityId,
    sourceRef: { specEntityId: spec.id, filePath: spec.filePath, contentHash: spec.contentHash },
    metadata: { type: spec.type, status: spec.status },
    confidence: 1,
  };
}

function externalDependencyNode(specifier: string): NodeDraft {
  const name = externalDependencyName(specifier);
  return {
    nodeKey: externalDependencyKey(specifier),
    nodeType: "external_dependency",
    label: name,
    path: null,
    symbolName: null,
    entityId: null,
    sourceRef: { specifier },
    metadata: {},
    confidence: 0.8,
  };
}

function buildTestEdges(files: SourceFileRow[]): EdgeDraft[] {
  const sourceFiles = files.filter((file) => classifyFile(file) !== "test");
  const sourceBaseByPath = new Map(sourceFiles.map((file) => [pathWithoutExtension(file.path), file]));
  const sourceBaseByName = new Map(sourceFiles.map((file) => [basename(pathWithoutExtension(file.path)), file]));
  const edges: EdgeDraft[] = [];

  for (const file of files) {
    if (classifyFile(file) !== "test") {
      continue;
    }

    const basePath = pathWithoutExtension(file.path).replace(/(?:\.test|\.spec)$/, "");
    const matched = sourceBaseByPath.get(basePath) ?? sourceBaseByName.get(basename(basePath));
    if (!matched) {
      continue;
    }

    edges.push({
      fromNodeKey: fileKey(file.path),
      toNodeKey: fileKey(matched.path),
      edgeType: "tests",
      provenance: "heuristic_test",
      sourceRef: { sourceFileId: file.id, matchedSourceFileId: matched.id },
      metadata: { strategy: "path_name_match" },
      confidence: 0.82,
    });
  }

  return edges;
}

function buildDiagnostics(facts: IndexedFacts): ProjectGraphDiagnostic[] {
  if (facts.files.length === 0) {
    return [
      {
        level: "warning",
        code: "no_source_files",
        message: "No indexed source files were available for the project graph.",
      },
    ];
  }

  return [];
}

function buildCoverage(
  nodes: NodeDraft[],
  edges: EdgeDraft[],
  facts: IndexedFacts,
): ProjectGraphCoverage {
  return {
    nodeCounts: countBy(nodes, (node) => node.nodeType),
    edgeCounts: countBy(edges, (edge) => edge.edgeType),
    sourceFileCount: facts.files.length,
    specEntityCount: facts.specs.length,
    unresolvedImportCount: facts.imports.filter((sourceImport) => !sourceImport.resolvedPath).length,
    heuristicEdgeCount: edges.filter((edge) => edge.provenance === "heuristic_test").length,
  };
}

function classifyFile(file: SourceFileRow) {
  const filePath = file.path.toLowerCase();
  const name = basename(filePath);

  if (file.kind === "test" || /(?:^|[/.])(test|spec)\.[cm]?[jt]sx?$/.test(name) || filePath.includes("/__tests__/")) {
    return "test";
  }
  if (filePath.includes("/routes/") || filePath.includes("/route.") || filePath.endsWith("/routes.ts")) {
    return "route";
  }
  if (
    filePath.includes("/db/") ||
    filePath.includes("/models/") ||
    filePath.includes("/schema") ||
    name.includes("model")
  ) {
    return "data_model";
  }
  if (
    name.startsWith(".") ||
    name.includes("config") ||
    filePath.endsWith("package.json") ||
    filePath.endsWith("tsconfig.json")
  ) {
    return "config";
  }
  if (file.kind === "source") {
    return "source";
  }

  return "unknown";
}

function packagePathFor(filePath: string): string | null {
  const parts = filePath.split("/");
  if (parts.length === 0) {
    return null;
  }
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length >= 2) {
    return parts.slice(0, 2).join("/");
  }

  return parts[0] ?? null;
}

function modulePathsFor(filePath: string): string[] {
  const parent = dirname(filePath);
  const packagePath = packagePathFor(filePath);
  if (!parent || !packagePath || parent === packagePath) {
    return [];
  }

  const parentParts = parent.split("/");
  const packagePartCount = packagePath.split("/").length;
  const modules: string[] = [];
  for (let index = packagePartCount + 1; index <= parentParts.length; index += 1) {
    modules.push(parentParts.slice(0, index).join("/"));
  }

  return modules;
}

function nearestBoundaryNodeKey(filePath: string): string | null {
  const modules = modulePathsFor(filePath);
  const nearestModule = modules.at(-1);
  if (nearestModule) {
    return moduleKey(nearestModule);
  }
  const packagePath = packagePathFor(filePath);
  return packagePath ? packageKey(packagePath) : null;
}

function externalDependencyName(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@") && parts.length >= 2) {
    return parts.slice(0, 2).join("/");
  }

  return parts[0] ?? specifier;
}

function fileKey(filePath: string) {
  return `file:${filePath}`;
}

function symbolNodeKey(filePath: string, symbolName: string) {
  return `symbol:${filePath}:${symbolName}`;
}

function symbolKey(filePath: string, symbolName: string) {
  return `${filePath}\0${symbolName}`;
}

function specNodeKey(entityId: string) {
  return `spec:${entityId}`;
}

function externalDependencyKey(specifier: string) {
  return `external:${externalDependencyName(specifier)}`;
}

function packageKey(packagePath: string) {
  return `package:${packagePath}`;
}

function moduleKey(modulePath: string) {
  return `module:${modulePath}`;
}

function pathWithoutExtension(filePath: string) {
  return filePath.replace(/\.[^.]+$/, "");
}

function basename(filePath: string) {
  return filePath.split("/").at(-1) ?? filePath;
}

function dirname(filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}

function compareNodes(left: NodeDraft, right: NodeDraft) {
  return (
    left.nodeType.localeCompare(right.nodeType) ||
    left.path?.localeCompare(right.path ?? "") ||
    left.label.localeCompare(right.label) ||
    left.nodeKey.localeCompare(right.nodeKey)
  );
}

function compareEdges(left: EdgeDraft, right: EdgeDraft) {
  return (
    left.edgeType.localeCompare(right.edgeType) ||
    left.fromNodeKey.localeCompare(right.fromNodeKey) ||
    left.toNodeKey.localeCompare(right.toNodeKey)
  );
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function groupEdges(edges: ProjectGraphEdgeRow[]) {
  return edges.reduce<Record<string, ProjectGraphEdgeDto[]>>((groups, edge) => {
    const key = edge.edgeType;
    groups[key] = [...(groups[key] ?? []), mapEdge(edge)];
    return groups;
  }, {});
}

function mapVersion(row: ProjectGraphVersionRow): ProjectGraphVersionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    indexRunId: row.indexRunId,
    status: row.status as ProjectGraphVersionDto["status"],
    summary: row.summary,
    coverage: readCoverage(row.coverageJson),
    diagnostics: readDiagnostics(row.diagnosticsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapNode(row: ProjectGraphNodeRow): ProjectGraphNodeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    graphVersionId: row.graphVersionId,
    nodeKey: row.nodeKey,
    nodeType: row.nodeType as ProjectGraphNodeType,
    label: row.label,
    path: row.path,
    symbolName: row.symbolName,
    entityId: row.entityId,
    sourceRef: readRecord(row.sourceRefJson),
    metadata: readRecord(row.metadataJson),
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapEdge(row: ProjectGraphEdgeRow): ProjectGraphEdgeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    graphVersionId: row.graphVersionId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    edgeType: row.edgeType as ProjectGraphEdgeType,
    provenance: row.provenance as ProjectGraphProvenance,
    sourceRef: readRecord(row.sourceRefJson),
    metadata: readRecord(row.metadataJson),
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
  };
}

function readCoverage(value: unknown): ProjectGraphCoverage {
  const record = readRecord(value);
  return {
    nodeCounts: readNumberRecord(record.nodeCounts),
    edgeCounts: readNumberRecord(record.edgeCounts),
    sourceFileCount: readNumber(record.sourceFileCount),
    specEntityCount: readNumber(record.specEntityCount),
    unresolvedImportCount: readNumber(record.unresolvedImportCount),
    heuristicEdgeCount: readNumber(record.heuristicEdgeCount),
  };
}

function readDiagnostics(value: unknown): ProjectGraphDiagnostic[] {
  return Array.isArray(value) ? (value as ProjectGraphDiagnostic[]) : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readNumberRecord(value: unknown): Record<string, number> {
  const record = readRecord(value);
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .map(([key, value]) => [key, Math.max(0, Math.trunc(value))]),
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" ? Math.max(0, Math.trunc(value)) : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
