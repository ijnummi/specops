# Project Health v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live Git drift health and strict stale generated task detection to the project dashboard.

**Architecture:** Keep the existing `/overview` endpoint cache-only and add a separate live `/health` endpoint. Indexing records the current Git commit when available, generated task markdown stores deterministic linked-spec content hashes, and health uses those hashes with timestamp fallback for older tasks.

**Tech Stack:** TypeScript, Fastify, Drizzle/PostgreSQL, Zod contracts, React, TanStack Query, Vitest, local Git CLI.

---

## File Structure

- Create `apps/api/src/services/git-service.ts`: small wrapper around non-interactive local Git commands.
- Create `apps/api/src/services/project-health-service.ts`: reads indexed project data plus live Git status and returns `ProjectHealthDto`.
- Create `apps/api/src/routes/project-health.ts`: registers `GET /api/projects/:projectId/health`.
- Modify `packages/contracts/src/projects.ts`: add `projectHealthSchema` and `ProjectHealthDto`.
- Modify `packages/taskgen/src/types.ts`: add optional `contentHash` to `TaskgenEntity`.
- Modify `packages/taskgen/src/generate.ts`: emit deterministic `tracked_spec_hashes`.
- Modify `apps/api/src/services/agent-task-service.ts`: pass `contentHash` into task generation.
- Modify `apps/api/src/services/indexer-service.ts`: store `gitCommit`.
- Modify `apps/api/src/server.ts`: register the new health route.
- Modify `apps/web/src/api/queries.ts`: add health query key and fetcher.
- Modify `apps/web/src/routes/project-detail.tsx`: load health with overview and invalidate it after project actions.
- Modify `apps/web/src/components/project-overview-dashboard.tsx`: render Git and drift panel plus stale task signals.
- Modify tests in `packages/taskgen`, `apps/api`, and `apps/web` next to existing test files.

## Task 1: Contracts And Task Hash Frontmatter

