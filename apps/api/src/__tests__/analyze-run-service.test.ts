import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { analyzeRunDetailSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import { createDb, projects } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ApiConfig } from "../config.js";
import { ConflictError } from "../lib/http-errors.js";
import {
  createAnalyzeRunService,
  type AiPrefillProviderFactory
} from "../services/analyze-run-service.js";
import { createProjectService } from "../services/project-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createAnalyzeRunService", () => {
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

  it("persists an initial queued run with all analyze steps", async () => {
    const project = await createProjectFixture();
    await writeAnalyzeSource(project.repoPath);
    const service = createAnalyzeRunService(db, {
      aiPrefillConfig: aiPrefillConfig(),
      aiPrefillProviderFactory: successfulProviderFactory()
    });

    const run = await service.startAnalyzeRun(project.id);

    expect(analyzeRunDetailSchema.parse(run)).toEqual(run);
    expect(["queued", "running"]).toContain(run.status);
    expect(run.steps.map((step) => step.name)).toEqual([
      "initialize",
      "index",
      "build_system_map",
      "source_proposals",
      "select_ai_sources",
      "ai_prefill",
      "link_map_to_drafts"
    ]);
    expect(run.steps.every((step) => step.status === "pending")).toBe(true);

    await waitForTerminalRun(service, project.id, run.id);
  });

  it("executes all steps and stores index, source, selection, and AI proposal counts", async () => {
    const project = await createProjectFixture();
    await writeAnalyzeSource(project.repoPath);
    const requestedModels: string[] = [];
    const service = createAnalyzeRunService(db, {
      aiPrefillConfig: aiPrefillConfig(),
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          requestedModels.push(input.model);
          return aiPrefillProviderResult(input.model);
        }
      })
    });

    const started = await service.startAnalyzeRun(project.id);
    const finished = await waitForTerminalRun(service, project.id, started.id);

    expect(finished.status).toBe("succeeded");
    expect(finished.currentStep).toBeNull();
    expect(finished.indexRunId).toEqual(expect.any(String));
    expect(finished.sourceProposalCount).toBeGreaterThan(0);
    expect(finished.aiProposalCount).toBe(1);
    expect(requestedModels).toEqual(["gemma4"]);
    expect(finished.proposalIds).toHaveLength(
      finished.sourceProposalCount + finished.aiProposalCount
    );
    expect(new Set(finished.proposalIds).size).toBe(finished.proposalIds.length);
    expect(finished.selection).toEqual(
      expect.objectContaining({
        selectedPaths: expect.arrayContaining(["src/routes/projects.ts"]),
        selectedSourceFileIds: [expect.any(String)]
      })
    );
    expect(finished.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded"
    ]);
    expect(finished.steps.find((step) => step.name === "index")?.counts).toMatchObject({
      sourceFileCount: expect.any(Number),
      sourceExportCount: expect.any(Number),
      sourceSymbolCount: expect.any(Number)
    });
    expect(finished.steps.find((step) => step.name === "build_system_map")?.counts).toMatchObject({
      systemMapAreaCount: expect.any(Number)
    });
    expect(finished.steps.find((step) => step.name === "link_map_to_drafts")?.counts).toMatchObject({
      linkedProposalCount: expect.any(Number)
    });
  });

  it("rejects a second start while an analyze run is active", async () => {
    const project = await createProjectFixture();
    await writeAnalyzeSource(project.repoPath);
    const deferredProvider = deferredSuccessfulProviderFactory();
    const service = createAnalyzeRunService(db, {
      aiPrefillConfig: aiPrefillConfig(),
      aiPrefillProviderFactory: deferredProvider.factory
    });

    const active = await service.startAnalyzeRun(project.id);

    await expect(service.startAnalyzeRun(project.id)).rejects.toMatchObject({
      name: "ConflictError",
      message: "Analyze run is already active",
      details: { activeRunId: active.id }
    } satisfies Partial<ConflictError>);

    deferredProvider.resolve();
    await waitForTerminalRun(service, project.id, active.id);
  });

  it("skips AI prefill and preserves selection diagnostics when no indexed source fits", async () => {
    const project = await createProjectFixture();
    await writeAnalyzeSource(project.repoPath);
    const service = createAnalyzeRunService(db, {
      aiPrefillConfig: aiPrefillConfig({ maxTotalBytes: 1 }),
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals() {
          throw new Error("AI Prefill should be skipped for an empty selection");
        }
      })
    });

    const started = await service.startAnalyzeRun(project.id);
    const finished = await waitForTerminalRun(service, project.id, started.id);

    expect(finished.status).toBe("succeeded");
    expect(finished.aiProposalCount).toBe(0);
    expect(finished.selection).toMatchObject({
      selectedSourceFileIds: [],
      selectedPaths: [],
      diagnostics: [
        {
          level: "warning",
          message: "No indexed source files fit within AI Prefill limits."
        }
      ]
    });
    expect(finished.steps.find((step) => step.name === "ai_prefill")).toMatchObject({
      status: "skipped",
      message: "No source files selected for AI Prefill"
    });
  });

  async function createProjectFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-analyze-run-"));
    tempRoots.push(root);

    const project = await createProjectService(db).createProject({
      name: `Analyze ${Date.now()} ${Math.random()}`,
      slug: `analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    });
    projectIds.push(project.id);

    return project;
  }
});

async function writeAnalyzeSource(repoPath: string) {
  const relativePath = "src/routes/projects.ts";
  const sourcePath = path.join(repoPath, relativePath);
  const content = [
    "import { ProjectStore } from '../services/project-store';",
    "",
    "export class ProjectRoutes {",
    "  constructor(private readonly store: ProjectStore) {}",
    "  list() { return this.store.listProjects(); }",
    "  create(name: string) { return this.store.createProject(name); }",
    "}",
    ""
  ].join("\n");

  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, content);
}

function successfulProviderFactory(): AiPrefillProviderFactory {
  return () => ({
    async generateSpecProposals(input) {
      return aiPrefillProviderResult(input.model);
    }
  });
}

function deferredSuccessfulProviderFactory(): {
  factory: AiPrefillProviderFactory;
  resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const ready = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return {
    factory: () => ({
      async generateSpecProposals(input) {
        await ready;
        return aiPrefillProviderResult(input.model);
      }
    }),
    resolve
  };
}

function aiPrefillProviderResult(model: string) {
  return {
    provider: "ollama" as const,
    model,
    text: JSON.stringify({
      proposals: [
        {
          entityId: "uc.manage-projects",
          type: "use_case",
          title: "Manage projects",
          summary: "Users can create and inspect local projects.",
          sourceFiles: ["src/routes/projects.ts"],
          claims: [
            {
              text: "Project routes create and inspect local projects.",
              sourceFiles: ["src/routes/projects.ts"]
            }
          ],
          proposedLinks: [],
          confidence: 0.82
        }
      ]
    })
  };
}

function aiPrefillConfig(
  overrides: Partial<ApiConfig["aiPrefill"]> = {}
): ApiConfig["aiPrefill"] {
  return {
    ollamaBaseUrl: "http://127.0.0.1:11434",
    openAiBaseUrl: "https://api.openai.com/v1",
    timeoutMs: 60_000,
    maxFiles: 5,
    maxTotalBytes: 60_000,
    ...overrides
  };
}

async function waitForTerminalRun(
  service: ReturnType<typeof createAnalyzeRunService>,
  projectId: string,
  runId: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await service.getAnalyzeRun(projectId, runId);
    if (run.status === "succeeded" || run.status === "failed") {
      return run;
    }

    await delay(50);
  }

  throw new Error("Timed out waiting for analyze run to finish");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await readFile(
      path.join(process.cwd(), "../../packages/db/migrations/0000_initial.sql"),
      "utf8"
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
    throw new Error(
      `Refusing to run DB-backed API tests against non-test database "${databaseName}"`
    );
  }
}
