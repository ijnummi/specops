import {
  projectGraphListResponseSchema,
  projectGraphNodeDetailSchema,
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  createDb,
  indexRuns,
  projectGraphEdges,
  projectGraphVersions,
  projects,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecAnnotations,
  sourceSymbols,
  specEntities,
} from "@specops/db";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createProjectGraphService } from "../services/project-graph-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createProjectGraphService", () => {
  const projectIds: string[] = [];
  let db: Db;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }

    await migrateTestDatabase(testDatabaseUrl);
    db = createDb(testDatabaseUrl);
  });

  afterEach(async () => {
    for (const projectId of projectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("builds graph nodes and deterministic edges from indexed facts", async () => {
    const { project, indexRun, files } = await createIndexedGraphFixture();

    const built = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });

    expect(projectGraphListResponseSchema.parse(built)).toEqual(built);
    expect(built.version.status).toBe("ready");
    expect(built.version.coverage.sourceFileCount).toBe(4);
    expect(built.version.coverage.unresolvedImportCount).toBe(1);
    expect(built.nodeCounts).toMatchObject({
      package: 1,
      module: expect.any(Number),
      file: 4,
      symbol: 3,
      spec_entity: 1,
      external_dependency: 1,
    });

    const nodeByKey = new Map(built.nodes.map((node) => [node.nodeKey, node]));
    const routeFile = nodeByKey.get("file:apps/api/src/routes/projects.ts");
    const serviceFile = nodeByKey.get("file:apps/api/src/services/project-service.ts");
    const testFile = nodeByKey.get("file:apps/api/src/services/project-service.test.ts");
    const schemaFile = nodeByKey.get("file:apps/api/src/db/schema.ts");
    const fastify = nodeByKey.get("external:fastify");
    const registerSymbol = nodeByKey.get("symbol:apps/api/src/routes/projects.ts:registerProjectRoutes");
    const listProjectsSymbol = nodeByKey.get("symbol:apps/api/src/services/project-service.ts:listProjects");

    expect(routeFile).toMatchObject({
      nodeType: "file",
      path: "apps/api/src/routes/projects.ts",
      metadata: expect.objectContaining({ classification: "route" }),
    });
    expect(serviceFile).toMatchObject({
      metadata: expect.objectContaining({ classification: "source" }),
    });
    expect(testFile).toMatchObject({
      metadata: expect.objectContaining({ classification: "test" }),
    });
    expect(schemaFile).toMatchObject({
      metadata: expect.objectContaining({ classification: "data_model" }),
    });
    expect(fastify).toMatchObject({ nodeType: "external_dependency", label: "fastify" });

    expect(edgeTypes(built, routeFile!.id, registerSymbol!.id)).toContain("defines");
    expect(edgeTypes(built, routeFile!.id, registerSymbol!.id)).toContain("exports");
    expect(edgeTypes(built, routeFile!.id, serviceFile!.id)).toContain("imports");
    expect(edgeTypes(built, routeFile!.id, fastify!.id)).toContain("imports");
    expect(edgeTypes(built, serviceFile!.id, listProjectsSymbol!.id)).toEqual(
      expect.arrayContaining(["defines", "exports"]),
    );
    expect(edgeTypes(built, testFile!.id, serviceFile!.id)).toContain("tests");
    expect(
      edgeTypes(
        built,
        nodeByKey.get("package:apps/api")!.id,
        nodeByKey.get("module:apps/api/src")!.id,
      ),
    ).toContain("contains");
    expect(
      edgeTypes(
        built,
        nodeByKey.get("module:apps/api/src")!.id,
        nodeByKey.get("module:apps/api/src/routes")!.id,
      ),
    ).toContain("contains");

    const detail = await createProjectGraphService(db).getGraphNode(project.id, routeFile!.id);
    expect(projectGraphNodeDetailSchema.parse(detail)).toEqual(detail);
    expect(detail.outgoingEdges.imports.map((edge) => edge.toNodeId)).toEqual(
      expect.arrayContaining([serviceFile!.id, fastify!.id]),
    );
    expect(detail.neighboringNodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([serviceFile!.id, fastify!.id, registerSymbol!.id]),
    );

    const rebuilt = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });
    expect(rebuilt.version.id).not.toBe(built.version.id);
    const [priorVersion] = await db
      .select()
      .from(projectGraphVersions)
      .where(
        and(
          eq(projectGraphVersions.projectId, project.id),
          eq(projectGraphVersions.id, built.version.id),
        ),
      );
    expect(priorVersion?.status).toBe("superseded");
    expect(files).toHaveLength(4);
  });

  it("includes missing endpoint nodes when graph queries return matching edges", async () => {
    const { project, indexRun } = await createIndexedGraphFixture();
    const service = createProjectGraphService(db);
    await service.buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });

    const filtered = await service.getProjectGraph(project.id, { q: "fastify", limit: 50 });
    const nodeIds = new Set(filtered.nodes.map((node) => node.id));

    expect(filtered.nodes.map((node) => node.nodeKey)).toEqual(
      expect.arrayContaining(["external:fastify", "file:apps/api/src/routes/projects.ts"]),
    );
    expect(filtered.edges).toEqual([
      expect.objectContaining({
        edgeType: "imports",
        provenance: "scanner_import",
      }),
    ]);
    for (const edge of filtered.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
  });

  it("bounds incoming and outgoing edges in node detail", async () => {
    const { project, indexRun, files } = await createIndexedGraphFixture();
    const routeFile = files.find((file) => file.path === "apps/api/src/routes/projects.ts")!;
    const extraFiles = await db
      .insert(sourceFiles)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          projectId: project.id,
          path: `apps/api/src/routes/project-importer-${index}.ts`,
          language: "typescript",
          kind: "source",
          sizeBytes: 24,
          contentHash: `project-importer-${index}`,
        })),
      )
      .returning();
    await db.insert(sourceImports).values([
      ...Array.from({ length: 120 }, (_, index) => ({
        projectId: project.id,
        sourceFileId: routeFile.id,
        filePath: routeFile.path,
        specifier: `dependency-${index}`,
        importKind: "named",
        importedNames: [`dependency${index}`],
        isRelative: false,
        resolvedPath: null,
      })),
      ...extraFiles.map((file) => ({
        projectId: project.id,
        sourceFileId: file.id,
        filePath: file.path,
        specifier: "./projects.js",
        importKind: "named",
        importedNames: ["registerProjectRoutes"],
        isRelative: true,
        resolvedPath: routeFile.path,
      })),
    ]);

    const service = createProjectGraphService(db);
    const built = await service.buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });
    const routeGraph = await service.getProjectGraph(
      project.id,
      { q: "file:apps/api/src/routes/projects.ts", limit: 10 },
      built.version.id,
    );
    const routeNode = routeGraph.nodes.find(
      (node) => node.nodeKey === "file:apps/api/src/routes/projects.ts",
    )!;

    const detail = await service.getGraphNode(project.id, routeNode.id);
    const incomingCount = Object.values(detail.incomingEdges).reduce(
      (total, edges) => total + edges.length,
      0,
    );
    const outgoingCount = Object.values(detail.outgoingEdges).reduce(
      (total, edges) => total + edges.length,
      0,
    );
    const neighborIds = new Set(detail.neighboringNodes.map((node) => node.id));

    expect(incomingCount).toBe(100);
    expect(outgoingCount).toBe(100);
    for (const edge of [
      ...Object.values(detail.incomingEdges).flat(),
      ...Object.values(detail.outgoingEdges).flat(),
    ]) {
      const neighborId = edge.fromNodeId === routeNode.id ? edge.toNodeId : edge.fromNodeId;
      expect(neighborIds.has(neighborId)).toBe(true);
    }
  });

  it("bounds incident edge retrieval for high-degree filtered graph queries", async () => {
    const { project, indexRun, files } = await createIndexedGraphFixture();
    const routeFile = files.find((file) => file.path === "apps/api/src/routes/projects.ts")!;
    const extraFiles = await db
      .insert(sourceFiles)
      .values(
        Array.from({ length: 20 }, (_, index) => ({
          projectId: project.id,
          path: `apps/api/src/routes/fastify-consumer-${index}.ts`,
          language: "typescript",
          kind: "source",
          sizeBytes: 24,
          contentHash: `fastify-consumer-${index}`,
        })),
      )
      .returning();
    await db.insert(sourceImports).values(
      extraFiles.map((file) => ({
        projectId: project.id,
        sourceFileId: file.id,
        filePath: file.path,
        specifier: "fastify",
        importKind: "named",
        importedNames: ["FastifyInstance"],
        isRelative: false,
        resolvedPath: null,
      })),
    );
    await db.insert(sourceImports).values({
      projectId: project.id,
      sourceFileId: routeFile.id,
      filePath: routeFile.path,
      specifier: "@fastify/cors",
      importKind: "default",
      importedNames: [],
      isRelative: false,
      resolvedPath: null,
    });

    const service = createProjectGraphService(db);
    await service.buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });
    const observed = observeProjectGraphEdgeSelectLimits(db);
    const filtered = await createProjectGraphService(observed.db).getProjectGraph(project.id, {
      q: "fastify",
      limit: 6,
    });
    const nodeIds = new Set(filtered.nodes.map((node) => node.id));

    expect(observed.edgeSelectLimits).toContain(12);
    expect(filtered.edges.length).toBeLessThanOrEqual(5);
    for (const edge of filtered.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
  });

  it("projects active source spec annotations into supports_spec edges", async () => {
    const { project, indexRun } = await createIndexedGraphFixture();
    await insertSourceSpecAnnotation(project.id, indexRun.id, {
      sourceFilePath: "apps/api/src/routes/projects.ts",
      symbolName: "registerProjectRoutes",
      confidence: 0.91,
      status: "active",
    });
    await insertSourceSpecAnnotation(project.id, indexRun.id, {
      sourceFilePath: "apps/api/src/services/project-service.ts",
      symbolName: "listProjects",
      confidence: 0.51,
      status: "stale",
    });

    const built = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });

    const nodeByKey = new Map(built.nodes.map((node) => [node.nodeKey, node]));
    const registerSymbol = nodeByKey.get("symbol:apps/api/src/routes/projects.ts:registerProjectRoutes");
    const serviceSymbol = nodeByKey.get("symbol:apps/api/src/services/project-service.ts:listProjects");
    const specNode = nodeByKey.get("spec:interface.project-routes");

    expect(edgeTypes(built, registerSymbol!.id, specNode!.id)).toContain("supports_spec");
    expect(edgeTypes(built, serviceSymbol!.id, specNode!.id)).not.toContain("supports_spec");
    expect(
      built.edges.find(
        (edge) =>
          edge.fromNodeId === registerSymbol!.id &&
          edge.toNodeId === specNode!.id &&
          edge.edgeType === "supports_spec",
      ),
    ).toMatchObject({ provenance: "annotation", confidence: 0.91 });
  });

  it("diagnoses active symbol annotations that do not match an indexed symbol", async () => {
    const { project, indexRun } = await createIndexedGraphFixture();
    await insertSourceSpecAnnotation(project.id, indexRun.id, {
      sourceFilePath: "apps/api/src/routes/projects.ts",
      symbolName: "missingSymbol",
      confidence: 0.67,
      status: "active",
    });

    const built = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });

    const nodeByKey = new Map(built.nodes.map((node) => [node.nodeKey, node]));
    const routeFile = nodeByKey.get("file:apps/api/src/routes/projects.ts");
    const specNode = nodeByKey.get("spec:interface.project-routes");

    expect(edgeTypes(built, routeFile!.id, specNode!.id)).not.toContain("supports_spec");
    expect(built.version.diagnostics).toContainEqual({
      level: "warning",
      code: "missing_annotation_symbol",
      message:
        "Active source/spec annotation references missing symbol missingSymbol in apps/api/src/routes/projects.ts.",
    });
  });

  it("creates a limited graph when only specs exist", async () => {
    const { project, indexRun } = await createProjectWithIndexRun();
    await insertSpecEntity(project.id);

    const built = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id,
    });

    expect(projectGraphListResponseSchema.parse(built)).toEqual(built);
    expect(built.version.status).toBe("limited");
    expect(built.version.coverage.sourceFileCount).toBe(0);
    expect(built.version.coverage.specEntityCount).toBe(1);
    expect(built.version.diagnostics).toContainEqual({
      level: "warning",
      code: "no_source_files",
      message: "No indexed source files were available for the project graph.",
    });
    expect(built.nodes).toMatchObject([
      expect.objectContaining({
        nodeType: "spec_entity",
        nodeKey: "spec:interface.project-routes",
      }),
    ]);
    expect(built.edges).toEqual([]);
  });

  async function createIndexedGraphFixture() {
    const { project, indexRun } = await createProjectWithIndexRun();
    await insertSpecEntity(project.id);

    const files = await db
      .insert(sourceFiles)
      .values([
        {
          projectId: project.id,
          path: "apps/api/src/routes/projects.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 128,
          contentHash: "routes-hash",
        },
        {
          projectId: project.id,
          path: "apps/api/src/services/project-service.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 96,
          contentHash: "service-hash",
        },
        {
          projectId: project.id,
          path: "apps/api/src/services/project-service.test.ts",
          language: "typescript",
          kind: "test",
          sizeBytes: 64,
          contentHash: "test-hash",
        },
        {
          projectId: project.id,
          path: "apps/api/src/db/schema.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 32,
          contentHash: "schema-hash",
        },
      ])
      .returning();

    const routeFile = files.find((file) => file.path.endsWith("routes/projects.ts"))!;
    const serviceFile = files.find((file) => file.path.endsWith("project-service.ts"))!;
    const testFile = files.find((file) => file.path.endsWith("project-service.test.ts"))!;
    const schemaFile = files.find((file) => file.path.endsWith("schema.ts"))!;

    await db.insert(sourceImports).values([
      {
        projectId: project.id,
        sourceFileId: routeFile.id,
        filePath: routeFile.path,
        specifier: "fastify",
        importKind: "named",
        importedNames: ["FastifyInstance"],
        isRelative: false,
        resolvedPath: null,
      },
      {
        projectId: project.id,
        sourceFileId: routeFile.id,
        filePath: routeFile.path,
        specifier: "../services/project-service.js",
        importKind: "named",
        importedNames: ["listProjects"],
        isRelative: true,
        resolvedPath: serviceFile.path,
      },
      {
        projectId: project.id,
        sourceFileId: testFile.id,
        filePath: testFile.path,
        specifier: "./project-service.js",
        importKind: "named",
        importedNames: ["listProjects"],
        isRelative: true,
        resolvedPath: serviceFile.path,
      },
    ]);

    await db.insert(sourceSymbols).values([
      {
        projectId: project.id,
        sourceFileId: routeFile.id,
        filePath: routeFile.path,
        name: "registerProjectRoutes",
        symbolKind: "function",
        isExported: true,
        line: 3,
        metadataJson: {},
      },
      {
        projectId: project.id,
        sourceFileId: serviceFile.id,
        filePath: serviceFile.path,
        name: "listProjects",
        symbolKind: "function",
        isExported: true,
        line: 1,
        metadataJson: {},
      },
      {
        projectId: project.id,
        sourceFileId: schemaFile.id,
        filePath: schemaFile.path,
        name: "ProjectRow",
        symbolKind: "type",
        isExported: true,
        line: 1,
        metadataJson: {},
      },
    ]);

    await db.insert(sourceExports).values([
      {
        projectId: project.id,
        sourceFileId: routeFile.id,
        filePath: routeFile.path,
        exportedName: "registerProjectRoutes",
        exportKind: "function",
        sourceSpecifier: null,
      },
      {
        projectId: project.id,
        sourceFileId: serviceFile.id,
        filePath: serviceFile.path,
        exportedName: "listProjects",
        exportKind: "function",
        sourceSpecifier: null,
      },
    ]);

    return { project, indexRun, files };
  }

  async function createProjectWithIndexRun() {
    const [project] = await db
      .insert(projects)
      .values({
        name: `Project Graph ${Date.now()} ${Math.random()}`,
        slug: `project-graph-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath: "/tmp/specops-project-graph",
        specopsPath: "/tmp/specops-project-graph/.specops",
      })
      .returning();
    projectIds.push(project!.id);

    const [indexRun] = await db
      .insert(indexRuns)
      .values({
        projectId: project!.id,
        status: "completed",
        entityCount: 1,
        sourceFileCount: 4,
        sourceImportCount: 3,
        sourceExportCount: 2,
        sourceSymbolCount: 3,
      })
      .returning();

    return { project: project!, indexRun: indexRun! };
  }

  async function insertSpecEntity(projectId: string) {
    await db.insert(specEntities).values({
      projectId,
      entityId: "interface.project-routes",
      type: "interface",
      title: "Project routes",
      status: "active",
      filePath: ".specops/interfaces/project-routes.md",
      frontmatterJson: { id: "interface.project-routes" },
      bodyMarkdown: "# Project routes\n",
      bodyText: "Project routes",
      contentHash: "spec-hash",
    });
  }

  async function insertSourceSpecAnnotation(
    projectId: string,
    indexRunId: string,
    input: {
      sourceFilePath: string;
      symbolName: string;
      confidence: number;
      status: "active" | "stale";
    },
  ) {
    await db.insert(sourceSpecAnnotations).values({
      projectId,
      sourceFilePath: input.sourceFilePath,
      symbolName: input.symbolName,
      symbolKind: "function",
      startLine: 1,
      endLine: 10,
      sourceContentHash: `${input.sourceFilePath}-hash`,
      entityId: "interface.project-routes",
      specFilePath: ".specops/interfaces/project-routes.md",
      relationshipType: "supports",
      confidence: input.confidence,
      provenance: "manual",
      status: input.status,
      indexRunId,
    });
  }
});

function edgeTypes(
  graph: ReturnType<typeof projectGraphListResponseSchema.parse>,
  fromNodeId: string,
  toNodeId: string,
) {
  return graph.edges
    .filter((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)
    .map((edge) => edge.edgeType);
}

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../../../../packages/db/migrations/0000_initial.sql", import.meta.url), "utf8"),
    );
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function closeDb(db: Db | undefined): Promise<void> {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } } | undefined)?.$client;
  await client?.end();
}

function readTestDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url && process.env.CI) {
    throw new Error("TEST_DATABASE_URL is required for DB-backed API tests in CI");
  }

  if (url) {
    assertSafeTestDatabaseUrl(url);
  }

  return url;
}

function assertSafeTestDatabaseUrl(connectionString: string) {
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, "");

  if (!databaseName.includes("test") && !databaseName.includes("specops_test")) {
    throw new Error(`Refusing to run DB-backed API tests against non-test database "${databaseName}"`);
  }
}

function observeProjectGraphEdgeSelectLimits(db: Db): {
  db: Db;
  edgeSelectLimits: number[];
} {
  const edgeSelectLimits: number[] = [];
  const observedDb = Object.create(db) as Db;
  observedDb.select = ((...args: Parameters<typeof db.select>) =>
    observeSelectBuilder(db.select(...args), {
      isProjectGraphEdgeSelect: false,
      edgeSelectLimits,
    })) as typeof db.select;

  return { db: observedDb, edgeSelectLimits };
}

function observeSelectBuilder<T>(
  builder: T,
  state: { isProjectGraphEdgeSelect: boolean; edgeSelectLimits: number[] },
): T {
  return new Proxy(builder as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        if (property === "limit" && state.isProjectGraphEdgeSelect && typeof args[0] === "number") {
          state.edgeSelectLimits.push(args[0]);
        }
        const result = value.apply(target, args);
        const isProjectGraphEdgeSelect =
          state.isProjectGraphEdgeSelect || (property === "from" && args[0] === projectGraphEdges);

        if (result && typeof result === "object") {
          return observeSelectBuilder(result, {
            isProjectGraphEdgeSelect,
            edgeSelectLimits: state.edgeSelectLimits,
          });
        }

        return result;
      };
    },
  }) as T;
}
