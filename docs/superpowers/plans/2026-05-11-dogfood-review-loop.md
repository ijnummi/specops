# Dogfood Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first agent run review loop that records runs from `agent_task` specs, captures Git state, computes changed files, maps changes to specs, and shows deterministic review findings.

**Architecture:** Add an `agent_runs` workflow table, shared contract schemas, an API service/routes layer, and two focused web routes. The review logic stays deterministic and reads existing indexed data: `spec_entities`, `spec_links`, `source_spec_links`, validation messages, readiness, and local Git state.

**Tech Stack:** pnpm TypeScript monorepo, Fastify, Zod, Drizzle/PostgreSQL, React, TanStack Router, TanStack Query, Vitest.

---

## File Structure

Create:

- `packages/contracts/src/agent-runs.ts` - Zod schemas and DTO types for run status, changed files, findings, summaries, details, and requests.
- `apps/api/src/services/agent-run-service.ts` - run lifecycle, Git snapshotting, changed-file computation, task context extraction, affected spec mapping, and finding generation.
- `apps/api/src/routes/agent-runs.ts` - Fastify routes for start/list/detail/finish/status update.
- `apps/web/src/routes/agent-runs.tsx` - project-level run list page.
- `apps/web/src/routes/agent-run-detail.tsx` - run detail/review page.
- `apps/web/src/routes/agent-runs.test.tsx` - route rendering tests for list and detail.

Modify:

- `packages/db/src/schema.ts` - add `agentRuns` Drizzle table.
- `packages/db/migrations/0000_initial.sql` - add `agent_runs` DDL to the current single migration.
- `packages/db/src/migrations.test.ts` - assert `agent_runs` exists in the migration.
- `packages/contracts/src/index.ts` - export agent run contracts.
- `apps/api/src/server.ts` - register agent run routes.
- `apps/api/src/services/git-service.ts` - add a `readGitChangedFiles()` helper for `git diff --name-only`.
- `apps/api/src/__tests__/routes.test.ts` - add DB-backed API tests.
- `apps/web/src/api/queries.ts` - add query keys, query functions, and mutation helpers.
- `apps/web/src/app.tsx` - add routes for run list/detail.
- `apps/web/src/components/entity-detail.tsx` - show `Start Agent Run` for `agent_task` entities.
- `apps/web/src/components/entity-detail.test.tsx` - cover the task-only start action.

---

### Task 1: Contracts And Database Shape

**Files:**

- Create: `packages/contracts/src/agent-runs.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`
- Test: `packages/contracts/src/agent-runs.test.ts`

- [ ] **Step 1: Add failing contract tests**

Create `packages/contracts/src/agent-runs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  agentRunDetailSchema,
  agentRunFindingSchema,
  finishAgentRunResponseSchema,
  startAgentRunRequestSchema,
  updateAgentRunStatusRequestSchema
} from "./agent-runs.js";

describe("agent run contracts", () => {
  it("parses start requests with custom agent names", () => {
    expect(startAgentRunRequestSchema.parse({
      taskEntityId: "task.review-dashboard",
      agent: "codex"
    })).toEqual({
      taskEntityId: "task.review-dashboard",
      agent: "codex"
    });
  });

  it("rejects unsupported review status updates", () => {
    expect(() =>
      updateAgentRunStatusRequestSchema.parse({ status: "running" })
    ).toThrow();
  });

  it("parses review findings and run detail payloads", () => {
    const finding = agentRunFindingSchema.parse({
      id: "unlinked-source-src-service-ts",
      severity: "context",
      kind: "unlinked_source_changed",
      message: "Source file src/service.ts changed without a linked spec.",
      suggestedFollowUp: "Link the source file to a spec or confirm no spec update is needed.",
      entityId: null,
      filePath: "src/service.ts"
    });

    expect(finding.kind).toBe("unlinked_source_changed");

    const detail = agentRunDetailSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      taskEntityId: "task.review-dashboard",
      taskTitle: "Review Dashboard",
      agent: "codex",
      status: "ready_for_review",
      promptMarkdown: "# Task",
      startedAt: "2026-05-11T10:00:00.000Z",
      finishedAt: "2026-05-11T10:05:00.000Z",
      startGitCommit: "abc123",
      endGitCommit: "def456",
      changedFiles: {
        specs: ["specops/use-cases/uc.review.md"],
        source: ["apps/api/src/server.ts"],
        tests: ["apps/api/src/__tests__/routes.test.ts"],
        other: []
      },
      reviewSummary: {
        changedFiles: {
          specs: ["specops/use-cases/uc.review.md"],
          source: ["apps/api/src/server.ts"],
          tests: ["apps/api/src/__tests__/routes.test.ts"],
          other: []
        },
        affectedSpecs: [
          {
            entityId: "uc.review",
            title: "Review",
            type: "use_case",
            filePath: "use-cases/uc.review.md",
            reason: "changed_spec"
          }
        ],
        taskContext: {
          sourceEntityId: "uc.review",
          contextEntityIds: ["interface.review-service"],
          missingEntityIds: []
        },
        findings: [finding],
        suggestedValidationCommands: ["pnpm typecheck", "pnpm test"]
      },
      createdAt: "2026-05-11T10:00:00.000Z",
      updatedAt: "2026-05-11T10:05:00.000Z"
    });

    expect(finishAgentRunResponseSchema.parse(detail).status).toBe("ready_for_review");
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```sh
pnpm --filter @specops/contracts test -- agent-runs.test.ts
```

Expected: FAIL because `packages/contracts/src/agent-runs.ts` does not exist.

- [ ] **Step 3: Add agent run contract schemas**

Create `packages/contracts/src/agent-runs.ts`:

```ts
import { z } from "zod";

export const agentRunStatusSchema = z.enum([
  "running",
  "ready_for_review",
  "accepted",
  "needs_followup",
  "superseded"
]);

export const agentRunReviewUpdateStatusSchema = z.enum([
  "accepted",
  "needs_followup",
  "superseded"
]);

export const agentRunFindingSeveritySchema = z.enum([
  "blocker",
  "review",
  "context",
  "info"
]);

export const agentRunFindingKindSchema = z.enum([
  "source_changed_without_spec",
  "task_context_spec_changed",
  "task_context_missing",
  "unlinked_source_changed",
  "validation_warning",
  "readiness_warning",
  "possible_missing_test_change",
  "task_not_updated",
  "git_comparison_unavailable"
]);

export const agentRunChangedFilesSchema = z.object({
  specs: z.array(z.string()),
  source: z.array(z.string()),
  tests: z.array(z.string()),
  other: z.array(z.string())
});

export const agentRunAffectedSpecSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  filePath: z.string().min(1),
  reason: z.enum(["changed_spec", "linked_source", "task_context"])
});

export const agentRunTaskContextSchema = z.object({
  sourceEntityId: z.string().min(1).nullable(),
  contextEntityIds: z.array(z.string().min(1)),
  missingEntityIds: z.array(z.string().min(1))
});

