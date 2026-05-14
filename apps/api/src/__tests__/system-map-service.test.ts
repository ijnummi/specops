import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { systemMapResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import { aiProposals, analyzeRuns, createDb, projects, sourceFiles, sourceSymbols } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";
import { createSystemMapService } from "../services/system-map-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createSystemMapService", () => {
  const tempRoots: string[] = [];
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

    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("builds a scanner-first map from indexed source inventory", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);

    const result = await createSystemMapService(db).buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id,
    });

    expect(systemMapResponseSchema.parse(result)).toEqual(result);
    expect(result.snapshot.status).toBe("ready");
    expect(result.snapshot.coverage.sourceFileCount).toBeGreaterThanOrEqual(8);
    expect(result.areas.map((area) => area.areaType)).toEqual([
      "backend_routes",
      "backend_services",
      "frontend_routes",
      "frontend_components",
      "data_models",
      "tests",
      "config",
      "packages",
    ]);
    expect(result.areas.find((area) => area.areaType === "backend_routes")).toMatchObject({
      name: "Backend routes",
      keyFiles: expect.arrayContaining(["apps/api/src/routes/projects.ts"]),
      evidence: expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "apps/api/src/routes/projects.ts",
          symbolName: "registerProjectRoutes",
          relationship: "defines",
        }),
      ]),
    });
    expect(result.areas.find((area) => area.areaType === "backend_services")?.summary).toContain(
      "imports",
    );
  });

  it("creates a limited map with diagnostics when no source files exist", async () => {
    const project = await createProjectFixture();
    await mkdir(path.join(project.repoPath, ".specops"), { recursive: true });
    await writeFile(path.join(project.repoPath, ".specops", "README.md"), "# Empty\n", "utf8");
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);

    const result = await createSystemMapService(db).buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id,
    });

    expect(systemMapResponseSchema.parse(result)).toEqual(result);
    expect(result.snapshot.status).toBe("limited");
    expect(result.snapshot.summary).toBe("No supported source files were available for the system map.");
    expect(result.snapshot.diagnostics).toContainEqual({
      level: "warning",
      code: "no_supported_source",
      message: "No indexed source files were available for the system map.",
    });
    expect(result.areas).toEqual([]);
  });

  it("throws NotFoundError when no system map snapshot exists", async () => {
    const project = await createProjectFixture();
    const analyzeRun = await insertAnalyzeRun(project.id);
    const service = createSystemMapService(db);

    await expect(service.getSystemMap(project.id, analyzeRun.id)).rejects.toMatchObject({
      name: "NotFoundError",
      message: "System map not found",
      details: { projectId: project.id, analyzeRunId: analyzeRun.id },
    });
  });

  it("reports actual symbol counts in area summaries while capping key symbols", async () => {
    const project = await createProjectFixture();
    const analyzeRun = await insertAnalyzeRun(project.id);
    const [sourceFile] = await db
      .insert(sourceFiles)
      .values({
        projectId: project.id,
        path: "apps/api/src/services/many-symbols-service.ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 1024,
        contentHash: "many-symbols-service",
      })
      .returning();
    await db.insert(sourceSymbols).values(
      Array.from({ length: 13 }, (_, index) => ({
        projectId: project.id,
        sourceFileId: sourceFile!.id,
        filePath: sourceFile!.path,
        name: `symbol${index.toString().padStart(2, "0")}`,
        symbolKind: "function",
        isExported: true,
        line: index + 1,
        metadataJson: {},
      })),
    );

    const result = await createSystemMapService(db).buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: null,
    });

    const area = result.areas.find((item) => item.areaType === "backend_services");
    expect(area?.keySymbols).toHaveLength(12);
    expect(area?.summary).toContain("13 symbols");
  });

  it("persists rebuilt system maps inside a transaction", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);
    let transactionCount = 0;
    const observedDb = Object.create(db) as typeof db;
    observedDb.transaction = (async (...args: Parameters<typeof db.transaction>) => {
      transactionCount += 1;
      return db.transaction(...args);
    }) as typeof db.transaction;

    await createSystemMapService(observedDb).buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id,
    });

    expect(transactionCount).toBe(1);
  });

  it("links proposals to map areas by source evidence path", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);
    const service = createSystemMapService(db);
    const built = await service.buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id,
    });
    const [proposal] = await db
      .insert(aiProposals)
      .values({
        projectId: project.id,
        proposalType: "ai_spec_entity",
        title: "Project routes",
        payloadJson: {
          entityId: "interface.project-routes",
          entityType: "interface",
          filePath: "interfaces/project-routes.md",
          summary: "Project routes expose project APIs.",
        },
        evidenceJson: {
          selectedSourceFiles: [
            {
              file: "apps/api/src/routes/projects.ts",
              contentHash: "hash-1",
              excerptStartLine: 1,
              excerptEndLine: 20,
            },
          ],
          provider: "ollama",
          model: "gemma4",
          promptVersion: "ai-prefill-v1",
          claims: [],
          warnings: [],
        },
        confidence: 0.8,
        status: "pending",
      })
      .returning();

    await service.linkMapToDrafts({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      proposalIds: [proposal!.id],
    });

    const linked = await service.getSystemMap(project.id, analyzeRun.id);
    const backendRoutesArea = built.areas.find((area) => area.areaType === "backend_routes");
    expect(linked.areas.find((area) => area.id === backendRoutesArea?.id)?.relatedProposalIds).toContain(
      proposal!.id,
    );
    expect(linked.areas.find((area) => area.areaType === "backend_services")?.relatedProposalIds).toEqual(
      [],
    );
  });

  it("links proposals to map areas inside a transaction", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);
    const service = createSystemMapService(db);
    await service.buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id,
    });
    const [proposal] = await db
      .insert(aiProposals)
      .values({
        projectId: project.id,
        proposalType: "source_spec_entity",
        title: "Project routes",
        payloadJson: {},
        evidenceJson: {
          sourceFiles: [
            {
              file: "apps/api/src/routes/projects.ts",
              symbolName: "registerProjectRoutes",
              symbolKind: "function",
              exported: true,
              line: 1,
            },
          ],
        },
        confidence: 0.9,
        status: "pending",
      })
      .returning();
    let transactionCount = 0;
    const observedDb = Object.create(db) as typeof db;
    observedDb.transaction = (async (...args: Parameters<typeof db.transaction>) => {
      transactionCount += 1;
      return db.transaction(...args);
    }) as typeof db.transaction;

    await createSystemMapService(observedDb).linkMapToDrafts({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      proposalIds: [proposal!.id],
    });

    expect(transactionCount).toBe(1);
  });

  it("recomputes proposal links from the supplied proposal ids", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);
    const service = createSystemMapService(db);
    await service.buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id,
    });
    const [proposalA, proposalB] = await db
      .insert(aiProposals)
      .values([
        {
          projectId: project.id,
          proposalType: "source_spec_entity",
          title: "Project routes",
          payloadJson: {},
          evidenceJson: {
            scanner: "typescript",
            sourceFiles: [
              {
                file: "apps/api/src/routes/projects.ts",
                symbolName: "registerProjectRoutes",
                symbolKind: "function",
                exported: true,
                line: 1,
              },
            ],
          },
          confidence: 0.9,
          status: "pending",
        },
        {
          projectId: project.id,
          proposalType: "ai_spec_entity",
          title: "Project service",
          payloadJson: {},
          evidenceJson: {
            provider: "ollama",
            model: "gemma4",
            promptVersion: "ai-prefill-v1",
            selectedSourceFiles: [
              {
                file: "apps/api/src/services/project-service.ts",
                contentHash: "hash-2",
                excerptStartLine: 1,
                excerptEndLine: 20,
              },
            ],
            claims: [],
            warnings: [],
          },
          confidence: 0.8,
          status: "pending",
        },
      ])
      .returning();

    const first = await service.linkMapToDrafts({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      proposalIds: [proposalA!.id],
    });
    expect(first.areas.find((area) => area.areaType === "backend_routes")?.relatedProposalIds).toEqual([
      proposalA!.id,
    ]);

    const second = await service.linkMapToDrafts({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      proposalIds: [proposalB!.id],
    });
    expect(second.areas.find((area) => area.areaType === "backend_routes")?.relatedProposalIds).toEqual([]);
    expect(second.areas.find((area) => area.areaType === "backend_services")?.relatedProposalIds).toEqual([
      proposalB!.id,
    ]);

    const third = await service.linkMapToDrafts({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      proposalIds: [],
    });
    expect(third.areas.flatMap((area) => area.relatedProposalIds)).toEqual([]);
  });

  async function createProjectFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-system-map-"));
    tempRoots.push(root);
    const project = await createProjectService(db).createProject({
      name: `System Map ${Date.now()} ${Math.random()}`,
      slug: `system-map-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops"),
    });
    projectIds.push(project.id);
    return project;
  }

  async function insertAnalyzeRun(projectId: string) {
    const [run] = await db
      .insert(analyzeRuns)
      .values({
        projectId,
        status: "running",
        stepsJson: [],
      })
      .returning();
    return run!;
  }
});

async function writeSystemMapFixture(repoPath: string) {
  await mkdir(path.join(repoPath, "apps/api/src/routes"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/api/src/services"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/web/src/routes"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/web/src/components"), { recursive: true });
  await mkdir(path.join(repoPath, "packages/db/src"), { recursive: true });
  await mkdir(path.join(repoPath, "packages/shared/src"), { recursive: true });
  await mkdir(path.join(repoPath, ".specops"), { recursive: true });

  await writeFile(
    path.join(repoPath, "apps/api/src/routes/projects.ts"),
    "export function registerProjectRoutes() { return 'routes'; }\n",
    "utf8",
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/services/project-service.ts"),
    "import { projects } from '../../../packages/db/src/schema';\nexport class ProjectService { listProjects() { return projects; } }\n",
    "utf8",
  );
  await writeFile(
    path.join(repoPath, "apps/web/src/routes/projects.tsx"),
    "export function ProjectsPage() { return null; }\n",
    "utf8",
  );
  await writeFile(
    path.join(repoPath, "apps/web/src/components/project-card.tsx"),
    "export function ProjectCard() { return null; }\n",
    "utf8",
  );
  await writeFile(path.join(repoPath, "packages/db/src/schema.ts"), "export const projects = {};\n", "utf8");
  await writeFile(
    path.join(repoPath, "apps/api/src/routes/projects.test.ts"),
    "export function testProjectRoutes() { return true; }\n",
    "utf8",
  );
  await writeFile(path.join(repoPath, "vite.config.ts"), "export default {};\n", "utf8");
  await writeFile(
    path.join(repoPath, "packages/shared/src/index.ts"),
    "export type Decision = { id: string };\n",
    "utf8",
  );
}

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(process.cwd(), "../../packages/db/migrations/0000_initial.sql"), "utf8"),
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