**Files:**
- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/taskgen/src/types.ts`
- Modify: `packages/taskgen/src/generate.ts`
- Modify: `packages/taskgen/src/__tests__/generate.test.ts`
- Modify: `apps/api/src/services/agent-task-service.ts`

- [ ] **Step 1: Write the failing taskgen test**

Add this test to `packages/taskgen/src/__tests__/generate.test.ts`:

```ts
it("includes deterministic tracked spec hashes when entities provide content hashes", () => {
  const result = generateAgentTaskMarkdown({
    source: { ...source, contentHash: "hash-source" },
    context: [
      { ...context[1], contentHash: "hash-interface" },
      { ...context[0], contentHash: "hash-domain" },
    ],
    links,
    targetAgent: "codex",
    validationCommands: ["pnpm test"],
  });

  expect(result.markdown).toContain("tracked_spec_hashes:");
  expect(result.markdown.indexOf("domain.spec-entity: hash-domain")).toBeLessThan(
    result.markdown.indexOf("interface.spec-entity-service: hash-interface")
  );
  expect(result.markdown.indexOf("interface.spec-entity-service: hash-interface")).toBeLessThan(
    result.markdown.indexOf("uc.generate-agent-task: hash-source")
  );
  expect(result.markdown).toContain("uc.generate-agent-task: hash-source");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @specops/taskgen test -- src/__tests__/generate.test.ts
```

Expected: FAIL because `tracked_spec_hashes` is absent.

- [ ] **Step 3: Add content hash support to taskgen types**

Change `packages/taskgen/src/types.ts`:

```ts
export type TaskgenEntity = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
  contentHash?: string;
};
```

- [ ] **Step 4: Emit tracked hashes in task frontmatter**

In `packages/taskgen/src/generate.ts`, before the `frontmatter` constant, add:

```ts
  const trackedSpecHashes = Object.fromEntries(
    [input.source, ...context]
      .filter((entity): entity is TaskgenEntity & { contentHash: string } =>
        typeof entity.contentHash === "string" && entity.contentHash.length > 0
      )
      .sort((left, right) => left.entityId.localeCompare(right.entityId))
      .map((entity) => [singleLineMarkdownScalar(entity.entityId), entity.contentHash])
  );
```

Then change the `stringify` object to include `tracked_spec_hashes` only when non-empty:

```ts
  const frontmatter = stringify({
    id: taskId,
    type: "agent_task",
    title,
    status: "ready",
    target_agent: targetAgent,
    source_entity: sourceEntityId,
    links: {
      generated_from: [sourceEntityId],
      uses: contextSpecIds,
    },
    ...(Object.keys(trackedSpecHashes).length > 0
      ? { tracked_spec_hashes: trackedSpecHashes }
      : {}),
  }).trim();
```

- [ ] **Step 5: Pass indexed hashes from the API task service**

Change `toTaskgenEntity` in `apps/api/src/services/agent-task-service.ts`:

```ts
function toTaskgenEntity(entity: SpecEntityDto): TaskgenEntity {
  return {
    entityId: entity.entityId,
    type: entity.type,
    title: entity.title,
    status: entity.status,
    filePath: entity.filePath,
    frontmatter: entity.frontmatter,
    bodyMarkdown: entity.bodyMarkdown,
    bodyText: entity.bodyText,
    contentHash: entity.contentHash
  };
}
```

- [ ] **Step 6: Add the health contract**

In `packages/contracts/src/projects.ts`, add this schema before `projectOverviewSchema` or directly after it:

```ts
export const projectHealthSchema = z.object({
  git: z.object({
    isRepo: z.boolean(),
    headCommit: z.string().nullable(),
    indexedCommit: z.string().nullable(),
    hasUncommittedChanges: z.boolean(),
    changedSpecFiles: z.array(z.string()),
    changedSourceFiles: z.array(z.string()),
    untrackedSpecFiles: z.array(z.string()),
    untrackedSourceFiles: z.array(z.string())
  }),
  drift: z.object({
    indexIsBehindHead: z.boolean(),
    currentSpecFileChangeCount: z.number(),
    currentSourceFileChangeCount: z.number()
  }),
  staleTasks: z.object({
    count: z.number(),
    samples: z.array(
      z.object({
        entityId: z.string(),
        title: z.string(),
        sourceEntityId: z.string().nullable(),
        reason: z.enum([
          "source_spec_changed",
          "context_spec_changed",
          "tracked_hash_mismatch",
          "missing_source_entity"
        ])
      })
    )
  }),
  attentionItems: z.array(
    z.object({
      kind: z.enum([
        "index_behind_head",
        "changed_spec_files",
        "changed_source_files",
        "stale_agent_task",
        "missing_task_source"
      ]),
      label: z.string(),
      entityId: z.string().nullable(),
      filePath: z.string().nullable()
    })
  )
});
```

Add the type export:

```ts
export type ProjectHealthDto = z.infer<typeof projectHealthSchema>;
```

- [ ] **Step 7: Run taskgen and contract checks**

Run:

```bash
pnpm --filter @specops/taskgen test -- src/__tests__/generate.test.ts
pnpm --filter @specops/contracts build
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/projects.ts packages/taskgen/src/types.ts packages/taskgen/src/generate.ts packages/taskgen/src/__tests__/generate.test.ts apps/api/src/services/agent-task-service.ts
git commit -m "feat: track spec hashes in generated tasks"
```

## Task 2: Git Metadata During Indexing

**Files:**
- Create: `apps/api/src/services/git-service.ts`
- Modify: `apps/api/src/services/indexer-service.ts`
- Modify: `apps/api/src/__tests__/indexer-service.test.ts`

- [ ] **Step 1: Write failing indexer tests for Git commit capture**

Add imports to `apps/api/src/__tests__/indexer-service.test.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
```

Add this helper near the bottom:

```ts
const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}
```

Add these tests inside `describeWithDb("indexProject", ...)`:

```ts
it("records the current git commit when indexing a git repository", async () => {
  const { projectId, repoPath, specopsPath } = await createProjectFixture();
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
  await git(repoPath, ["init"]);
  await git(repoPath, ["config", "user.email", "specops@example.test"]);
  await git(repoPath, ["config", "user.name", "SpecOps Test"]);
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "initial"]);
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath });
  const expectedCommit = stdout.trim();

  const result = await createIndexerService(db).indexProject(projectId);

  expect(result.gitCommit).toBe(expectedCommit);
});

it("keeps indexing successful with null git commit outside git", async () => {
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

  const result = await createIndexerService(db).indexProject(projectId);

  expect(result.status).toBe("succeeded");
  expect(result.gitCommit).toBeNull();
});
```

- [ ] **Step 2: Run the focused indexer test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/indexer-service.test.ts
```

Expected: FAIL because `gitCommit` is not populated.

- [ ] **Step 3: Create the Git service**