export const agentRunFindingSchema = z.object({
  id: z.string().min(1),
  severity: agentRunFindingSeveritySchema,
  kind: agentRunFindingKindSchema,
  message: z.string().min(1),
  suggestedFollowUp: z.string().min(1),
  entityId: z.string().nullable(),
  filePath: z.string().nullable()
});

export const agentRunReviewSchema = z.object({
  changedFiles: agentRunChangedFilesSchema,
  affectedSpecs: z.array(agentRunAffectedSpecSchema),
  taskContext: agentRunTaskContextSchema,
  findings: z.array(agentRunFindingSchema),
  suggestedValidationCommands: z.array(z.string().min(1))
});

export const startAgentRunRequestSchema = z.object({
  taskEntityId: z.string().min(1),
  agent: z.string().min(1)
});

export const updateAgentRunStatusRequestSchema = z.object({
  status: agentRunReviewUpdateStatusSchema
});

export const agentRunSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  taskEntityId: z.string().min(1),
  taskTitle: z.string().min(1),
  agent: z.string().min(1),
  status: agentRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  startGitCommit: z.string().nullable(),
  endGitCommit: z.string().nullable(),
  changedFileCount: z.number().int().nonnegative(),
  findingCounts: z.object({
    blocker: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    context: z.number().int().nonnegative(),
    info: z.number().int().nonnegative()
  }),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const agentRunDetailSchema = agentRunSummarySchema.extend({
  promptMarkdown: z.string(),
  changedFiles: agentRunChangedFilesSchema,
  reviewSummary: agentRunReviewSchema
});

export const startAgentRunResponseSchema = agentRunDetailSchema;
export const finishAgentRunResponseSchema = agentRunDetailSchema;
export const updateAgentRunStatusResponseSchema = agentRunDetailSchema;

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentRunFindingSeverity = z.infer<typeof agentRunFindingSeveritySchema>;
export type AgentRunFindingKind = z.infer<typeof agentRunFindingKindSchema>;
export type AgentRunChangedFilesDto = z.infer<typeof agentRunChangedFilesSchema>;
export type AgentRunFindingDto = z.infer<typeof agentRunFindingSchema>;
export type AgentRunReviewDto = z.infer<typeof agentRunReviewSchema>;
export type AgentRunSummaryDto = z.infer<typeof agentRunSummarySchema>;
export type AgentRunDetailDto = z.infer<typeof agentRunDetailSchema>;
export type StartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;
export type UpdateAgentRunStatusRequest = z.infer<typeof updateAgentRunStatusRequestSchema>;
```

- [ ] **Step 4: Export contracts**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-runs.js";
export * from "./agent-tasks.js";
export * from "./change-impact.js";
export * from "./entities.js";
export * from "./impact.js";
export * from "./indexing.js";
export * from "./proposals.js";
export * from "./projects.js";
export * from "./readiness.js";
export * from "./source.js";
export * from "./validation.js";
```

- [ ] **Step 5: Run contract test to verify it passes**

Run:

```sh
pnpm --filter @specops/contracts test -- agent-runs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add failing migration/schema test**

Modify `packages/db/src/migrations.test.ts` by adding this test in the existing `describe("initial migration", ...)` block:

```ts
  it("creates the agent_runs workflow table", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS agent_runs");
    expect(migration).toContain("task_entity_id text NOT NULL");
    expect(migration).toContain("review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("agent_runs_project_id_idx");
    expect(migration).toContain("agent_runs_project_status_idx");
  });
```

- [ ] **Step 7: Run migration test to verify it fails**

Run:

```sh
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because `agent_runs` is not in the migration.

- [ ] **Step 8: Add Drizzle table**

Modify `packages/db/src/schema.ts` after `aiProposals`:

```ts
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskEntityId: text("task_entity_id").notNull(),
    agent: text("agent").notNull(),
    status: text("status").notNull(),
    promptMarkdown: text("prompt_markdown").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    startGitCommit: text("start_git_commit"),
    endGitCommit: text("end_git_commit"),
    startDirtyFilesJson: jsonb("start_dirty_files_json").notNull().default(sql`'[]'::jsonb`),
    endDirtyFilesJson: jsonb("end_dirty_files_json").notNull().default(sql`'[]'::jsonb`),
    changedFilesJson: jsonb("changed_files_json").notNull().default(sql`'{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb`),
    reviewSummaryJson: jsonb("review_summary_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("agent_runs_project_id_idx").on(table.projectId),
    projectStatusIdx: index("agent_runs_project_status_idx").on(table.projectId, table.status),
    projectTaskIdx: index("agent_runs_project_task_entity_id_idx").on(table.projectId, table.taskEntityId),
    projectStartedAtIdx: index("agent_runs_project_started_at_idx").on(table.projectId, table.startedAt),
  }),
);
```

- [ ] **Step 9: Add SQL migration DDL**

Modify `packages/db/migrations/0000_initial.sql` near the other `CREATE TABLE` statements:

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_entity_id text NOT NULL,
  agent text NOT NULL,
  status text NOT NULL,
  prompt_markdown text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  start_git_commit text,
  end_git_commit text,
  start_dirty_files_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  end_dirty_files_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_files_json jsonb NOT NULL DEFAULT '{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb,
  review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_project_id_idx ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS agent_runs_project_status_idx ON agent_runs(project_id, status);
CREATE INDEX IF NOT EXISTS agent_runs_project_task_entity_id_idx ON agent_runs(project_id, task_entity_id);
CREATE INDEX IF NOT EXISTS agent_runs_project_started_at_idx ON agent_runs(project_id, started_at);
```

- [ ] **Step 10: Run db tests**

Run:

```sh
pnpm --filter @specops/db test -- migrations.test.ts schema.typecheck.ts
```

Expected: PASS.

- [ ] **Step 11: Commit contracts and database shape**

```sh
git add packages/contracts/src/agent-runs.ts packages/contracts/src/agent-runs.test.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add agent run data contracts"
```

---

### Task 2: Git Helpers And Backend Service

**Files:**

