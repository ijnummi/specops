import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
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
import { createSourceBootstrapService } from "../services/source-bootstrap-service.js";
import { createSourceScanService } from "../services/source-scan-service.js";

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

  it("allows browser preflight for project metadata deletion", async () => {
    const app = buildServer("postgres://specops:specops@127.0.0.1:1/specops_test_routes");

    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/projects/demo",
        headers: {
          origin: "http://127.0.0.1:5176",
          "access-control-request-method": "DELETE"
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
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

  it("deletes project metadata without deleting repository or spec files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const specFilePath = path.join(project.specopsPath, "domain", "domain.keep.md");
    await mkdir(path.dirname(specFilePath), { recursive: true });
    await writeFile(specFilePath, "---\nid: domain.keep\n---\n\n# Keep\n");
    await pool.query("insert into index_runs (project_id, status) values ($1, 'completed')", [
      project.id
    ]);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`
    });

    expect(deleteResponse.statusCode).toBe(204);
    expect(await fileExists(project.repoPath)).toBe(true);
    expect(await fileExists(project.specopsPath)).toBe(true);
    expect(await fileExists(specFilePath)).toBe(true);
    const indexRunsResult = await pool.query(
      "select count(*)::int as count from index_runs where project_id = $1",
      [project.id]
    );
    expect(indexRunsResult.rows[0].count).toBe(0);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`
    });

    expect(getResponse.statusCode).toBe(404);
  });

  it("returns 404 when deleting a missing project", async () => {
    app = buildServer(testDatabaseUrl!);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/00000000-0000-4000-8000-000000000000"
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns a populated project overview", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const runResult = await pool.query<{ id: string }>(
      "insert into index_runs (project_id, started_at, finished_at, status, entity_count, link_count, error_count, warning_count, source_file_count, source_import_count, source_export_count, source_symbol_count, git_commit) values ($1, '2026-05-10T10:00:00Z', '2026-05-10T10:00:03Z', 'succeeded', 6, 1, 1, 1, 2, 1, 1, 2, 'abc123') returning id",
      [project.id]
    );
    const indexRunId = runResult.rows[0].id;

    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash, created_at, updated_at) values " +
        "($1, 'domain.customer', 'domain_entity', 'Customer', 'draft', 'domain/customer.md', '# Customer', 'Customer', 'hash-1', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')," +
        "($1, 'interface.customer-api', 'interface', 'Customer API', 'ready', 'interfaces/customer-api.md', '# Customer API', 'Customer API', 'hash-2', '2026-05-10T09:01:00Z', '2026-05-10T09:01:00Z')," +
        "($1, 'data.customer-record', 'data_model', 'Customer Record', 'draft', 'data/customer-record.md', '# Customer Record', 'Customer Record', 'hash-3', '2026-05-10T09:02:00Z', '2026-05-10T09:02:00Z')," +
        "($1, 'ui.customer-dashboard', 'ui_view', 'Customer Dashboard', 'draft', 'ui/customer-dashboard.md', '# Customer Dashboard', 'Customer Dashboard', 'hash-4', '2026-05-10T09:03:00Z', '2026-05-10T09:03:00Z')," +
        "($1, 'task.review-dashboard', 'agent_task', 'Review Dashboard', 'open', 'agent-tasks/task.review-dashboard.md', '# Review Dashboard', 'Review Dashboard', 'hash-5', '2026-05-10T09:04:00Z', '2026-05-10T09:07:00Z')," +
        "($1, 'adr.source-evidence', 'adr', 'Source Evidence ADR', 'accepted', 'adrs/source-evidence.md', '# Source Evidence ADR', 'Source Evidence ADR', 'hash-6', '2026-05-10T09:05:00Z', '2026-05-10T09:05:00Z')",
      [project.id]
    );
    await pool.query(
      "insert into spec_links (project_id, from_entity_id, to_entity_id, link_type, source) values ($1, 'domain.customer', 'interface.customer-api', 'interfaces', 'frontmatter')",
      [project.id]
    );
    await pool.query(
      "insert into validation_messages (project_id, index_run_id, file_path, entity_id, level, code, message, created_at) values " +
        "($1, $2, 'domain/customer.md', 'domain.customer', 'error', 'duplicate_entity_id', 'Duplicate customer entity.', '2026-05-10T10:00:01Z')," +
        "($1, $2, 'interfaces/customer-api.md', 'interface.customer-api', 'warning', 'broken_link', 'Broken interface link.', '2026-05-10T10:00:02Z')," +
        "($1, $2, 'adrs/source-evidence.md', 'adr.source-evidence', 'info', 'orphan_entity', 'ADR has no valid links.', '2026-05-10T10:00:03Z')",
      [project.id, indexRunId]
    );
    const sourceFileResult = await pool.query<{ id: string; path: string }>(
      "insert into source_files (project_id, path, language, kind, size_bytes, content_hash, last_seen_at) values " +
        "($1, 'src/customer.ts', 'typescript', 'source', 120, 'source-hash-1', '2026-05-10T10:00:01Z')," +
        "($1, 'src/customer-api.ts', 'typescript', 'source', 80, 'source-hash-2', '2026-05-10T10:00:02Z') returning id, path",
      [project.id]
    );
    const customerSourceId = sourceFileResult.rows.find((row) => row.path === "src/customer.ts")!.id;
    const apiSourceId = sourceFileResult.rows.find((row) => row.path === "src/customer-api.ts")!.id;
    await pool.query(
      "insert into source_imports (project_id, source_file_id, file_path, specifier, import_kind, imported_names, is_relative, resolved_path) values ($1, $2, 'src/customer-api.ts', './customer', 'named', array['Customer'], true, 'src/customer.ts')",
      [project.id, apiSourceId]
    );
    await pool.query(
      "insert into source_exports (project_id, source_file_id, file_path, exported_name, export_kind) values ($1, $2, 'src/customer.ts', 'Customer', 'interface')",
      [project.id, customerSourceId]
    );
    await pool.query(
      "insert into source_symbols (project_id, source_file_id, file_path, name, symbol_kind, is_exported, line) values " +
        "($1, $2, 'src/customer.ts', 'Customer', 'interface', true, 1)," +
        "($1, $3, 'src/customer-api.ts', 'CustomerApi', 'class', true, 3)",
      [project.id, customerSourceId, apiSourceId]
    );
    await pool.query(
      "insert into source_spec_links (project_id, source_file_id, file_path, entity_id, symbol_name, symbol_kind, symbol_line, annotation_line, content_hash, created_at) values " +
        "($1, $2, 'src/customer.ts', 'domain.customer', 'Customer', 'interface', 1, 1, 'source-hash-1', '2026-05-10T10:00:01Z')," +
        "($1, $3, 'src/customer-api.ts', 'interface.customer-api', 'CustomerApi', 'class', 3, 2, 'source-hash-2', '2026-05-10T10:00:02Z')",
      [project.id, customerSourceId, apiSourceId]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      project: {
        id: project.id,
        entityCount: 6,
        linkCount: 1,
        validationErrorCount: 1,
        validationWarningCount: 1,
        lastIndexedAt: "2026-05-10T10:00:03.000Z"
      },
      latestIndexRun: {
        projectId: project.id,
        status: "succeeded",
        entityCount: 6,
        linkCount: 1,
        errorCount: 1,
        warningCount: 1,
        sourceFileCount: 2,
        sourceImportCount: 1,
        sourceExportCount: 1,
        sourceSymbolCount: 2,
        gitCommit: "abc123"
      },
      entityCountsByType: [
        { type: "adr", count: 1 },
        { type: "agent_task", count: 1 },
        { type: "data_model", count: 1 },
        { type: "domain_entity", count: 1 },
        { type: "interface", count: 1 },
        { type: "ui_view", count: 1 }
      ],
      entityCountsByStatus: [
        { status: "accepted", count: 1 },
        { status: "draft", count: 3 },
        { status: "open", count: 1 },
        { status: "ready", count: 1 }
      ],
      validationSummary: {
        errorCount: 1,
        warningCount: 1,
        samples: [
          {
            level: "error",
            code: "duplicate_entity_id",
            message: "Duplicate customer entity.",
            entityId: "domain.customer",
            filePath: "domain/customer.md"
          },
          {
            level: "warning",
            code: "broken_link",
            message: "Broken interface link.",
            entityId: "interface.customer-api",
            filePath: "interfaces/customer-api.md"
          }
        ]
      },
      sourceInventory: {
        fileCount: 2,
        symbolCount: 2,
        importCount: 1,
        exportCount: 1
      },
      sourceEvidence: {
        eligibleSpecCount: 4,
        withSourceEvidenceCount: 2,
        withoutSourceEvidenceCount: 2,
        missingSamples: [
          { entityId: "data.customer-record", title: "Customer Record", type: "data_model" },
          { entityId: "ui.customer-dashboard", title: "Customer Dashboard", type: "ui_view" }
        ]
      },
      agentTasks: {
        totalCount: 1,
        recent: [
          {
            entityId: "task.review-dashboard",
            title: "Review Dashboard",
            status: "open",
            updatedAt: "2026-05-10T09:07:00.000Z"
          }
        ]
      },
      attentionItems: [
        {
          kind: "validation_error",
          label: "Duplicate customer entity.",
          entityId: "domain.customer",
          filePath: "domain/customer.md"
        },
        {
          kind: "validation_warning",
          label: "Broken interface link.",
          entityId: "interface.customer-api",
          filePath: "interfaces/customer-api.md"
        },
        {
          kind: "missing_source_evidence",
          label: "Customer Record is missing source evidence.",
          entityId: "data.customer-record",
          filePath: "data/customer-record.md"
        },
        {
          kind: "missing_source_evidence",
          label: "Customer Dashboard is missing source evidence.",
          entityId: "ui.customer-dashboard",
          filePath: "ui/customer-dashboard.md"
        }
      ]
    });
  });

  it("returns an empty project overview before indexing", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      project: {
        id: project.id,
        entityCount: 0,
        linkCount: 0,
        validationErrorCount: 0,
        validationWarningCount: 0,
        lastIndexedAt: null
      },
      latestIndexRun: null,
      entityCountsByType: [],
      entityCountsByStatus: [],
      validationSummary: {
        errorCount: 0,
        warningCount: 0,
        samples: []
      },
      sourceInventory: {
        fileCount: 0,
        symbolCount: 0,
        importCount: 0,
        exportCount: 0
      },
      sourceEvidence: {
        eligibleSpecCount: 0,
        withSourceEvidenceCount: 0,
        withoutSourceEvidenceCount: 0,
        missingSamples: []
      },
      agentTasks: {
        totalCount: 0,
        recent: []
      },
      attentionItems: []
    });
  });

  it("returns 404 for a missing project overview", async () => {
    app = buildServer(testDatabaseUrl!);

    const response = await app.inject({
      method: "GET",
      url: "/api/projects/00000000-0000-4000-8000-000000000000/overview"
    });

    expect(response.statusCode).toBe(404);
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

  it("bootstraps source-only projects into canonical markdown specs and indexes them", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      projectId: project.id,
      status: "succeeded",
      entityCount: 5
    });

    await expect(
      readFile(path.join(project.specopsPath, "domain", "decision.md"), "utf8")
    ).resolves.toContain("id: domain.decision");
    await expect(
      readFile(path.join(project.specopsPath, "domain", "workspace.md"), "utf8")
    ).resolves.toContain("id: domain.workspace");
    await expect(
      readFile(path.join(project.specopsPath, "interfaces", "decision-service.md"), "utf8")
    ).resolves.toContain("id: interface.decision-service");
    await expect(readFile(path.join(project.specopsPath, "project.yaml"), "utf8")).resolves.toContain(
      "source_bootstrap:"
    );
    await expect(readFile(path.join(project.repoPath, "src", "domain.ts"), "utf8")).resolves.toContain(
      "@specops domain.decision"
    );
    await expect(readFile(path.join(project.repoPath, "src", "service.ts"), "utf8")).resolves.toContain(
      "@specops interface.decision-service"
    );

    const entitiesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities`
    });
    const entities = entitiesResponse.json() as Array<{ entityId: string }>;
    expect(entities.map((entity) => entity.entityId)).toEqual(
      expect.arrayContaining([
        "domain.decision",
        "domain.workspace",
        "interface.decision-service"
      ])
    );

    const sourceLinksResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });
    expect(sourceLinksResponse.statusCode).toBe(200);
    expect(sourceLinksResponse.json()).toContainEqual(
      expect.objectContaining({
        entityId: "domain.decision",
        symbolName: "Decision"
      })
    );
  });

  it("returns entity impact with spec links and source evidence", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "interfaces"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\n" +
        "id: domain.decision\n" +
        "type: domain_entity\n" +
        "title: Decision\n" +
        "status: draft\n" +
        "links:\n" +
        "  interfaces:\n" +
        "    - interface.decision-service\n" +
        "---\n\n" +
        "# Decision\n"
    );
    await writeFile(
      path.join(project.specopsPath, "interfaces", "decision-service.md"),
      "---\n" +
        "id: interface.decision-service\n" +
        "type: interface\n" +
        "title: Decision Service\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Decision Service\n"
    );
    await writeFile(
      path.join(project.specopsPath, "use-cases", "create-decision.md"),
      "---\n" +
        "id: uc.create-decision\n" +
        "type: use_case\n" +
        "title: Create Decision\n" +
        "status: draft\n" +
        "links:\n" +
        "  domain:\n" +
        "    - domain.decision\n" +
        "---\n\n" +
        "# Create Decision\n"
    );
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision {}\n"
    );

    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/impact?depth=1&direction=both&includeSource=true`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rootEntity: {
        entityId: "domain.decision",
        title: "Decision"
      },
      truncated: {
        isTruncated: false
      }
    });
    expect(response.json().nodes).toContainEqual(
      expect.objectContaining({ id: "spec:domain.decision", kind: "spec" })
    );
    expect(response.json().nodes).toContainEqual(
      expect.objectContaining({
        kind: "source",
        entityId: "domain.decision",
        filePath: "src/decision.ts",
        symbolName: "Decision"
      })
    );
    expect(
      response.json().upstreamPaths.map((path: { entityIds: string[] }) => path.entityIds)
    ).toEqual([["uc.create-decision", "domain.decision"]]);
    expect(
      response.json().downstreamPaths.map((path: { entityIds: string[] }) => path.entityIds)
    ).toEqual([["domain.decision", "interface.decision-service"]]);
  });

  it("refuses source bootstrap when non-template specs already exist", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "existing.md"),
      "---\n" +
        "id: domain.existing\n" +
        "type: domain_entity\n" +
        "title: Existing\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Existing\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Source bootstrap requires an empty specops folder");
  });

  it("refuses source bootstrap when it has already completed", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    await mkdir(project.specopsPath, { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "project.yaml"),
      "id: sample\n" +
        "source_bootstrap:\n" +
        '  completed_at: "2026-05-10T00:00:00.000Z"\n' +
        "  scanner: typescript\n" +
        "  generated_entity_count: 1\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Source bootstrap has already completed");
  });

  it("refuses source bootstrap when no supported source files are found", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("No supported source files found");
  });

  it("refuses source bootstrap when no eligible exported symbols are found", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "helpers.ts"),
      "function internalOnly() { return 1; }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("No eligible exported source symbols found");
  });

  it("refuses source bootstrap when a candidate symbol has a conflicting specops annotation", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/** @specops domain.other */\n" +
        "export interface Decision { id: string }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    await expect(fileExists(path.join(project.specopsPath, "domain", "decision.md"))).resolves.toBe(
      false
    );
  });

  it("does not write any source annotations before all bootstrap source edits are valid", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const accountSourcePath = path.join(project.repoPath, "src", "account.ts");
    const accountSource = "export interface Account { id: string }\n";
    await writeFile(accountSourcePath, accountSource);
    await writeFile(
      path.join(project.repoPath, "src", "workspace.ts"),
      "/** @specops domain.other */\n" +
        "export interface Workspace { id: string }\n"
    );
    const before = await stat(accountSourcePath);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(createSourceBootstrapService(db).bootstrapProject(project.id)).rejects.toThrow(
      /already has a different @specops annotation/
    );

    const after = await stat(accountSourcePath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await expect(readFile(accountSourcePath, "utf8")).resolves.toBe(accountSource);
    await expect(fileExists(path.join(project.specopsPath, "domain", "account.md"))).resolves.toBe(
      false
    );
  });

  it("refuses source bootstrap when multiple annotations target the same source line", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const sourcePath = path.join(project.repoPath, "src", "services.ts");
    const originalSource =
      "export const DecisionService = {}; export const ReminderScheduler = {};\n";
    await writeFile(sourcePath, originalSource);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("Multiple source annotations target line");
    await expect(fileExists(path.join(project.specopsPath, "interfaces", "decision-service.md")))
      .resolves.toBe(false);
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(originalSource);
  });

  it("rejects source bootstrap when the generated file parent symlink escapes specops", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    const outside = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-outside-"));
    tempRoots.push(outside);
    await writeSampleSourceProject(project.repoPath);
    const domainSourcePath = path.join(project.repoPath, "src", "domain.ts");
    const serviceSourcePath = path.join(project.repoPath, "src", "service.ts");
    const originalDomainSource = await readFile(domainSourcePath, "utf8");
    const originalServiceSource = await readFile(serviceSourcePath, "utf8");
    await mkdir(project.specopsPath, { recursive: true });
    await symlink(outside, path.join(project.specopsPath, "domain"), "dir");

    await expect(createSourceBootstrapService(db).bootstrapProject(project.id)).rejects.toThrow(
      /inside/
    );
    await expect(fileExists(path.join(outside, "decision.md"))).resolves.toBe(false);
    await expect(fileExists(path.join(outside, "workspace.md"))).resolves.toBe(false);
    await expect(readFile(domainSourcePath, "utf8")).resolves.toBe(originalDomainSource);
    await expect(readFile(serviceSourcePath, "utf8")).resolves.toBe(originalServiceSource);
  });

  it("rejects source bootstrap when project.yaml symlink escapes specops without modifying it", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    const outside = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-outside-"));
    tempRoots.push(outside);
    const outsideProjectYaml = path.join(outside, "project.yaml");
    const originalProjectYaml = "id: outside\n";
    await writeSampleSourceProject(project.repoPath);
    await mkdir(project.specopsPath, { recursive: true });
    await writeFile(outsideProjectYaml, originalProjectYaml);
    await symlink(outsideProjectYaml, path.join(project.specopsPath, "project.yaml"));

    await expect(createSourceBootstrapService(db).bootstrapProject(project.id)).rejects.toThrow(
      /inside/
    );
    await expect(readFile(outsideProjectYaml, "utf8")).resolves.toBe(originalProjectYaml);
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

  it("persists source spec links during project indexing", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "domain.decision.md"),
      "---\n" +
        "id: domain.decision\n" +
        "type: domain_entity\n" +
        "title: Decision\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Decision\n"
    );
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision {}\n"
    );

    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);

    const links = await pool.query(
      "select file_path, entity_id, symbol_name, symbol_kind, symbol_line, annotation_line from source_spec_links where project_id = $1",
      [project.id]
    );

    expect(links.rows).toEqual([
      expect.objectContaining({
        file_path: "src/decision.ts",
        entity_id: "domain.decision",
        symbol_name: "Decision",
        symbol_kind: "interface",
        symbol_line: 4,
        annotation_line: 2
      })
    ]);
  });

  it("persists source spec links for non-dotted entity ids accepted by markdown", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "feature-auth.md"),
      "---\n" +
        "id: feature-auth\n" +
        "type: use_case\n" +
        "title: Feature Auth\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Feature Auth\n"
    );
    await writeFile(
      path.join(project.repoPath, "src", "auth.ts"),
      "/** @specops feature-auth */\n" + "export function authenticate() {}\n"
    );

    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);

    const links = await pool.query(
      "select file_path, entity_id, symbol_name, symbol_kind, symbol_line, annotation_line from source_spec_links where project_id = $1",
      [project.id]
    );
    const messagesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/validation-messages`
    });

    expect(links.rows).toContainEqual(
      expect.objectContaining({
        file_path: "src/auth.ts",
        entity_id: "feature-auth",
        symbol_name: "authenticate",
        symbol_kind: "function",
        symbol_line: 2,
        annotation_line: 1
      })
    );
    expect(messagesResponse.statusCode).toBe(200);
    expect(messagesResponse.json()).not.toContainEqual(
      expect.objectContaining({
        code: "source_spec_invalid_entity_id",
        entityId: "feature-auth",
        filePath: "src/auth.ts"
      })
    );
  });

  it("returns full source file content for entity source links", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "const first = true;\n" +
        "const second = true;\n" +
        "const third = true;\n" +
        "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n" +
        "const after = true;\n" +
        "const last = true;\n"
    );
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "available",
        startLine: 1,
        endLine: 9
      }
    });
    expect(response.json()[0].excerpt.text).toContain("const first = true;");
    expect(response.json()[0].excerpt.text).toContain("@specops domain.decision");
    expect(response.json()[0].excerpt.text).toContain("const last = true;");
  });

  it("marks source excerpts changed when file content hash differs", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const sourcePath = path.join(project.repoPath, "src", "decision.ts");
    await writeFile(sourcePath, "/** @specops domain.decision */\nexport interface Decision {}\n");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
    await writeFile(sourcePath, "export interface Decision { changed: true }\n");

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "changed",
        message: "Source file changed since the last index run."
      }
    });
  });

  it("marks source excerpts unavailable when stored source paths escape the repo", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/** @specops domain.decision */\nexport interface Decision {}\n"
    );
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
    await pool.query("update source_spec_links set file_path = '../outside.ts' where project_id = $1", [
      project.id
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "unavailable",
        message: "Source excerpt unavailable."
      }
    });
    expect(response.json()[0].excerpt.message).not.toContain(project.repoPath);
  });

  it("marks source excerpts missing when the indexed source file is gone", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const sourcePath = path.join(project.repoPath, "src", "decision.ts");
    await writeFile(sourcePath, "/** @specops domain.decision */\nexport interface Decision {}\n");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
    await unlink(sourcePath);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "missing",
        message: "Source file is missing."
      }
    });
  });

  it("marks source excerpts unavailable when a source symlink escapes the repo", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const sourcePath = path.join(project.repoPath, "src", "decision.ts");
    await writeFile(sourcePath, "/** @specops domain.decision */\nexport interface Decision {}\n");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });

    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-outside-"));
    tempRoots.push(outsideRoot);
    const outsidePath = path.join(outsideRoot, "outside.ts");
    await writeFile(outsidePath, "/** @specops domain.decision */\nexport interface Outside {}\n");
    await unlink(sourcePath);
    await symlink(outsidePath, sourcePath);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "unavailable",
        message: "Source excerpt unavailable."
      }
    });
    expect(response.json()[0].excerpt.message).not.toContain(outsidePath);
  });

  it("marks source excerpts unavailable when the source file is too large", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const sourcePath = path.join(project.repoPath, "src", "decision.ts");
    await writeFile(sourcePath, "/** @specops domain.decision */\nexport interface Decision {}\n");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
    await writeFile(sourcePath, `${"a".repeat(256 * 1024 + 1)}\n`);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "unavailable",
        message: "Source file is too large to excerpt."
      }
    });
  });

  it("warns when a source spec annotation references a missing entity", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(project.specopsPath, { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "missing.ts"),
      "/**\n" +
        " * @specops domain.missing\n" +
        " */\n" +
        "export interface Missing {}\n"
    );

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
        code: "source_spec_missing_entity",
        entityId: "domain.missing",
        filePath: "src/missing.ts",
        level: "warning"
      })
    );
  });

  it("warns when a source spec annotation has an invalid entity id", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(project.specopsPath, { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "invalid.ts"),
      "/** @specops */\n" + "export interface Invalid {}\n"
    );

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
        code: "source_spec_invalid_entity_id",
        entityId: null,
        filePath: "src/invalid.ts",
        level: "warning"
      })
    );
  });

  it("scopes source file detail lookup by project and source file id", async () => {
    const db = createTestDb();
    const firstProject = await createProjectDirectly(db);
    const secondProject = await createProjectDirectly(db);
    await mkdir(path.join(firstProject.repoPath, "src"), { recursive: true });
    await mkdir(path.join(secondProject.repoPath, "src"), { recursive: true });
    await writeFile(path.join(firstProject.repoPath, "src", "alpha.ts"), "export const alpha = 1;\n");
    await writeFile(path.join(firstProject.repoPath, "src", "gamma.ts"), "export const gamma = 3;\n");
    await writeFile(path.join(secondProject.repoPath, "src", "beta.ts"), "export const beta = 2;\n");

    const sourceScanService = createSourceScanService(db);
    await sourceScanService.scanAndPersistProject({
      projectId: firstProject.id,
      repoPath: firstProject.repoPath,
      indexRunId: firstProject.id
    });
    await sourceScanService.scanAndPersistProject({
      projectId: secondProject.id,
      repoPath: secondProject.repoPath,
      indexRunId: secondProject.id
    });

    const firstFiles = await sourceScanService.listSourceFiles(firstProject.id, {
      limit: 50,
      offset: 0
    });
    const secondFiles = await sourceScanService.listSourceFiles(secondProject.id, {
      limit: 50,
      offset: 0
    });
    const alphaFile = firstFiles.find((file) => file.path === "src/alpha.ts");
    const betaFile = secondFiles.find((file) => file.path === "src/beta.ts");

    expect(firstFiles).toHaveLength(2);
    expect(alphaFile).toBeDefined();
    expect(betaFile).toBeDefined();

    await expect(
      sourceScanService.getSourceFileDetail(firstProject.id, betaFile!.id)
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Source file not found"
    });
    await expect(
      sourceScanService.getSourceFileDetail(firstProject.id, alphaFile!.id)
    ).resolves.toMatchObject({
      projectId: firstProject.id,
      path: "src/alpha.ts"
    });
  });

  it("uses a transaction snapshot for route-facing source inventory reads", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.repoPath, "src", "alpha.ts"), "export const alpha = 1;\n");

    const sourceScanService = createSourceScanService(db);
    await sourceScanService.scanAndPersistProject({
      projectId: project.id,
      repoPath: project.repoPath,
      indexRunId: project.id
    });

    let transactionCount = 0;
    const observedDb = Object.create(db) as typeof db;
    observedDb.transaction = (async (...args: Parameters<typeof db.transaction>) => {
      transactionCount += 1;
      return db.transaction(...args);
    }) as typeof db.transaction;
    const observedService = createSourceScanService(observedDb);

    const files = await observedService.listSourceFiles(project.id, { limit: 50, offset: 0 });
    await observedService.getSourceFileDetail(project.id, files[0]!.id);
    await observedService.getSourceAggregate(project.id);

    expect(transactionCount).toBe(3);
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
      targetAgent: "codex",
      impactedContextEntityIds: []
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

  it("includes explicit impacted context when previewing an agent task", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      [
        "---",
        "id: domain.decision",
        "type: domain_entity",
        "title: Decision",
        "status: draft",
        "links:",
        "  uses:",
        "    - domain.policy",
        "---",
        "",
        "# Decision",
        "",
        "## Definition",
        "",
        "A decision made in a workspace.",
        ""
      ].join("\n")
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "policy.md"),
      "---\nid: domain.policy\ntype: domain_entity\ntitle: Policy\nstatus: draft\nlinks: {}\n---\n\n# Policy\n"
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "outcome.md"),
      "---\nid: domain.outcome\ntype: domain_entity\ntitle: Outcome\nstatus: draft\nlinks: {}\n---\n\n# Outcome\n"
    );
    await createIndexerService(createTestDb()).indexProject(project.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-tasks/preview`,
      payload: {
        sourceEntityId: "domain.decision",
        targetAgent: "codex",
        impactedContextEntityIds: ["domain.policy", "domain.outcome"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceSpecIds: ["domain.decision"],
      contextSpecIds: expect.arrayContaining(["domain.policy", "domain.outcome"])
    });
  });

  it("returns change impact preview data for an indexed entity", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "domain.ts"),
      "/**\n * @specops domain.decision\n */\nexport interface Decision { id: string; }\n"
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\n" +
        "id: domain.decision\n" +
        "type: domain_entity\n" +
        "title: Decision\n" +
        "status: draft\n" +
        "links:\n" +
        "  uses:\n" +
        "    - domain.policy\n" +
        "---\n\n" +
        "# Decision\n"
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "policy.md"),
      "---\n" +
        "id: domain.policy\n" +
        "type: domain_entity\n" +
        "title: Policy\n" +
        "status: draft\n" +
        "links: {}\n" +
        "---\n\n" +
        "# Policy\n"
    );
    await createIndexerService(createTestDb()).indexProject(project.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/change-impact-preview?depth=1&direction=both&includeSource=true`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rootEntity: { entityId: "domain.decision" },
      overview: expect.objectContaining({
        impactedSpecCount: 2,
        sourceFileCount: 1
      }),
      sourceGroups: [
        expect.objectContaining({
          filePath: "src/domain.ts"
        })
      ],
      taskSeed: {
        sourceEntityId: "domain.decision",
        targetAgent: "codex",
        impactedContextEntityIds: ["domain.policy"]
      }
    });
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
      targetAgent: "codex",
      impactedContextEntityIds: []
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
      targetAgent: "codex",
      impactedContextEntityIds: []
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
      targetAgent: "codex",
      impactedContextEntityIds: []
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
      targetAgent: "codex",
      impactedContextEntityIds: []
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

  async function writeSampleSourceProject(repoPath: string) {
    await mkdir(path.join(repoPath, "src", "services"), { recursive: true });
    await writeFile(
      path.join(repoPath, "src", "domain.ts"),
      "export interface Workspace { id: string; name: string; }\n" +
        "export interface Decision { id: string; title: string; }\n" +
        "export type DecisionLink = { fromId: string; toId: string };\n"
    );
    await writeFile(
      path.join(repoPath, "src", "service.ts"),
      "import type { Decision, Workspace } from './domain';\n" +
        "export class DecisionService {\n" +
        "  list(_workspace: Workspace): Decision[] { return []; }\n" +
        "}\n"
    );
    await writeFile(
      path.join(repoPath, "src", "services", "reminder-scheduler.ts"),
      "export class ReminderScheduler { schedule() { return null; } }\n"
    );
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
    await stat(value);
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