Create `apps/api/src/services/git-service.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitStatusEntry = {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  untracked: boolean;
};

export type GitStatus = {
  isRepo: boolean;
  headCommit: string | null;
  entries: GitStatusEntry[];
};

export async function readGitHeadCommit(repoPath: string): Promise<string | null> {
  const status = await readGitStatus(repoPath, { includeEntries: false });
  return status.headCommit;
}

export async function readGitStatus(
  repoPath: string,
  options: { includeEntries?: boolean } = {}
): Promise<GitStatus> {
  const isRepo = await isInsideWorkTree(repoPath);
  if (!isRepo) {
    return { isRepo: false, headCommit: null, entries: [] };
  }

  const headCommit = await gitOutput(repoPath, ["rev-parse", "HEAD"]);
  const entries = options.includeEntries === false ? [] : await readStatusEntries(repoPath);

  return { isRepo: true, headCommit, entries };
}

async function isInsideWorkTree(repoPath: string): Promise<boolean> {
  try {
    return (await gitOutput(repoPath, ["rev-parse", "--is-inside-work-tree"])) === "true";
  } catch (error) {
    if (isExpectedNoGitError(error)) {
      return false;
    }
    throw error;
  }
}

async function readStatusEntries(repoPath: string): Promise<GitStatusEntry[]> {
  const output = await gitOutput(repoPath, ["status", "--porcelain=v1", "-z"]);
  const records = output.split("\0").filter((record) => record.length > 0);
  const entries: GitStatusEntry[] = [];

  for (const record of records) {
    const indexStatus = record.slice(0, 1);
    const workTreeStatus = record.slice(1, 2);
    const rawPath = record.slice(3);
    const renameSeparator = rawPath.indexOf(" -> ");
    const filePath = renameSeparator === -1 ? rawPath : rawPath.slice(renameSeparator + 4);

    entries.push({
      path: filePath,
      indexStatus,
      workTreeStatus,
      untracked: indexStatus === "?" && workTreeStatus === "?"
    });
  }

  return entries;
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

function isExpectedNoGitError(error: unknown): boolean {
  return (
    isNodeExecError(error) &&
    typeof error.stderr === "string" &&
    error.stderr.toLowerCase().includes("not a git repository")
  );
}

function isNodeExecError(error: unknown): error is Error & { stderr?: string } {
  return typeof error === "object" && error !== null && "stderr" in error;
}
```

- [ ] **Step 4: Use Git service in the indexer**

In `apps/api/src/services/indexer-service.ts`, add:

```ts
import { readGitHeadCommit } from "./git-service.js";
```

Inside `indexProject`, after path validation and before `db.transaction`, add:

```ts
      const gitCommit = await readGitHeadCommit(repoPath).catch(() => null);
```

In the successful `tx.update(indexRuns).set(...)`, add:

```ts
              gitCommit,
```

- [ ] **Step 5: Run focused indexer tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/indexer-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/git-service.ts apps/api/src/services/indexer-service.ts apps/api/src/__tests__/indexer-service.test.ts
git commit -m "feat: capture git commit during indexing"
```

## Task 3: Project Health Endpoint And Stale Task Detection

**Files:**
- Create: `apps/api/src/services/project-health-service.ts`
- Create: `apps/api/src/routes/project-health.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing route tests for no-Git and stale task cases**

Add imports to `apps/api/src/__tests__/routes.test.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
```

Add helpers near the existing test helpers:

```ts
const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}
```

In `apps/api/src/__tests__/routes.test.ts`, add two tests inside `describeWithDb("database-backed routes", ...)`:

```ts
it("returns project health for a non-git project without failing", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/health`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
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
    staleTasks: { count: 0, samples: [] },
    attentionItems: []
  });
});

