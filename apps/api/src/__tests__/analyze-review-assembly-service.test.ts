import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiSpecEntityProposalEvidence, AiSpecEntityProposalPayload } from "@specops/contracts";
import type { Db } from "@specops/db";
import { aiProposals, analyzeRuns, createDb, projects } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAnalyzeReviewAssemblyService } from "../services/analyze-review-assembly-service.js";
import { createProjectService } from "../services/project-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createAnalyzeReviewAssemblyService", () => {
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

  it("derives one draft assembly per run proposal and is idempotent", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);

    const first = await service.listReviewAssemblies(project.id, run.id);
    const second = await service.listReviewAssemblies(project.id, run.id);

    expect(first.assemblies).toHaveLength(1);
    expect(second.assemblies).toHaveLength(1);
    expect(first.assemblies[0]?.inputs[0]?.proposalId).toBe(proposal.id);
    expect(first.assemblies[0]?.validation.state).toBe("ready");
  });

  it("attaches and removes proposal inputs", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md",
      summary: "Review generated drafts.",
      proposalIds: []
    });

    await service.attachInput(project.id, run.id, assembly.id, {
      proposalId: proposal.id,
      role: "primary"
    });
    let review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.inputs).toHaveLength(1);

    await service.removeInput(project.id, run.id, assembly.id, proposal.id);
    review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.inputs).toHaveLength(0);
    expect(review.unassignedInputs).toHaveLength(1);
  });

  async function createReviewFixture(_options: { derive?: boolean } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-review-assembly-"));
    tempRoots.push(root);

    const project = await createProjectService(db).createProject({
      name: `Review Assembly ${Date.now()} ${Math.random()}`,
      slug: `review-assembly-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    });
    projectIds.push(project.id);

    const payload: AiSpecEntityProposalPayload = {
      entityId: "use-case.review-drafts",
      type: "use_case",
      title: "Review drafts",
      status: "draft",
      filePath: "use-cases/review-drafts.md",
      generatedMarkdown: "---\nid: use-case.review-drafts\n---\n\n# Review drafts\n",
      markdown: "---\nid: use-case.review-drafts\n---\n\n# Review drafts\n",
      sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"],
      proposedLinks: []
    };
    const evidence: AiSpecEntityProposalEvidence = {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      promptVersion: "ai-prefill-v1",
      selectedSourceFiles: [
        {
          file: "apps/web/src/routes/analyze-run-review.tsx",
          contentHash: "review-drafts-hash",
          excerptStartLine: 20,
          excerptEndLine: 80
        }
      ],
      claims: [
        {
          text: "Users review generated draft inputs before accepting specs.",
          sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"]
        }
      ],
      warnings: []
    };

    const [proposal] = await db
      .insert(aiProposals)
      .values({
        projectId: project.id,
        proposalType: "ai_spec_entity",
        title: payload.title,
        payloadJson: payload,
        evidenceJson: evidence,
        confidence: 0.82,
        status: "pending"
      })
      .returning();
    expect(proposal).toBeDefined();

    const [run] = await db
      .insert(analyzeRuns)
      .values({
        projectId: project.id,
        status: "succeeded",
        stepsJson: [],
        proposalIdsJson: [proposal!.id],
        aiProposalCount: 1
      })
      .returning();
    expect(run).toBeDefined();

    return { db, project, run: run!, proposal: proposal! };
  }
});

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(process.cwd(), "../../packages/db/migrations/0000_initial.sql"), "utf8")
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
