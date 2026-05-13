import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { analyzeRunDetailSchema } from "@specops/contracts";
import { aiProposals, analyzeRuns, createDb, diffReviews } from "@specops/db";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BadRequestError } from "../lib/http-errors.js";
import { buildServer } from "../server.js";
import { createAgentRunService } from "../services/agent-run-service.js";
import { createAgentTaskService } from "../services/agent-task-service.js";
import type { AiPrefillProviderFactory } from "../services/ai-prefill-service.js";
import { createDiffReviewService } from "../services/diff-review-service.js";
import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";
import { createProposalService } from "../services/proposal-service.js";
import { createSourceBootstrapService } from "../services/source-bootstrap-service.js";
import { createSourceScanService } from "../services/source-scan-service.js";

const execFileAsync = promisify(execFile);
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

  it("lists known admin database tables without exposing arbitrary database tables", async () => {
    app = buildServer(testDatabaseUrl!);
    await createProjectViaApi();

    const response = await app.inject({ method: "GET", url: "/api/admin/database/tables" });
    const body = response.json() as Array<{
      name: string;
      label: string;
      rowCount: number;
      supportsRowId: boolean;
    }>;

    expect(response.statusCode).toBe(200);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "projects",
          label: "projects",
          rowCount: expect.any(Number),
          supportsRowId: true
        }),
        expect.objectContaining({
          name: "spec_entities",
          label: "spec_entities",
          rowCount: expect.any(Number),
          supportsRowId: true
        })
      ])
    );
    expect(body).not.toContainEqual(expect.objectContaining({ name: "pg_catalog" }));
  });

  it("returns schema metadata for a known admin database table", async () => {
    app = buildServer(testDatabaseUrl!);

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/database/tables/projects/schema"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      table: "projects",
      primaryKey: "id",
      columns: expect.arrayContaining([
        { name: "id", dataType: "uuid", notNull: true },
        { name: "name", dataType: "text", notNull: true },
        { name: "description", dataType: "text", notNull: false }
      ])
    });
  });

  it("reads an admin database row by id and navigates neighboring rows", async () => {
    app = buildServer(testDatabaseUrl!);
    const first = await createProjectDirectlyWithId("00000000-0000-4000-8000-000000000101");
    const second = await createProjectDirectlyWithId("00000000-0000-4000-8000-000000000102");

    const rowResponse = await app.inject({
      method: "GET",
      url: `/api/admin/database/tables/projects/row?id=${first.id}`
    });
    const nextResponse = await app.inject({
      method: "GET",
      url: `/api/admin/database/tables/projects/row-neighbor?id=${first.id}&direction=next`
    });
    const prevResponse = await app.inject({
      method: "GET",
      url: `/api/admin/database/tables/projects/row-neighbor?id=${second.id}&direction=prev`
    });

    expect(rowResponse.statusCode).toBe(200);
    expect(rowResponse.json()).toMatchObject({ table: "projects", row: { id: first.id } });
    expect(nextResponse.statusCode).toBe(200);
    expect(nextResponse.json()).toMatchObject({ table: "projects", row: { id: second.id } });
    expect(prevResponse.statusCode).toBe(200);
    expect(prevResponse.json()).toMatchObject({ table: "projects", row: { id: first.id } });
  });

  it("returns capped admin database rows and rejects unknown tables", async () => {
    app = buildServer(testDatabaseUrl!);
    await createProjectViaApi();

    const rowsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/database/tables/projects/rows?limit=1"
    });
    const unknownResponse = await app.inject({
      method: "GET",
      url: "/api/admin/database/tables/not_allowed/rows"
    });

    expect(rowsResponse.statusCode).toBe(200);
    expect(rowsResponse.json()).toMatchObject({
      table: "projects",
      rows: [expect.objectContaining({ id: expect.any(String) })],
      limit: 1
    });
    expect(unknownResponse.statusCode).toBe(404);
    expect(unknownResponse.json().error.message).toBe("Unknown admin database table");
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

  it("starts, lists, reads, and finishes an agent run through the API", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSampleSourceProject(project.repoPath);
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'ready'; }\n"
    );
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n\nReview source changes before acceptance."
      })
    );
    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n\nUpdate the review service implementation."
      })
    );
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "specops@example.test"]);
    await git(project.repoPath, ["config", "user.name", "SpecOps Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "Initial state"]);
    await createIndexerService(db).indexProject(project.id);

    const sourceFileResult = await pool.query<{ id: string }>(
      "select id from source_files where project_id = $1 and path = 'src/review-service.ts'",
      [project.id]
    );
    expect(sourceFileResult.rows[0]).toBeDefined();
    await pool.query(
      "insert into source_spec_links (project_id, source_file_id, file_path, entity_id, symbol_name, symbol_kind, symbol_line, annotation_line, content_hash) values ($1, $2, 'src/review-service.ts', 'uc.review', 'reviewService', 'function', 1, null, 'review-link-hash')",
      [project.id, sourceFileResult.rows[0]!.id]
    );

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-runs`,
      payload: {
        taskEntityId: "task.review",
        agent: "codex"
      }
    });
    const started = startResponse.json() as {
      id: string;
      status: string;
      taskEntityId: string;
      promptMarkdown: string;
    };

    expect(startResponse.statusCode).toBe(201);
    expect(started.status).toBe("running");
    expect(started.taskEntityId).toBe("task.review");
    expect(started.promptMarkdown).toContain("source_entity: uc.review");

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/agent-runs`
    });
    const listBody = listResponse.json() as Array<{ id: string; status: string }>;

    expect(listResponse.statusCode).toBe(200);
    expect(listBody).toEqual([
      expect.objectContaining({
        id: started.id,
        status: "running"
      })
    ]);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/agent-runs/${started.id}`
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      id: started.id,
      status: "running",
      taskEntityId: "task.review"
    });

    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'changed'; }\n"
    );

    const finishResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-runs/${started.id}/finish`
    });
    const finished = finishResponse.json() as {
      status: string;
      changedFiles: {
        specs: string[];
        source: string[];
        tests: string[];
        other: string[];
      };
      changedFileCount: number;
      reviewSummary: {
        taskContext: {
          sourceEntityId: string | null;
          contextEntityIds: string[];
          missingEntityIds: string[];
        };
        affectedSpecs: Array<{
          entityId: string;
          title: string;
          type: string;
          filePath: string;
          reason: string;
        }>;
        findings: Array<{
          id: string;
          kind: string;
          entityId: string | null;
          filePath: string | null;
        }>;
        suggestedValidationCommands: string[];
      };
      findingCounts: {
        review: number;
      };
    };

    expect(finishResponse.statusCode).toBe(200);
    expect(finished.status).toBe("ready_for_review");
    expect(finished.changedFiles).toEqual({
      specs: [],
      source: ["src/review-service.ts"],
      tests: [],
      other: []
    });
    expect(finished.changedFileCount).toBe(1);
    expect(finished.reviewSummary.taskContext).toEqual({
      sourceEntityId: "uc.review",
      contextEntityIds: ["uc.review"],
      missingEntityIds: []
    });
    expect(finished.reviewSummary.affectedSpecs).toEqual([
      {
        entityId: "uc.review",
        title: "Review Loop",
        type: "use_case",
        filePath: "use-cases/uc.review.md",
        reason: "linked_source"
      }
    ]);
    expect(finished.reviewSummary.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        "source_changed_without_spec",
        "possible_missing_test_change",
        "task_not_updated"
      ])
    );
    expect(finished.reviewSummary.findings.map((finding) => finding.id)).toEqual(
      finished.reviewSummary.findings.map((finding) => `${finding.kind}:${
        finding.entityId ?? finding.filePath ?? "project"
      }`)
    );
    expect(finished.reviewSummary.suggestedValidationCommands).toEqual([
      "pnpm typecheck",
      "pnpm test"
    ]);
    expect(finished.findingCounts.review).toBeGreaterThanOrEqual(1);
  });

  it("does not flag task_not_updated when the agent task markdown changes", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n"
      })
    );
    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n"
      })
    );
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "specops@example.test"]);
    await git(project.repoPath, ["config", "user.name", "SpecOps Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "Initial state"]);
    await createIndexerService(db).indexProject(project.id);

    const service = createAgentRunService(db);
    const started = await service.startRun(project.id, {
      taskEntityId: "task.review",
      agent: "codex"
    });

    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n\nValidation: pnpm test passed.\n"
      })
    );

    const finished = await service.finishRun(project.id, started.id);

    expect(finished.changedFiles.specs).toEqual([".specops/agent-tasks/task.review.md"]);
    expect(finished.reviewSummary.findings.map((finding) => finding.kind)).not.toContain(
      "task_not_updated"
    );
  });

  it("reports affected spec validation errors as blocker agent run findings", async () => {
    const db = createTestDb();
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n\n## Goal\n\nReview changes.\n\n## Acceptance Criteria\n\n- Review passes.\n"
    });
    await pool.query(
      "insert into validation_messages (project_id, entity_id, file_path, level, code, message) values ($1, 'uc.review', 'use-cases/uc.review.md', 'error', 'review_error', 'Review spec is invalid')",
      [project.id]
    );
    const service = createAgentRunService(db);
    const started = await service.startRun(project.id, {
      taskEntityId: "task.review",
      agent: "codex"
    });

    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'changed'; }\n"
    );

    const finished = await service.finishRun(project.id, started.id);
    const validationFinding = finished.reviewSummary.findings.find(
      (finding) => finding.kind === "validation_warning" && finding.entityId === "uc.review"
    );

    expect(validationFinding).toMatchObject({
      severity: "blocker",
      kind: "validation_warning",
      entityId: "uc.review",
      filePath: "use-cases/uc.review.md"
    });
    expect(finished.findingCounts.blocker).toBeGreaterThanOrEqual(1);
  });

  it("reports non-ready affected specs as readiness agent run findings", async () => {
    const db = createTestDb();
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n"
    });
    const service = createAgentRunService(db);
    const started = await service.startRun(project.id, {
      taskEntityId: "task.review",
      agent: "codex"
    });

    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'changed'; }\n"
    );

    const finished = await service.finishRun(project.id, started.id);
    const readinessFinding = finished.reviewSummary.findings.find(
      (finding) => finding.kind === "readiness_warning" && finding.entityId === "uc.review"
    );

    expect(readinessFinding).toMatchObject({
      severity: "review",
      kind: "readiness_warning",
      entityId: "uc.review",
      filePath: "use-cases/uc.review.md"
    });
  });

  it("uses project.yaml validation commands for agent run review suggestions", async () => {
    const db = createTestDb();
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n\n## Goal\n\nReview changes.\n"
    });
    await writeSpecFile(
      project.specopsPath,
      "project.yaml",
      [
        "agent_task_defaults:",
        "  validation_commands:",
        "    - pnpm lint",
        "    - pnpm test -- review-service",
        ""
      ].join("\n")
    );
    const service = createAgentRunService(db);
    const started = await service.startRun(project.id, {
      taskEntityId: "task.review",
      agent: "codex"
    });

    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'changed'; }\n"
    );

    const finished = await service.finishRun(project.id, started.id);

    expect(finished.reviewSummary.suggestedValidationCommands).toEqual([
      "pnpm lint",
      "pnpm test -- review-service"
    ]);
  });

  it("reports unlinked-only source changes without source_changed_without_spec", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "unlinked-service.ts"),
      "export function unlinkedService() { return 'ready'; }\n"
    );
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n\n## Goal\n\nReview changes.\n"
      })
    );
    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n"
      })
    );
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "specops@example.test"]);
    await git(project.repoPath, ["config", "user.name", "SpecOps Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "Initial state"]);
    await createIndexerService(db).indexProject(project.id);
    const service = createAgentRunService(db);
    const started = await service.startRun(project.id, {
      taskEntityId: "task.review",
      agent: "codex"
    });

    await writeFile(
      path.join(project.repoPath, "src", "unlinked-service.ts"),
      "export function unlinkedService() { return 'changed'; }\n"
    );

    const finished = await service.finishRun(project.id, started.id);
    const findingKinds = finished.reviewSummary.findings.map((finding) => finding.kind);

    expect(findingKinds).toContain("unlinked_source_changed");
    expect(findingKinds).not.toContain("source_changed_without_spec");
  });

  it.each([
    { mode: "non-Git", initializeGit: false },
    { mode: "Git repo with no HEAD", initializeGit: true }
  ])("reports git comparison unavailable for $mode agent runs", async ({ initializeGit }) => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n"
      })
    );
    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n"
      })
    );
    if (initializeGit) {
      await git(project.repoPath, ["init"]);
    }
    await createIndexerService(db).indexProject(project.id);
    const service = createAgentRunService(db);
    const started = await service.startRun(project.id, {
      taskEntityId: "task.review",
      agent: "codex"
    });

    const finished = await service.finishRun(project.id, started.id);
    const gitFinding = finished.reviewSummary.findings.find(
      (finding) => finding.kind === "git_comparison_unavailable"
    );

    expect(gitFinding).toMatchObject({
      severity: "info",
      kind: "git_comparison_unavailable",
      entityId: null,
      filePath: null
    });
  });

  it("rejects starting an agent run from a non-agent-task entity", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n"
      })
    );
    await createIndexerService(db).indexProject(project.id);

    await expect(
      createAgentRunService(db).startRun(project.id, {
        taskEntityId: "uc.review",
        agent: "codex"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Agent run must start from an agent_task entity"
    });
  });

  it("rejects accepting a running agent run through the API", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n"
      })
    );
    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n"
      })
    );
    await createIndexerService(db).indexProject(project.id);
    const startResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-runs`,
      payload: {
        taskEntityId: "task.review",
        agent: "codex"
      }
    });
    const run = startResponse.json() as { id: string };

    expect(startResponse.statusCode).toBe(201);

    const acceptResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/agent-runs/${run.id}`,
      payload: {
        status: "accepted"
      }
    });

    expect(acceptResponse.statusCode).toBe(400);
    expect(acceptResponse.json()).toMatchObject({
      error: {
        code: "bad_request",
        message: "Agent run status can only be accepted from ready_for_review"
      }
    });
  });

  it("creates, lists, reads, and updates a working tree diff review", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createDiffReviewProject(db);
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'changed'; }\n"
    );

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "working_tree" }
    });
    const created = createResponse.json() as {
      id: string;
      status: string;
      reviewType: string;
      changedFiles: { specs: string[]; source: string[]; tests: string[]; other: string[] };
      changedFileCount: number;
      reviewSummary: {
        affectedSpecs: Array<{ entityId: string; reason: string }>;
        relatedTasks: Array<{ entityId: string; reason: string }>;
        findings: Array<{ kind: string; entityId: string | null; filePath: string | null }>;
      };
      findingCounts: { review: number };
    };

    expect(createResponse.statusCode).toBe(201);
    expect(created).toMatchObject({
      status: "ready_for_review",
      reviewType: "working_tree",
      changedFiles: {
        specs: [],
        source: ["src/review-service.ts"],
        tests: [],
        other: []
      },
      changedFileCount: 1,
      reviewSummary: {
        affectedSpecs: [{ entityId: "uc.review", reason: "linked_source" }],
        relatedTasks: [{ entityId: "task.review", reason: "generated_from" }]
      }
    });
    expect(created.reviewSummary.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        "source_changed_without_spec",
        "possible_missing_test_change",
        "related_task_may_be_stale"
      ])
    );

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/diff-reviews`
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        id: created.id,
        status: "ready_for_review",
        changedFileCount: 1,
        findingCounts: expect.objectContaining({ review: expect.any(Number) })
      })
    ]);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/diff-reviews/${created.id}`
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      id: created.id,
      changedFiles: created.changedFiles
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/diff-reviews/${created.id}`,
      payload: { status: "accepted" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({ id: created.id, status: "accepted" });
  });

  it("creates a staged diff review from staged files only", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createDiffReviewProject(db);
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'staged'; }\n"
    );
    await git(project.repoPath, ["add", "src/review-service.ts"]);
    await writeFile(
      path.join(project.repoPath, "src", "unlinked-service.ts"),
      "export function unlinkedService() { return 'unstaged'; }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "staged" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      changedFiles: {
        specs: [],
        source: ["src/review-service.ts"],
        tests: [],
        other: []
      },
      changedFileCount: 1
    });
  });

  it("creates a ref range diff review with resolved commits and changed files", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createDiffReviewProject(db);
    const { stdout: baseStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: project.repoPath
    });
    const baseCommit = baseStdout.trim();
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'committed'; }\n"
    );
    await git(project.repoPath, ["add", "src/review-service.ts"]);
    await git(project.repoPath, ["commit", "-m", "Change review service"]);
    const { stdout: headStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: project.repoPath
    });
    const headCommit = headStdout.trim();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "ref_range", baseRef: "HEAD~1", headRef: "HEAD" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      reviewType: "ref_range",
      baseRef: "HEAD~1",
      headRef: "HEAD",
      baseCommit,
      headCommit,
      changedFiles: {
        specs: [],
        source: ["src/review-service.ts"],
        tests: [],
        other: []
      }
    });
  });

  it("returns 400 for an invalid diff review ref range", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createDiffReviewProject(db);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "ref_range", baseRef: "missing-ref", headRef: "HEAD" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "bad_request",
        message: "Invalid Git ref",
        details: { ref: "missing-ref" }
      }
    });
  });

  it("creates a no-Git diff review with a git_comparison_unavailable finding", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: "# Review Loop\n"
      })
    );
    await createIndexerService(db).indexProject(project.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "working_tree" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      baseCommit: null,
      headCommit: null,
      changedFiles: { specs: [], source: [], tests: [], other: [] },
      reviewSummary: {
        findings: [
          expect.objectContaining({
            severity: "info",
            kind: "git_comparison_unavailable",
            entityId: null,
            filePath: null
          })
        ]
      }
    });
  });

  it("rejects diff review status changes after a terminal status", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createDiffReviewProject(db);

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "working_tree" }
    });
    const created = createResponse.json() as { id: string };
    const acceptResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/diff-reviews/${created.id}`,
      payload: { status: "accepted" }
    });
    const rejectResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/diff-reviews/${created.id}`,
      payload: { status: "needs_followup" }
    });

    expect(acceptResponse.statusCode).toBe(200);
    expect(rejectResponse.statusCode).toBe(400);
    expect(rejectResponse.json()).toMatchObject({
      error: {
        code: "bad_request",
        message: "Diff review already has a terminal status"
      }
    });
  });

  it("rejects a diff review status update when a concurrent update makes it terminal", async () => {
    const db = createTestDb();
    const project = await createDiffReviewProject(db);
    const service = createDiffReviewService(db);
    const created = await service.createReview(project.id, { reviewType: "working_tree" });
    const raceDb = createTerminalRaceDb(db, project.id, created.id);

    await expect(
      createDiffReviewService(raceDb).updateReviewStatus(project.id, created.id, {
        status: "needs_followup"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Diff review already has a terminal status",
      details: expect.objectContaining({
        reviewId: created.id,
        status: "accepted",
        requestedStatus: "needs_followup"
      })
    });

    await expect(service.getReview(project.id, created.id)).resolves.toMatchObject({
      status: "accepted"
    });
  });

  it("reports diff review findings for unlinked source, spec tasks, validation, and readiness", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createDiffReviewProject(db);
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.orphan.md",
      specEntityMarkdown({
        id: "uc.orphan",
        type: "use_case",
        title: "Orphan Spec",
        status: "draft",
        body: "# Orphan Spec\n"
      })
    );
    await createIndexerService(db).indexProject(project.id);
    await pool.query(
      "insert into validation_messages (project_id, entity_id, file_path, level, code, message) values ($1, 'uc.orphan', 'use-cases/uc.orphan.md', 'error', 'review_error', 'Orphan spec is invalid')",
      [project.id]
    );
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "Add orphan spec"]);
    await writeFile(
      path.join(project.repoPath, "src", "unlinked-service.ts"),
      "export function unlinkedService() { return 'changed'; }\n"
    );
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.orphan.md",
      specEntityMarkdown({
        id: "uc.orphan",
        type: "use_case",
        title: "Orphan Spec",
        status: "draft",
        body: "# Orphan Spec\n\nChanged.\n"
      })
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "working_tree" }
    });
    const body = response.json() as {
      reviewSummary: {
        affectedSpecs: Array<{ entityId: string; reason: string }>;
        relatedTasks: Array<{ entityId: string; reason: string }>;
        findings: Array<{ severity: string; kind: string; entityId: string | null; filePath: string | null }>;
      };
    };

    expect(response.statusCode).toBe(201);
    expect(body.reviewSummary.affectedSpecs).toContainEqual(
      expect.objectContaining({ entityId: "uc.orphan", reason: "changed_spec" })
    );
    expect(body.reviewSummary.relatedTasks).not.toContainEqual(
      expect.objectContaining({ entityId: "task.review" })
    );
    expect(body.reviewSummary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unlinked_source_changed",
          severity: "context",
          filePath: "src/unlinked-service.ts"
        }),
        expect.objectContaining({
          kind: "possible_missing_test_change",
          severity: "review"
        }),
        expect.objectContaining({
          kind: "changed_spec_has_no_task",
          severity: "review",
          entityId: "uc.orphan"
        }),
        expect.objectContaining({
          kind: "validation_warning",
          severity: "blocker",
          entityId: "uc.orphan"
        }),
        expect.objectContaining({
          kind: "readiness_warning",
          severity: "blocker",
          entityId: "uc.orphan"
        })
      ])
    );
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

  it("uses one deterministic latest index run for project overview summary", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const olderRunId = "10000000-0000-4000-8000-000000000001";
    const latestRunId = "f0000000-0000-4000-8000-000000000002";

    await pool.query(
      "insert into index_runs (id, project_id, started_at, finished_at, status, entity_count, link_count, error_count, warning_count, source_file_count, source_import_count, source_export_count, source_symbol_count, git_commit) values " +
        "($1, $3, '2026-05-10T11:00:00Z', '2026-05-10T11:00:01Z', 'succeeded', 1, 0, 0, 0, 0, 0, 0, 0, 'older')," +
        "($2, $3, '2026-05-10T11:00:00Z', '2026-05-10T11:00:09Z', 'succeeded', 2, 0, 0, 0, 0, 0, 0, 0, 'latest')",
      [olderRunId, latestRunId, project.id]
    );
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash, created_at, updated_at) values " +
        "($1, 'domain.alpha', 'domain_entity', 'Alpha', 'draft', 'domain/alpha.md', '# Alpha', 'Alpha', 'hash-alpha', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')," +
        "($1, 'interface.beta', 'interface', 'Beta', 'ready', 'interfaces/beta.md', '# Beta', 'Beta', 'hash-beta', '2026-05-10T09:01:00Z', '2026-05-10T09:01:00Z')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview`
    });
    const body = response.json() as {
      project: { entityCount: number; lastIndexedAt: string | null };
      latestIndexRun: { id: string; finishedAt: string | null; gitCommit: string | null };
      entityCountsByType: Array<{ count: number }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.latestIndexRun).toMatchObject({
      id: latestRunId,
      gitCommit: "latest",
      finishedAt: "2026-05-10T11:00:09.000Z"
    });
    expect(body.project.lastIndexedAt).toBe(body.latestIndexRun.finishedAt);
    expect(body.project.entityCount).toBe(
      body.entityCountsByType.reduce((total, row) => total + row.count, 0)
    );
  });

  it("returns zero project health drift for a non-Git project", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      git: {
        isRepo: false,
        headCommit: null,
        indexedCommit: null,
        hasUncommittedChanges: false,
        changedSpecFiles: [],
        changedSourceFiles: [],
        untrackedSpecFiles: [],
        untrackedSourceFiles: []
      },
      drift: {
        indexIsBehindHead: false,
        currentSpecFileChangeCount: 0,
        currentSourceFileChangeCount: 0
      },
      staleTasks: {
        count: 0,
        samples: []
      },
      attentionItems: []
    });
  });

  it("reports stale agent tasks when tracked spec hashes mismatch", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, frontmatter_json, body_markdown, body_text, content_hash, created_at, updated_at) values " +
        "($1, 'domain.customer', 'domain_entity', 'Customer', 'draft', 'domain/customer.md', '{}'::jsonb, '# Customer', 'Customer', 'hash-current', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')," +
        "($1, 'task.customer', 'agent_task', 'Update Customer', 'open', 'agent-tasks/task.customer.md', $2::jsonb, '# Update Customer', 'Update Customer', 'task-hash', '2026-05-10T10:00:00Z', '2026-05-10T10:00:00Z')",
      [
        project.id,
        JSON.stringify({
          source_entity: "domain.customer",
          links: {
            generated_from: ["domain.customer"],
            uses: ["domain.customer"]
          },
          tracked_spec_hashes: {
            "domain.customer": "hash-old"
          }
        })
      ]
    );
    await pool.query(
      "insert into spec_links (project_id, from_entity_id, to_entity_id, link_type, source) values " +
        "($1, 'task.customer', 'domain.customer', 'generated_from', 'frontmatter')," +
        "($1, 'task.customer', 'domain.customer', 'uses', 'frontmatter')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      staleTasks: {
        count: 1,
        samples: [
          {
            entityId: "task.customer",
            title: "Update Customer",
            sourceEntityId: "domain.customer",
            reason: "tracked_hash_mismatch"
          }
        ]
      },
      attentionItems: [
        expect.objectContaining({
          kind: "stale_agent_task",
          entityId: "task.customer"
        })
      ]
    });
  });

  it("reports Git commit drift and dirty spec and source files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi({ specopsDirectoryName: "specops" });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "domain", "customer.md"), "# Customer\n");
    await writeFile(path.join(project.repoPath, "src", "customer.ts"), "export const customer = 1;\n");
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "routes@example.test"]);
    await git(project.repoPath, ["config", "user.name", "Routes Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "initial"]);
    const { stdout: indexedCommitStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: project.repoPath
    });
    const indexedCommit = indexedCommitStdout.trim();
    await writeFile(path.join(project.repoPath, "README.md"), "# Readme\n");
    await git(project.repoPath, ["add", "README.md"]);
    await git(project.repoPath, ["commit", "-m", "readme"]);
    const { stdout: headCommitStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: project.repoPath
    });
    const headCommit = headCommitStdout.trim();
    await writeFile(path.join(project.specopsPath, "domain", "customer.md"), "# Customer\n\nDirty\n");
    await writeFile(path.join(project.repoPath, "src", "customer.ts"), "export const customer = 2;\n");
    await writeFile(path.join(project.specopsPath, "domain", "new.md"), "# New\n");
    await pool.query(
      "insert into index_runs (project_id, started_at, finished_at, status, git_commit) values ($1, '2026-05-10T10:00:00Z', '2026-05-10T10:00:03Z', 'succeeded', $2)",
      [project.id, indexedCommit]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: {
        isRepo: true,
        headCommit,
        indexedCommit,
        hasUncommittedChanges: true,
        changedSpecFiles: ["specops/domain/customer.md"],
        changedSourceFiles: ["src/customer.ts"],
        untrackedSpecFiles: ["specops/domain/new.md"],
        untrackedSourceFiles: []
      },
      drift: {
        indexIsBehindHead: true,
        currentSpecFileChangeCount: 2,
        currentSourceFileChangeCount: 1
      }
    });
  });

  it("filters project health Git drift to canonical specs and supported source paths", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi({ specopsDirectoryName: "specops" });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "templates"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "domain", "customer.md"), "# Customer\n");
    await writeFile(path.join(project.specopsPath, "templates", "use-case.template.md"), "# Template\n");
    await writeFile(path.join(project.specopsPath, "project.yaml"), "name: old\n");
    await writeFile(path.join(project.repoPath, "src", "customer.ts"), "export const customer = 1;\n");
    await writeFile(path.join(project.repoPath, "README.md"), "# Readme\n");
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "routes@example.test"]);
    await git(project.repoPath, ["config", "user.name", "Routes Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "initial"]);

    await mkdir(path.join(project.repoPath, "dist"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "domain", "customer.md"), "# Customer\n\nDirty\n");
    await writeFile(path.join(project.specopsPath, "templates", "use-case.template.md"), "# Template\n\nDirty\n");
    await writeFile(path.join(project.specopsPath, "templates", "adr.template.md"), "# ADR Template\n");
    await writeFile(path.join(project.specopsPath, "project.yaml"), "name: dirty\n");
    await writeFile(path.join(project.specopsPath, "notes.txt"), "not a canonical spec\n");
    await writeFile(path.join(project.repoPath, "src", "customer.ts"), "export const customer = 2;\n");
    await writeFile(path.join(project.repoPath, "README.md"), "# Readme\n\nDirty\n");
    await writeFile(path.join(project.repoPath, ".env"), "SECRET=value\n");
    await writeFile(path.join(project.repoPath, "dist", "generated.ts"), "export const generated = 1;\n");

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: {
        changedSpecFiles: ["specops/domain/customer.md"],
        changedSourceFiles: ["src/customer.ts"],
        untrackedSpecFiles: [],
        untrackedSourceFiles: []
      },
      drift: {
        currentSpecFileChangeCount: 1,
        currentSourceFileChangeCount: 1
      }
    });
  });

  it("reports nested untracked spec and source files instead of directory placeholders", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi({ specopsDirectoryName: "specops" });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "domain", "customer.md"), "# Customer\n");
    await writeFile(path.join(project.repoPath, "src", "customer.ts"), "export const customer = 1;\n");
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "routes@example.test"]);
    await git(project.repoPath, ["config", "user.name", "Routes Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "initial"]);
    await mkdir(path.join(project.specopsPath, "new"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src", "new"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "new", "nested.md"), "# Nested\n");
    await writeFile(path.join(project.repoPath, "src", "new", "component.ts"), "export const component = 1;\n");

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: {
        untrackedSpecFiles: ["specops/new/nested.md"],
        untrackedSourceFiles: ["src/new/component.ts"]
      },
      drift: {
        currentSpecFileChangeCount: 1,
        currentSourceFileChangeCount: 1
      }
    });
  });

  it("reports missing source tasks before timestamp fallback stale tasks", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, frontmatter_json, body_markdown, body_text, content_hash, created_at, updated_at) values " +
        "($1, 'domain.changed', 'domain_entity', 'Changed', 'draft', 'domain/changed.md', '{}'::jsonb, '# Changed', 'Changed', 'hash-changed', '2026-05-10T10:00:00Z', '2026-05-10T12:00:00Z')," +
        "($1, 'task.old', 'agent_task', 'Old Task', 'open', 'agent-tasks/task.old.md', $2::jsonb, '# Old Task', 'Old Task', 'task-old-hash', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')," +
        "($1, 'task.missing', 'agent_task', 'Missing Task', 'open', 'agent-tasks/task.missing.md', $3::jsonb, '# Missing Task', 'Missing Task', 'task-missing-hash', '2026-05-10T11:00:00Z', '2026-05-10T11:00:00Z')",
      [
        project.id,
        JSON.stringify({ source_entity: "domain.changed", links: { generated_from: ["domain.changed"] } }),
        JSON.stringify({ source_entity: "domain.missing", links: { generated_from: ["domain.missing"] } })
      ]
    );
    await pool.query(
      "insert into spec_links (project_id, from_entity_id, to_entity_id, link_type, source) values " +
        "($1, 'task.old', 'domain.changed', 'generated_from', 'frontmatter')," +
        "($1, 'task.missing', 'domain.missing', 'generated_from', 'frontmatter')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      staleTasks: {
        count: 2,
        samples: [
          {
            entityId: "task.missing",
            sourceEntityId: "domain.missing",
            reason: "missing_source_entity"
          },
          {
            entityId: "task.old",
            sourceEntityId: "domain.changed",
            reason: "source_spec_changed"
          }
        ]
      }
    });
  });

  it("classifies generated_from timestamp fallback as context when it is not the source entity", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, frontmatter_json, body_markdown, body_text, content_hash, created_at, updated_at) values " +
        "($1, 'domain.source', 'domain_entity', 'Source', 'draft', 'domain/source.md', '{}'::jsonb, '# Source', 'Source', 'hash-source', '2026-05-10T08:00:00Z', '2026-05-10T08:00:00Z')," +
        "($1, 'domain.context', 'domain_entity', 'Context', 'draft', 'domain/context.md', '{}'::jsonb, '# Context', 'Context', 'hash-context', '2026-05-10T10:00:00Z', '2026-05-10T12:00:00Z')," +
        "($1, 'task.context', 'agent_task', 'Context Task', 'open', 'agent-tasks/task.context.md', $2::jsonb, '# Context Task', 'Context Task', 'task-context-hash', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')",
      [
        project.id,
        JSON.stringify({
          source_entity: "domain.source",
          links: { generated_from: ["domain.context"] }
        })
      ]
    );
    await pool.query(
      "insert into spec_links (project_id, from_entity_id, to_entity_id, link_type, source) values " +
        "($1, 'task.context', 'domain.context', 'generated_from', 'frontmatter')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      staleTasks: {
        count: 1,
        samples: [
          {
            entityId: "task.context",
            sourceEntityId: "domain.source",
            reason: "context_spec_changed"
          }
        ]
      }
    });
  });

  it("reports no-tracked-hash tasks as stale after a source spec changes and reindexes", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "agent-tasks"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "customer.md"),
      specEntityMarkdown({
        id: "domain.customer",
        type: "domain_entity",
        title: "Customer",
        status: "draft",
        body: "Customers manage profile settings."
      })
    );
    await writeFile(
      path.join(project.specopsPath, "agent-tasks", "task.customer.md"),
      agentTaskMarkdown({
        id: "task.customer",
        title: "Update Customer Task",
        sourceEntity: "domain.customer",
        body: "Review customer profile work."
      })
    );
    const indexer = createIndexerService(db);
    await indexer.indexProject(project.id);
    await delay(20);
    await writeFile(
      path.join(project.specopsPath, "domain", "customer.md"),
      specEntityMarkdown({
        id: "domain.customer",
        type: "domain_entity",
        title: "Customer",
        status: "draft",
        body: "Customers manage profile settings and notifications."
      })
    );
    await indexer.indexProject(project.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      staleTasks: {
        count: 1,
        samples: [
          {
            entityId: "task.customer",
            sourceEntityId: "domain.customer",
            reason: "source_spec_changed"
          }
        ]
      }
    });
  });

  it("returns project readiness summary and queue from indexed specs", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.checkout.md"),
      "---\n" +
        "id: uc.checkout\n" +
        "type: use_case\n" +
        "title: Checkout\n" +
        "status: draft\n" +
        "links:\n" +
        "  domain:\n" +
        "    - domain.customer\n" +
        "---\n\n" +
        "# Checkout\n\n" +
        "## Goal\n\n" +
        "Customers complete purchases with saved account details, selected shipping options, and clear payment confirmation before order fulfillment begins.\n"
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "domain.customer.md"),
      "---\n" +
        "id: domain.customer\n" +
        "type: domain_entity\n" +
        "title: Customer\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Customer\n\n" +
        "## Definition\n\n" +
        "A customer represents the account holder placing orders, managing saved addresses, and confirming payment preferences during checkout.\n"
    );
    await createIndexerService(db).indexProject(project.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/readiness`
    });
    const body = response.json() as {
      summary: { ready: number; needsContext: number; needsReview: number; blocked: number };
      queue: Array<{
        entityId: string;
        readiness: string;
        topChecks: Array<{ id: string }>;
      }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.summary).toEqual({
      ready: 1,
      needsContext: 1,
      needsReview: 0,
      blocked: 0
    });
    expect(body.queue).toContainEqual(
      expect.objectContaining({
        entityId: "uc.checkout",
        readiness: "needs_context",
        topChecks: expect.arrayContaining([
          expect.objectContaining({ id: "use_case_acceptance_criteria_missing" })
        ])
      })
    );
  });

  it("returns entity readiness and 404 for a missing entity readiness request", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "domain.customer.md"),
      "---\n" +
        "id: domain.customer\n" +
        "type: domain_entity\n" +
        "title: Customer\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Customer\n\n" +
        "## Definition\n\n" +
        "A customer is the account profile used to manage identity, saved addresses, order ownership, and checkout communication preferences.\n"
    );
    await createIndexerService(db).indexProject(project.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.customer/readiness`
    });
    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.missing/readiness`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entityId: "domain.customer",
      readiness: "needs_context",
      checks: [expect.objectContaining({ id: "model_isolated" })]
    });
    expect(missingResponse.statusCode).toBe(404);
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

  it("creates an entity markdown file, indexes it, and returns ranked entity search results", async () => {
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
    const searchBody = searchResponse.json() as Array<{
      entityId: string;
      title: string;
      type: string;
      status: string;
      filePath: string;
      rank: number;
      snippet: string;
      matchedFields: string[];
    }>;

    expect(searchResponse.statusCode).toBe(200);
    expect(searchBody).toHaveLength(1);
    expect(searchBody[0]).toMatchObject({
      entityId: "domain.customer",
      title: "Customer",
      type: "domain_entity",
      status: "draft",
      filePath: "domain/domain.customer.md"
    });
    expect(searchBody[0].rank).toBeGreaterThan(0);
    expect(searchBody[0].snippet).toContain("Customer");
    expect(searchBody[0].matchedFields).toContain("title");
  });

  it("ranks title and entity id matches ahead of body-only matches", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await insertSearchEntity(project.id, {
      entityId: "domain.customer",
      title: "Customer",
      bodyText: "Primary account record."
    });
    await insertSearchEntity(project.id, {
      entityId: "domain.billing",
      title: "Billing",
      bodyText: "Invoices for each customer account."
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer`
    });
    const body = response.json() as Array<{ entityId: string; rank: number }>;

    expect(response.statusCode).toBe(200);
    expect(body.map((result) => result.entityId)).toEqual(["domain.customer", "domain.billing"]);
    expect(body[0].rank).toBeGreaterThanOrEqual(body[1].rank);
  });

  it("reports title as matched when full-text query terms match non-contiguously", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await insertSearchEntity(project.id, {
      entityId: "domain.billing-record",
      title: "Customer billing account",
      bodyText: "Invoices, payments, subscriptions, and statements."
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer%20account`
    });
    const body = response.json() as Array<{ entityId: string; matchedFields: string[] }>;

    expect(response.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ entityId: "domain.billing-record" });
    expect(body[0].matchedFields).toContain("title");
  });

  it("matches entity id segments separated by punctuation", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await insertSearchEntity(project.id, {
      entityId: "domain.customer-profile",
      title: "Profile Record",
      bodyText: "Stores account preferences."
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer`
    });
    const body = response.json() as Array<{ entityId: string; matchedFields: string[] }>;

    expect(response.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ entityId: "domain.customer-profile" });
    expect(body[0].matchedFields).toContain("entityId");
  });

  it("matches punctuated queries against normalized entity id segments", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await insertSearchEntity(project.id, {
      entityId: "domain.customer-profile",
      title: "Account Record",
      bodyText: "Stores preferences."
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer-profile`
    });
    const body = response.json() as Array<{ entityId: string; matchedFields: string[] }>;

    expect(response.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ entityId: "domain.customer-profile" });
    expect(body[0].matchedFields).toContain("entityId");
  });

  it("filters entity search results by type and status", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await insertSearchEntity(project.id, {
      entityId: "domain.customer",
      type: "domain_entity",
      title: "Customer",
      status: "draft"
    });
    await insertSearchEntity(project.id, {
      entityId: "domain.customer-profile",
      type: "domain_entity",
      title: "Customer Profile",
      status: "ready"
    });
    await insertSearchEntity(project.id, {
      entityId: "interface.customer-api",
      type: "interface",
      title: "Customer API",
      status: "ready"
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer&type=domain_entity&status=ready`
    });
    const body = response.json() as Array<{ entityId: string }>;

    expect(response.statusCode).toBe(200);
    expect(body.map((result) => result.entityId)).toEqual(["domain.customer-profile"]);
  });

  it("keeps entity search scoped to the project and enforces limit", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const otherProject = await createProjectViaApi();
    await insertSearchEntity(project.id, {
      entityId: "domain.customer-a",
      title: "Customer A"
    });
    await insertSearchEntity(project.id, {
      entityId: "domain.customer-b",
      title: "Customer B"
    });
    await insertSearchEntity(project.id, {
      entityId: "domain.customer-c",
      title: "Customer C"
    });
    await insertSearchEntity(otherProject.id, {
      entityId: "domain.customer-other",
      title: "Customer Other"
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer&limit=2`
    });
    const body = response.json() as Array<{ entityId: string }>;

    expect(response.statusCode).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.map((result) => result.entityId)).not.toContain("domain.customer-other");
  });

  it("rejects invalid entity search query parameters", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const emptyQueryResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=%20%20`
    });
    const tooLargeLimitResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer&limit=51`
    });

    expect(emptyQueryResponse.statusCode).toBe(400);
    expect(tooLargeLimitResponse.statusCode).toBe(400);
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

  it("generates source import proposals without writing markdown files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const body = response.json() as Array<{
      status: string;
      title: string;
      entityId: string;
      filePath: string;
    }>;

    expect(response.statusCode).toBe(201);
    expect(body).toContainEqual(
      expect.objectContaining({
        status: "pending",
        title: "DecisionService",
        entityId: "interface.decision-service",
        filePath: "interfaces/decision-service.md"
      })
    );
    await expect(fileExists(path.join(project.specopsPath, "interfaces", "decision-service.md")))
      .resolves.toBe(false);
  });

  it("starts and fetches an analyze run through the API", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: successfulAnalyzeRunProviderFactory()
    });
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs`
    });
    const started = analyzeRunDetailSchema.parse(startResponse.json());

    expect(startResponse.statusCode).toBe(201);
    expect(started).toMatchObject({
      id: expect.any(String),
      projectId: project.id
    });
    expect(started.steps.map((step) => step.name)).toEqual([
      "initialize",
      "index",
      "source_proposals",
      "select_ai_sources",
      "ai_prefill"
    ]);

    const fetched = await waitForAnalyzeRun(project.id, started.id);

    expect(fetched).toMatchObject({
      id: started.id,
      projectId: project.id
    });
    expect(fetched.status).toBe("succeeded");
    expect(fetched.aiProposalCount).toBeGreaterThan(0);
    expect(fetched.steps.map((step) => step.name)).toEqual(started.steps.map((step) => step.name));
  });

  it("returns conflict details when starting an analyze run while one is active", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const activeRun = await insertActiveAnalyzeRun(project.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        details: {
          activeRunId: activeRun.id
        }
      }
    });
  });

  it("returns not found when fetching a missing analyze run", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/analyze-runs/00000000-0000-4000-8000-000000000404`
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns bad request when fetching an analyze run with a malformed run id", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/analyze-runs/not-a-uuid`
    });

    expect(response.statusCode).toBe(400);
  });

  it("lists analyze review assemblies for a run", async () => {
    const { app, project, run } = await createAnalyzeReviewRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      assemblies: expect.any(Array),
      unassignedInputs: expect.any(Array),
      counts: expect.any(Object)
    });
  });

  it("creates and patches analyze review assemblies", async () => {
    const { app, project, run } = await createAnalyzeReviewRouteFixture();

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies`,
      payload: {
        title: "Review drafts",
        entityType: "use_case",
        entityId: "use-case.review-drafts",
        filePath: "use-cases/review-drafts.md",
        summary: "Review generated drafts.",
        proposalIds: []
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const assemblyId = createResponse.json().id;
    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assemblyId}`,
      payload: { title: "Review generated drafts" }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().title).toBe("Review generated drafts");
  });

  it("attaches and removes analyze review assembly inputs", async () => {
    const { app, project, run, proposal } = await createAnalyzeReviewRouteFixture();
    const assembly = await createReviewAssemblyViaApi(project.id, run.id);

    const attachResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/inputs`,
      payload: {
        proposalId: proposal.id,
        role: "primary"
      }
    });

    expect(attachResponse.statusCode).toBe(201);
    expect(attachResponse.json().inputs).toContainEqual(
      expect.objectContaining({ proposalId: proposal.id, role: "primary" })
    );

    const removeResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/inputs/${proposal.id}`
    });

    expect(removeResponse.statusCode).toBe(204);
    expect(removeResponse.body).toBe("");
  });

  it("creates and patches analyze review assembly claims", async () => {
    const { app, project, run } = await createAnalyzeReviewRouteFixture();
    const assembly = await createReviewAssemblyViaApi(project.id, run.id);

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/claims`,
      payload: {
        text: "Generated drafts should be reviewed before acceptance.",
        kind: "hypothesis",
        confidence: 0.4
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const claimId = createResponse.json().id;
    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/claims/${claimId}`,
      payload: {
        text: "Generated drafts are reviewed before acceptance.",
        confidence: 0.7
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({
      id: claimId,
      text: "Generated drafts are reviewed before acceptance.",
      confidence: 0.7
    });
  });

  it("attaches and removes analyze review claim evidence", async () => {
    const { app, project, run, proposal } = await createAnalyzeReviewRouteFixture();
    const assembly = await createReviewAssemblyViaApi(project.id, run.id);
    const claimResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/claims`,
      payload: {
        text: "Review routes expose generated drafts.",
        kind: "fact",
        confidence: 0.8
      }
    });
    expect(claimResponse.statusCode).toBe(201);

    const claimId = claimResponse.json().id;
    const attachResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/claims/${claimId}/evidence`,
      payload: {
        proposalId: proposal.id,
        sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
        symbolName: "registerAnalyzeReviewAssemblyRoutes",
        startLine: 1,
        endLine: 80,
        provenance: "user",
        confidence: 0.8
      }
    });

    expect(attachResponse.statusCode).toBe(201);
    expect(attachResponse.json()).toMatchObject({
      proposalId: proposal.id,
      sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts"
    });

    const evidenceId = attachResponse.json().id;
    const removeResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/${assembly.id}/claims/${claimId}/evidence/${evidenceId}`
    });

    expect(removeResponse.statusCode).toBe(204);
    expect(removeResponse.body).toBe("");
  });

  it("accepts analyze review assemblies", async () => {
    const { app, project, run, proposal } = await createAnalyzeReviewRouteFixture();
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies`,
      payload: {
        proposalIds: [proposal.id]
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const assemblyId = createResponse.json().id;
    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs/${run.id}/review-assemblies/accept`,
      payload: {
        assemblyIds: [assemblyId]
      }
    });

    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json()).toMatchObject({
      acceptedAssemblyIds: [assemblyId],
      failures: []
    });
  });

  it("generates AI proposals from selected source files without writing markdown", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          return {
            provider: "ollama",
            model: input.model,
            text: JSON.stringify({
              proposals: [
                {
                  entityId: "uc.manage-projects",
                  type: "use_case",
                  title: "Manage projects",
                  summary: "Users can create and inspect local projects.",
                  sourceFiles: ["src/projects.ts"],
                  claims: [
                    {
                      text: "Project routes create and inspect local projects.",
                      sourceFiles: ["src/projects.ts"]
                    }
                  ],
                  proposedLinks: [],
                  confidence: 0.82
                }
              ]
            })
          };
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });
    const body = response.json() as {
      proposals: ProposalSummaryForTest[];
      diagnostics: unknown[];
    };

    expect(response.statusCode).toBe(201);
    expect(body.diagnostics).toEqual([]);
    expect(body.proposals).toEqual([
      expect.objectContaining({
        proposalType: "ai_spec_entity",
        status: "pending",
        title: "Manage projects",
        entityId: "uc.manage-projects",
        entityType: "use_case",
        filePath: "use-cases/uc.manage-projects.md",
        confidence: 0.82,
        conflict: { status: "none" }
      })
    ]);
    await expect(fileExists(path.join(project.specopsPath, "use-cases", "uc.manage-projects.md")))
      .resolves.toBe(false);
  });

  it("writes no AI proposals when provider generation fails", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          if (input.model === "provider-fails") {
            throw new Error("provider failed");
          }
          throw new Error("unexpected model");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "provider-fails",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({
      code: "bad_gateway",
      message: "AI provider generation failed"
    });
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("writes no AI proposals when provider returns malformed JSON", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          return {
            provider: "ollama",
            model: input.model,
            text: "not json"
          };
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "malformed-output",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "bad_request",
      message: "AI provider returned invalid JSON"
    });
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("returns source file summaries from source-files route", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/source-files`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: sourceFile.id,
        projectId: project.id,
        path: "src/projects.ts",
        language: "typescript",
        kind: "source",
        importCount: 1,
        exportCount: 1,
        symbolCount: 1
      })
    ]);
  });

  it("returns source file detail including imports exports and symbols from source-files route", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/source-files/${sourceFile.id}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: sourceFile.id,
      projectId: project.id,
      path: "src/projects.ts",
      imports: [
        {
          specifier: "./db",
          importKind: "named",
          importedNames: ["ProjectStore"],
          isRelative: true,
          resolvedPath: "src/db.ts"
        }
      ],
      exports: [
        {
          exportedName: "ProjectRoutes",
          exportKind: "class",
          sourceSpecifier: null
        }
      ],
      symbols: [
        {
          name: "ProjectRoutes",
          symbolKind: "class",
          isExported: true,
          line: 3,
          metadata: { routeCount: 2 }
        }
      ]
    });
  });

  it("rejects AI generation when selected source file ID does not belong to project", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals() {
          throw new Error("provider should not be called");
        }
      })
    });
    const project = await createProjectViaApi();
    const otherProject = await createProjectViaApi();
    const otherSourceFile = await insertIndexedSourceFile(otherProject.id, otherProject.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [otherSourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(400);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation over the file count limit before reading selected files", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillConfig: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        openAiBaseUrl: "https://api.openai.com/v1",
        timeoutMs: 60_000,
        maxFiles: 1,
        maxTotalBytes: 60_000
      },
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals() {
          providerCalled = true;
          throw new Error("provider should not be called");
        }
      })
    });
    const project = await createProjectViaApi();
    const firstSourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    const secondSourceFile = await insertIndexedSourceFile(
      project.id,
      project.repoPath,
      "src/extra.ts"
    );
    await rm(path.join(project.repoPath, "src", "extra.ts"));

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [firstSourceFile.id, secondSourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe(
      "Selected source file count exceeds AI Prefill limit"
    );
    expect(providerCalled).toBe(false);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation over the indexed byte limit before reading selected files", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillConfig: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        openAiBaseUrl: "https://api.openai.com/v1",
        timeoutMs: 60_000,
        maxFiles: 5,
        maxTotalBytes: 10_000
      },
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals() {
          providerCalled = true;
          throw new Error("provider should not be called");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    await pool.query("update source_files set size_bytes = 10001 where id = $1", [
      sourceFile.id
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe(
      "Selected source content exceeds AI Prefill limit"
    );
    expect(providerCalled).toBe(false);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation when selected source file changed since indexing", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals() {
          providerCalled = true;
          throw new Error("provider should not be called");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    await writeFile(path.join(project.repoPath, "src", "projects.ts"), "export const changed = true;\n");

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      "Selected source file changed since indexing; re-index before AI Prefill"
    );
    expect(providerCalled).toBe(false);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation when selected source file is missing", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals() {
          providerCalled = true;
          throw new Error("provider should not be called");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    await rm(path.join(project.repoPath, "src", "projects.ts"));

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      "Selected source file is missing; re-index before AI Prefill"
    );
    expect(providerCalled).toBe(false);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation when selected source file changes while provider is running", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          providerCalled = true;
          await writeFile(path.join(project.repoPath, "src", "projects.ts"), "export const changed = true;\n");
          return aiPrefillProviderResult(input.model, "uc.manage-projects", "Manage projects");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      "Selected source file changed since indexing; re-index before AI Prefill"
    );
    expect(providerCalled).toBe(true);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation when selected source file disappears while provider is running", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          providerCalled = true;
          await rm(path.join(project.repoPath, "src", "projects.ts"));
          return aiPrefillProviderResult(input.model, "uc.manage-projects", "Manage projects");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      "Selected source file is missing; re-index before AI Prefill"
    );
    expect(providerCalled).toBe(true);
    await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
  });

  it("rejects AI generation when selected source file changes while waiting for write lock", async () => {
    let providerCalled = false;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          providerCalled = true;
          return aiPrefillProviderResult(input.model, "uc.manage-projects", "Manage projects");
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    const lockClient = await pool.connect();

    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${project.id}:ai_spec_entity`
      ]);

      const responsePromise = app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/proposals/ai-prefill`,
        payload: {
          sourceFileIds: [sourceFile.id],
          provider: "ollama",
          model: "fake-local-model",
          temperature: 0.1
        }
      });

      await waitForAdvisoryLockWaiter();
      await writeFile(path.join(project.repoPath, "src", "projects.ts"), "export const changed = true;\n");
      await lockClient.query("commit");

      const response = await responsePromise;

      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toBe(
        "Selected source file changed since indexing; re-index before AI Prefill"
      );
      expect(providerCalled).toBe(true);
      await expect(countAiPrefillProposals(project.id)).resolves.toBe(0);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
  });

  it("keeps only one pending AI proposal batch when concurrent generations finish together", async () => {
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    let providerCallCount = 0;
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          providerCallCount += 1;
          if (providerCallCount === 2) {
            entered.resolve();
          }
          await release.promise;
          return {
            provider: "ollama",
            model: input.model,
            text: JSON.stringify({
              proposals: [
                {
                  entityId:
                    input.model === "batch-one" ? "uc.manage-projects" : "uc.inspect-projects",
                  type: "use_case",
                  title: input.model === "batch-one" ? "Manage projects" : "Inspect projects",
                  summary: "Users can create and inspect local projects.",
                  sourceFiles: ["src/projects.ts"],
                  claims: [
                    {
                      text: "Project routes create and inspect local projects.",
                      sourceFiles: ["src/projects.ts"]
                    }
                  ],
                  proposedLinks: [],
                  confidence: 0.82
                }
              ]
            })
          };
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    const payload = {
      sourceFileIds: [sourceFile.id],
      provider: "ollama",
      temperature: 0.1
    };

    const first = app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: { ...payload, model: "batch-one" }
    });
    const second = app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: { ...payload, model: "batch-two" }
    });
    await entered.promise;
    release.resolve();
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(
      responses.map(
        (response) =>
          (response.json() as { proposals: ProposalSummaryForTest[] }).proposals[0].entityId
      )
    ).toEqual(["uc.manage-projects", "uc.inspect-projects"]);
    expect(providerCallCount).toBe(2);
    await expect(countPendingAiPrefillProposals(project.id)).resolves.toBe(1);
  });

  it("obsoletes previous pending AI proposals on regeneration while preserving reviewed proposals", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        async generateSpecProposals(input) {
          return {
            provider: "ollama",
            model: input.model,
            text: JSON.stringify({
              proposals: [
                {
                  entityId: "uc.manage-projects",
                  type: "use_case",
                  title: "Manage projects",
                  summary: "Users can create and inspect local projects.",
                  sourceFiles: ["src/projects.ts"],
                  claims: [
                    {
                      text: "Project routes create and inspect local projects.",
                      sourceFiles: ["src/projects.ts"]
                    }
                  ],
                  proposedLinks: [],
                  confidence: 0.82
                }
              ]
            })
          };
        }
      })
    });
    const project = await createProjectViaApi();
    const sourceFile = await insertIndexedSourceFile(project.id, project.repoPath);
    const reviewed = await insertPendingAiProposal(project.id, {
      entityId: "uc.reviewed",
      title: "Reviewed",
      filePath: "use-cases/uc.reviewed.md"
    });
    await pool.query("update ai_proposals set status = 'rejected' where id = $1", [reviewed.id]);

    const firstResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });
    const firstProposalId = (firstResponse.json() as { proposals: ProposalSummaryForTest[] })
      .proposals[0].id;

    const secondResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/ai-prefill`,
      payload: {
        sourceFileIds: [sourceFile.id],
        provider: "ollama",
        model: "fake-local-model",
        temperature: 0.1
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    await expect(readProposalStatus(firstProposalId)).resolves.toBe("obsolete");
    await expect(readProposalStatus(reviewed.id)).resolves.toBe("rejected");
    expect((secondResponse.json() as { proposals: ProposalSummaryForTest[] }).proposals).toEqual([
      expect.objectContaining({
        proposalType: "ai_spec_entity",
        status: "pending",
        entityId: "uc.manage-projects"
      })
    ]);
  });

  it("filters proposal listings by proposal type", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    await pool.query(
      "insert into ai_proposals (project_id, proposal_type, title, payload_json, evidence_json, confidence, status) values ($1, 'ai_spec_entity', 'Manage projects', $2::jsonb, $3::jsonb, 0.73, 'pending')",
      [project.id, JSON.stringify(aiProposalPayload()), JSON.stringify(aiProposalEvidence())]
    );

    const aiResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending&proposalType=ai_spec_entity`
    });
    const sourceResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending&proposalType=source_spec_entity`
    });

    expect(aiResponse.statusCode).toBe(200);
    expect(sourceResponse.statusCode).toBe(200);
    expect(aiResponse.json()).toEqual([
      expect.objectContaining({
        proposalType: "ai_spec_entity",
        entityId: "uc.manage-projects"
      })
    ]);
    expect(sourceResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposalType: "source_spec_entity",
          entityId: "interface.decision-service"
        })
      ])
    );
    expect(
      (sourceResponse.json() as Array<{ proposalType: string }>).every(
        (proposal) => proposal.proposalType === "source_spec_entity"
      )
    ).toBe(true);
  });

  it("obsoletes prior pending source import proposals on regeneration", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });

    const pendingResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending`
    });
    const obsoleteResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=obsolete`
    });

    expect(pendingResponse.statusCode).toBe(200);
    expect(obsoleteResponse.statusCode).toBe(200);
    expect((pendingResponse.json() as unknown[]).length).toBeGreaterThan(0);
    expect((obsoleteResponse.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it("obsoletes prior pending source import proposals when eligible symbols disappear", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const firstResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(firstResponse.statusCode).toBe(201);

    await rm(path.join(project.repoPath, "src"), { recursive: true, force: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.repoPath, "src", "helpers.ts"), "function internalOnly() {}\n");

    const regenerateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const pendingResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending`
    });
    const obsoleteResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=obsolete`
    });

    expect(regenerateResponse.statusCode).toBe(400);
    expect(regenerateResponse.json().error.message).toBe(
      "No eligible exported source symbols found"
    );
    expect(pendingResponse.statusCode).toBe(200);
    expect(obsoleteResponse.statusCode).toBe(200);
    expect(pendingResponse.json()).toHaveLength(0);
    expect((obsoleteResponse.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it("reports file conflict for source import proposal targets that exist but are not indexed", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposals = generateResponse.json() as Array<{
      id: string;
      entityId: string;
      conflict: { status: string };
    }>;
    const proposal = proposals.find((item) => item.entityId === "interface.decision-service");
    expect(proposal).toBeDefined();
    expect(proposal!.conflict).toEqual({ status: "none" });

    await mkdir(path.join(project.specopsPath, "interfaces"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "interfaces", "decision-service.md"),
      "---\nid: interface.other\n---\n\n# Existing\n"
    );

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending`
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal!.id}`
    });
    const listProposal = (
      listResponse.json() as Array<{ entityId: string; conflict: unknown }>
    ).find((item) => item.entityId === "interface.decision-service");

    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect(listProposal).toMatchObject({
      conflict: { status: "file_exists", filePath: "interfaces/decision-service.md" }
    });
    expect(detailResponse.json()).toMatchObject({
      conflict: { status: "file_exists", filePath: "interfaces/decision-service.md" }
    });
  });

  it("keeps source import proposals readable when conflict checks are unavailable", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposal = findProposalByEntityId(
      generateResponse.json() as ProposalSummaryForTest[],
      "interface.decision-service"
    );
    const outside = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-outside-"));
    tempRoots.push(outside);
    await writeFile(path.join(outside, "decision-service.md"), "# Outside\n");
    await mkdir(path.join(project.specopsPath, "interfaces"), { recursive: true });
    await symlink(
      path.join(outside, "decision-service.md"),
      path.join(project.specopsPath, "interfaces", "decision-service.md")
    );

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending`
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });
    const listProposal = (
      listResponse.json() as Array<{ entityId: string; conflict: unknown }>
    ).find((item) => item.entityId === "interface.decision-service");

    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect(listProposal).toMatchObject({
      conflict: { status: "unavailable" }
    });
    expect(detailResponse.json()).toMatchObject({
      conflict: { status: "unavailable" }
    });
  });

  it("accepts selected source import proposals, writes markdown, and re-indexes", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposal = findProposalByEntityId(
      generateResponse.json() as ProposalSummaryForTest[],
      "interface.decision-service"
    );

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });
    const targetPath = path.join(project.specopsPath, "interfaces", "decision-service.md");
    const writtenMarkdown = await readFile(targetPath, "utf8");

    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json()).toMatchObject({
      acceptedProposalIds: [proposal.id],
      indexRun: { status: "succeeded" }
    });
    expect(writtenMarkdown).toContain("id: interface.decision-service");
  });

  it("accepts AI spec entity proposals as canonical markdown", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const proposal = await insertPendingAiProposal(project.id);

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });
    const targetPath = path.join(project.specopsPath, "use-cases", "uc.manage-projects.md");
    const acceptedDetailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });

    expect(acceptResponse.statusCode).toBe(200);
    const writtenMarkdown = await readFile(targetPath, "utf8");
    expect(acceptResponse.json()).toMatchObject({
      acceptedProposalIds: [proposal.id],
      indexRun: { status: "succeeded" }
    });
    expect(writtenMarkdown).toContain("id: uc.manage-projects");
    expect(acceptedDetailResponse.statusCode).toBe(200);
    expect(acceptedDetailResponse.json()).toMatchObject({ status: "accepted" });
  });

  it("accepts edited AI markdown as edited_and_accepted", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const generatedMarkdown = aiProposalMarkdown();
    const proposal = await insertPendingAiProposal(project.id, {
      generatedMarkdown,
      markdown: generatedMarkdown.replace("# Manage projects", "# Manage project work")
    });

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });
    const acceptedDetailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });

    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptedDetailResponse.statusCode).toBe(200);
    expect(acceptedDetailResponse.json()).toMatchObject({
      status: "edited_and_accepted",
      reviewedAt: expect.any(String)
    });
  });

  it("marks edited accepted proposals as edited_and_accepted", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposal = findProposalByEntityId(
      generateResponse.json() as ProposalSummaryForTest[],
      "interface.decision-service"
    );
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json() as {
      payload: { markdown: string };
    };
    const editedMarkdown = detail.payload.markdown.replace(
      "Initial spec generated from exported source symbol",
      "Reviewed content generated from exported source symbol"
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`,
      payload: { markdown: editedMarkdown }
    });
    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });
    const acceptedDetailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptedDetailResponse.statusCode).toBe(200);
    expect(acceptedDetailResponse.json()).toMatchObject({
      status: "edited_and_accepted",
      reviewedAt: expect.any(String)
    });
  });

  it("refuses accept when the target file exists without writing any selected files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposals = generateResponse.json() as ProposalSummaryForTest[];
    const conflictingProposal = findProposalByEntityId(proposals, "interface.decision-service");
    const otherProposal = findProposalOtherThan(proposals, conflictingProposal.id);

    await mkdir(path.join(project.specopsPath, "interfaces"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "interfaces", "decision-service.md"),
      "---\nid: interface.existing\n---\n\n# Existing\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [conflictingProposal.id, otherProposal.id] }
    });

    expect(response.statusCode).toBe(409);
    await expect(fileExists(path.join(project.specopsPath, otherProposal.filePath))).resolves.toBe(
      false
    );
  });

  it("refuses accept when unindexed markdown already has the target entity id", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    await mkdir(path.join(project.specopsPath, "legacy"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "legacy", "decision-service-copy.md"),
      "---\n" +
        "id: interface.decision-service\n" +
        "type: interface\n" +
        "title: Existing Decision Service\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Existing Decision Service\n"
    );

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposal = findProposalByEntityId(
      generateResponse.json() as ProposalSummaryForTest[],
      "interface.decision-service"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Target entity already exists");
    await expect(fileExists(path.join(project.specopsPath, proposal.filePath))).resolves.toBe(
      false
    );
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({ status: "pending" });
  });

  it("rejects AI proposal file conflicts without partial writes", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const conflictingProposal = await insertPendingAiProposal(project.id);
    const otherProposal = await insertPendingAiProposal(project.id, {
      entityId: "uc.review-projects",
      title: "Review projects",
      filePath: "use-cases/uc.review-projects.md",
      generatedMarkdown: aiProposalMarkdown({
        entityId: "uc.review-projects",
        title: "Review projects"
      }),
      markdown: aiProposalMarkdown({
        entityId: "uc.review-projects",
        title: "Review projects"
      })
    });

    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.manage-projects.md"),
      "---\nid: uc.existing\n---\n\n# Existing\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [conflictingProposal.id, otherProposal.id] }
    });
    const conflictingDetailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${conflictingProposal.id}`
    });
    const otherDetailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${otherProposal.id}`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Proposal target markdown file already exists");
    expect(conflictingDetailResponse.json()).toMatchObject({ status: "pending" });
    expect(otherDetailResponse.json()).toMatchObject({ status: "pending" });
    await expect(fileExists(path.join(project.specopsPath, otherProposal.filePath))).resolves.toBe(
      false
    );
  });

  it("returns source import proposal detail and persists edited markdown", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    await writeFile(
      path.join(project.repoPath, "src", "services", "decision-service.ts"),
      "import type { Decision, Workspace } from '../domain';\n" +
        "export class DecisionService {\n" +
        "  list(_workspace: Workspace): Decision[] { return []; }\n" +
        "}\n"
    );

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposals = generateResponse.json() as Array<{
      id: string;
      entityId: string;
    }>;
    const proposal = proposals.find((item) => item.entityId === "interface.decision-service");
    expect(proposal).toBeDefined();

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal!.id}`
    });
    const detail = detailResponse.json() as {
      payload: { markdown: string; generatedMarkdown: string };
      evidence: {
        scanner: string;
        sourceFiles: Array<{
          file: string;
          symbolName: string;
          symbolKind: string;
          exported: boolean;
        }>;
      };
    };
    const originalGeneratedMarkdown = detail.payload.generatedMarkdown;
    const editedMarkdown = detail.payload.markdown.replace(
      "Initial spec generated from exported source symbol",
      "Reviewed spec generated from exported source symbol"
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal!.id}`,
      payload: { markdown: editedMarkdown }
    });
    const patched = patchResponse.json() as {
      payload: { markdown: string; generatedMarkdown: string };
    };

    expect(detailResponse.statusCode).toBe(200);
    expect(detail.evidence).toMatchObject({
      scanner: "typescript",
      sourceFiles: expect.arrayContaining([
        expect.objectContaining({
          file: "src/services/decision-service.ts",
          symbolName: "DecisionService",
          symbolKind: "class",
          exported: true
        })
      ])
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patched.payload.markdown).toContain(
      "Reviewed spec generated from exported source symbol"
    );
    expect(patched.payload.generatedMarkdown).toBe(originalGeneratedMarkdown);
  });

  it("rejects a pending source import proposal", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposals = generateResponse.json() as Array<{
      id: string;
      entityId: string;
    }>;
    const proposal = proposals.find((item) => item.entityId === "interface.decision-service");
    expect(proposal).toBeDefined();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal!.id}`,
      payload: { status: "rejected" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "rejected",
      reviewedAt: expect.any(String)
    });
  });

  it("returns conflict when patching an obsolete source import proposal", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const firstResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(firstResponse.statusCode).toBe(201);
    const proposals = firstResponse.json() as Array<{
      id: string;
      entityId: string;
    }>;
    const proposal = proposals.find((item) => item.entityId === "interface.decision-service");
    expect(proposal).toBeDefined();

    const secondResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(secondResponse.statusCode).toBe(201);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal!.id}`,
      payload: { markdown: "# Edited obsolete proposal\n" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Only pending proposals can be edited or rejected");
  });

  it("returns conflict when accepting a non-pending source import proposal", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposal = findProposalByEntityId(
      generateResponse.json() as ProposalSummaryForTest[],
      "interface.decision-service"
    );
    const rejectResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`,
      payload: { status: "rejected" }
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });

    expect(rejectResponse.statusCode).toBe(200);
    expect(response.statusCode).toBe(409);
    await expect(fileExists(path.join(project.specopsPath, proposal.filePath))).resolves.toBe(
      false
    );
  });

  it("refuses duplicate selected source import proposal targets without writing files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposals = generateResponse.json() as ProposalSummaryForTest[];
    const firstProposal = findProposalByEntityId(proposals, "interface.decision-service");
    const secondProposal = findProposalOtherThan(proposals, firstProposal.id);
    const secondDetailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${secondProposal.id}`
    });
    expect(secondDetailResponse.statusCode).toBe(200);
    const secondPayload = (secondDetailResponse.json() as {
      payload: Record<string, unknown>;
    }).payload;

    await pool.query("update ai_proposals set payload_json = $1 where id = $2", [
      {
        ...secondPayload,
        filePath: `interfaces/../${firstProposal.filePath}`
      },
      secondProposal.id
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [firstProposal.id, secondProposal.id] }
    });

    expect(response.statusCode).toBe(409);
    await expect(fileExists(path.join(project.specopsPath, firstProposal.filePath))).resolves.toBe(
      false
    );
    await expect(fileExists(path.join(project.specopsPath, secondProposal.filePath))).resolves.toBe(
      false
    );
  });

  it("rolls back written proposal files and derived cache when accept fails after indexing", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSampleSourceProject(project.repoPath);
    const service = createProposalService(db, {
      acceptTestHooks: {
        afterIndex: async () => {
          throw new Error("forced accept failure after index");
        }
      }
    });
    const proposals = await service.generateSourceImportProposals(project.id);
    const proposal = findProposalByEntityId(proposals, "interface.decision-service");

    await expect(
      service.acceptProposals(project.id, { proposalIds: [proposal.id] })
    ).rejects.toThrow("forced accept failure after index");

    await expect(fileExists(path.join(project.specopsPath, proposal.filePath))).resolves.toBe(
      false
    );
    const detail = await service.getProposal(project.id, proposal.id);
    expect(detail.status).toBe("pending");
    await expect(expectIndexedSpecReferenceCount(project.id, proposal)).resolves.toBe(0);
  });

  it("rolls back written proposal files when final status update loses the pending race", async () => {
    const db = createTestDb();
    const project = await createProjectDirectly(db);
    await writeSampleSourceProject(project.repoPath);
    let proposalIdToChange = "";
    const service = createProposalService(db, {
      acceptTestHooks: {
        beforeStatusUpdate: async () => {
          await pool.query("update ai_proposals set status = 'rejected' where id = $1", [
            proposalIdToChange
          ]);
        }
      }
    });
    const proposals = await service.generateSourceImportProposals(project.id);
    const proposal = findProposalByEntityId(proposals, "interface.decision-service");
    proposalIdToChange = proposal.id;

    await expect(
      service.acceptProposals(project.id, { proposalIds: [proposal.id] })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Only pending proposals can be accepted"
    });

    await expect(fileExists(path.join(project.specopsPath, proposal.filePath))).resolves.toBe(
      false
    );
    await expect(expectIndexedSpecReferenceCount(project.id, proposal)).resolves.toBe(0);
  });

  it("refuses invalid accepted proposal markdown without writing any selected files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    expect(generateResponse.statusCode).toBe(201);
    const proposals = generateResponse.json() as ProposalSummaryForTest[];
    const invalidProposal = findProposalByEntityId(proposals, "interface.decision-service");
    const otherProposal = findProposalOtherThan(proposals, invalidProposal.id);
    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${invalidProposal.id}`,
      payload: { markdown: "# Missing frontmatter\n" }
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [invalidProposal.id, otherProposal.id] }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(response.statusCode).toBe(400);
    await expect(fileExists(path.join(project.specopsPath, invalidProposal.filePath))).resolves.toBe(
      false
    );
    await expect(fileExists(path.join(project.specopsPath, otherProposal.filePath))).resolves.toBe(
      false
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

  it("includes readiness warnings in generated task previews", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "checkout.md"),
      `---
id: uc.checkout
type: use_case
title: Checkout
status: draft
---

# Checkout

## Goal

Let customers buy products and receive confirmation while keeping payment and order handling clear enough for implementation planning.
`
    );
    await createIndexerService(db).indexProject(project.id);

    const preview = await createAgentTaskService(db).previewAgentTask(project.id, {
      sourceEntityId: "uc.checkout",
      targetAgent: "codex",
      impactedContextEntityIds: []
    });

    expect(preview.warnings).toContainEqual(
      expect.objectContaining({
        code: "readiness:use_case_acceptance_criteria_missing",
        entityId: "uc.checkout"
      })
    );
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

  type ProposalSummaryForTest = {
    id: string;
    entityId: string;
    filePath: string;
  };

  function findProposalByEntityId(
    proposals: ProposalSummaryForTest[],
    entityId: string
  ): ProposalSummaryForTest {
    const proposal = proposals.find((item) => item.entityId === entityId);
    expect(proposal).toBeDefined();
    return proposal!;
  }

  function findProposalOtherThan(
    proposals: ProposalSummaryForTest[],
    proposalId: string
  ): ProposalSummaryForTest {
    const proposal = proposals.find((item) => item.id !== proposalId);
    expect(proposal).toBeDefined();
    return proposal!;
  }

  async function insertPendingAiProposal(
    projectId: string,
    payloadOverrides: Partial<ReturnType<typeof aiProposalPayload>> = {}
  ): Promise<ProposalSummaryForTest> {
    const payload = { ...aiProposalPayload(), ...payloadOverrides };
    const result = await pool.query<{ id: string; entityId: string; filePath: string }>(
      "insert into ai_proposals (project_id, proposal_type, title, payload_json, evidence_json, confidence, status) values ($1, 'ai_spec_entity', $2, $3::jsonb, $4::jsonb, 0.73, 'pending') returning id, payload_json->>'entityId' as \"entityId\", payload_json->>'filePath' as \"filePath\"",
      [projectId, payload.title, JSON.stringify(payload), JSON.stringify(aiProposalEvidence())]
    );

    return result.rows[0];
  }

  function aiProposalMarkdown({
    entityId = "uc.manage-projects",
    title = "Manage projects"
  }: {
    entityId?: string;
    title?: string;
  } = {}): string {
    return [
      "---",
      `id: ${entityId}`,
      "type: use_case",
      `title: ${title}`,
      "status: draft",
      "---",
      "",
      `# ${title}`
    ].join("\n");
  }

  function aiProposalPayload({
    entityId = "uc.manage-projects",
    title = "Manage projects"
  }: {
    entityId?: string;
    title?: string;
  } = {}) {
    const markdown = aiProposalMarkdown({ entityId, title });

    return {
      entityId,
      type: "use_case",
      title,
      status: "draft",
      filePath: `use-cases/${entityId}.md`,
      generatedMarkdown: markdown,
      markdown,
      sourceFiles: ["apps/api/src/routes/projects.ts"],
      proposedLinks: []
    };
  }

  function aiProposalEvidence() {
    return {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      promptVersion: "ai-prefill-v1",
      selectedSourceFiles: [
        {
          file: "apps/api/src/routes/projects.ts",
          contentHash: "hash-1",
          excerptStartLine: 1,
          excerptEndLine: 80
        }
      ],
      claims: [
        {
          text: "Project routes expose project creation.",
          sourceFiles: ["apps/api/src/routes/projects.ts"]
        }
      ],
      warnings: []
    };
  }

  async function expectIndexedSpecReferenceCount(
    projectId: string,
    proposal: ProposalSummaryForTest
  ): Promise<number> {
    const result = await pool.query<{ count: number }>(
      "select count(*)::int as count from (" +
        "select 1 from spec_entities where project_id = $1 and (entity_id = $2 or file_path = $3) " +
        "union all " +
        "select 1 from spec_files where project_id = $1 and path = $3" +
        ") refs",
      [projectId, proposal.entityId, proposal.filePath]
    );
    return result.rows[0].count;
  }

  async function insertIndexedSourceFile(
    projectId: string,
    repoPath: string,
    relativePath = "src/projects.ts"
  ): Promise<{ id: string }> {
    await mkdir(path.join(repoPath, "src"), { recursive: true });
    const content = [
      "import { ProjectStore } from './db';",
      "",
      "export class ProjectRoutes {",
      "  constructor(private readonly store: ProjectStore) {}",
      "  list() { return this.store.listProjects(); }",
      "  create(name: string) { return this.store.createProject(name); }",
      "}",
      ""
    ].join("\n");
    await writeFile(path.join(repoPath, relativePath), content);
    const sourceFileResult = await pool.query<{ id: string }>(
      "insert into source_files (project_id, path, language, kind, size_bytes, content_hash, last_seen_at) values ($1, $2, 'typescript', 'source', $3, $4, '2026-05-10T10:00:01Z') returning id",
      [projectId, relativePath, Buffer.byteLength(content), sha256(content)]
    );
    const sourceFileId = sourceFileResult.rows[0].id;
    await pool.query(
      "insert into source_imports (project_id, source_file_id, file_path, specifier, import_kind, imported_names, is_relative, resolved_path) values ($1, $2, $3, './db', 'named', array['ProjectStore'], true, 'src/db.ts')",
      [projectId, sourceFileId, relativePath]
    );
    await pool.query(
      "insert into source_exports (project_id, source_file_id, file_path, exported_name, export_kind) values ($1, $2, $3, 'ProjectRoutes', 'class')",
      [projectId, sourceFileId, relativePath]
    );
    await pool.query(
      "insert into source_symbols (project_id, source_file_id, file_path, name, symbol_kind, is_exported, line, metadata_json) values ($1, $2, $3, 'ProjectRoutes', 'class', true, 3, $4::jsonb)",
      [projectId, sourceFileId, relativePath, JSON.stringify({ routeCount: 2 })]
    );

    return { id: sourceFileId };
  }

  function aiPrefillProviderResult(model: string, entityId: string, title: string) {
    return {
      provider: "ollama" as const,
      model,
      text: JSON.stringify({
        proposals: [
          {
            entityId,
            type: "use_case",
            title,
            summary: "Users can create and inspect local projects.",
            sourceFiles: ["src/projects.ts"],
            claims: [
              {
                text: "Project routes create and inspect local projects.",
                sourceFiles: ["src/projects.ts"]
              }
            ],
            proposedLinks: [],
            confidence: 0.82
          }
        ]
      })
    };
  }

  function successfulAnalyzeRunProviderFactory(): AiPrefillProviderFactory {
    return () => ({
      async generateSpecProposals(input) {
        return {
          provider: "ollama",
          model: input.model,
          text: JSON.stringify({
            proposals: [
              {
                entityId: "uc.manage-projects",
                type: "use_case",
                title: "Manage projects",
                summary: "Users can create and inspect local projects.",
                sourceFiles: ["src/service.ts"],
                claims: [
                  {
                    text: "Decision services can list workspace decisions.",
                    sourceFiles: ["src/service.ts"]
                  }
                ],
                proposedLinks: [],
                confidence: 0.82
              }
            ]
          })
        };
      }
    });
  }

  async function insertActiveAnalyzeRun(projectId: string): Promise<{ id: string }> {
    const result = await pool.query<{ id: string }>(
      "insert into analyze_runs (project_id, status, steps_json) values ($1, 'running', $2::jsonb) returning id",
      [projectId, JSON.stringify(initialAnalyzeRunSteps())]
    );

    return result.rows[0];
  }

  async function createAnalyzeReviewRouteFixture(options: { proposalCount?: number } = {}) {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    const proposalCount = options.proposalCount ?? 1;
    const proposalInputs = Array.from({ length: proposalCount }, (_, index) => {
      const suffix = index === 0 ? "" : ` ${index + 1}`;
      const entitySuffix = index === 0 ? "" : `-${index + 1}`;
      const payload = aiProposalPayload({
        entityId: `use-case.review-drafts${entitySuffix}`,
        title: `Review drafts${suffix}`
      });

      return {
        projectId: project.id,
        proposalType: "ai_spec_entity" as const,
        title: payload.title,
        payloadJson: {
          ...payload,
          filePath: `use-cases/review-drafts${entitySuffix}.md`
        },
        evidenceJson: aiProposalEvidence(),
        confidence: 0.82,
        status: "pending" as const
      };
    });
    const proposals = await db.insert(aiProposals).values(proposalInputs).returning();
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

    expect(proposals).toHaveLength(proposalCount);
    expect(run).toBeDefined();

    return { app, project, run: run!, proposal: proposals[0]!, proposals };
  }

  async function createReviewAssemblyViaApi(projectId: string, runId: string) {
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/analyze-runs/${runId}/review-assemblies`,
      payload: {
        title: "Review drafts",
        entityType: "use_case",
        entityId: "use-case.review-drafts",
        filePath: "use-cases/review-drafts.md",
        summary: "Review generated drafts.",
        proposalIds: []
      }
    });

    expect(response.statusCode).toBe(201);
    return response.json() as { id: string };
  }

  async function waitForAnalyzeRun(projectId: string, runId: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/analyze-runs/${runId}`
      });
      const run = analyzeRunDetailSchema.parse(response.json());

      expect(response.statusCode).toBe(200);
      if (run.status === "succeeded") {
        return run;
      }
      if (run.status === "failed") {
        throw new Error(`Analyze run failed: ${run.errorMessage ?? "unknown error"}`);
      }

      await delay(50);
    }

    throw new Error("Timed out waiting for analyze run to finish");
  }

  function initialAnalyzeRunSteps() {
    return ["initialize", "index", "source_proposals", "select_ai_sources", "ai_prefill"].map(
      (name) => ({
        name,
        status: "pending",
        startedAt: null,
        finishedAt: null,
        message: null,
        counts: {}
      })
    );
  }

  async function countAiPrefillProposals(projectId: string): Promise<number> {
    const result = await pool.query<{ count: number }>(
      "select count(*)::int as count from ai_proposals where project_id = $1 and proposal_type = 'ai_spec_entity'",
      [projectId]
    );
    return result.rows[0].count;
  }

  async function countPendingAiPrefillProposals(projectId: string): Promise<number> {
    const result = await pool.query<{ count: number }>(
      "select count(*)::int as count from ai_proposals where project_id = $1 and proposal_type = 'ai_spec_entity' and status = 'pending'",
      [projectId]
    );
    return result.rows[0].count;
  }

  async function waitForAdvisoryLockWaiter(): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ count: number }>(
        "select count(*)::int as count from pg_locks where locktype = 'advisory' and granted = false"
      );
      if (result.rows[0].count > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for advisory lock waiter");
  }

  async function readProposalStatus(proposalId: string): Promise<string | null> {
    const result = await pool.query<{ status: string }>(
      "select status from ai_proposals where id = $1",
      [proposalId]
    );
    return result.rows[0]?.status ?? null;
  }

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  function createTestDb() {
    const db = createDb(testDatabaseUrl!);
    dbs.push(db);
    return db;
  }

  function createTerminalRaceDb(
    db: ReturnType<typeof createDb>,
    projectId: string,
    reviewId: string
  ): ReturnType<typeof createDb> {
    const originalUpdate = db.update.bind(db);
    let raced = false;

    return new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "update") {
          return Reflect.get(target, property, receiver);
        }

        return ((table: Parameters<typeof db.update>[0]) => {
          if (table !== diffReviews || raced) {
            return originalUpdate(table);
          }

          raced = true;
          const builder = originalUpdate(table);

          return {
            set(values: Parameters<typeof builder.set>[0]) {
              const setBuilder = builder.set(values);

              return {
                where(condition: Parameters<typeof setBuilder.where>[0]) {
                  const whereBuilder = setBuilder.where(condition);

                  return {
                    async returning() {
                      await originalUpdate(diffReviews)
                        .set({ status: "accepted", updatedAt: new Date() })
                        .where(
                          and(eq(diffReviews.projectId, projectId), eq(diffReviews.id, reviewId))
                        )
                        .returning();

                      return whereBuilder.returning();
                    }
                  };
                }
              };
            }
          };
        }) as typeof db.update;
      }
    });
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

  async function createProjectDirectlyWithId(id: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-"));
    tempRoots.push(root);
    const slug = `routes-${id.slice(-6)}`;

    await pool.query(
      "insert into projects (id, name, slug, repo_path, specops_path) values ($1, $2, $3, $4, $5)",
      [id, `Routes ${id}`, slug, root, path.join(root, ".specops")]
    );
    projectIds.push(id);

    return {
      id,
      name: `Routes ${id}`,
      slug,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    };
  }

  async function git(cwd: string, args: string[]) {
    await execFileAsync("git", args, { cwd });
  }

  async function writeSpecFile(specopsPath: string, relativePath: string, content: string) {
    const absolutePath = path.join(specopsPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { flag: "w" });
  }

  async function createProjectViaApi(options: { specopsDirectoryName?: string } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-routes-"));
    tempRoots.push(root);

    const payload = {
      name: `Routes ${Date.now()} ${Math.random()}`,
      slug: `routes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, options.specopsDirectoryName ?? ".specops")
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

  async function insertSearchEntity(
    projectId: string,
    entity: {
      entityId: string;
      type?: string;
      title: string;
      status?: string;
      bodyText?: string;
    }
  ) {
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        projectId,
        entity.entityId,
        entity.type ?? "domain_entity",
        entity.title,
        entity.status ?? "draft",
        `${entity.entityId.replace(".", "/")}.md`,
        `# ${entity.title}\n\n${entity.bodyText ?? entity.title}`,
        entity.bodyText ?? entity.title,
        sha256(`${projectId}:${entity.entityId}`)
      ]
    );
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

  async function createLinkedReviewProject(
    db: ReturnType<typeof createDb>,
    input: { useCaseBody: string }
  ) {
    const project = await createProjectDirectly(db);
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'ready'; }\n"
    );
    await writeSpecFile(
      project.specopsPath,
      "use-cases/uc.review.md",
      specEntityMarkdown({
        id: "uc.review",
        type: "use_case",
        title: "Review Loop",
        status: "draft",
        body: input.useCaseBody
      })
    );
    await writeSpecFile(
      project.specopsPath,
      "agent-tasks/task.review.md",
      agentTaskMarkdown({
        id: "task.review",
        title: "Review Service",
        sourceEntity: "uc.review",
        body: "# Review Service\n"
      })
    );
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "specops@example.test"]);
    await git(project.repoPath, ["config", "user.name", "SpecOps Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "Initial state"]);
    await createIndexerService(db).indexProject(project.id);

    const sourceFileResult = await pool.query<{ id: string }>(
      "select id from source_files where project_id = $1 and path = 'src/review-service.ts'",
      [project.id]
    );
    expect(sourceFileResult.rows[0]).toBeDefined();
    await pool.query(
      "insert into source_spec_links (project_id, source_file_id, file_path, entity_id, symbol_name, symbol_kind, symbol_line, annotation_line, content_hash) values ($1, $2, 'src/review-service.ts', 'uc.review', 'reviewService', 'function', 1, null, 'review-link-hash')",
      [project.id, sourceFileResult.rows[0]!.id]
    );

    return project;
  }

  async function createDiffReviewProject(db: ReturnType<typeof createDb>) {
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n\nReview source changes before acceptance."
    });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "unlinked-service.ts"),
      "export function unlinkedService() { return 'ready'; }\n"
    );
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "Add unlinked service"]);

    return project;
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

function specEntityMarkdown(input: {
  id: string;
  type: string;
  title: string;
  status: string;
  body: string;
}) {
  return [
    "---",
    `id: ${input.id}`,
    `type: ${input.type}`,
    `title: ${input.title}`,
    `status: ${input.status}`,
    "---",
    "",
    input.body,
    ""
  ].join("\n");
}

function agentTaskMarkdown(input: {
  id: string;
  title: string;
  sourceEntity: string;
  body: string;
}) {
  return [
    "---",
    `id: ${input.id}`,
    "type: agent_task",
    `title: ${input.title}`,
    "status: open",
    `source_entity: ${input.sourceEntity}`,
    "links:",
    `  generated_from: [${input.sourceEntity}]`,
    "---",
    "",
    input.body,
    ""
  ].join("\n");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