it("reports stale generated tasks from tracked hash mismatches", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await pool.query(
    "insert into spec_entities (project_id, entity_id, type, title, status, file_path, frontmatter_json, body_markdown, body_text, content_hash, created_at, updated_at) values " +
      "($1, 'domain.customer', 'domain_entity', 'Customer', 'draft', 'domain/customer.md', '{}'::jsonb, '# Customer', 'Customer', 'hash-current', '2026-05-10T09:00:00Z', '2026-05-10T09:00:00Z')," +
      "($1, 'task.customer', 'agent_task', 'Customer Task', 'ready', 'agent-tasks/task.customer.md', $2::jsonb, '# Task', 'Task', 'task-hash', '2026-05-10T09:01:00Z', '2026-05-10T09:01:00Z')",
    [
      project.id,
      JSON.stringify({
        source_entity: "domain.customer",
        tracked_spec_hashes: { "domain.customer": "hash-old" },
        links: { generated_from: ["domain.customer"], uses: [] }
      })
    ]
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
          title: "Customer Task",
          sourceEntityId: "domain.customer",
          reason: "tracked_hash_mismatch"
        }
      ]
    },
    attentionItems: [
      {
        kind: "stale_agent_task",
        entityId: "task.customer"
      }
    ]
  });
});
```

- [ ] **Step 1a: Add failing route tests for Git drift and dirty files**

Add this test inside `describeWithDb("database-backed routes", ...)`:

```ts
it("reports index drift and current dirty spec and source files", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  const specFilePath = path.join(project.specopsPath, "domain", "customer.md");
  const sourceFilePath = path.join(project.repoPath, "src", "customer.ts");
  await mkdir(path.dirname(specFilePath), { recursive: true });
  await mkdir(path.dirname(sourceFilePath), { recursive: true });
  await writeFile(specFilePath, "---\nid: domain.customer\ntype: domain_entity\ntitle: Customer\nstatus: draft\n---\n\n# Customer\n");
  await writeFile(sourceFilePath, "export interface Customer {}\n");
  await git(project.repoPath, ["init"]);
  await git(project.repoPath, ["config", "user.email", "specops@example.test"]);
  await git(project.repoPath, ["config", "user.name", "SpecOps Test"]);
  await git(project.repoPath, ["add", "."]);
  await git(project.repoPath, ["commit", "-m", "initial"]);
  const firstCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: project.repoPath })).stdout.trim();
  await writeFile(path.join(project.repoPath, "README.md"), "# SpecOps\n");
  await git(project.repoPath, ["add", "README.md"]);
  await git(project.repoPath, ["commit", "-m", "second"]);
  const headCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: project.repoPath })).stdout.trim();
  await pool.query(
    "insert into index_runs (project_id, status, started_at, finished_at, git_commit) values ($1, 'succeeded', '2026-05-10T10:00:00Z', '2026-05-10T10:00:01Z', $2)",
    [project.id, firstCommit]
  );
  await writeFile(specFilePath, "---\nid: domain.customer\ntype: domain_entity\ntitle: Customer\nstatus: draft\n---\n\n# Customer changed\n");
  await writeFile(sourceFilePath, "export interface Customer { id: string }\n");
  await writeFile(path.join(project.specopsPath, "domain", "new.md"), "# New\n");

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/health`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    git: {
      isRepo: true,
      headCommit,
      indexedCommit: firstCommit,
      hasUncommittedChanges: true,
      changedSpecFiles: ["specops/domain/customer.md"],
      changedSourceFiles: ["src/customer.ts"],
      untrackedSpecFiles: ["specops/domain/new.md"]
    },
    drift: {
      indexIsBehindHead: true,
      currentSpecFileChangeCount: 2,
      currentSourceFileChangeCount: 1
    }
  });
});
```

- [ ] **Step 1b: Add failing route tests for missing source and timestamp fallback**

Add this test inside `describeWithDb("database-backed routes", ...)`:

```ts
it("reports stale generated tasks from missing sources and timestamp fallback", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await pool.query(
    "insert into spec_entities (project_id, entity_id, type, title, status, file_path, frontmatter_json, body_markdown, body_text, content_hash, created_at, updated_at) values " +
      "($1, 'domain.changed', 'domain_entity', 'Changed Domain', 'draft', 'domain/changed.md', '{}'::jsonb, '# Changed', 'Changed', 'hash-domain', '2026-05-10T09:00:00Z', '2026-05-10T10:00:00Z')," +
      "($1, 'task.old', 'agent_task', 'Old Task', 'ready', 'agent-tasks/task.old.md', $2::jsonb, '# Task', 'Task', 'task-hash', '2026-05-10T09:01:00Z', '2026-05-10T09:01:00Z')," +
      "($1, 'task.missing', 'agent_task', 'Missing Task', 'ready', 'agent-tasks/task.missing.md', $3::jsonb, '# Task', 'Task', 'task-hash-2', '2026-05-10T09:02:00Z', '2026-05-10T09:02:00Z')",
    [
      project.id,
      JSON.stringify({
        source_entity: "domain.changed",
        links: { generated_from: ["domain.changed"], uses: [] }
      }),
      JSON.stringify({
        source_entity: "domain.missing",
        links: { generated_from: ["domain.missing"], uses: [] }
      })
    ]
  );

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/health`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().staleTasks.samples).toEqual([
    expect.objectContaining({
      entityId: "task.missing",
      reason: "missing_source_entity"
    }),
    expect.objectContaining({
      entityId: "task.old",
      reason: "source_spec_changed"
    })
  ]);
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: FAIL because `/health` under projects is not registered.

- [ ] **Step 3: Implement the health service**

Create `apps/api/src/services/project-health-service.ts`:

```ts
import type { ProjectHealthDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { indexRuns, projects, specEntities } from "@specops/db";
import { and, asc, desc, eq } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import { readGitStatus, type GitStatusEntry } from "./git-service.js";

const staleReasonRank = {
  missing_source_entity: 0,
  tracked_hash_mismatch: 1,
  source_spec_changed: 2,
  context_spec_changed: 3
} as const;

export function createProjectHealthService(db: Db) {
  async function getProjectHealth(projectId: string): Promise<ProjectHealthDto> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }

    const [latestRun] = await db
      .select()
      .from(indexRuns)
      .where(and(eq(indexRuns.projectId, projectId), eq(indexRuns.status, "succeeded")))
      .orderBy(desc(indexRuns.finishedAt), desc(indexRuns.startedAt), desc(indexRuns.id))
      .limit(1);
    const git = await readGitStatus(project.repoPath, { includeEntries: true });
    const specopsPrefix = repoRelativeSpecopsPrefix(project.repoPath, project.specopsPath);
    const changedSpecFiles = classifyFiles(git.entries, specopsPrefix, false);
    const untrackedSpecFiles = classifyFiles(git.entries, specopsPrefix, true);
    const changedSourceFiles = classifySourceFiles(git.entries, specopsPrefix, false);
    const untrackedSourceFiles = classifySourceFiles(git.entries, specopsPrefix, true);
    const staleTasks = await findStaleTasks(projectId);
    const indexIsBehindHead = Boolean(
      git.isRepo &&
        git.headCommit &&
        latestRun?.gitCommit &&
        latestRun.gitCommit !== git.headCommit
    );
    const allSpecChangeCount = changedSpecFiles.length + untrackedSpecFiles.length;
    const allSourceChangeCount = changedSourceFiles.length + untrackedSourceFiles.length;

    return {
      git: {
        isRepo: git.isRepo,
        headCommit: git.headCommit,
        indexedCommit: latestRun?.gitCommit ?? null,
        hasUncommittedChanges: git.entries.length > 0,
        changedSpecFiles,
        changedSourceFiles,
        untrackedSpecFiles,
        untrackedSourceFiles
      },
      drift: {
        indexIsBehindHead,
        currentSpecFileChangeCount: allSpecChangeCount,
        currentSourceFileChangeCount: allSourceChangeCount
      },
      staleTasks: {
        count: staleTasks.length,
        samples: staleTasks.slice(0, 5)
      },
      attentionItems: buildAttentionItems({
        indexIsBehindHead,
        allSpecChangeCount,
        allSourceChangeCount,
        staleTasks
      })
    };
  }

  async function findStaleTasks(projectId: string): Promise<ProjectHealthDto["staleTasks"]["samples"]> {
    const rows = await db
      .select()
      .from(specEntities)
      .where(eq(specEntities.projectId, projectId))
      .orderBy(asc(specEntities.entityId));
    const entitiesById = new Map(rows.map((row) => [row.entityId, row]));
    const tasks = rows.filter((row) => row.type === "agent_task");
    const stale = tasks.flatMap((task) => {
      const frontmatter = task.frontmatterJson as Record<string, unknown>;
      const sourceEntityId = readSourceEntity(frontmatter);
      const linkedIds = readLinkedSpecIds(frontmatter, sourceEntityId);
      const trackedHashes = readTrackedHashes(frontmatter);

      if (sourceEntityId && !entitiesById.has(sourceEntityId)) {
        return [{
          entityId: task.entityId,
          title: task.title,
          sourceEntityId,
          reason: "missing_source_entity" as const
        }];
      }

      for (const [entityId, expectedHash] of trackedHashes) {
        const current = entitiesById.get(entityId);
        if (!current || current.contentHash !== expectedHash) {
          return [{
            entityId: task.entityId,
            title: task.title,
            sourceEntityId,
            reason: "tracked_hash_mismatch" as const
          }];
        }
      }

      if (trackedHashes.length === 0) {
        for (const entityId of linkedIds) {
          const current = entitiesById.get(entityId);
          if (!current || current.updatedAt <= task.updatedAt) {
            continue;
          }
          return [{
            entityId: task.entityId,
            title: task.title,
            sourceEntityId,
            reason: entityId === sourceEntityId ? "source_spec_changed" as const : "context_spec_changed" as const
          }];
        }
      }

      return [];
    });

    return stale.sort((left, right) => {
      const rankDiff = staleReasonRank[left.reason] - staleReasonRank[right.reason];
      return rankDiff === 0 ? left.entityId.localeCompare(right.entityId) : rankDiff;
    });
  }

  return { getProjectHealth };
}

function repoRelativeSpecopsPrefix(repoPath: string, specopsPath: string): string {
  const normalizedRepo = repoPath.replace(/\/+$/, "");
  const normalizedSpecops = specopsPath.replace(/\/+$/, "");
  const relative = normalizedSpecops.startsWith(`${normalizedRepo}/`)
    ? normalizedSpecops.slice(normalizedRepo.length + 1)
    : "specops";
  return relative.length > 0 ? `${relative}/` : "";
}

function classifyFiles(entries: GitStatusEntry[], specopsPrefix: string, untracked: boolean): string[] {
  return entries
    .filter((entry) => entry.untracked === untracked && entry.path.startsWith(specopsPrefix))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
}

function classifySourceFiles(entries: GitStatusEntry[], specopsPrefix: string, untracked: boolean): string[] {
  return entries
    .filter((entry) => entry.untracked === untracked && !entry.path.startsWith(specopsPrefix))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
}

function readSourceEntity(frontmatter: Record<string, unknown>): string | null {
  return typeof frontmatter.source_entity === "string" ? frontmatter.source_entity : null;
}

function readLinkedSpecIds(frontmatter: Record<string, unknown>, sourceEntityId: string | null): string[] {
  const links = isRecord(frontmatter.links) ? frontmatter.links : {};
  const generatedFrom = readStringArray(links.generated_from);
  const uses = readStringArray(links.uses);
  return [...new Set([sourceEntityId, ...generatedFrom, ...uses].filter((value): value is string => Boolean(value)))];
}

function readTrackedHashes(frontmatter: Record<string, unknown>): Array<[string, string]> {
  if (!isRecord(frontmatter.tracked_spec_hashes)) {
    return [];
  }
  return Object.entries(frontmatter.tracked_spec_hashes)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function buildAttentionItems(input: {
  indexIsBehindHead: boolean;
  allSpecChangeCount: number;
  allSourceChangeCount: number;
  staleTasks: ProjectHealthDto["staleTasks"]["samples"];
}): ProjectHealthDto["attentionItems"] {
  const items: ProjectHealthDto["attentionItems"] = [];
  if (input.indexIsBehindHead) {
    items.push({ kind: "index_behind_head", label: "Index is behind current Git HEAD.", entityId: null, filePath: null });
  }
  if (input.allSpecChangeCount > 0) {
    items.push({ kind: "changed_spec_files", label: `${input.allSpecChangeCount} spec files have unindexed Git changes.`, entityId: null, filePath: null });
  }
  if (input.allSourceChangeCount > 0) {
    items.push({ kind: "changed_source_files", label: `${input.allSourceChangeCount} source files have Git changes.`, entityId: null, filePath: null });
  }
  for (const task of input.staleTasks.slice(0, 5)) {
    items.push({
      kind: task.reason === "missing_source_entity" ? "missing_task_source" : "stale_agent_task",
      label: `${task.title} may be stale: ${task.reason.replaceAll("_", " ")}.`,
      entityId: task.entityId,
      filePath: null
    });
  }
  return items.slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Add and register the route**

Create `apps/api/src/routes/project-health.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { Db } from "@specops/db";

