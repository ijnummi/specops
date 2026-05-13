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

  it("derives missing proposals when a run is partially initialized", async () => {
    const { db, project, run, proposals } = await createReviewFixture({
      derive: false,
      proposalCount: 2
    });
    const service = createAnalyzeReviewAssemblyService(db);

    await service.createAssembly(project.id, run.id, {
      proposalIds: [proposals[0]!.id]
    });

    const first = await service.listReviewAssemblies(project.id, run.id);
    const second = await service.listReviewAssemblies(project.id, run.id);
    const assignedProposalIds = first.assemblies.flatMap((assembly) =>
      assembly.inputs.map((input) => input.proposalId)
    );

    expect(first.assemblies).toHaveLength(2);
    expect(second.assemblies).toHaveLength(2);
    expect(assignedProposalIds).toEqual(expect.arrayContaining(proposals.map((item) => item.id)));
  });

  it("does not derive a duplicate active assignment from another run in the project", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);
    await service.listReviewAssemblies(project.id, run.id);
    const [secondRun] = await db
      .insert(analyzeRuns)
      .values({
        projectId: project.id,
        status: "succeeded",
        stepsJson: [],
        proposalIdsJson: [proposal.id],
        aiProposalCount: 1
      })
      .returning();
    expect(secondRun).toBeDefined();

    const review = await service.listReviewAssemblies(project.id, secondRun!.id);

    expect(review.assemblies.flatMap((item) => item.inputs)).toHaveLength(0);
    expect(review.unassignedInputs.map((input) => input.proposalId)).toContain(proposal.id);
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
    expect(review.assemblies.flatMap((item) => item.inputs.map((input) => input.proposalId))).toContain(
      proposal.id
    );
  });

  it("derives active input when a run proposal only has evidence-only inputs", async () => {
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
      role: "evidence_only"
    });

    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies[0]?.inputs[0]?.role).toBe("evidence_only");
    expect(review.assemblies.flatMap((item) => item.inputs.map((input) => input.proposalId))).toContain(
      proposal.id
    );
    expect(review.counts.inputs.assigned).toBe(1);
  });

  it("blocks creating a second draft assembly with an actively assigned proposal", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);

    await service.listReviewAssemblies(project.id, run.id);

    await expect(
      service.createAssembly(project.id, run.id, {
        proposalIds: [proposal.id]
      })
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Proposal is already assigned to an active assembly"
    });
  });

  it("blocks attaching an actively assigned proposal to another draft assembly", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const firstAssembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md",
      summary: "Review generated drafts.",
      proposalIds: []
    });
    const secondAssembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts follow-up",
      entityType: "use_case",
      entityId: "use-case.review-drafts-follow-up",
      filePath: "use-cases/review-drafts-follow-up.md",
      summary: "Review generated drafts follow-up.",
      proposalIds: []
    });

    await service.attachInput(project.id, run.id, firstAssembly.id, {
      proposalId: proposal.id,
      role: "primary"
    });

    await expect(
      service.attachInput(project.id, run.id, secondAssembly.id, {
        proposalId: proposal.id,
        role: "primary"
      })
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Proposal is already assigned to an active assembly"
    });
  });

  it("uses the first AI claim text when selected source evidence exists", async () => {
    const { db, project, run } = await createReviewFixture({
      claims: [
        {
          text: "First generated claim is kept even when its source file does not overlap.",
          sourceFiles: ["apps/api/src/not-selected.ts"]
        },
        {
          text: "Second generated claim overlaps the selected source file.",
          sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"]
        }
      ]
    });
    const service = createAnalyzeReviewAssemblyService(db);

    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies[0]?.claims[0]?.text).toBe(
      "First generated claim is kept even when its source file does not overlap."
    );
    expect(review.assemblies[0]?.claims[0]?.evidence).toHaveLength(0);
    expect(review.assemblies[0]?.validation.state).toBe("blocker");
  });

  it("does not attach selected AI evidence to a synthetic fact when AI claims are empty", async () => {
    const { db, project, run } = await createReviewFixture({ claims: [] });
    const service = createAnalyzeReviewAssemblyService(db);

    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies[0]?.claims[0]).toMatchObject({
      kind: "hypothesis",
      text: "Review drafts",
      evidence: []
    });
    expect(review.assemblies[0]?.validation.state).toBe("warning");
  });

  async function createReviewFixture(
    options: {
      derive?: boolean;
      claims?: AiSpecEntityProposalEvidence["claims"];
      proposalCount?: number;
    } = {}
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-review-assembly-"));
    tempRoots.push(root);

    const project = await createProjectService(db).createProject({
      name: `Review Assembly ${Date.now()} ${Math.random()}`,
      slug: `review-assembly-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    });
    projectIds.push(project.id);

    const proposalCount = options.proposalCount ?? 1;
    const proposalInputs = Array.from({ length: proposalCount }, (_, index) => {
      const suffix = index === 0 ? "" : ` ${index + 1}`;
      const entitySuffix = index === 0 ? "" : `-${index + 1}`;
      const payload: AiSpecEntityProposalPayload = {
        entityId: `use-case.review-drafts${entitySuffix}`,
        type: "use_case",
        title: `Review drafts${suffix}`,
        status: "draft",
        filePath: `use-cases/review-drafts${entitySuffix}.md`,
        generatedMarkdown: `---\nid: use-case.review-drafts${entitySuffix}\n---\n\n# Review drafts${suffix}\n`,
        markdown: `---\nid: use-case.review-drafts${entitySuffix}\n---\n\n# Review drafts${suffix}\n`,
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
            contentHash: `review-drafts-hash${entitySuffix}`,
            excerptStartLine: 20,
            excerptEndLine: 80
          }
        ],
        claims: [
          ...(index === 0 && options.claims
            ? options.claims
            : [
                {
                  text: `Users review generated draft inputs before accepting specs${suffix}.`,
                  sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"]
                }
              ])
        ],
        warnings: []
      };

      return {
        projectId: project.id,
        proposalType: "ai_spec_entity",
        title: payload.title,
        payloadJson: payload,
        evidenceJson: evidence,
        confidence: 0.82,
        status: "pending"
      };
    });

    const proposals = await db
      .insert(aiProposals)
      .values(proposalInputs)
      .returning();
    expect(proposals).toHaveLength(proposalCount);

    const [run] = await db
      .insert(analyzeRuns)
      .values({
        projectId: project.id,
        status: "succeeded",
        stepsJson: [],
        proposalIdsJson: proposals.map((proposal) => proposal.id),
        aiProposalCount: proposals.length
      })
      .returning();
    expect(run).toBeDefined();

    return { db, project, run: run!, proposal: proposals[0]!, proposals };
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
