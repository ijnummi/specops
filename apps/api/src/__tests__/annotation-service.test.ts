import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sourceSpecAnnotationSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import { createDb, indexRuns, projects, sourceFiles, specEntities } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createAnnotationService,
  type ScannerAnnotationInput
} from "../services/annotation-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createAnnotationService", () => {
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

  it("creates and lists a user annotation scoped to one project", async () => {
    const first = await createProjectFixture("first");
    const second = await createProjectFixture("second");
    const firstSource = await createSourceFileFixture(first.id, "src/decision.ts", "export const decision = true;\n");
    const secondSource = await createSourceFileFixture(second.id, "src/decision.ts", "export const other = true;\n");
    await createSpecEntityFixture(first.id, "domain.decision", "specs/decision.md");
    await createSpecEntityFixture(second.id, "domain.decision", "specs/decision.md");

    const service = createAnnotationService(db);
    const created = await service.createUserAnnotation(first.id, {
      sourceFileId: firstSource.id,
      entityId: "domain.decision",
      relationshipType: "implements",
      symbolName: "DecisionService",
      symbolKind: "class",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      claimId: null,
      confidence: 1
    });
    await service.createUserAnnotation(second.id, {
      sourceFileId: secondSource.id,
      entityId: "domain.decision",
      relationshipType: "uses",
      symbolName: "OtherService",
      symbolKind: "class",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      claimId: null,
      confidence: 1
    });

    expect(sourceSpecAnnotationSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      projectId: first.id,
      sourceFileId: firstSource.id,
      sourceFilePath: "src/decision.ts",
      sourceContentHash: firstSource.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "implements",
      provenance: "user",
      status: "active"
    });

    const annotations = await service.listAnnotations(first.id, { includeExcerpt: false });

    expect(annotations).toEqual([
      expect.objectContaining({
        id: created.id,
        projectId: first.id,
        sourceFilePath: "src/decision.ts",
        symbolName: "DecisionService",
        relationshipType: "implements"
      })
    ]);
  });

  it("deduplicates active scanner annotations", async () => {
    const project = await createProjectFixture("scanner");
    const source = await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const indexRunId = await createIndexRunFixture(project.id);
    const scannerAnnotation: ScannerAnnotationInput = {
      sourceFileId: source.id,
      sourceFilePath: source.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: source.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1
    };

    const service = createAnnotationService(db);
    await service.replaceScannerAnnotations(project.id, indexRunId, [
      scannerAnnotation,
      scannerAnnotation
    ]);
    await service.replaceScannerAnnotations(project.id, indexRunId, [
      scannerAnnotation,
      scannerAnnotation
    ]);

    const annotations = await service.listAnnotations(project.id, {
      provenance: "scanner",
      status: "active",
      includeExcerpt: false
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      projectId: project.id,
      sourceFileId: source.id,
      sourceFilePath: "src/decision.ts",
      entityId: "domain.decision",
      relationshipType: "references",
      provenance: "scanner",
      indexRunId
    });
  });

  it("returns source excerpts when requested", async () => {
    const project = await createProjectFixture("excerpt");
    const content =
      "const first = true;\n" +
      "/** @specops domain.decision */\n" +
      "export interface Decision { id: string }\n";
    const source = await createSourceFileFixture(project.id, "src/decision.ts", content);
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");

    const service = createAnnotationService(db);
    await service.createUserAnnotation(project.id, {
      sourceFileId: source.id,
      entityId: "domain.decision",
      relationshipType: "implements",
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 3,
      endLine: 3,
      annotationLine: 2,
      claimId: null,
      confidence: 1
    });

    const annotations = await service.listAnnotations(project.id, {
      includeExcerpt: true
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.excerpt).toEqual({
      status: "available",
      startLine: 1,
      endLine: 3,
      text: content.replace(/\n$/, "")
    });
  });

  async function createProjectFixture(name: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), `specops-annotation-${name}-`));
    tempRoots.push(root);
    const specopsPath = path.join(root, ".specops");
    await mkdir(specopsPath, { recursive: true });
    const [project] = await db
      .insert(projects)
      .values({
        name: `Annotation ${name} ${Date.now()} ${Math.random()}`,
        slug: `annotation-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath: root,
        specopsPath
      })
      .returning();

    expect(project).toBeDefined();
    projectIds.push(project!.id);
    return project!;
  }

  async function createSourceFileFixture(projectId: string, filePath: string, content: string) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId)
    });
    expect(project).toBeDefined();
    const absolutePath = path.join(project!.repoPath, filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { flag: "w" });
    const [sourceFile] = await db
      .insert(sourceFiles)
      .values({
        projectId,
        path: filePath,
        language: "typescript",
        kind: "source",
        sizeBytes: Buffer.byteLength(content),
        contentHash: sha256(content)
      })
      .returning();

    expect(sourceFile).toBeDefined();
    return sourceFile!;
  }

  async function createSpecEntityFixture(projectId: string, entityId: string, filePath: string) {
    const [entity] = await db
      .insert(specEntities)
      .values({
        projectId,
        entityId,
        type: "domain_entity",
        title: entityId,
        status: "draft",
        filePath,
        bodyMarkdown: `# ${entityId}\n`,
        bodyText: entityId,
        contentHash: sha256(`${projectId}:${entityId}`)
      })
      .returning();

    expect(entity).toBeDefined();
    return entity!;
  }

  async function createIndexRunFixture(projectId: string): Promise<string> {
    const [indexRun] = await db
      .insert(indexRuns)
      .values({
        projectId,
        status: "succeeded"
      })
      .returning({ id: indexRuns.id });

    expect(indexRun).toBeDefined();
    return indexRun!.id;
  }
});

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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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