import { createProjectHealthService } from "../services/project-health-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerProjectHealthRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectHealthService = createProjectHealthService(db);

  app.get("/projects/:projectId/health", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return projectHealthService.getProjectHealth(projectId);
  });
};
```

In `apps/api/src/server.ts`, add:

```ts
import { registerProjectHealthRoutes } from "./routes/project-health.js";
```

and register it:

```ts
  app.register(registerProjectHealthRoutes, { prefix: "/api", db });
```

- [ ] **Step 5: Run route tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/project-health-service.ts apps/api/src/routes/project-health.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add project health endpoint"
```

## Task 4: Frontend Health Query And Dashboard Panel

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/routes/project-detail.tsx`
- Modify: `apps/web/src/components/project-overview-dashboard.tsx`
- Modify: `apps/web/src/components/project-overview-dashboard.test.tsx`

- [ ] **Step 1: Write failing dashboard component tests**

In `apps/web/src/components/project-overview-dashboard.test.tsx`, add `ProjectHealthDto` to the type import:

```ts
import type { ProjectHealthDto, ProjectOverviewDto } from "@specops/contracts";
```

Change the existing render call to pass health props:

```tsx
<ProjectOverviewDashboard
  projectId="project-1"
  overview={overview}
  health={health}
  healthError={null}
  isHealthLoading={false}