- Modify: `apps/api/src/services/git-service.ts`
- Create: `apps/api/src/services/agent-run-service.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing API tests for start and finish**

Add this test group inside `describeWithDb("database-backed routes", ...)` in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("starts and finishes an agent run with deterministic review findings", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi({ specopsDirectoryName: "specops" });
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "agent-tasks"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.repoPath, "src", "review-service.ts"), "export function review() { return 'old'; }\n");
    await writeFile(path.join(project.specopsPath, "use-cases", "uc.review.md"), specEntityMarkdown({
      id: "uc.review",
      type: "use_case",
      title: "Review",
      status: "accepted",
      body: "## Goal\n\nReview work.\n\n## Acceptance Criteria\n\n- Review output is visible.\n"
    }));
    await writeFile(path.join(project.specopsPath, "agent-tasks", "task.review.md"), agentTaskMarkdown({
      id: "task.review",
      title: "Review Task",
      sourceEntity: "uc.review",
      body: "## Objective\n\nImplement review.\n\n## Validation Commands\n\n```sh\npnpm test\n```\n"
    }));
    await git(project.repoPath, ["init"]);
    await git(project.repoPath, ["config", "user.email", "test@example.com"]);
    await git(project.repoPath, ["config", "user.name", "SpecOps Test"]);
    await git(project.repoPath, ["add", "."]);
    await git(project.repoPath, ["commit", "-m", "initial"]);

    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
    const sourceFile = await pool.query("select id from source_files where project_id = $1 and path = 'src/review-service.ts'", [project.id]);
    await pool.query(
      "insert into source_spec_links (project_id, source_file_id, file_path, entity_id, symbol_name, symbol_kind, content_hash) values ($1, $2, 'src/review-service.ts', 'uc.review', 'review', 'function', 'hash-source-link')",
      [project.id, sourceFile.rows[0].id]
    );

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-runs`,
      payload: { taskEntityId: "task.review", agent: "codex" }
    });
    expect(startResponse.statusCode).toBe(201);
    expect(startResponse.json()).toMatchObject({
      projectId: project.id,
      taskEntityId: "task.review",
      taskTitle: "Review Task",
      agent: "codex",
      status: "running",
      promptMarkdown: expect.stringContaining("id: task.review")
    });

    await writeFile(path.join(project.repoPath, "src", "review-service.ts"), "export function review() { return 'new'; }\n");
    const runId = startResponse.json().id as string;
    const finishResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-runs/${runId}/finish`
    });

    expect(finishResponse.statusCode).toBe(200);
    expect(finishResponse.json()).toMatchObject({
      id: runId,
      status: "ready_for_review",
      changedFiles: {
        source: ["src/review-service.ts"],
        specs: [],
        tests: [],
        other: []
      },
      reviewSummary: {
        taskContext: {
          sourceEntityId: "uc.review",
          contextEntityIds: ["uc.review"],
          missingEntityIds: []
        },
        affectedSpecs: [
          expect.objectContaining({
            entityId: "uc.review",
            reason: "linked_source"
          })
        ],
        findings: expect.arrayContaining([
          expect.objectContaining({ kind: "source_changed_without_spec" }),
          expect.objectContaining({ kind: "possible_missing_test_change" }),
          expect.objectContaining({ kind: "task_not_updated" })
        ]),
        suggestedValidationCommands: ["pnpm typecheck", "pnpm test"]
      }
    });
  });
```

- [ ] **Step 2: Add failing API tests for invalid task and status transitions**

Add:

