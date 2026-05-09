import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Db } from "@specops/db";
import { projects, specEntities, specFiles, specLinks, validationMessages } from "@specops/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("indexProject", () => {
  const tempRoots: string[] = [];
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }

    await migrateTestDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool) as unknown as Db;
  });

  beforeEach(async () => {
    await db.delete(validationMessages);
    await db.delete(specLinks);
    await db.delete(specEntities);
    await db.delete(specFiles);
    await db.delete(projects);
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

    return { projectId: project.id, root, specopsPath };
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