/>
```

Add assertions to the populated test:

```ts
expect(html).toContain("Git & Drift");
expect(html).toContain("abc1234");
expect(html).toContain("def5678");
expect(html).toContain("Index behind HEAD");
expect(html).toContain("1 stale task");
expect(html).toContain("Customer Task may be stale");
```

Add this test:

```ts
it("keeps overview visible when health fails", () => {
  const html = renderToStaticMarkup(
    <ProjectOverviewDashboard
      projectId="project-1"
      overview={overview}
      health={undefined}
      healthError={new Error("Git failed")}
      isHealthLoading={false}
    />
  );

  expect(html).toContain("Project Health");
  expect(html).toContain("Git health unavailable");
  expect(html).toContain("Git failed");
});
```

Add this fixture near the existing `overview` fixture:

```ts
const health: ProjectHealthDto = {
  git: {
    isRepo: true,
    headCommit: "abc123456789",
    indexedCommit: "def567812345",
    hasUncommittedChanges: true,
    changedSpecFiles: ["specops/domain/customer.md"],
    changedSourceFiles: ["src/customer.ts"],
    untrackedSpecFiles: [],
    untrackedSourceFiles: []
  },
  drift: {
    indexIsBehindHead: true,
    currentSpecFileChangeCount: 1,
    currentSourceFileChangeCount: 1
  },
  staleTasks: {
    count: 1,
    samples: [
      {
        entityId: "task.customer",
        title: "Customer Task",
        sourceEntityId: "domain.customer",
        reason: "tracked_hash_mismatch"
      }
    ]
  },
  attentionItems: [
    {
      kind: "index_behind_head",
      label: "Index is behind current Git HEAD.",
      entityId: null,
      filePath: null
    },
    {
      kind: "stale_agent_task",
      label: "Customer Task may be stale: tracked hash mismatch.",
      entityId: "task.customer",
      filePath: null
    }
  ]
};
```

- [ ] **Step 2: Run frontend test to verify failure**

Run:

```bash
pnpm --filter web test -- src/components/project-overview-dashboard.test.tsx
```

Expected: FAIL because the dashboard props and Git panel are missing.

- [ ] **Step 3: Add the query**

In `apps/web/src/api/queries.ts`, import `ProjectHealthDto`, add a key, and add a query function:

```ts
  ProjectHealthDto,
```

```ts
  projectHealth: (projectId: string) => ["projects", projectId, "health"] as const,
```

```ts
export function projectHealthQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectHealth(projectId),
    queryFn: () =>
      apiGet<ProjectHealthDto>(`/api/projects/${encodeURIComponent(projectId)}/health`)
  });
}
```

- [ ] **Step 4: Load health in the project route**

In `apps/web/src/routes/project-detail.tsx`, import `projectHealthQuery`:

```ts
  projectHealthQuery,
```

Add the query next to `overview`:

```ts
  const health = useQuery({
    ...projectHealthQuery(projectId),
    enabled: entityId === null && !hasActiveQuery
  });
```

Add health invalidation in `invalidateProject`:

```ts
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
```

Pass health state into the dashboard:

```tsx
        <ProjectOverviewDashboard
          projectId={projectId}
          overview={overview.data}
          health={health.data}
          healthError={health.error}
          isHealthLoading={health.isLoading}
        />
```

- [ ] **Step 5: Add dashboard props and Git panel**

In `apps/web/src/components/project-overview-dashboard.tsx`, import `ProjectHealthDto` and `GitBranch`:

```ts
import type { ProjectHealthDto, ProjectOverviewDto } from "@specops/contracts";
```

```ts
  GitBranch,
```

Change props:

```ts
type ProjectOverviewDashboardProps = {
  projectId: string;
  overview: ProjectOverviewDto;
  health?: ProjectHealthDto;
  healthError?: Error | null;
  isHealthLoading?: boolean;
};
```

Change function signature:

```ts
export function ProjectOverviewDashboard({
  projectId,
  overview,
  health,
  healthError = null,
  isHealthLoading = false
}: ProjectOverviewDashboardProps) {
```

Add this panel beside Latest Index by changing the top grid to three columns on wide screens:

```tsx
      <section className="grid gap-3 xl:grid-cols-[1.3fr_1fr_1fr]">
```

After the Latest Index panel, add:

```tsx
        <Panel title="Git & Drift" icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}>
          <GitDriftPanel
            projectId={projectId}
            health={health}
            error={healthError}
            isLoading={isHealthLoading}
          />
        </Panel>
