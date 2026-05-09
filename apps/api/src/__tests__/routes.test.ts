import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDb } from "@specops/db";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BadRequestError } from "../lib/http-errors.js";
import { buildServer } from "../server.js";
import { createAgentTaskService } from "../services/agent-task-service.js";
import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describe("routes", () => {
  it("reports health without touching the database", async () => {
    const app = buildServer("postgres://specops:specops@127.0.0.1:1/specops_test_routes");

    try {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});

describeWithDb("database-backed routes", () => {
  const tempRoots: string[] = [];
  const projectIds: string[] = [];
  const dbs: Array<ReturnType<typeof createDb>> = [];
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }

    await migrateTestDatabase(testDatabaseUrl);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined as unknown as ReturnType<typeof buildServer>;

    await Promise.all(dbs.splice(0).map(closeDb));

    if (projectIds.length > 0) {
      await pool.query("delete from projects where id = any($1::uuid[])", [projectIds.splice(0)]);
    }

    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates and reads projects through the API", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const listResponse = await app.inject({ method: "GET", url: "/api/projects" });
    const listBody = listResponse.json() as Array<{ id: string; slug: string }>;

    expect(listResponse.statusCode).toBe(200);
    expect(listBody).toContainEqual(expect.objectContaining({ id: project.id, slug: project.slug }));

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      id: project.id,
      name: project.name,
      slug: project.slug,
      repoPath: project.repoPath,
      specopsPath: project.specopsPath
    });
  });

  it("creates an entity markdown file, indexes it, and returns searchable entities", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.customer",
        type: "domain_entity",
        title: "Customer",
        status: "draft"
      }
    });

    expect(createEntityResponse.statusCode).toBe(201);
    expect(createEntityResponse.json()).toMatchObject({
      projectId: project.id,
      entityId: "domain.customer",
      type: "domain_entity",
      title: "Customer",
      filePath: "domain/domain.customer.md"
    });

    const searchResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer`
    });
    const searchBody = searchResponse.json() as Array<{ entityId: string; title: string }>;

    expect(searchResponse.statusCode).toBe(200);
    expect(searchBody).toContainEqual(
      expect.objectContaining({ entityId: "domain.customer", title: "Customer" })
    );
  });

  it("creates and indexes entities with YAML punctuation in titles", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const title = "Customer: Profile #1";

    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.customer-profile",
        type: "domain_entity",
        title,
        status: "draft"
      }
    });

    expect(createEntityResponse.statusCode).toBe(201);
    expect(createEntityResponse.json()).toMatchObject({
      projectId: project.id,
      entityId: "domain.customer-profile",
      type: "domain_entity",
      title
    });

    const getEntityResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.customer-profile`
    });

    expect(getEntityResponse.statusCode).toBe(200);
    expect(getEntityResponse.json()).toMatchObject({ title });
  });

  it("reads entity editing markdown from the current canonical file", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.current-file",
        type: "domain_entity",
        title: "Indexed Title",
        status: "draft"
      }
    });
    expect(createEntityResponse.statusCode).toBe(201);

    const directMarkdown =
      "---\n" +
      "# keep this frontmatter comment\n" +
      "id: domain.current-file\n" +
      "type: domain_entity\n" +
      "title: Direct Filesystem Title\n" +
      "status: draft\n" +
      "---\n\n" +
      "Edited directly on disk.\n";
    await writeFile(
      path.join(project.specopsPath, "domain", "domain.current-file.md"),
      directMarkdown
    );

    const getEntityResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.current-file`
    });

    expect(getEntityResponse.statusCode).toBe(200);
    expect(getEntityResponse.json()).toMatchObject({
      entityId: "domain.current-file",
      markdown: directMarkdown,
      contentHash: sha256(directMarkdown)
    });
  });

  it("rejects stale markdown saves without altering the current file", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.stale",
        type: "domain_entity",
        title: "Stale Entity",
        status: "draft"
      }
    });
    expect(createEntityResponse.statusCode).toBe(201);
    const loaded = createEntityResponse.json() as { contentHash: string };

    const directMarkdown =
      "---\n" +
      "id: domain.stale\n" +
      "type: domain_entity\n" +
      "title: Stale Entity\n" +
      "status: draft\n" +
      "---\n\n" +
      "Direct edit wins.\n";
    const filePath = path.join(project.specopsPath, "domain", "domain.stale.md");
    await writeFile(filePath, directMarkdown);

    const response = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/entities/domain.stale/markdown`,
      payload: {
        markdown:
          "---\n" +
          "id: domain.stale\n" +
          "type: domain_entity\n" +
          "title: Stale Entity\n" +
          "status: draft\n" +
          "---\n\n" +
          "Browser edit based on old content.\n",
        baseContentHash: loaded.contentHash
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { message: "Entity markdown has changed since it was loaded" }
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(directMarkdown);
  });

  it("rejects invalid markdown saves without altering the current file", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.required",
        type: "domain_entity",
        title: "Required Entity",
        status: "draft"
      }
    });
    expect(createEntityResponse.statusCode).toBe(201);
    const loaded = createEntityResponse.json() as { markdown: string; contentHash: string };
    const filePath = path.join(project.specopsPath, "domain", "domain.required.md");

    const response = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/entities/domain.required/markdown`,
      payload: {
        markdown:
          "---\n" +
          "id: domain.required\n" +
          "type: domain_entity\n" +
          "status: draft\n" +
          "---\n\n" +
          "Missing title should not be written.\n",
        baseContentHash: loaded.contentHash
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { message: "Invalid entity markdown" }
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(loaded.markdown);
  });

  it("rejects entity creation when an existing parent directory symlink escapes specops", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const outside = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-outside-"));
    tempRoots.push(outside);
    await mkdir(project.specopsPath, { recursive: true });
    await symlink(outside, path.join(project.specopsPath, "domain"), "dir");

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.escape",
        type: "domain_entity",
        title: "Escaping Entity",
        status: "draft"
      }
    });

    await expect(fileExists(path.join(outside, "domain.escape.md"))).resolves.toBe(false);
    expect(response.statusCode).toBe(400);
  });

  it("rejects markdown save when the indexed file symlink escapes specops", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.safe",
        type: "domain_entity",
        title: "Safe Entity",
        status: "draft"
      }
    });
    expect(createEntityResponse.statusCode).toBe(201);
    const loaded = createEntityResponse.json() as { contentHash: string };

    const outside = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-outside-"));
    tempRoots.push(outside);
    const outsideFile = path.join(outside, "outside.md");
    await writeFile(outsideFile, "outside original\n");
    const indexedPath = path.join(project.specopsPath, "domain", "domain.safe.md");
    await unlink(indexedPath);
    await symlink(outsideFile, indexedPath);

    const response = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/entities/domain.safe/markdown`,
      payload: {
        markdown:
          "---\nid: domain.safe\ntype: domain_entity\ntitle: Safe Entity\nstatus: draft\n---\n\nchanged\n",
        baseContentHash: loaded.contentHash
      }
    });

    await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside original\n");
    expect(response.statusCode).toBe(400);
  });

  it("refreshes source files and facts during project indexing", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(project.specopsPath, { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "math.ts"),
      "import { strict as assert } from 'node:assert';\n" +
        "export function add(left: number, right: number) {\n" +
        "  assert.ok(true);\n" +
        "  return left + right;\n" +
        "}\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceFileCount: 1,
      sourceImportCount: 1,
      sourceExportCount: 1,
      sourceSymbolCount: 1
    });
  });

  it("persists source parse warnings as validation messages during project indexing", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(project.specopsPath, { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.repoPath, "src", "broken.ts"), "export function broken(\n");

    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/validation-messages`
    });

    expect(messagesResponse.statusCode).toBe(200);
    expect(messagesResponse.json()).toContainEqual(
      expect.objectContaining({
        code: "source_parse_error",
        filePath: "src/broken.ts",
        level: "warning"
      })
    );
  });

  it("previews an agent task with one-hop context", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "links:\n" +
        "  uses:\n" +
        "    - domain.spec-entity\n" +
        "---\n\n" +
        "# Generate Agent Task\n\n" +
        "## Goal\n\n" +
        "Generate a focused implementation prompt.\n"
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "domain.spec-entity.md"),
      "---\n" +
        "id: domain.spec-entity\n" +
        "type: domain_entity\n" +
        "title: Spec Entity\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Spec Entity\n\n" +
        "## Definition\n\n" +
        "A spec entity is one indexed markdown document.\n"
    );
    await createIndexerService(db).indexProject(project.id);

    const preview = await createAgentTaskService(db).previewAgentTask(project.id, {
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });

    expect(preview).toMatchObject({
      taskId: "task.uc-generate-agent-task",
      title: "Generate Agent Task",
      filePath: "agent-tasks/task.uc-generate-agent-task.md",
      sourceSpecIds: ["uc.generate-agent-task"],
      contextSpecIds: ["domain.spec-entity"]
    });
    expect(preview.markdown).toContain("source_entity: uc.generate-agent-task");
    expect(preview.markdown).toContain("domain.spec-entity");
  });

  it("saves an edited agent task and rejects duplicate saves", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Generate Agent Task\n"
    );
    await createIndexerService(db).indexProject(project.id);
    const service = createAgentTaskService(db);
    const preview = await service.previewAgentTask(project.id, {
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });

    const saved = await service.saveAgentTask(project.id, preview);

    expect(saved).toMatchObject({
      entityId: "task.uc-generate-agent-task",
      type: "agent_task",
      filePath: "agent-tasks/task.uc-generate-agent-task.md"
    });
    await expect(
      readFile(path.join(project.specopsPath, "agent-tasks", "task.uc-generate-agent-task.md"), "utf8")
    ).resolves.toContain("type: agent_task");

    await expect(service.saveAgentTask(project.id, preview)).rejects.toMatchObject({
      statusCode: 409,
      message: "Agent task markdown file already exists"
    });
  });

  it("rejects agent task save paths that escape agent-tasks", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Generate Agent Task\n"
    );
    await createIndexerService(db).indexProject(project.id);
    const service = createAgentTaskService(db);
    const preview = await service.previewAgentTask(project.id, {
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });

    await expect(
      service.saveAgentTask(project.id, {
        ...preview,
        filePath: "agent-tasks/../../escape.md"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Agent task file path must match task id",
      details: {
        expectedFilePath: "agent-tasks/task.uc-generate-agent-task.md",
        receivedFilePath: "agent-tasks/../../escape.md"
      }
    });
  });

  it("rejects nested agent task save paths", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Generate Agent Task\n"
    );
    await createIndexerService(db).indexProject(project.id);
    const service = createAgentTaskService(db);
    const preview = await service.previewAgentTask(project.id, {
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });

    const save = service.saveAgentTask(project.id, {
      ...preview,
      filePath: "agent-tasks/subdir/task.uc-generate-agent-task.md"
    });

    await expect(save).rejects.toBeInstanceOf(BadRequestError);
    await expect(save).rejects.toMatchObject({
      statusCode: 400,
      message: "Agent task file path must match task id",
      details: {
        expectedFilePath: "agent-tasks/task.uc-generate-agent-task.md",
        receivedFilePath: "agent-tasks/subdir/task.uc-generate-agent-task.md"
      }
    });
  });

  it("rejects agent task save paths that do not match the task id", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Generate Agent Task\n"
    );
    await createIndexerService(db).indexProject(project.id);
    const service = createAgentTaskService(db);
    const preview = await service.previewAgentTask(project.id, {
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });

    await expect(
      service.saveAgentTask(project.id, {
        ...preview,
        filePath: "agent-tasks/unrelated.md"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Agent task file path must match task id",
      details: {
        expectedFilePath: "agent-tasks/task.uc-generate-agent-task.md",
        receivedFilePath: "agent-tasks/unrelated.md"
      }
    });
  });

  function createTestDb() {
    const db = createDb(testDatabaseUrl!);
    dbs.push(db);
    return db;
  }

  async function createProjectDirectly(db: ReturnType<typeof createDb>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-"));
    tempRoots.push(root);

    const project = await createProjectService(db).createProject({
      name: `Routes ${Date.now()} ${Math.random()}`,
      slug: `routes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    });
    projectIds.push(project.id);

    return project;
  }

  async function createProjectViaApi() {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-"));
    tempRoots.push(root);

    const payload = {
      name: `Routes ${Date.now()} ${Math.random()}`,
      slug: `routes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload
    });
    const body = response.json() as typeof payload & { id: string };

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject(payload);
    projectIds.push(body.id);

    return body;
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

async function fileExists(value: string): Promise<boolean> {
  try {
    await readFile(value);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

async function closeDb(db: ReturnType<typeof createDb>): Promise<void> {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