```ts
  it("rejects starting an agent run from a non-task entity", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash) values ($1, 'uc.review', 'use_case', 'Review', 'accepted', 'use-cases/uc.review.md', '# Review', 'Review', 'hash-review')",
      [project.id]
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-runs`,
      payload: { taskEntityId: "uc.review", agent: "codex" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("Agent run must start from an agent_task entity");
  });

  it("rejects invalid agent run status transitions", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await pool.query(
      "insert into agent_runs (project_id, task_entity_id, agent, status, prompt_markdown) values ($1, 'task.review', 'codex', 'running', '# Task') returning id",
      [project.id]
    );
    const run = await pool.query("select id from agent_runs where project_id = $1", [project.id]);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/agent-runs/${run.rows[0].id}`,
      payload: { status: "accepted" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Agent run is not ready for review");
  });
```

- [ ] **Step 3: Run API tests to verify they fail**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: FAIL because agent run routes and service do not exist.

- [ ] **Step 4: Add Git changed-file helper**

Modify `apps/api/src/services/git-service.ts`:

```ts
export async function readGitChangedFiles(
  repoPath: string,
  fromCommit: string,
  toCommit: string
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", fromCommit, toCommit],
    { cwd: repoPath }
  );

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
}
```

- [ ] **Step 5: Create agent run service**

Create `apps/api/src/services/agent-run-service.ts` with this structure:

```ts
import type {
  AgentRunChangedFilesDto,
  AgentRunDetailDto,
  AgentRunFindingDto,
  AgentRunReviewDto,
  AgentRunStatus,
  StartAgentRunRequest,
  UpdateAgentRunStatusRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { agentRuns, projects, sourceSpecLinks, specEntities, specLinks, validationMessages } from "@specops/db";
import { classifySourceFile } from "@specops/repo-scanner";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import { createProjectService } from "./project-service.js";
import { createSpecReadinessService } from "./spec-readiness-service.js";
import { readGitChangedFiles, readGitStatus, type GitStatusEntry } from "./git-service.js";

const emptyChangedFiles: AgentRunChangedFilesDto = {
  specs: [],
  source: [],
  tests: [],
  other: []
};

const emptyReview: AgentRunReviewDto = {
  changedFiles: emptyChangedFiles,
  affectedSpecs: [],
  taskContext: {
    sourceEntityId: null,
    contextEntityIds: [],
    missingEntityIds: []
  },
  findings: [],
  suggestedValidationCommands: ["pnpm typecheck", "pnpm test"]
};

export function createAgentRunService(db: Db) {
  const projectService = createProjectService(db);
  const readinessService = createSpecReadinessService(db);

  async function startRun(projectId: string, input: StartAgentRunRequest): Promise<AgentRunDetailDto> {
    const project = await projectService.getProject(projectId);
    const task = await getTaskEntity(projectId, input.taskEntityId);
    const git = await readGitStatus(project.repoPath);
    const [row] = await db
      .insert(agentRuns)
      .values({
        projectId,
        taskEntityId: task.entityId,
        agent: input.agent,
        status: "running",
        promptMarkdown: entityMarkdown(task),
        startGitCommit: git.headCommit,
        startDirtyFilesJson: git.entries,
        changedFilesJson: emptyChangedFiles,
        reviewSummaryJson: emptyReview
      })
      .returning();

    return mapRun(row, task.title);
  }

  async function listRuns(projectId: string): Promise<AgentRunDetailDto[]> {
    await projectService.getProject(projectId);
    const rows = await db
      .select({ run: agentRuns, title: specEntities.title })
      .from(agentRuns)
      .leftJoin(
        specEntities,
        and(
          eq(specEntities.projectId, agentRuns.projectId),
          eq(specEntities.entityId, agentRuns.taskEntityId)
        )
      )
      .where(eq(agentRuns.projectId, projectId))
      .orderBy(desc(agentRuns.startedAt));

    return rows.map(({ run, title }) => mapRun(run, title ?? run.taskEntityId));
  }

  async function getRun(projectId: string, runId: string): Promise<AgentRunDetailDto> {
    await projectService.getProject(projectId);
    const row = await getRunRow(projectId, runId);
    const task = await findEntity(projectId, row.taskEntityId);
    return mapRun(row, task?.title ?? row.taskEntityId);
  }

  async function finishRun(projectId: string, runId: string): Promise<AgentRunDetailDto> {
    const project = await projectService.getProject(projectId);
    const row = await getRunRow(projectId, runId);
    if (row.status !== "running") {
      throw new ConflictError("Only running agent runs can be finished", { runId, status: row.status });
    }

    const git = await readGitStatus(project.repoPath);
    const changedFiles = await computeChangedFiles(project.repoPath, project.specopsPath, row.startGitCommit, git.headCommit, row.startDirtyFilesJson as GitStatusEntry[], git.entries);
    const reviewSummary = await buildReviewSummary(projectId, row.taskEntityId, changedFiles, git.isRepo);
    const [updated] = await db
      .update(agentRuns)
      .set({
        status: "ready_for_review",
        finishedAt: new Date(),
        endGitCommit: git.headCommit,
        endDirtyFilesJson: git.entries,
        changedFilesJson: changedFiles,
        reviewSummaryJson: reviewSummary,
        updatedAt: new Date()
      })
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .returning();

    const task = await findEntity(projectId, updated.taskEntityId);
    return mapRun(updated, task?.title ?? updated.taskEntityId);
  }

  async function updateRunStatus(projectId: string, runId: string, input: UpdateAgentRunStatusRequest): Promise<AgentRunDetailDto> {
    await projectService.getProject(projectId);
    const row = await getRunRow(projectId, runId);
    if ((input.status === "accepted" || input.status === "needs_followup") && row.status !== "ready_for_review") {
      throw new ConflictError("Agent run is not ready for review", { runId, status: row.status });
    }
    if (["accepted", "needs_followup", "superseded"].includes(row.status) && row.status !== input.status) {
      throw new ConflictError("Terminal agent run status cannot be changed", { runId, status: row.status });
    }

    const [updated] = await db
      .update(agentRuns)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .returning();
    const task = await findEntity(projectId, updated.taskEntityId);
    return mapRun(updated, task?.title ?? updated.taskEntityId);
  }

  async function getTaskEntity(projectId: string, taskEntityId: string) {
    const task = await findEntity(projectId, taskEntityId);
    if (!task) {
      throw new NotFoundError("Entity not found", { projectId, entityId: taskEntityId });
    }
    if (task.type !== "agent_task") {
      throw new BadRequestError("Agent run must start from an agent_task entity", { taskEntityId, type: task.type });
    }
    return task;
  }

  async function findEntity(projectId: string, entityId: string) {
    const [row] = await db
      .select()
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, entityId)))
      .limit(1);
    return row ?? null;
  }

  async function getRunRow(projectId: string, runId: string) {
    const [row] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .limit(1);
    if (!row) {
      throw new NotFoundError("Agent run not found", { projectId, runId });
    }
    return row;
  }

  async function buildReviewSummary(projectId: string, taskEntityId: string, changedFiles: AgentRunChangedFilesDto, isGitRepo: boolean): Promise<AgentRunReviewDto> {
    const task = await getTaskEntity(projectId, taskEntityId);
    const taskContext = await readTaskContext(projectId, task);
    const affectedSpecs = await readAffectedSpecs(projectId, changedFiles, taskContext);
    const findings = await buildFindings(projectId, taskEntityId, changedFiles, affectedSpecs, taskContext, isGitRepo);
    return {
      changedFiles,
      affectedSpecs,
      taskContext,
      findings,
      suggestedValidationCommands: ["pnpm typecheck", "pnpm test"]
    };
  }

  return {
    startRun,
    listRuns,
    getRun,
    finishRun,
    updateRunStatus
  };
}
```

- [ ] **Step 6: Add helper functions to the same service file**

Append focused helpers to `agent-run-service.ts`:

```ts
async function computeChangedFiles(
  repoPath: string,
  specopsPath: string,
  startCommit: string | null,
  endCommit: string | null,
  startEntries: GitStatusEntry[],
  endEntries: GitStatusEntry[]
): Promise<AgentRunChangedFilesDto> {
  const paths = new Set<string>();
  if (startCommit && endCommit && startCommit !== endCommit) {
    for (const filePath of await readGitChangedFiles(repoPath, startCommit, endCommit)) {
      paths.add(filePath);
    }
  }
  for (const entry of endEntries) paths.add(entry.path);
  const startDirty = new Set(startEntries.map((entry) => entry.path));
  for (const entry of endEntries) {
    if (!startDirty.has(entry.path)) paths.add(entry.path);
  }

  const specopsDirectory = specopsPath.split(/[\\/]+/).pop() ?? "specops";
  const grouped: AgentRunChangedFilesDto = { specs: [], source: [], tests: [], other: [] };
  for (const filePath of [...paths].sort((left, right) => left.localeCompare(right))) {
    if (filePath === specopsDirectory || filePath.startsWith(`${specopsDirectory}/`)) {
      grouped.specs.push(filePath);
      continue;
    }
    const classification = classifySourceFile(filePath);
    if (classification.kind === "test") grouped.tests.push(filePath);
    else if (classification.kind === "source" || classification.kind === "entrypoint") grouped.source.push(filePath);
    else grouped.other.push(filePath);
  }
  return grouped;
}

function entityMarkdown(entity: { frontmatterJson: unknown; bodyMarkdown: string }) {
  const frontmatter = entity.frontmatterJson && typeof entity.frontmatterJson === "object"
    ? entity.frontmatterJson as Record<string, unknown>
    : {};
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) lines.push(`${key}: [${value.join(", ")}]`);
    else if (value && typeof value === "object") lines.push(`${key}: ${JSON.stringify(value)}`);
    else lines.push(`${key}: ${String(value)}`);
  }
  lines.push("---", "", entity.bodyMarkdown);
  return lines.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

async function readTaskContext(
  projectId: string,
  task: { frontmatterJson: unknown; entityId: string },
  db: Db
) {
  const frontmatter = asRecord(task.frontmatterJson);
  const links = asRecord(frontmatter.links);
  const sourceEntityId = typeof frontmatter.source_entity === "string" ? frontmatter.source_entity : null;
  const linkedIds = [
    ...stringArray(links.generated_from),
    ...stringArray(links.uses),
    ...Object.keys(asRecord(frontmatter.tracked_spec_hashes))
  ];
  const contextIds = [...new Set([sourceEntityId, ...linkedIds].filter((id): id is string => Boolean(id)))].sort();
  const rows = contextIds.length === 0 ? [] : await db
    .select({ entityId: specEntities.entityId })
    .from(specEntities)
    .where(and(eq(specEntities.projectId, projectId), inArray(specEntities.entityId, contextIds)));
  const existing = new Set(rows.map((row) => row.entityId));
  return {
    sourceEntityId,
    contextEntityIds: contextIds,
    missingEntityIds: contextIds.filter((entityId) => !existing.has(entityId))
  };
}
```

In `buildReviewSummary`, call this helper as `readTaskContext(projectId, task, db)` so the helper uses the same database handle as the service factory.

- [ ] **Step 7: Add affected spec and finding helpers**

In `agent-run-service.ts`, add helpers that query exact rows:

```ts
async function readAffectedSpecs(
  db: Db,
  projectId: string,
  changedFiles: AgentRunChangedFilesDto,
  taskContext: AgentRunReviewDto["taskContext"]
): Promise<AgentRunReviewDto["affectedSpecs"]> {
  const byId = new Map<string, AgentRunReviewDto["affectedSpecs"][number]>();
  const specRelativePaths = changedFiles.specs.map((filePath) => filePath.replace(/^specops\//, ""));
  if (specRelativePaths.length > 0) {
    const changedSpecRows = await db.select().from(specEntities).where(
      and(eq(specEntities.projectId, projectId), inArray(specEntities.filePath, specRelativePaths))
    );
    for (const row of changedSpecRows) {
      byId.set(row.entityId, {
        entityId: row.entityId,
        title: row.title,
        type: row.type,
        filePath: row.filePath,
        reason: "changed_spec"
      });
    }
  }

  const linkedRows = changedFiles.source.length === 0 ? [] : await db
    .select({
      entityId: specEntities.entityId,
      title: specEntities.title,
      type: specEntities.type,
      filePath: specEntities.filePath
    })
    .from(sourceSpecLinks)
    .innerJoin(
      specEntities,
      and(
        eq(specEntities.projectId, sourceSpecLinks.projectId),
        eq(specEntities.entityId, sourceSpecLinks.entityId)
      )
    )
    .where(and(eq(sourceSpecLinks.projectId, projectId), inArray(sourceSpecLinks.filePath, changedFiles.source)));

  for (const row of linkedRows) {
    if (!byId.has(row.entityId)) {
      byId.set(row.entityId, { ...row, reason: "linked_source" });
    }
  }

  if (taskContext.contextEntityIds.length > 0) {
    const contextRows = await db.select().from(specEntities).where(
      and(eq(specEntities.projectId, projectId), inArray(specEntities.entityId, taskContext.contextEntityIds))
    );
    for (const row of contextRows) {
      if (!byId.has(row.entityId)) {
        byId.set(row.entityId, {
          entityId: row.entityId,
          title: row.title,
          type: row.type,
          filePath: row.filePath,
          reason: "task_context"
        });
      }
    }
  }

  return [...byId.values()].sort((left, right) => left.entityId.localeCompare(right.entityId));
}
```

Add finding creation using stable IDs:

```ts
function finding(input: Omit<AgentRunFindingDto, "id">): AgentRunFindingDto {
  const suffix = `${input.kind}-${input.entityId ?? input.filePath ?? "project"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { id: suffix, ...input };
}
```

Add `buildFindings` with the full v1 rule set:

```ts
async function buildFindings(
  db: Db,
  readinessService: ReturnType<typeof createSpecReadinessService>,
  projectId: string,
  taskEntityId: string,
  changedFiles: AgentRunChangedFilesDto,
  affectedSpecs: AgentRunReviewDto["affectedSpecs"],
  taskContext: AgentRunReviewDto["taskContext"],
  isGitRepo: boolean
): Promise<AgentRunFindingDto[]> {
  const findings: AgentRunFindingDto[] = [];
  const linkedSourceRows = changedFiles.source.length === 0 ? [] : await db
    .select({ filePath: sourceSpecLinks.filePath })
    .from(sourceSpecLinks)
    .where(and(eq(sourceSpecLinks.projectId, projectId), inArray(sourceSpecLinks.filePath, changedFiles.source)));
  const linkedSourceFiles = new Set(linkedSourceRows.map((row) => row.filePath));
  const changedSpecEntityIds = new Set(
    affectedSpecs.filter((spec) => spec.reason === "changed_spec").map((spec) => spec.entityId)
  );

  if (!isGitRepo) {
    findings.push(finding({
      severity: "info",
      kind: "git_comparison_unavailable",
      message: "This project is not currently readable as a Git repository, so commit comparison is unavailable.",
      suggestedFollowUp: "Use the changed file snapshot as review evidence or initialize Git for the project.",
      entityId: null,
      filePath: null
    }));
  }

  if (changedFiles.source.length > 0 && changedFiles.specs.length === 0 && linkedSourceFiles.size > 0) {
    findings.push(finding({
      severity: "review",
      kind: "source_changed_without_spec",
      message: "Source files changed but no spec files changed.",
      suggestedFollowUp: "Inspect linked specs and update canonical markdown when behavior or architecture changed.",
      entityId: null,
      filePath: null
    }));
  }

  for (const filePath of changedFiles.source) {
    if (!linkedSourceFiles.has(filePath)) {
      findings.push(finding({
        severity: "context",
        kind: "unlinked_source_changed",
        message: `Source file ${filePath} changed without a source-spec link.`,
        suggestedFollowUp: "Link the source file to a spec or confirm no spec update is needed.",
        entityId: null,
        filePath
      }));
    }
  }

  for (const entityId of taskContext.missingEntityIds) {
    findings.push(finding({
      severity: "blocker",
      kind: "task_context_missing",
      message: `Task context references missing spec ${entityId}.`,
      suggestedFollowUp: "Restore the referenced spec, update task frontmatter, or supersede this run.",
      entityId,
      filePath: null
    }));
  }

  for (const entityId of taskContext.contextEntityIds) {
    if (changedSpecEntityIds.has(entityId)) {
      findings.push(finding({
        severity: "review",
        kind: "task_context_spec_changed",
        message: `Task context spec ${entityId} changed during the run.`,
        suggestedFollowUp: "Review whether the implementation still matches the updated spec context.",
        entityId,
        filePath: null
      }));
    }
  }

  const affectedEntityIds = affectedSpecs.map((spec) => spec.entityId);
  if (affectedEntityIds.length > 0) {
    const messages = await db
      .select()
      .from(validationMessages)
      .where(and(eq(validationMessages.projectId, projectId), inArray(validationMessages.entityId, affectedEntityIds)));
    for (const message of messages) {
      findings.push(finding({
        severity: message.level === "error" ? "blocker" : "review",
        kind: "validation_warning",
        message: `${message.entityId ?? "project"}: ${message.message}`,
        suggestedFollowUp: "Resolve or intentionally accept the validation message before accepting the run.",
        entityId: message.entityId,
        filePath: message.filePath
      }));
    }
  }

  for (const spec of affectedSpecs) {
    const readiness = await readinessService.getEntityReadiness(projectId, spec.entityId);
    if (readiness.readiness !== "ready") {
      findings.push(finding({
        severity: readiness.readiness === "blocked" ? "blocker" : "review",
        kind: "readiness_warning",
        message: `${spec.entityId} readiness is ${readiness.readiness}.`,
        suggestedFollowUp: "Review failed readiness checks before accepting the run.",
        entityId: spec.entityId,
        filePath: spec.filePath
      }));
    }
  }

  if (changedFiles.source.length > 0 && changedFiles.tests.length === 0) {
    findings.push(finding({
      severity: "context",
      kind: "possible_missing_test_change",
      message: "Source files changed but no test files changed.",
      suggestedFollowUp: "Confirm existing tests cover the change or add focused tests.",
      entityId: null,
      filePath: null
    }));
  }

  const taskFileChanged = affectedSpecs.some((spec) => spec.entityId === taskEntityId && spec.reason === "changed_spec");
  if (!taskFileChanged) {
    findings.push(finding({
      severity: "info",
      kind: "task_not_updated",
      message: "The agent task spec did not change during the run.",
      suggestedFollowUp: "Update the task status or notes if the run outcome should be recorded in markdown.",
      entityId: taskEntityId,
      filePath: null
    }));
  }

  return findings.sort((left, right) => left.severity.localeCompare(right.severity) || left.id.localeCompare(right.id));
}
```

- [ ] **Step 8: Run typecheck to catch service signature issues**

Run:

```sh
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit backend service foundation**

```sh
git add apps/api/src/services/git-service.ts apps/api/src/services/agent-run-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add agent run service"
```

---

### Task 3: Agent Run API Routes

**Files:**

- Create: `apps/api/src/routes/agent-runs.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Create route module**

Create `apps/api/src/routes/agent-runs.ts`:

```ts
import {
  startAgentRunRequestSchema,
  updateAgentRunStatusRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAgentRunService } from "../services/agent-run-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const runParamsSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().uuid()
});

