import { mkdtemp, rm } from "node:fs/promises";
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
