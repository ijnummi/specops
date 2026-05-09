import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Db } from "@specops/db";
import { projects, specEntities, specFiles, specLinks, validationMessages } from "@specops/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";
import { createSpecopsInitializerService } from "../services/specops-initializer.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("indexProject", () => {
  const tempRoots: string[] = [];
  const fixtureProjectIds: string[] = [];
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }

    await migrateTestDatabase(testDatabaseUrl);
    pool = new Pool({ connectionString: testDatabaseUrl });
    db = drizzle(pool) as unknown as Db;
  });

  afterEach(async () => {
    for (const projectId of fixtureProjectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  afterAll(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    await pool?.end();
  });

  it("creates files, entities, links, and validation messages on first index", async () => {
    const { projectId, specopsPath } = await createProjectFixture();
    await writeSpecFile(
      specopsPath,
      "requirements/REQ-1.md",
      specMarkdown({
        id: "REQ-1",
        type: "requirement",
        title: "Track project specs",
        status: "draft",
        links: { relates: ["TASK-1"] },
        body: "Workbench users can browse indexed project specs."
      })
    );
    await writeSpecFile(
      specopsPath,
      "tasks/TASK-1.md",
      specMarkdown({
        id: "TASK-1",
        type: "task",
        title: "Build indexer",
        status: "draft",
        body: "Implement the derived cache indexer."
      })
    );
    await writeSpecFile(
      specopsPath,
      "notes/NOTE-1.md",
      specMarkdown({
        id: "NOTE-1",
        type: "note",
        title: "Standalone note",
        status: "draft",
        body: "This note is intentionally unlinked to exercise validation messages."
      })
    );

    const result = await createIndexerService(db).indexProject(projectId);

    expect(result.status).toBe("succeeded");
    expect(result.entityCount).toBe(3);
    expect(result.linkCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    await expectProjectCounts(projectId, {
      files: 3,
      entities: 3,
      links: 1,
      errors: 0,
      warnings: 0
    });
    const [message] = await db
      .select()
      .from(validationMessages)
      .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.code, "orphan_entity")));
    expect(message).toMatchObject({
      level: "info",
      entityId: "NOTE-1",
      filePath: "notes/NOTE-1.md"
    });
  });

  it("keeps unchanged indexes idempotent by count", async () => {
    const { projectId, specopsPath } = await createProjectFixture();
    await writeSpecFile(
      specopsPath,
      "requirements/REQ-1.md",
      specMarkdown({
        id: "REQ-1",
        type: "requirement",
        title: "Track project specs",
        status: "draft",
        links: { relates: ["TASK-1"] },
        body: "Workbench users can browse indexed project specs."
      })
    );
    await writeSpecFile(
      specopsPath,
      "tasks/TASK-1.md",
      specMarkdown({
        id: "TASK-1",
        type: "task",
        title: "Build indexer",
        status: "draft",
        body: "Implement the derived cache indexer."
      })
    );
    const service = createIndexerService(db);

    const first = await service.indexProject(projectId);
    const second = await service.indexProject(projectId);

    expect(second.entityCount).toBe(first.entityCount);
    expect(second.linkCount).toBe(first.linkCount);
    await expectProjectCounts(projectId, {
      files: 2,
      entities: 2,
      links: 1,
      errors: 0,
      warnings: 0
    });
  });

  it("waits on the per-project advisory lock before indexing", async () => {
    const { projectId, specopsPath } = await createProjectFixture();
    await writeSpecFile(
      specopsPath,
      "tasks/TASK-1.md",
      specMarkdown({
        id: "TASK-1",
        type: "task",
        title: "Build indexer",
        status: "draft",
        body: "Implement the derived cache indexer."
      })
    );
    const lockClient = await pool.connect();

    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        projectId
      ]);

      const indexPromise = createIndexerService(db).indexProject(projectId);
      const pending = Symbol("pending");
      const earlyResult = await Promise.race([indexPromise, delay(100).then(() => pending)]);
      expect(earlyResult).toBe(pending);

      await lockClient.query("commit");
      await expect(indexPromise).resolves.toMatchObject({
        projectId,
        status: "succeeded",
        entityCount: 1
      });
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
  });

  it("removes derived entities and links when a markdown file is deleted", async () => {
    const { projectId, specopsPath } = await createProjectFixture();
    await writeSpecFile(
      specopsPath,
      "requirements/REQ-1.md",
      specMarkdown({
        id: "REQ-1",
        type: "requirement",
        title: "Track project specs",
        status: "draft",
        links: { relates: ["TASK-1"] },
        body: "Workbench users can browse indexed project specs."
      })
    );
    await writeSpecFile(
      specopsPath,
      "tasks/TASK-1.md",
      specMarkdown({
        id: "TASK-1",
        type: "task",
        title: "Build indexer",
        status: "draft",
        body: "Implement the derived cache indexer."
      })
    );
    const service = createIndexerService(db);
    await service.indexProject(projectId);

    await unlink(path.join(specopsPath, "tasks/TASK-1.md"));
    const result = await service.indexProject(projectId);

    expect(result.entityCount).toBe(1);
    expect(result.linkCount).toBe(0);
    await expectProjectCounts(projectId, {
      files: 1,
      entities: 1,
      links: 0,
      errors: 0,
      warnings: 1
    });
  });

  it("records duplicate IDs as validation errors and excludes duplicate entities", async () => {
    const { projectId, specopsPath } = await createProjectFixture();
    await writeSpecFile(
      specopsPath,
      "a.md",
      specMarkdown({
        id: "REQ-1",
        type: "requirement",
        title: "First",
        status: "draft",
        body: "First body."
      })
    );
    await writeSpecFile(
      specopsPath,
      "b.md",
      specMarkdown({
        id: "REQ-1",
        type: "requirement",
        title: "Second",
        status: "draft",
        body: "Second body."
      })
    );

    const result = await createIndexerService(db).indexProject(projectId);

    expect(result.entityCount).toBe(0);
    expect(result.errorCount).toBe(2);
    await expectProjectCounts(projectId, {
      files: 2,
      entities: 0,
      links: 0,
      errors: 2,
      warnings: 0
    });
    const messages = await db
      .select()
      .from(validationMessages)
      .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.code, "duplicate_entity_id")));
    expect(messages).toHaveLength(2);
  });

  it("records broken links as warnings and excludes invalid links", async () => {
    const { projectId, specopsPath } = await createProjectFixture();
    await writeSpecFile(
      specopsPath,
      "requirements/REQ-1.md",
      specMarkdown({
        id: "REQ-1",
        type: "requirement",
        title: "Track project specs",
        status: "draft",
        links: { relates: ["TASK-404"] },
        body: "Workbench users can browse indexed project specs."
      })
    );

    const result = await createIndexerService(db).indexProject(projectId);

    expect(result.entityCount).toBe(1);
    expect(result.linkCount).toBe(0);
    expect(result.warningCount).toBe(1);
    await expectProjectCounts(projectId, {
      files: 1,
      entities: 1,
      links: 0,
      errors: 0,
      warnings: 1
    });
    const messages = await db
      .select()
      .from(validationMessages)
      .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.code, "broken_link")));
    expect(messages).toHaveLength(1);
  });

  it("rejects relative or outside project paths before persisting", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-indexer-"));
    tempRoots.push(root);
    const service = createProjectService(db);

    await expect(
      service.createProject({
        name: "Relative paths",
        slug: `relative-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath: "relative/repo",
        specopsPath: path.join(root, ".specops")
      })
    ).rejects.toThrow(/absolute/);

    await expect(
      service.createProject({
        name: "Outside specops",
        slug: `outside-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath: path.join(root, "repo"),
        specopsPath: path.join(root, "sibling")
      })
    ).rejects.toThrow(/inside/);
  });

  it("rejects project creation when an existing specops path symlink escapes the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-indexer-"));
    tempRoots.push(root);
    const repoPath = path.join(root, "repo");
    const outside = path.join(root, "outside");
    await mkdir(repoPath);
    await mkdir(outside);
    await symlink(outside, path.join(repoPath, ".specops"), "dir");

    await expect(
      createProjectService(db).createProject({
        name: "Symlink escape",
        slug: `symlink-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath,
        specopsPath: path.join(repoPath, ".specops")
      })
    ).rejects.toThrow(/inside/);
  });

  it("rejects update paths that move specops outside the repository", async () => {
    const { projectId, root } = await createProjectFixture();

    await expect(
      createProjectService(db).updateProject(projectId, {
        specopsPath: path.join(path.dirname(root), "sibling")
      })
    ).rejects.toThrow(/inside/);
  });

  it("rejects indexing when a persisted specops path points outside the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-indexer-"));
    tempRoots.push(root);
    const repoPath = path.join(root, "repo");
    const specopsPath = path.join(root, "sibling");
    await mkdir(specopsPath, { recursive: true });
    const [project] = await db
      .insert(projects)
      .values({
        name: "Unsafe persisted project",
        slug: `unsafe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath,
        specopsPath
      })
      .returning();
    fixtureProjectIds.push(project.id);

    await expect(createIndexerService(db).indexProject(project.id)).rejects.toThrow(/inside/);
  });

  it("rejects indexing a persisted project with relative paths before filesystem work", async () => {
    const projectId = await insertProjectRow({
      name: "Relative persisted index project",
      slug: `relative-index-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: "relative-repo",
      specopsPath: "relative-repo/.specops"
    });

    await expect(createIndexerService(db).indexProject(projectId)).rejects.toThrow(/absolute/);
  });

  it("rejects initializing a persisted project with relative paths before filesystem work", async () => {
    const projectId = await insertProjectRow({
      name: "Relative persisted init project",
      slug: `relative-init-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: "relative-repo",
      specopsPath: "relative-repo/.specops"
    });

    await expect(createSpecopsInitializerService(db).initializeProjectSpecops(projectId)).rejects.toThrow(
      /absolute/
    );
  });

  async function createProjectFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-indexer-"));
    tempRoots.push(root);
    const specopsPath = path.join(root, ".specops");
    const project = await createProjectService(db).createProject({
      name: `Indexer ${Date.now()} ${Math.random()}`,
      slug: `indexer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath
    });
    fixtureProjectIds.push(project.id);

    return { projectId: project.id, root, specopsPath };
  }

  async function insertProjectRow(input: {
    name: string;
    slug: string;
    repoPath: string;
    specopsPath: string;
  }) {
    const [project] = await db.insert(projects).values(input).returning();
    fixtureProjectIds.push(project.id);
    return project.id;
  }

  async function expectProjectCounts(
    projectId: string,
    expected: { files: number; entities: number; links: number; errors: number; warnings: number }
  ) {
    const [files, entities, links, errors, warnings] = await Promise.all([
      db.select().from(specFiles).where(eq(specFiles.projectId, projectId)),
      db.select().from(specEntities).where(eq(specEntities.projectId, projectId)),
      db.select().from(specLinks).where(eq(specLinks.projectId, projectId)),
      db
        .select()
        .from(validationMessages)
        .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, "error"))),
      db
        .select()
        .from(validationMessages)
        .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, "warning")))
    ]);

    expect(files).toHaveLength(expected.files);
    expect(entities).toHaveLength(expected.entities);
    expect(links).toHaveLength(expected.links);
    expect(errors).toHaveLength(expected.errors);
    expect(warnings).toHaveLength(expected.warnings);
  }
});

async function writeSpecFile(specopsPath: string, relativePath: string, content: string) {
  const absolutePath = path.join(specopsPath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, { flag: "w" });
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function specMarkdown(input: {
  id: string;
  type: string;
  title: string;
  status: string;
  links?: Record<string, string[]>;
  body: string;
}) {
  const links = input.links
    ? ["links:", ...Object.entries(input.links).map(([type, ids]) => `  ${type}: [${ids.join(", ")}]`)]
    : [];

  return [
    "---",
    `id: ${input.id}`,
    `type: ${input.type}`,
    `title: ${input.title}`,
    `status: ${input.status}`,
    ...links,
    "---",
    "",
    input.body,
    ""
  ].join("\n");
}