export const registerAgentRunRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const agentRunService = createAgentRunService(db);

  app.post("/projects/:projectId/agent-runs", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = startAgentRunRequestSchema.parse(request.body);
    const run = await agentRunService.startRun(projectId, input);
    return reply.code(201).send(run);
  });

  app.get("/projects/:projectId/agent-runs", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return agentRunService.listRuns(projectId);
  });

  app.get("/projects/:projectId/agent-runs/:runId", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    return agentRunService.getRun(projectId, runId);
  });

  app.post("/projects/:projectId/agent-runs/:runId/finish", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    return agentRunService.finishRun(projectId, runId);
  });

  app.patch("/projects/:projectId/agent-runs/:runId", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    const input = updateAgentRunStatusRequestSchema.parse(request.body);
    return agentRunService.updateRunStatus(projectId, runId, input);
  });
};
```

- [ ] **Step 2: Register routes**

Modify `apps/api/src/server.ts` imports:

```ts
import { registerAgentRunRoutes } from "./routes/agent-runs.js";
```

Register after agent task routes:

```ts
  app.register(registerAgentTaskRoutes, { prefix: "/api", db });
  app.register(registerAgentRunRoutes, { prefix: "/api", db });
```

- [ ] **Step 3: Run API tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: PASS for the new agent run route tests.

- [ ] **Step 4: Run API typecheck**

Run:

```sh
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit API routes**

