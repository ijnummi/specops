import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../server.js";

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