```

Add this helper component near the other helper components:

```tsx
function GitDriftPanel({
  projectId,
  health,
  error,
  isLoading
}: {
  projectId: string;
  health?: ProjectHealthDto;
  error: Error | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <EmptyState title="Loading Git health" body="Checking local repository state." />;
  }

  if (error) {
    return <EmptyState title="Git health unavailable" body={error.message} />;
  }

  if (!health) {
    return <EmptyState title="Git health unavailable" body="Health data has not loaded." />;
  }

  if (!health.git.isRepo) {
    return <EmptyState title="Git unavailable" body="This project path is not inside a Git repository." />;
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 text-sm text-slate-700">
        <StatusRow label="HEAD" value={shortCommit(health.git.headCommit)} />
        <StatusRow label="Indexed" value={shortCommit(health.git.indexedCommit)} />
        <StatusRow
          label="State"
          value={health.drift.indexIsBehindHead ? "Index behind HEAD" : "Index matches HEAD"}
        />
      </dl>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
        <Metric label="Spec changes" value={health.drift.currentSpecFileChangeCount} />
        <Metric label="Source changes" value={health.drift.currentSourceFileChangeCount} />
        <Metric label="Stale tasks" value={health.staleTasks.count} tone={health.staleTasks.count > 0 ? "warning" : "neutral"} />
      </div>
      <LinkedHealthItems projectId={projectId} items={health.attentionItems} />
    </div>
  );
}
```

Add linked health items and short commit helpers:

```tsx
function LinkedHealthItems({
  projectId,
  items
}: {
  projectId: string;
  items: ProjectHealthDto["attentionItems"];
}) {
  if (items.length === 0) {
    return <div className="text-xs text-slate-500">No Git drift attention items.</div>;
  }

  return (
    <ul className="divide-y divide-slate-200">
      {items.slice(0, 5).map((item, index) => (
        <li key={`${item.kind}-${item.entityId ?? item.filePath ?? index}`} className="py-2">
          {item.entityId ? (
            <Link
              to="/projects/$projectId/entities/$entityId"
              params={{ projectId, entityId: item.entityId }}
              search={{ q: undefined }}
              className="block min-w-0 text-xs text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline"
            >
              <span className="block truncate font-medium">{healthKindLabel(item.kind)}</span>
              <span className="mt-0.5 block truncate text-slate-500">{item.label}</span>
            </Link>
          ) : (
            <div className="min-w-0 text-xs text-slate-700">
              <span className="block truncate font-medium">{healthKindLabel(item.kind)}</span>
              <span className="mt-0.5 block truncate text-slate-500">{item.label}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function healthKindLabel(kind: ProjectHealthDto["attentionItems"][number]["kind"]) {
  if (kind === "index_behind_head") return "Index drift";
  if (kind === "changed_spec_files") return "Spec changes";
  if (kind === "changed_source_files") return "Source changes";
  if (kind === "missing_task_source") return "Missing task source";
  return "Stale task";
}

function shortCommit(value: string | null) {
  return value ? value.slice(0, 7) : "Unavailable";
}
```

- [ ] **Step 6: Update project detail route test wiring**

In `apps/web/src/routes/project-detail.test.tsx`, add health state to `mocks`:

```ts
  healthQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
  healthState: {
    data: null,
    error: null,
    isLoading: false
  } as { data: unknown; error: Error | null; isLoading: boolean },
```

Add `projectHealthQuery` to the `../api/queries.js` mock:

```ts
  projectHealthQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "health"],
    queryType: "health"
  })),
```

Add `projectHealth` to mocked `queryKeys`:

```ts
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
```

Update mocked `useQuery`:

```ts
    if (options.queryType === "health") {
      mocks.healthQueryOptions.push(options);
      return mocks.healthState;
    }
```

Reset health state in `beforeEach`:

```ts
    mocks.healthQueryOptions = [];
    mocks.healthState = {
      data: null,
      error: null,
      isLoading: false
    };
```

Change the mocked `ProjectOverviewDashboard` to prove health props are passed:

```tsx
vi.mock("../components/project-overview-dashboard.js", () => ({
  ProjectOverviewDashboard: ({
    projectId,
    healthError
  }: {
    projectId: string;
    healthError?: Error | null;
  }) => (
    <div>
      Project overview dashboard: {projectId}
      {healthError ? ` health error: ${healthError.message}` : ""}
    </div>
  )
}));
```

Add route tests:

```ts
it("enables the project health query only for the overview route", () => {
  renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);
  renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId="entity-1" query="" />);

  expect(mocks.healthQueryOptions).toEqual([
    expect.objectContaining({
      enabled: true,
      queryKey: ["projects", "project-1", "health"]
    }),
    expect.objectContaining({
      enabled: false,
      queryKey: ["projects", "project-1", "health"]
    })
  ]);
});

it("invalidates project health after project actions succeed", () => {
  renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);

  mocks.projectActionsProps?.onBootstrap();

  expect(mocks.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["projects", "project-1", "health"]
  });
});
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
pnpm --filter web test -- src/components/project-overview-dashboard.test.tsx src/routes/project-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api/queries.ts apps/web/src/routes/project-detail.tsx apps/web/src/components/project-overview-dashboard.tsx apps/web/src/components/project-overview-dashboard.test.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "feat: show project git health"
```

## Task 5: Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS. DB-backed tests require:

```bash
export TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test
```

- [ ] **Step 3: Run web build**

Run:

```bash
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 4: Review final diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree after task commits, with recent commits for task hashes, Git indexing, health endpoint, and dashboard UI.