```sh
git add apps/api/src/routes/agent-runs.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose agent run API"
```

---

### Task 4: Web Client And Routing

**Files:**

- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/routes/agent-runs.tsx`
- Create: `apps/web/src/routes/agent-run-detail.tsx`
- Create: `apps/web/src/routes/agent-runs.test.tsx`

- [ ] **Step 1: Add failing route tests**

Create `apps/web/src/routes/agent-runs.test.tsx`:

```tsx
import type { AgentRunDetailDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runsState: { data: [] as AgentRunDetailDto[], error: null as Error | null, isLoading: false },
  detailState: { data: null as AgentRunDetailDto | null, error: null as Error | null, isLoading: false },
  mutate: vi.fn(),
  agentRunsQuery: vi.fn((projectId: string) => ({ queryKey: ["projects", projectId, "agent-runs"] })),
  agentRunQuery: vi.fn((projectId: string, runId: string) => ({ queryKey: ["projects", projectId, "agent-runs", runId] }))
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
  useQuery: (options: { queryKey: readonly string[] }) =>
    options.queryKey.length === 4 ? mocks.detailState : mocks.runsState,
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={`${to}:${params?.projectId ?? ""}:${params?.runId ?? ""}`}>{children}</a>
  )
}));

vi.mock("../api/queries.js", () => ({
  agentRunsQuery: mocks.agentRunsQuery,
  agentRunQuery: mocks.agentRunQuery,
  finishAgentRun: vi.fn(),
  queryKeys: {
    agentRunsRoot: (projectId: string) => ["projects", projectId, "agent-runs"],
    agentRun: (projectId: string, runId: string) => ["projects", projectId, "agent-runs", runId]
  },
  updateAgentRunStatus: vi.fn()
}));

import { AgentRunDetailPage } from "./agent-run-detail.js";
import { AgentRunsPage } from "./agent-runs.js";

describe("agent run routes", () => {
  it("renders recent agent runs with finding counts", () => {
    mocks.runsState = { data: [runDetail()], error: null, isLoading: false };

    const html = renderToStaticMarkup(<AgentRunsPage projectId="project-1" />);

    expect(html).toContain("Agent Runs");
    expect(html).toContain("Review Task");
    expect(html).toContain("ready_for_review");
    expect(html).toContain("1 review");
    expect(html).toContain("/projects/$projectId/agent-runs/$runId:project-1:run-1");
  });

  it("renders changed files and findings on run detail", () => {
    mocks.detailState = { data: runDetail(), error: null, isLoading: false };

    const html = renderToStaticMarkup(<AgentRunDetailPage projectId="project-1" runId="run-1" />);

    expect(html).toContain("Review Task");
    expect(html).toContain("src/review-service.ts");
    expect(html).toContain("Source files changed but no spec files changed.");
    expect(html).toContain("pnpm test");
  });
});

function runDetail(): AgentRunDetailDto {
  return {
    id: "run-1",
    projectId: "project-1",
    taskEntityId: "task.review",
    taskTitle: "Review Task",
    agent: "codex",
    status: "ready_for_review",
    promptMarkdown: "# Task",
    startedAt: "2026-05-11T10:00:00.000Z",
    finishedAt: "2026-05-11T10:05:00.000Z",
    startGitCommit: "abc123456",
    endGitCommit: "def456789",
    changedFileCount: 1,
    findingCounts: { blocker: 0, review: 1, context: 0, info: 0 },
    changedFiles: { specs: [], source: ["src/review-service.ts"], tests: [], other: [] },
    reviewSummary: {
      changedFiles: { specs: [], source: ["src/review-service.ts"], tests: [], other: [] },
      affectedSpecs: [{ entityId: "uc.review", title: "Review", type: "use_case", filePath: "use-cases/uc.review.md", reason: "linked_source" }],
      taskContext: { sourceEntityId: "uc.review", contextEntityIds: ["uc.review"], missingEntityIds: [] },
      findings: [{
        id: "source-changed-without-spec-project",
        severity: "review",
        kind: "source_changed_without_spec",
        message: "Source files changed but no spec files changed.",
        suggestedFollowUp: "Inspect linked specs.",
        entityId: null,
        filePath: null
      }],
      suggestedValidationCommands: ["pnpm typecheck", "pnpm test"]
    },
    createdAt: "2026-05-11T10:00:00.000Z",
    updatedAt: "2026-05-11T10:05:00.000Z"
  };
}
```

- [ ] **Step 2: Run web route test to verify it fails**

Run:

```sh
pnpm --filter web test -- agent-runs.test.tsx
```

Expected: FAIL because the route files do not exist.

- [ ] **Step 3: Add web API helpers**

Modify imports in `apps/web/src/api/queries.ts` to include:

```ts
  AgentRunDetailDto,
  AgentRunSummaryDto,
  StartAgentRunRequest,
  UpdateAgentRunStatusRequest,
```

Add query keys:

```ts
  agentRunsRoot: (projectId: string) => ["projects", projectId, "agent-runs"] as const,
  agentRuns: (projectId: string) => ["projects", projectId, "agent-runs", "list"] as const,
  agentRun: (projectId: string, runId: string) =>
    ["projects", projectId, "agent-runs", runId] as const,
```

Add helpers:

```ts
export function agentRunsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.agentRuns(projectId),
    queryFn: () =>
      apiGet<AgentRunSummaryDto[]>(`/api/projects/${encodeURIComponent(projectId)}/agent-runs`)
  });
}

export function agentRunQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.agentRun(projectId, runId),
    queryFn: () =>
      apiGet<AgentRunDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}`
      )
  });
}

export function startAgentRun(projectId: string, input: StartAgentRunRequest) {
  return apiSend<AgentRunDetailDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-runs`,
    input
  );
}

export function finishAgentRun(projectId: string, runId: string) {
  return apiSend<AgentRunDetailDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}/finish`
  );
}

export function updateAgentRunStatus(
  projectId: string,
  runId: string,
  input: UpdateAgentRunStatusRequest
) {
  return apiSend<AgentRunDetailDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}`,
    input
  );
}
```

- [ ] **Step 4: Create Agent Runs list route**

Create `apps/web/src/routes/agent-runs.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { agentRunsQuery } from "../api/queries.js";

export function AgentRunsPage({ projectId }: { projectId: string }) {
  const runs = useQuery(agentRunsQuery(projectId));

  if (runs.isLoading) return <div className="p-4 text-sm text-slate-600">Loading agent runs...</div>;
  if (runs.error) return <div className="p-4 text-sm text-red-700">{runs.error.message}</div>;

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header>
        <h1 className="text-base font-semibold text-slate-950">Agent Runs</h1>
      </header>
      <section className="rounded border border-slate-200 bg-white">
        {(runs.data ?? []).length === 0 ? (
          <p className="p-3 text-sm text-slate-500">No agent runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {(runs.data ?? []).map((run) => (
              <li key={run.id} className="p-3">
                <Link
                  to="/projects/$projectId/agent-runs/$runId"
                  params={{ projectId, runId: run.id }}
                  className="block underline-offset-2 hover:underline"
                >
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{run.taskTitle}</div>
                      <div className="truncate text-xs text-slate-500">{run.taskEntityId} / {run.agent} / {run.status}</div>
                    </div>
                    <div className="shrink-0 text-xs text-slate-500">
                      {run.changedFileCount} files / {run.findingCounts.review} review / {run.findingCounts.context} context
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {shortSha(run.startGitCommit)} -> {shortSha(run.endGitCommit)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 8) : "none";
}
```

- [ ] **Step 5: Create Agent Run detail route**

Create `apps/web/src/routes/agent-run-detail.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  agentRunQuery,
  finishAgentRun,
  queryKeys,
  updateAgentRunStatus
} from "../api/queries.js";

export function AgentRunDetailPage({ projectId, runId }: { projectId: string; runId: string }) {
  const queryClient = useQueryClient();
  const run = useQuery(agentRunQuery(projectId, runId));
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.agentRunsRoot(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agentRun(projectId, runId) })
    ]);
  };
  const finishMutation = useMutation({
    mutationFn: () => finishAgentRun(projectId, runId),
    onSuccess: invalidate
  });
  const statusMutation = useMutation({
    mutationFn: (status: "accepted" | "needs_followup" | "superseded") =>
      updateAgentRunStatus(projectId, runId, { status }),
    onSuccess: invalidate
  });

  if (run.isLoading) return <div className="p-4 text-sm text-slate-600">Loading agent run...</div>;
  if (run.error) return <div className="p-4 text-sm text-red-700">{run.error.message}</div>;
  if (!run.data) return <div className="p-4 text-sm text-slate-600">Agent run unavailable.</div>;

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-950">{run.data.taskTitle}</h1>
          <p className="text-sm text-slate-600">{run.data.taskEntityId} / {run.data.agent} / {run.data.status}</p>
          <p className="mt-1 text-xs text-slate-500">{shortSha(run.data.startGitCommit)} -> {shortSha(run.data.endGitCommit)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.data.status === "running" ? (
            <button className="button-primary" type="button" disabled={finishMutation.isPending} onClick={() => finishMutation.mutate()}>
              Finish run
            </button>
          ) : null}
          {run.data.status === "ready_for_review" ? (
            <>
              <button className="button-primary" type="button" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("accepted")}>Mark accepted</button>
              <button className="button-secondary" type="button" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("needs_followup")}>Needs follow-up</button>
            </>
          ) : null}
          {run.data.status !== "accepted" && run.data.status !== "needs_followup" && run.data.status !== "superseded" ? (
            <button className="button-secondary" type="button" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("superseded")}>Supersede</button>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-2">
        <Panel title="Changed Files">
          <FileGroup title="Specs" files={run.data.changedFiles.specs} />
          <FileGroup title="Source" files={run.data.changedFiles.source} />
          <FileGroup title="Tests" files={run.data.changedFiles.tests} />
          <FileGroup title="Other" files={run.data.changedFiles.other} />
        </Panel>
        <Panel title="Findings">
          {run.data.reviewSummary.findings.length === 0 ? <p className="text-sm text-slate-500">No findings.</p> : null}
          <ul className="grid gap-2">
            {run.data.reviewSummary.findings.map((finding) => (
              <li key={finding.id} className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-medium text-slate-900">{finding.severity}: {finding.kind}</div>
                <div className="text-slate-700">{finding.message}</div>
                <div className="mt-1 text-xs text-slate-500">{finding.suggestedFollowUp}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Panel title="Affected Specs">
          <ul className="grid gap-1 text-sm">
            {run.data.reviewSummary.affectedSpecs.map((spec) => (
              <li key={`${spec.reason}-${spec.entityId}`}>{spec.title} / {spec.entityId} / {spec.reason}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Validation Commands">
          <ul className="grid gap-1 text-sm font-mono">
            {run.data.reviewSummary.suggestedValidationCommands.map((command) => <li key={command}>{command}</li>)}
          </ul>
        </Panel>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded border border-slate-200 bg-white p-3"><h2 className="mb-2 text-sm font-semibold text-slate-800">{title}</h2>{children}</section>;
}

function FileGroup({ title, files }: { title: string; files: string[] }) {
  return <div className="mb-3 last:mb-0"><h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>{files.length === 0 ? <p className="text-sm text-slate-500">None</p> : <ul className="grid gap-1 text-sm font-mono">{files.map((file) => <li key={file}>{file}</li>)}</ul>}</div>;
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 8) : "none";
}
```

- [ ] **Step 6: Register web routes**

Modify `apps/web/src/app.tsx` imports:

```ts
import { AgentRunDetailPage } from "./routes/agent-run-detail.js";
import { AgentRunsPage } from "./routes/agent-runs.js";
```

Add route declarations before `impactRoute`:

```tsx
const agentRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/agent-runs",
  component: () => {
    const { projectId } = agentRunsRoute.useParams();
    return <AgentRunsPage projectId={projectId} />;
  }
});

const agentRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/agent-runs/$runId",
  component: () => {
    const { projectId, runId } = agentRunDetailRoute.useParams();
    return <AgentRunDetailPage projectId={projectId} runId={runId} />;
  }
});
```

Add both to `routeTree`:

```ts
  agentRunsRoute,
  agentRunDetailRoute,
```

- [ ] **Step 7: Run web route tests**

Run:

```sh
pnpm --filter web test -- agent-runs.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit web routes**

```sh
git add apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/routes/agent-runs.tsx apps/web/src/routes/agent-run-detail.tsx apps/web/src/routes/agent-runs.test.tsx
git commit -m "feat: add agent run review pages"
```

---

### Task 5: Start Run From Agent Task Entity

**Files:**

- Modify: `apps/web/src/components/entity-detail.tsx`
- Modify: `apps/web/src/components/entity-detail.test.tsx`

- [ ] **Step 1: Add failing component tests**

Modify `apps/web/src/components/entity-detail.test.tsx` by adding mocks:

```ts
  navigate: vi.fn(),
  startAgentRun: vi.fn(async () => ({ id: "run-1" }))
```

Update the router mock:

```tsx
  useNavigate: () => mocks.navigate,
```

Update the queries mock exports:

```ts
  startAgentRun: mocks.startAgentRun,
```

Add tests:

```tsx
  it("shows Start Agent Run for agent task entities", () => {
    mocks.entity = {
      ...mocks.entity,
      entityId: "task.review",
      type: "agent_task",
      title: "Review Task",
      filePath: "agent-tasks/task.review.md"
    };

    const html = renderEntityDetail();

    expect(html).toContain("Start Agent Run");
  });

  it("does not show Start Agent Run for non-task entities", () => {
    mocks.entity = {
      ...mocks.entity,
      entityId: "domain.decision",
      type: "domain_entity",
      title: "Decision",
      filePath: "domain/decision.md"
    };

    const html = renderEntityDetail();

    expect(html).not.toContain("Start Agent Run");
  });
```

- [ ] **Step 2: Run component test to verify it fails**

Run:

```sh
pnpm --filter web test -- entity-detail.test.tsx
```

Expected: FAIL because `Start Agent Run` is not rendered.

- [ ] **Step 3: Add start-run mutation to entity detail**

Modify imports in `apps/web/src/components/entity-detail.tsx`:

```ts
import { Link, useNavigate } from "@tanstack/react-router";
import { Bot, Network, Play, Save, Sparkles } from "lucide-react";
```

Add `startAgentRun` to query imports.

Inside `EntityDetail`, add:

```ts
  const navigate = useNavigate();
```

Add mutation:

```ts
  const startRunMutation = useMutation({
    mutationFn: () => startAgentRun(projectId, { taskEntityId: entityId, agent: taskTargetAgent.trim() || defaultTargetAgent() }),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentRunsRoot(projectId) });
      await navigate({
        to: "/projects/$projectId/agent-runs/$runId",
        params: { projectId, runId: run.id }
      });
    }
  });
```

In the action button group, before `Generate Task`, render:

```tsx
                {entity.data.type === "agent_task" ? (
                  <button
                    type="button"
                    className="button-primary"
                    disabled={startRunMutation.isPending || isDirty}
                    onClick={() => startRunMutation.mutate()}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    Start Agent Run
                  </button>
                ) : null}
```

Below existing task errors, render:

```tsx
      {startRunMutation.error ? (
        <p className="text-sm text-red-700">{startRunMutation.error.message}</p>
      ) : null}
```

- [ ] **Step 4: Add missing query key mock and real query key**

In `apps/web/src/api/queries.ts`, ensure `queryKeys.agentRunsRoot(projectId)` exists from Task 4.

In `entity-detail.test.tsx`, add:

```ts
    agentRunsRoot: (projectId: string) => ["agent-runs-root", projectId],
```

- [ ] **Step 5: Run component tests**

Run:

```sh
pnpm --filter web test -- entity-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit entity action**

```sh
git add apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx
git commit -m "feat: start agent runs from task specs"
```

---

### Task 6: Final Verification And Polish

**Files:**

- Modify only files required by failures from verification commands.

- [ ] **Step 1: Run package typechecks**

Run:

```sh
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused tests**

Run:

```sh
pnpm --filter @specops/contracts test -- agent-runs.test.ts
pnpm --filter @specops/db test -- migrations.test.ts schema.typecheck.ts
pnpm --filter web test -- agent-runs.test.tsx entity-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run DB-backed API tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: PASS. If PostgreSQL is not running, start it with `docker compose up -d postgres`, create the `specops_test` database if needed, then rerun the command.

- [ ] **Step 4: Run full test suite**

Run:

```sh
pnpm test
```

Expected: PASS, with DB-backed tests skipped only when `TEST_DATABASE_URL` is intentionally unset outside CI.

- [ ] **Step 5: Build the web app**

Run:

```sh
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 6: Manual dogfood smoke test**

Run:

```sh
pnpm dev
```

Open `http://127.0.0.1:5176`.

Manual checks:

- Open a project with an indexed `agent_task`.
- Confirm the entity detail page shows `Start Agent Run`.
- Start a run and confirm navigation to `/projects/<projectId>/agent-runs/<runId>`.
- Modify a source file in the project repository.
- Click `Finish run`.
- Confirm changed files, affected specs, findings, and validation commands render.
- Mark the run `Needs follow-up`.
- Return to `/projects/<projectId>/agent-runs` and confirm the updated status appears.

- [ ] **Step 7: Commit verification fixes**

If verification required fixes, stage the implementation files touched by this plan:

```sh
git add packages/contracts/src/agent-runs.ts packages/contracts/src/agent-runs.test.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts apps/api/src/services/git-service.ts apps/api/src/services/agent-run-service.ts apps/api/src/routes/agent-runs.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/routes/agent-runs.tsx apps/web/src/routes/agent-run-detail.tsx apps/web/src/routes/agent-runs.test.tsx apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx
git commit -m "fix: stabilize agent run review"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Start run from `agent_task`: Tasks 2, 3, and 5.
- Store prompt and Git start/end state: Tasks 1, 2, and 3.
- Compute changed files: Task 2.
- Map source/spec changes to specs: Task 2.
- Include task context: Task 2.
- Deterministic findings: Task 2.
- Web list/detail surfaces: Task 4.
- Entity action: Task 5.
- Status updates: Tasks 2, 3, and 4.
- Tests and verification: Tasks 1 through 6.

Type consistency:

- Contract names used by API and web are defined in `packages/contracts/src/agent-runs.ts`.
- Query key names used by `EntityDetail` are defined in `apps/web/src/api/queries.ts`.
- Route paths match the design: `/projects/:projectId/agent-runs` and `/projects/:projectId/agent-runs/:runId`.
