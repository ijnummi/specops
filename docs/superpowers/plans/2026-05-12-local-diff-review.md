# Local Diff Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Git diff review workflow that maps working tree, staged, and ref-range changes to affected specs, related tasks, deterministic findings, and review status.

**Architecture:** Add a `diff_reviews` workflow beside `agent_runs`, backed by a new database table and shared review-summary helpers extracted from the current agent run service. The API creates page-ready review summaries from local Git file lists, and the web UI mirrors the existing agent run list/detail pattern with diff-specific create controls.

**Tech Stack:** TypeScript, Fastify, Zod, Drizzle/PostgreSQL, Vitest, React, TanStack Router, TanStack Query, Tailwind CSS.

---

## File Structure

- Create: `packages/contracts/src/diff-reviews.ts`
  - Owns Zod schemas and DTO types for diff review requests, summaries, findings, and responses.
- Modify: `packages/contracts/src/index.ts`
  - Exports diff review contracts.
- Modify: `packages/db/src/schema.ts`
  - Adds `diffReviews` Drizzle table.
- Modify: `packages/db/migrations/0000_initial.sql`
  - Adds idempotent table and indexes for `diff_reviews`.
- Modify: `packages/db/src/migrations.test.ts`
  - Verifies migration creates diff review storage.
- Modify: `apps/api/src/services/git-service.ts`
  - Adds local diff helpers for working tree, staged changes, ref resolution, and ref-range changed files.
- Create: `apps/api/src/services/review-summary-service.ts`
  - Shared deterministic review summary logic used by agent runs and diff reviews.
- Modify: `apps/api/src/services/agent-run-service.ts`
  - Uses shared review summary helpers while keeping task-specific run findings.
- Create: `apps/api/src/services/diff-review-service.ts`
  - Creates, lists, reads, and updates diff reviews.
- Create: `apps/api/src/routes/diff-reviews.ts`
  - Registers diff review API routes.
- Modify: `apps/api/src/server.ts`
  - Registers diff review routes.
- Modify: `apps/api/src/__tests__/routes.test.ts`
  - Adds DB-backed API/service tests for diff reviews and verifies agent runs still work.
- Modify: `apps/web/src/api/queries.ts`
  - Adds diff review query keys, queries, and mutations.
- Create: `apps/web/src/routes/diff-reviews.tsx`
  - Diff review list and create form.
- Create: `apps/web/src/routes/diff-review-detail.tsx`
  - Diff review detail page.
- Create: `apps/web/src/routes/diff-reviews.test.tsx`
  - Route rendering and interaction tests.
- Modify: `apps/web/src/app.tsx`
  - Adds diff review routes.
- Modify: `apps/web/src/components/project-actions.tsx`
  - Adds a `Diff Reviews` navigation link near existing project workflow links.

---

### Task 1: Contracts and Database Storage

**Files:**
- Create: `packages/contracts/src/diff-reviews.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`

- [ ] **Step 1: Add failing contract tests inline by creating the contract module**

Create `packages/contracts/src/diff-reviews.ts` with the schemas and types below:

```ts
import { z } from "zod";

export const diffReviewStatusSchema = z.enum([
  "ready_for_review",
  "accepted",
  "needs_followup",
  "superseded"
]);

export const diffReviewUpdateStatusSchema = z.enum([
  "accepted",
  "needs_followup",
  "superseded"
]);

export const diffReviewTypeSchema = z.enum(["working_tree", "staged", "ref_range"]);

export const diffReviewFindingSeveritySchema = z.enum([
  "blocker",
  "review",
  "context",
  "info"
]);

export const diffReviewFindingKindSchema = z.enum([
  "source_changed_without_spec",
  "unlinked_source_changed",
  "possible_missing_test_change",
  "changed_spec_has_no_task",
  "related_task_may_be_stale",
  "validation_warning",
  "readiness_warning",
  "git_comparison_unavailable"
]);

export const diffReviewChangedFilesSchema = z.object({
  specs: z.array(z.string()),
  source: z.array(z.string()),
  tests: z.array(z.string()),
  other: z.array(z.string())
});

export const diffReviewAffectedSpecSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  filePath: z.string().min(1),
  reason: z.enum(["changed_spec", "linked_source"])
});

export const diffReviewRelatedTaskSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1),
  reason: z.enum(["generated_from", "uses", "changed_task"])
});

export const diffReviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: diffReviewFindingSeveritySchema,
  kind: diffReviewFindingKindSchema,
  message: z.string().min(1),
  suggestedFollowUp: z.string().min(1),
  entityId: z.string().min(1).nullable(),
  filePath: z.string().min(1).nullable()
});

export const diffReviewSummarySchema = z.object({
  changedFiles: diffReviewChangedFilesSchema,
  affectedSpecs: z.array(diffReviewAffectedSpecSchema),
  relatedTasks: z.array(diffReviewRelatedTaskSchema),
  findings: z.array(diffReviewFindingSchema),
  suggestedValidationCommands: z.array(z.string().min(1))
});

export const createDiffReviewRequestSchema = z.discriminatedUnion("reviewType", [
  z.object({ reviewType: z.literal("working_tree") }),
  z.object({ reviewType: z.literal("staged") }),
  z.object({
    reviewType: z.literal("ref_range"),
    baseRef: z.string().min(1),
    headRef: z.string().min(1)
  })
]);

export const updateDiffReviewStatusRequestSchema = z.object({
  status: diffReviewUpdateStatusSchema
});

export const diffReviewSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: diffReviewStatusSchema,
  reviewType: diffReviewTypeSchema,
  baseRef: z.string().nullable(),
  headRef: z.string().nullable(),
  baseCommit: z.string().nullable(),
  headCommit: z.string().nullable(),
  changedFileCount: z.number().int().nonnegative(),
  findingCounts: z.object({
    blocker: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    context: z.number().int().nonnegative(),
    info: z.number().int().nonnegative()
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const diffReviewDetailResponseSchema = diffReviewSummaryResponseSchema.extend({
  changedFiles: diffReviewChangedFilesSchema,
  reviewSummary: diffReviewSummarySchema
});

export const createDiffReviewResponseSchema = diffReviewDetailResponseSchema;
export const updateDiffReviewStatusResponseSchema = diffReviewDetailResponseSchema;

export type DiffReviewStatus = z.infer<typeof diffReviewStatusSchema>;
export type DiffReviewType = z.infer<typeof diffReviewTypeSchema>;
export type DiffReviewFindingSeverity = z.infer<typeof diffReviewFindingSeveritySchema>;
export type DiffReviewFindingKind = z.infer<typeof diffReviewFindingKindSchema>;
export type DiffReviewChangedFiles = z.infer<typeof diffReviewChangedFilesSchema>;
export type DiffReviewAffectedSpec = z.infer<typeof diffReviewAffectedSpecSchema>;
export type DiffReviewRelatedTask = z.infer<typeof diffReviewRelatedTaskSchema>;
export type DiffReviewFinding = z.infer<typeof diffReviewFindingSchema>;
export type DiffReviewSummary = z.infer<typeof diffReviewSummarySchema>;
export type CreateDiffReviewRequest = z.infer<typeof createDiffReviewRequestSchema>;
export type UpdateDiffReviewStatusRequest = z.infer<typeof updateDiffReviewStatusRequestSchema>;
export type DiffReviewSummaryResponse = z.infer<typeof diffReviewSummaryResponseSchema>;
export type DiffReviewDetailResponse = z.infer<typeof diffReviewDetailResponseSchema>;
export type CreateDiffReviewResponse = z.infer<typeof createDiffReviewResponseSchema>;
export type UpdateDiffReviewStatusResponse = z.infer<typeof updateDiffReviewStatusResponseSchema>;
```

- [ ] **Step 2: Export the contracts**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./agent-runs.js";
export * from "./change-impact.js";
export * from "./diff-reviews.js";
export * from "./entities.js";
export * from "./impact.js";
export * from "./indexing.js";
export * from "./proposals.js";
export * from "./projects.js";
export * from "./readiness.js";
export * from "./source.js";
export * from "./validation.js";
```

- [ ] **Step 3: Run contract typecheck**

Run:

```bash
pnpm --filter @specops/contracts typecheck
```

Expected: PASS.

- [ ] **Step 4: Add Drizzle table**

In `packages/db/src/schema.ts`, add `diffReviews` after `agentRuns`:

```ts
export const diffReviews = pgTable(
  "diff_reviews",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    reviewType: text("review_type").notNull(),
    baseRef: text("base_ref"),
    headRef: text("head_ref"),
    baseCommit: text("base_commit"),
    headCommit: text("head_commit"),
    changedFilesJson: jsonb("changed_files_json")
      .notNull()
      .default(sql`'{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb`),
    reviewSummaryJson: jsonb("review_summary_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("diff_reviews_project_id_idx").on(table.projectId),
    projectStatusIdx: index("diff_reviews_project_status_idx").on(table.projectId, table.status),
    projectCreatedAtIdx: index("diff_reviews_project_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
  }),
);
```

- [ ] **Step 5: Add SQL migration**

Append to `packages/db/migrations/0000_initial.sql`:

```sql
CREATE TABLE IF NOT EXISTS diff_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  review_type text NOT NULL,
  base_ref text,
  head_ref text,
  base_commit text,
  head_commit text,
  changed_files_json jsonb NOT NULL DEFAULT '{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb,
  review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diff_reviews_project_id_idx ON diff_reviews(project_id);
CREATE INDEX IF NOT EXISTS diff_reviews_project_status_idx ON diff_reviews(project_id, status);
CREATE INDEX IF NOT EXISTS diff_reviews_project_created_at_idx ON diff_reviews(project_id, created_at);
```

- [ ] **Step 6: Add migration test**

In `packages/db/src/migrations.test.ts`, add:

```ts
  it("creates diff review storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS diff_reviews");
    expect(migration).toContain("review_type text NOT NULL");
    expect(migration).toContain("base_ref text");
    expect(migration).toContain("head_ref text");
    expect(migration).toContain("review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("diff_reviews_project_id_idx");
    expect(migration).toContain("diff_reviews_project_status_idx");
    expect(migration).toContain("diff_reviews_project_created_at_idx");
  });
```

- [ ] **Step 7: Run DB tests and typecheck**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/diff-reviews.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add diff review contracts and storage"
```

---

### Task 2: Git Diff Helpers

**Files:**
- Modify: `apps/api/src/services/git-service.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing service-level expectations through diff review API tests**

In `apps/api/src/__tests__/routes.test.ts`, add imports near the existing service imports:

```ts
import { createDiffReviewService } from "../services/diff-review-service.js";
```

Add this test near the current agent run tests. It will fail until `createDiffReviewService` and Git helpers exist:

```ts
  it("creates working tree, staged, and ref range diff reviews from local Git", async () => {
    const db = createTestDb();
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n\n## Goal\n\nReview changes.\n\n## Acceptance Criteria\n\n- Review passes.\n"
    });
    await git(project.repoPath, ["checkout", "-b", "feature"]);
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'working-tree'; }\n"
    );

    const service = createDiffReviewService(db);
    const workingTreeReview = await service.createReview(project.id, { reviewType: "working_tree" });

    expect(workingTreeReview.status).toBe("ready_for_review");
    expect(workingTreeReview.reviewType).toBe("working_tree");
    expect(workingTreeReview.changedFiles.source).toEqual(["src/review-service.ts"]);

    await git(project.repoPath, ["add", "src/review-service.ts"]);
    const stagedReview = await service.createReview(project.id, { reviewType: "staged" });

    expect(stagedReview.reviewType).toBe("staged");
    expect(stagedReview.changedFiles.source).toEqual(["src/review-service.ts"]);

    await git(project.repoPath, ["commit", "-m", "Change review service"]);
    const refRangeReview = await service.createReview(project.id, {
      reviewType: "ref_range",
      baseRef: "main",
      headRef: "feature"
    });

    expect(refRangeReview.reviewType).toBe("ref_range");
    expect(refRangeReview.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(refRangeReview.headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(refRangeReview.changedFiles.source).toEqual(["src/review-service.ts"]);
  });
```

- [ ] **Step 2: Add Git helper functions**

In `apps/api/src/services/git-service.ts`, add:

```ts
export async function resolveGitRef(repoPath: string, ref: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", ref], { cwd: repoPath });
  const commit = stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`Invalid Git ref: ${ref}`);
  }
  return commit;
}

export async function readGitWorkingTreeChangedFiles(repoPath: string): Promise<string[]> {
  const paths = new Set<string>();

  for (const filePath of await readGitDiffNameOnly(repoPath, ["diff", "--name-only", "HEAD", "--"])) {
    paths.add(filePath);
  }
  for (const filePath of await readGitDiffNameOnly(repoPath, ["diff", "--name-only", "--cached", "--"])) {
    paths.add(filePath);
  }
  for (const entry of (await readGitStatus(repoPath)).entries) {
    paths.add(entry.path);
    if (entry.originalPath) {
      paths.add(entry.originalPath);
    }
  }

  return [...paths].filter((filePath) => filePath.length > 0).sort((left, right) => left.localeCompare(right));
}

export async function readGitStagedChangedFiles(repoPath: string): Promise<string[]> {
  return readGitDiffNameOnly(repoPath, ["diff", "--name-only", "--cached", "--"]);
}

export async function readGitRefRangeChangedFiles(
  repoPath: string,
  baseCommit: string,
  headCommit: string
): Promise<string[]> {
  return readGitDiffNameOnly(repoPath, ["diff", "--name-only", baseCommit, headCommit, "--"]);
}

async function readGitDiffNameOnly(repoPath: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoPath });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
}
```

- [ ] **Step 3: Run the focused test to confirm it still fails on missing service**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "creates working tree, staged, and ref range diff reviews"
```

Expected: FAIL because `diff-review-service.ts` does not exist.

- [ ] **Step 4: Commit Git helpers only after TypeScript passes**

Run:

```bash
pnpm --filter api typecheck
```

Expected: FAIL until Task 4 creates `diff-review-service.ts`. Do not commit this task alone if the test import has already been added. Carry the test import forward into Task 4 and commit the API slice there.

---

### Task 3: Shared Review Summary Service

**Files:**
- Create: `apps/api/src/services/review-summary-service.ts`
- Modify: `apps/api/src/services/agent-run-service.ts`

- [ ] **Step 1: Create the shared service by moving existing pure helpers**

Create `apps/api/src/services/review-summary-service.ts`:

```ts
import path from "node:path";

import type {
  AgentRunChangedFiles,
  AgentRunFinding,
  AgentRunFindingSeverity,
  AgentRunReview,
  AgentRunSummary,
  DiffReviewChangedFiles,
  DiffReviewFinding,
  DiffReviewFindingSeverity,
  DiffReviewSummary,
  ProjectReadinessQueueItemDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { sourceSpecLinks, specEntities, specLinks, validationMessages } from "@specops/db";
import { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "@specops/repo-scanner";
import { and, eq, inArray } from "drizzle-orm";

import { readValidationCommands } from "./agent-task-defaults.js";
import { createSpecReadinessService } from "./spec-readiness-service.js";

type ProjectLike = {
  id: string;
  repoPath: string;
  specopsPath: string;
};

type SpecEntityRow = typeof specEntities.$inferSelect;
type SourceSpecLinkRow = typeof sourceSpecLinks.$inferSelect;
type SpecLinkRow = typeof specLinks.$inferSelect;
type ValidationMessageRow = typeof validationMessages.$inferSelect;

type TaskContext = AgentRunReview["taskContext"];

export const EMPTY_CHANGED_FILES: AgentRunChangedFiles = {
  specs: [],
  source: [],
  tests: [],
  other: []
};

export function classifyChangedFiles(project: ProjectLike, paths: string[]): AgentRunChangedFiles {
  const specopsPrefix = toRepoRelativeSpecopsPrefix(project);
  const grouped: AgentRunChangedFiles = {
    specs: [],
    source: [],
    tests: [],
    other: []
  };

  for (const filePath of paths.map(normalizePath)) {
    if (isSpecFile(filePath, specopsPrefix)) {
      grouped.specs.push(filePath);
      continue;
    }

    if (isSupportedSourcePath(filePath) && !shouldExcludePath(filePath)) {
      const classification = classifySourceFile(filePath);
      if (classification.kind === "test") {
        grouped.tests.push(filePath);
      } else {
        grouped.source.push(filePath);
      }
      continue;
    }

    grouped.other.push(filePath);
  }

  return sortChangedFiles(grouped);
}

export function countChangedFiles(changedFiles: AgentRunChangedFiles | DiffReviewChangedFiles): number {
  return (
    changedFiles.specs.length +
    changedFiles.source.length +
    changedFiles.tests.length +
    changedFiles.other.length
  );
}

export function countFindings(
  findings: Array<AgentRunFinding | DiffReviewFinding>
): AgentRunSummary["findingCounts"] {
  const counts: AgentRunSummary["findingCounts"] = {
    blocker: 0,
    review: 0,
    context: 0,
    info: 0
  };

  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return counts;
}

export function readChangedFiles(value: unknown): AgentRunChangedFiles {
  const record = readRecord(value);
  return sortChangedFiles({
    specs: readStringArray(record.specs),
    source: readStringArray(record.source),
    tests: readStringArray(record.tests),
    other: readStringArray(record.other)
  });
}

export function sortChangedFiles(changedFiles: AgentRunChangedFiles): AgentRunChangedFiles {
  return {
    specs: [...new Set(changedFiles.specs)].sort(),
    source: [...new Set(changedFiles.source)].sort(),
    tests: [...new Set(changedFiles.tests)].sort(),
    other: [...new Set(changedFiles.other)].sort()
  };
}

export function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

export function readStringArrayInOrder(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readFrontmatterLinkIds(frontmatter: Record<string, unknown>, linkType: string): string[] {
  const links = readRecord(frontmatter.links);
  const value = links[linkType];

  if (typeof value === "string") {
    return [value];
  }

  return readStringArray(value);
}

export function readTrackedSpecHashes(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function mergeIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((item) => item.length > 0))].sort();
}

export function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

export function stripSpecopsPrefix(filePath: string, specopsPrefix: string): string {
  if (specopsPrefix === ".") {
    return filePath;
  }

  return filePath.startsWith(`${specopsPrefix}/`) ? filePath.slice(specopsPrefix.length + 1) : filePath;
}

export function toRepoRelativeSpecopsPrefix(project: ProjectLike): string {
  const relativePath = path.relative(project.repoPath, project.specopsPath);
  return normalizePath(relativePath === "" ? "." : relativePath);
}

export async function buildAgentRunReviewSummary(input: {
  db: Db;
  project: ProjectLike;
  task: SpecEntityRow;
  changedFiles: AgentRunChangedFiles;
  gitComparisonUnavailable: boolean;
}): Promise<AgentRunReview> {
  const [entities, sourceLinks, indexedLinks] = await Promise.all([
    input.db.select().from(specEntities).where(eq(specEntities.projectId, input.project.id)),
    input.changedFiles.source.length > 0
      ? input.db
          .select()
          .from(sourceSpecLinks)
          .where(
            and(
              eq(sourceSpecLinks.projectId, input.project.id),
              inArray(sourceSpecLinks.filePath, input.changedFiles.source)
            )
          )
      : Promise.resolve([]),
    input.db
      .select()
      .from(specLinks)
      .where(
        and(
          eq(specLinks.projectId, input.project.id),
          eq(specLinks.fromEntityId, input.task.entityId),
          inArray(specLinks.linkType, ["generated_from", "uses"])
        )
      )
  ]);
  const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const taskContext = deriveTaskContext(input.task, indexedLinks, entitiesById);
  const affectedSpecs = collectAffectedSpecs({
    project: input.project,
    changedFiles: input.changedFiles,
    entitiesById,
    sourceLinks,
    taskContext
  });
  const common = await loadCommonReviewInputs(input.db, input.project, affectedSpecs.map((spec) => spec.entityId));

  return {
    changedFiles: input.changedFiles,
    affectedSpecs,
    taskContext,
    findings: collectAgentRunFindings({
      project: input.project,
      task: input.task,
      changedFiles: input.changedFiles,
      sourceLinks,
      taskContext,
      affectedSpecs,
      validationMessages: common.validationMessages,
      readinessByEntityId: common.readinessByEntityId,
      gitComparisonUnavailable: input.gitComparisonUnavailable
    }),
    suggestedValidationCommands: common.suggestedValidationCommands
  };
}
```

After the pasted code, move these existing helper implementations from `agent-run-service.ts` into this file without changing their behavior:

- `collectAffectedSpecs`
- `collectFindings`, renamed to `collectAgentRunFindings`
- `deriveTaskContext`
- `isSpecFile`
- `isUnderSpecopsPath`
- `reasonRankFor`

Add this shared loader below those moved helpers:

```ts
async function loadCommonReviewInputs(
  db: Db,
  project: ProjectLike,
  affectedEntityIds: string[]
): Promise<{
  validationMessages: ValidationMessageRow[];
  readinessByEntityId: Map<string, ProjectReadinessQueueItemDto>;
  suggestedValidationCommands: string[];
}> {
  const readinessService = createSpecReadinessService(db);
  const [affectedValidationMessages, affectedReadiness, suggestedValidationCommands] =
    await Promise.all([
      affectedEntityIds.length > 0
        ? db
            .select()
            .from(validationMessages)
            .where(
              and(
                eq(validationMessages.projectId, project.id),
                inArray(validationMessages.entityId, affectedEntityIds)
              )
            )
        : Promise.resolve([]),
      readinessService.getProjectReadiness(project.id),
      readValidationCommands(project)
    ]);

  return {
    validationMessages: affectedValidationMessages,
    readinessByEntityId: new Map(
      affectedReadiness.queue.map((readiness) => [readiness.entityId, readiness])
    ),
    suggestedValidationCommands
  };
}
```

Use the exact current logic from `agent-run-service.ts` for agent-run findings so existing tests keep their current behavior.

- [ ] **Step 2: Update agent run service imports**

In `apps/api/src/services/agent-run-service.ts`, remove local helper copies that now live in `review-summary-service.ts`, and import:

```ts
import {
  buildAgentRunReviewSummary,
  classifyChangedFiles,
  countChangedFiles,
  countFindings,
  EMPTY_CHANGED_FILES,
  normalizePath,
  readChangedFiles,
  readFrontmatterLinkIds,
  readRecord,
  readString,
  readStringArray,
  readStringArrayInOrder,
  readTrackedSpecHashes,
  sortChangedFiles
} from "./review-summary-service.js";
```

Replace the body of `buildReviewSummary` with:

```ts
  async function buildReviewSummary(input: {
    project: ProjectRow;
    task: SpecEntityRow;
    changedFiles: AgentRunChangedFiles;
    gitComparisonUnavailable: boolean;
  }): Promise<AgentRunReview> {
    return buildAgentRunReviewSummary({
      db,
      project: input.project,
      task: input.task,
      changedFiles: input.changedFiles,
      gitComparisonUnavailable: input.gitComparisonUnavailable
    });
  }
```

- [ ] **Step 3: Run existing agent run tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "agent run"
```

Expected: PASS.

- [ ] **Step 4: Commit the refactor**

```bash
git add apps/api/src/services/review-summary-service.ts apps/api/src/services/agent-run-service.ts
git commit -m "refactor: share review summary helpers"
```

---

### Task 4: Diff Review API Service and Routes

**Files:**
- Modify: `apps/api/src/services/review-summary-service.ts`
- Create: `apps/api/src/services/diff-review-service.ts`
- Create: `apps/api/src/routes/diff-reviews.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add API route tests**

In `apps/api/src/__tests__/routes.test.ts`, add:

```ts
  it("creates, lists, reads, and updates a diff review through the API", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n\n## Goal\n\nReview changes.\n\n## Acceptance Criteria\n\n- Review passes.\n"
    });
    await writeFile(
      path.join(project.repoPath, "src", "review-service.ts"),
      "export function reviewService() { return 'api-review'; }\n"
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
      changedFiles: { source: string[] };
      reviewSummary: {
        affectedSpecs: Array<{ entityId: string; reason: string }>;
        relatedTasks: Array<{ entityId: string; reason: string }>;
        findings: Array<{ kind: string }>;
      };
    };

    expect(createResponse.statusCode).toBe(201);
    expect(created.status).toBe("ready_for_review");
    expect(created.reviewType).toBe("working_tree");
    expect(created.changedFiles.source).toEqual(["src/review-service.ts"]);
    expect(created.reviewSummary.affectedSpecs).toContainEqual(
      expect.objectContaining({ entityId: "uc.review", reason: "linked_source" })
    );
    expect(created.reviewSummary.relatedTasks).toContainEqual(
      expect.objectContaining({ entityId: "task.review", reason: "generated_from" })
    );
    expect(created.reviewSummary.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["source_changed_without_spec", "possible_missing_test_change"])
    );

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/diff-reviews`
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({ id: created.id, status: "ready_for_review" })
    ]);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/diff-reviews/${created.id}`
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: created.id, reviewType: "working_tree" });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/diff-reviews/${created.id}`,
      payload: { status: "needs_followup" }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({ id: created.id, status: "needs_followup" });
  });
```

Also add:

```ts
  it("rejects invalid diff review ref ranges", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createLinkedReviewProject(db, {
      useCaseBody: "# Review Loop\n\n## Goal\n\nReview changes.\n"
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/diff-reviews`,
      payload: { reviewType: "ref_range", baseRef: "missing-base", headRef: "HEAD" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("Invalid Git ref");
  });
```

- [ ] **Step 2: Extend review summary service for diff reviews**

In `apps/api/src/services/review-summary-service.ts`, add:

```ts
export async function buildDiffReviewSummary(input: {
  db: Db;
  project: ProjectLike;
  changedFiles: DiffReviewChangedFiles;
  gitComparisonUnavailable: boolean;
}): Promise<DiffReviewSummary> {
  const [entities, sourceLinks, allTaskLinks] = await Promise.all([
    input.db.select().from(specEntities).where(eq(specEntities.projectId, input.project.id)),
    input.changedFiles.source.length > 0
      ? input.db
          .select()
          .from(sourceSpecLinks)
          .where(
            and(
              eq(sourceSpecLinks.projectId, input.project.id),
              inArray(sourceSpecLinks.filePath, input.changedFiles.source)
            )
          )
      : Promise.resolve([]),
    input.db
      .select()
      .from(specLinks)
      .where(
        and(
          eq(specLinks.projectId, input.project.id),
          inArray(specLinks.linkType, ["generated_from", "uses"])
        )
      )
  ]);
  const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const affectedSpecs = collectDiffAffectedSpecs(input.project, input.changedFiles, entitiesById, sourceLinks);
  const relatedTasks = collectRelatedTasks({
    project: input.project,
    changedFiles: input.changedFiles,
    entities,
    affectedSpecs,
    allTaskLinks
  });
  const common = await loadCommonReviewInputs(input.db, input.project, affectedSpecs.map((spec) => spec.entityId));

  return {
    changedFiles: input.changedFiles,
    affectedSpecs,
    relatedTasks,
    findings: collectDiffReviewFindings({
      changedFiles: input.changedFiles,
      sourceLinks,
      affectedSpecs,
      relatedTasks,
      validationMessages: common.validationMessages,
      readinessByEntityId: common.readinessByEntityId,
      gitComparisonUnavailable: input.gitComparisonUnavailable
    }),
    suggestedValidationCommands: common.suggestedValidationCommands
  };
}
```

Add helper functions in the same file:

```ts
function collectDiffAffectedSpecs(
  project: ProjectLike,
  changedFiles: DiffReviewChangedFiles,
  entitiesById: Map<string, SpecEntityRow>,
  sourceLinks: SourceSpecLinkRow[]
): DiffReviewSummary["affectedSpecs"] {
  const affected = new Map<string, DiffReviewSummary["affectedSpecs"][number]>();
  const specopsPrefix = toRepoRelativeSpecopsPrefix(project);
  const add = (entityId: string, reason: "changed_spec" | "linked_source") => {
    const entity = entitiesById.get(entityId);
    if (!entity || affected.has(entityId)) return;
    affected.set(entityId, {
      entityId: entity.entityId,
      title: entity.title,
      type: entity.type,
      filePath: entity.filePath,
      reason
    });
  };

  for (const changedSpecFile of changedFiles.specs) {
    const entity = [...entitiesById.values()].find(
      (candidate) => candidate.filePath === stripSpecopsPrefix(changedSpecFile, specopsPrefix)
    );
    if (entity) add(entity.entityId, "changed_spec");
  }
  for (const sourceLink of sourceLinks) {
    add(sourceLink.entityId, "linked_source");
  }

  return [...affected.values()].sort((left, right) => {
    const reasonRank = (left.reason === "changed_spec" ? 0 : 1) - (right.reason === "changed_spec" ? 0 : 1);
    return reasonRank === 0 ? left.entityId.localeCompare(right.entityId) : reasonRank;
  });
}

function collectRelatedTasks(input: {
  project: ProjectLike;
  changedFiles: DiffReviewChangedFiles;
  entities: SpecEntityRow[];
  affectedSpecs: DiffReviewSummary["affectedSpecs"];
  allTaskLinks: SpecLinkRow[];
}): DiffReviewSummary["relatedTasks"] {
  const affectedIds = new Set(input.affectedSpecs.map((spec) => spec.entityId));
  const tasksById = new Map(input.entities.filter((entity) => entity.type === "agent_task").map((task) => [task.entityId, task]));
  const related = new Map<string, DiffReviewSummary["relatedTasks"][number]>();
  const specopsPrefix = toRepoRelativeSpecopsPrefix(input.project);
  const changedTaskPaths = new Set(input.changedFiles.specs.map((filePath) => stripSpecopsPrefix(filePath, specopsPrefix)));

  for (const link of input.allTaskLinks) {
    const task = tasksById.get(link.fromEntityId);
    if (!task || !affectedIds.has(link.toEntityId)) continue;
    related.set(`${task.entityId}:${link.linkType}`, {
      entityId: task.entityId,
      title: task.title,
      status: task.status,
      filePath: task.filePath,
      reason: link.linkType === "generated_from" ? "generated_from" : "uses"
    });
  }
  for (const task of tasksById.values()) {
    if (!changedTaskPaths.has(task.filePath)) continue;
    related.set(`${task.entityId}:changed_task`, {
      entityId: task.entityId,
      title: task.title,
      status: task.status,
      filePath: task.filePath,
      reason: "changed_task"
    });
  }

  return [...related.values()].sort((left, right) => left.entityId.localeCompare(right.entityId) || left.reason.localeCompare(right.reason));
}
```

Add `collectDiffReviewFindings` with these exact finding kinds and messages:

```ts
function collectDiffReviewFindings(input: {
  changedFiles: DiffReviewChangedFiles;
  sourceLinks: SourceSpecLinkRow[];
  affectedSpecs: DiffReviewSummary["affectedSpecs"];
  relatedTasks: DiffReviewSummary["relatedTasks"];
  validationMessages: ValidationMessageRow[];
  readinessByEntityId: Map<string, ProjectReadinessQueueItemDto>;
  gitComparisonUnavailable: boolean;
}): DiffReviewFinding[] {
  const findings: DiffReviewFinding[] = [];
  const addFinding = (
    kind: DiffReviewFinding["kind"],
    severity: DiffReviewFindingSeverity,
    message: string,
    suggestedFollowUp: string,
    entityId: string | null,
    filePath: string | null
  ) => {
    findings.push({
      id: `${kind}:${entityId ?? filePath ?? "project"}`,
      severity,
      kind,
      message,
      suggestedFollowUp,
      entityId,
      filePath
    });
  };

  if (input.gitComparisonUnavailable) {
    addFinding("git_comparison_unavailable", "info", "Git comparison was unavailable for this review.", "Review the project Git state and rerun the review from a valid local repository.", null, null);
  }
  if (input.changedFiles.source.length > 0 && input.sourceLinks.length > 0 && input.changedFiles.specs.length === 0) {
    addFinding("source_changed_without_spec", "review", "Source files changed without a spec file update.", "Confirm the linked specs still reflect the source changes.", null, null);
  }

  const linkedSourceFiles = new Set(input.sourceLinks.map((link) => link.filePath));
  for (const filePath of input.changedFiles.source) {
    if (!linkedSourceFiles.has(filePath)) {
      addFinding("unlinked_source_changed", "context", `Source file ${filePath} changed without an indexed spec link.`, "Add a source-to-spec annotation or verify the change manually.", null, filePath);
    }
  }
  if (input.changedFiles.source.length > 0 && input.changedFiles.tests.length === 0) {
    addFinding("possible_missing_test_change", "review", "Source files changed without a test file update.", "Confirm existing tests cover the change or add focused coverage.", null, input.changedFiles.source[0] ?? null);
  }

  const relatedTaskSpecIds = new Set(input.relatedTasks.map((task) => task.entityId));
  for (const spec of input.affectedSpecs.filter((spec) => spec.reason === "changed_spec")) {
    if (input.relatedTasks.length === 0) {
      addFinding("changed_spec_has_no_task", "review", `Changed spec ${spec.entityId} has no related agent task.`, "Create or update an agent task for the spec change if implementation work is still needed.", spec.entityId, spec.filePath);
    }
  }
  for (const task of input.relatedTasks) {
    if (!relatedTaskSpecIds.has(task.entityId)) {
      addFinding("related_task_may_be_stale", "review", `Related task ${task.entityId} may be stale for this diff.`, "Review the task context before reusing it for follow-up work.", task.entityId, task.filePath);
    }
  }
  for (const message of input.validationMessages) {
    findings.push({
      id: `validation_warning:${message.entityId ?? message.filePath ?? "project"}:${message.id}`,
      severity: message.level === "error" ? "blocker" : "review",
      kind: "validation_warning",
      message: message.message,
      suggestedFollowUp: "Resolve the affected spec validation message before accepting this review.",
      entityId: message.entityId,
      filePath: message.filePath
    });
  }
  for (const spec of input.affectedSpecs) {
    const readiness = input.readinessByEntityId.get(spec.entityId);
    if (!readiness || readiness.readiness === "ready") continue;
    addFinding("readiness_warning", readiness.readiness === "blocked" ? "blocker" : "review", `Affected spec ${spec.entityId} readiness is ${readiness.readiness}.`, "Resolve affected spec readiness checks before accepting this review.", spec.entityId, spec.filePath);
  }

  return findings.sort((left, right) => left.severity.localeCompare(right.severity) || left.kind.localeCompare(right.kind) || (left.entityId ?? "").localeCompare(right.entityId ?? "") || (left.filePath ?? "").localeCompare(right.filePath ?? "") || left.message.localeCompare(right.message));
}
```

- [ ] **Step 3: Create diff review service**

Create `apps/api/src/services/diff-review-service.ts` with:

```ts
import type {
  CreateDiffReviewRequest,
  DiffReviewChangedFiles,
  DiffReviewDetailResponse,
  DiffReviewStatus,
  DiffReviewSummary,
  DiffReviewSummaryResponse,
  UpdateDiffReviewStatusRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { diffReviews, projects } from "@specops/db";
import { and, desc, eq } from "drizzle-orm";

import { BadRequestError, NotFoundError } from "../lib/http-errors.js";
import {
  readGitRefRangeChangedFiles,
  readGitStagedChangedFiles,
  readGitStatus,
  readGitWorkingTreeChangedFiles,
  resolveGitRef
} from "./git-service.js";
import {
  buildDiffReviewSummary,
  classifyChangedFiles,
  countChangedFiles,
  countFindings,
  readChangedFiles,
  readRecord,
  sortChangedFiles
} from "./review-summary-service.js";

type ProjectRow = typeof projects.$inferSelect;
type DiffReviewRow = typeof diffReviews.$inferSelect;

const TERMINAL_STATUSES = new Set<DiffReviewStatus>(["accepted", "needs_followup", "superseded"]);

export function createDiffReviewService(db: Db) {
  async function createReview(projectId: string, input: CreateDiffReviewRequest): Promise<DiffReviewDetailResponse> {
    const project = await loadProject(projectId);
    const diff = await resolveDiff(project, input);
    const changedFiles = classifyChangedFiles(project, diff.paths);
    const reviewSummary = await buildDiffReviewSummary({
      db,
      project,
      changedFiles,
      gitComparisonUnavailable: diff.gitComparisonUnavailable
    });
    const [row] = await db
      .insert(diffReviews)
      .values({
        projectId,
        status: "ready_for_review",
        reviewType: input.reviewType,
        baseRef: input.reviewType === "ref_range" ? input.baseRef : null,
        headRef: input.reviewType === "ref_range" ? input.headRef : null,
        baseCommit: diff.baseCommit,
        headCommit: diff.headCommit,
        changedFilesJson: changedFiles,
        reviewSummaryJson: reviewSummary
      })
      .returning();

    if (!row) throw new Error("Failed to create diff review");
    return mapReviewDetail(row);
  }

  async function listReviews(projectId: string): Promise<DiffReviewSummaryResponse[]> {
    await loadProject(projectId);
    const rows = await db
      .select()
      .from(diffReviews)
      .where(eq(diffReviews.projectId, projectId))
      .orderBy(desc(diffReviews.createdAt), desc(diffReviews.id));
    return rows.map(mapReviewSummary);
  }

  async function getReview(projectId: string, reviewId: string): Promise<DiffReviewDetailResponse> {
    return mapReviewDetail(await loadReview(projectId, reviewId));
  }

  async function updateReviewStatus(
    projectId: string,
    reviewId: string,
    input: UpdateDiffReviewStatusRequest
  ): Promise<DiffReviewDetailResponse> {
    const row = await loadReview(projectId, reviewId);
    const currentStatus = row.status as DiffReviewStatus;
    if (currentStatus === input.status) return mapReviewDetail(row);
    if (TERMINAL_STATUSES.has(currentStatus)) {
      throw new BadRequestError("Diff review already has a terminal status", {
        reviewId,
        status: currentStatus,
        requestedStatus: input.status
      });
    }

    const [updated] = await db
      .update(diffReviews)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(diffReviews.projectId, projectId), eq(diffReviews.id, reviewId)))
      .returning();
    if (!updated) throw new NotFoundError("Diff review not found", { projectId, reviewId });
    return mapReviewDetail(updated);
  }

  async function loadProject(projectId: string): Promise<ProjectRow> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new NotFoundError("Project not found", { projectId });
    return project;
  }

  async function loadReview(projectId: string, reviewId: string): Promise<DiffReviewRow> {
    const [row] = await db
      .select()
      .from(diffReviews)
      .where(and(eq(diffReviews.projectId, projectId), eq(diffReviews.id, reviewId)))
      .limit(1);
    if (!row) throw new NotFoundError("Diff review not found", { projectId, reviewId });
    return row;
  }

  return { createReview, listReviews, getReview, updateReviewStatus };
}
```

Add the remaining helper functions below the service:

```ts
async function resolveDiff(
  project: ProjectRow,
  input: CreateDiffReviewRequest
): Promise<{ paths: string[]; baseCommit: string | null; headCommit: string | null; gitComparisonUnavailable: boolean }> {
  const status = await readGitStatus(project.repoPath, { includeEntries: false });
  if (!status.isRepo) {
    return { paths: [], baseCommit: null, headCommit: null, gitComparisonUnavailable: true };
  }

  try {
    if (input.reviewType === "working_tree") {
      return {
        paths: await readGitWorkingTreeChangedFiles(project.repoPath),
        baseCommit: status.headCommit,
        headCommit: status.headCommit,
        gitComparisonUnavailable: status.headCommit === null
      };
    }
    if (input.reviewType === "staged") {
      return {
        paths: await readGitStagedChangedFiles(project.repoPath),
        baseCommit: status.headCommit,
        headCommit: status.headCommit,
        gitComparisonUnavailable: status.headCommit === null
      };
    }

    const baseCommit = await resolveGitRef(project.repoPath, input.baseRef).catch((error) => {
      throw new BadRequestError("Invalid Git ref", { ref: input.baseRef, cause: error instanceof Error ? error.message : String(error) });
    });
    const headCommit = await resolveGitRef(project.repoPath, input.headRef).catch((error) => {
      throw new BadRequestError("Invalid Git ref", { ref: input.headRef, cause: error instanceof Error ? error.message : String(error) });
    });
    return {
      paths: await readGitRefRangeChangedFiles(project.repoPath, baseCommit, headCommit),
      baseCommit,
      headCommit,
      gitComparisonUnavailable: false
    };
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw error;
  }
}

function mapReviewSummary(row: DiffReviewRow): DiffReviewSummaryResponse {
  const changedFiles = readChangedFiles(row.changedFilesJson) as DiffReviewChangedFiles;
  const reviewSummary = readDiffReviewSummary(row.reviewSummaryJson, changedFiles);
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as DiffReviewStatus,
    reviewType: row.reviewType as DiffReviewSummaryResponse["reviewType"],
    baseRef: row.baseRef,
    headRef: row.headRef,
    baseCommit: row.baseCommit,
    headCommit: row.headCommit,
    changedFileCount: countChangedFiles(changedFiles),
    findingCounts: countFindings(reviewSummary.findings),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapReviewDetail(row: DiffReviewRow): DiffReviewDetailResponse {
  const changedFiles = readChangedFiles(row.changedFilesJson) as DiffReviewChangedFiles;
  return {
    ...mapReviewSummary(row),
    changedFiles,
    reviewSummary: readDiffReviewSummary(row.reviewSummaryJson, changedFiles)
  };
}

function readDiffReviewSummary(value: unknown, changedFiles: DiffReviewChangedFiles): DiffReviewSummary {
  const record = readRecord(value);
  return {
    changedFiles: readChangedFiles(record.changedFiles ?? changedFiles) as DiffReviewChangedFiles,
    affectedSpecs: Array.isArray(record.affectedSpecs) ? record.affectedSpecs : [],
    relatedTasks: Array.isArray(record.relatedTasks) ? record.relatedTasks : [],
    findings: Array.isArray(record.findings) ? record.findings : [],
    suggestedValidationCommands: Array.isArray(record.suggestedValidationCommands)
      ? record.suggestedValidationCommands.filter((item): item is string => typeof item === "string")
      : []
  };
}
```

- [ ] **Step 4: Create routes**

Create `apps/api/src/routes/diff-reviews.ts`:

```ts
import {
  createDiffReviewRequestSchema,
  updateDiffReviewStatusRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createDiffReviewService } from "../services/diff-review-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const diffReviewParamsSchema = z.object({
  projectId: z.string().min(1),
  reviewId: z.string().uuid()
});

export const registerDiffReviewRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const diffReviewService = createDiffReviewService(db);

  app.post("/projects/:projectId/diff-reviews", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = createDiffReviewRequestSchema.parse(request.body);
    const review = await diffReviewService.createReview(projectId, input);
    return reply.code(201).send(review);
  });

  app.get("/projects/:projectId/diff-reviews", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return diffReviewService.listReviews(projectId);
  });

  app.get("/projects/:projectId/diff-reviews/:reviewId", async (request) => {
    const { projectId, reviewId } = diffReviewParamsSchema.parse(request.params);
    return diffReviewService.getReview(projectId, reviewId);
  });

  app.patch("/projects/:projectId/diff-reviews/:reviewId", async (request) => {
    const { projectId, reviewId } = diffReviewParamsSchema.parse(request.params);
    const input = updateDiffReviewStatusRequestSchema.parse(request.body);
    return diffReviewService.updateReviewStatus(projectId, reviewId, input);
  });
};
```

- [ ] **Step 5: Register routes**

In `apps/api/src/server.ts`, add import:

```ts
import { registerDiffReviewRoutes } from "./routes/diff-reviews.js";
```

Register after agent runs:

```ts
  app.register(registerAgentRunRoutes, { prefix: "/api", db });
  app.register(registerDiffReviewRoutes, { prefix: "/api", db });
```

- [ ] **Step 6: Run API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "diff review"
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "agent run"
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/git-service.ts apps/api/src/services/review-summary-service.ts apps/api/src/services/diff-review-service.ts apps/api/src/routes/diff-reviews.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add local diff review api"
```

---

### Task 5: Web Queries and Routes

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/routes/diff-reviews.tsx`
- Create: `apps/web/src/routes/diff-review-detail.tsx`
- Create: `apps/web/src/routes/diff-reviews.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/project-actions.tsx`

- [ ] **Step 1: Add web tests first**

Create `apps/web/src/routes/diff-reviews.test.tsx` by copying the mock structure from `apps/web/src/routes/agent-runs.test.tsx`, replacing agent run DTOs with diff review DTOs:

```ts
// @vitest-environment happy-dom

import type { DiffReviewDetailResponse, DiffReviewSummaryResponse } from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listState: { data: null as DiffReviewSummaryResponse[] | null, error: null as Error | null, isLoading: false },
  detailState: { data: null as DiffReviewDetailResponse | null, error: null as Error | null, isLoading: false },
  mutationState: { isPending: false, mutate: vi.fn() },
  invalidateQueries: vi.fn(),
  diffReviewsQuery: vi.fn((projectId: string) => ({ queryKey: ["projects", projectId, "diff-reviews", "list"] })),
  diffReviewQuery: vi.fn((projectId: string, reviewId: string) => ({ queryKey: ["projects", projectId, "diff-reviews", reviewId] })),
  createDiffReview: vi.fn(),
  updateDiffReviewStatus: vi.fn()
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: unknown }) => ({ ...mocks.mutationState, options }),
  useQuery: (options: { queryKey: readonly unknown[] }) =>
    options.queryKey.at(-1) === "review-1" ? mocks.detailState : mocks.listState,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className, params, to }: { children: ReactNode; className?: string; params?: Record<string, string>; to: string }) => (
    <a className={className} href={to.replace("$projectId", params?.projectId ?? "").replace("$reviewId", params?.reviewId ?? "")}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn()
}));

vi.mock("../api/queries.js", () => ({
  createDiffReview: mocks.createDiffReview,
  diffReviewQuery: mocks.diffReviewQuery,
  diffReviewsQuery: mocks.diffReviewsQuery,
  queryKeys: {
    diffReview: (projectId: string, reviewId: string) => ["projects", projectId, "diff-reviews", reviewId] as const,
    diffReviewsRoot: (projectId: string) => ["projects", projectId, "diff-reviews"] as const
  },
  updateDiffReviewStatus: mocks.updateDiffReviewStatus
}));

import { DiffReviewDetailPage } from "./diff-review-detail.js";
import { DiffReviewsPage } from "./diff-reviews.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiffReviewsPage", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    for (const container of containers.splice(0)) container.remove();
  });

  it("renders create controls and review summaries", () => {
    mocks.listState = { data: [diffReviewSummary], error: null, isLoading: false };
    const html = renderToStaticMarkup(<DiffReviewsPage projectId="project-1" />);

    expect(html).toContain("Diff Reviews");
    expect(html).toContain("Working tree");
    expect(html).toContain("Staged");
    expect(html).toContain("Ref range");
    expect(html).toContain("ready for review");
    expect(html).toContain("3 changed files");
    expect(html).toContain("1 blocker");
    expect(html).toContain("/projects/project-1/diff-reviews/review-1");
  });

  it("renders ref range inputs only for ref range mode", async () => {
    mocks.listState = { data: [], error: null, isLoading: false };
    const { container } = await renderDiffReviewsPage();

    expect(container.textContent).not.toContain("Base ref");
    await changeSelect(container, "Review type", "ref_range");
    expect(container.textContent).toContain("Base ref");
    expect(container.textContent).toContain("Head ref");
  });
});

describe("DiffReviewDetailPage", () => {
  it("renders changed files, affected specs, related tasks, findings, and validation commands", () => {
    mocks.detailState = { data: diffReviewDetail, error: null, isLoading: false };
    const html = renderToStaticMarkup(<DiffReviewDetailPage projectId="project-1" reviewId="review-1" />);

    expect(html).toContain("working tree");
    expect(html).toContain("apps/api/src/checkout.ts");
    expect(html).toContain("use.checkout");
    expect(html).toContain("task.checkout");
    expect(html).toContain("Source files changed without a spec file update.");
    expect(html).toContain("pnpm test -- checkout");
  });
});
```

Append fixture objects and helper functions matching `agent-runs.test.tsx`:

```ts
const diffReviewSummary: DiffReviewSummaryResponse = {
  id: "review-1",
  projectId: "project-1",
  status: "ready_for_review",
  reviewType: "working_tree",
  baseRef: null,
  headRef: null,
  baseCommit: "abc1234567890",
  headCommit: "abc1234567890",
  changedFileCount: 3,
  findingCounts: { blocker: 1, review: 2, context: 0, info: 1 },
  createdAt: "2026-05-12T08:00:00.000Z",
  updatedAt: "2026-05-12T08:30:00.000Z"
};

const diffReviewDetail: DiffReviewDetailResponse = {
  ...diffReviewSummary,
  changedFiles: {
    specs: ["specops/use/checkout.md"],
    source: ["apps/api/src/checkout.ts"],
    tests: ["apps/api/src/checkout.test.ts"],
    other: ["pnpm-lock.yaml"]
  },
  reviewSummary: {
    changedFiles: {
      specs: ["specops/use/checkout.md"],
      source: ["apps/api/src/checkout.ts"],
      tests: ["apps/api/src/checkout.test.ts"],
      other: ["pnpm-lock.yaml"]
    },
    affectedSpecs: [{ entityId: "use.checkout", title: "Checkout flow", type: "use_case", filePath: "specops/use/checkout.md", reason: "changed_spec" }],
    relatedTasks: [{ entityId: "task.checkout", title: "Review checkout validation", status: "ready", filePath: "agent-tasks/task.checkout.md", reason: "generated_from" }],
    findings: [{
      id: "finding-1",
      severity: "blocker",
      kind: "source_changed_without_spec",
      message: "Source files changed without a spec file update.",
      suggestedFollowUp: "Update the checkout spec.",
      entityId: "use.checkout",
      filePath: "apps/api/src/checkout.ts"
    }],
    suggestedValidationCommands: ["pnpm test -- checkout", "pnpm typecheck"]
  }
};
```

- [ ] **Step 2: Run the web test to confirm it fails**

Run:

```bash
pnpm --filter web test -- diff-reviews.test.tsx
```

Expected: FAIL because the route components and query helpers do not exist.

- [ ] **Step 3: Add query helpers**

In `apps/web/src/api/queries.ts`, import the diff review types:

```ts
  CreateDiffReviewRequest,
  CreateDiffReviewResponse,
  DiffReviewDetailResponse,
  DiffReviewSummaryResponse,
  UpdateDiffReviewStatusRequest,
  UpdateDiffReviewStatusResponse,
```

Add query keys:

```ts
  diffReviewsRoot: (projectId: string) => ["projects", projectId, "diff-reviews"] as const,
  diffReviews: (projectId: string) => ["projects", projectId, "diff-reviews", "list"] as const,
  diffReview: (projectId: string, reviewId: string) =>
    ["projects", projectId, "diff-reviews", reviewId] as const,
```

Add functions near agent run functions:

```ts
export function diffReviewsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.diffReviews(projectId),
    queryFn: () =>
      apiGet<DiffReviewSummaryResponse[]>(
        `/api/projects/${encodeURIComponent(projectId)}/diff-reviews`
      )
  });
}

export function diffReviewQuery(projectId: string, reviewId: string) {
  return queryOptions({
    queryKey: queryKeys.diffReview(projectId, reviewId),
    queryFn: () =>
      apiGet<DiffReviewDetailResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/diff-reviews/${encodeURIComponent(reviewId)}`
      )
  });
}

export function createDiffReview(projectId: string, input: CreateDiffReviewRequest) {
  return apiSend<CreateDiffReviewResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/diff-reviews`,
    input
  );
}

export function updateDiffReviewStatus(
  projectId: string,
  reviewId: string,
  input: UpdateDiffReviewStatusRequest
) {
  return apiSend<UpdateDiffReviewStatusResponse>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/diff-reviews/${encodeURIComponent(reviewId)}`,
    input
  );
}
```

- [ ] **Step 4: Create `DiffReviewsPage`**

Create `apps/web/src/routes/diff-reviews.tsx` using `AgentRunsPage` as the visual pattern. Required state:

```ts
const [reviewType, setReviewType] = useState<CreateDiffReviewRequest["reviewType"]>("working_tree");
const [baseRef, setBaseRef] = useState("main");
const [headRef, setHeadRef] = useState("HEAD");
```

Create mutation:

```ts
const createMutation = useMutation({
  mutationFn: (input: CreateDiffReviewRequest) => createDiffReview(projectId, input),
  onSuccess: async (review) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.diffReviewsRoot(projectId) });
    await navigate({
      to: "/projects/$projectId/diff-reviews/$reviewId",
      params: { projectId, reviewId: review.id }
    });
  }
});
```

Render:

```tsx
<select
  aria-label="Review type"
  className="input h-9 py-1"
  value={reviewType}
  onChange={(event) => setReviewType(event.currentTarget.value as CreateDiffReviewRequest["reviewType"])}
>
  <option value="working_tree">Working tree</option>
  <option value="staged">Staged</option>
  <option value="ref_range">Ref range</option>
</select>
```

For ref range, render inputs with labels `Base ref` and `Head ref`. On submit, call:

```ts
const input: CreateDiffReviewRequest =
  reviewType === "ref_range"
    ? { reviewType, baseRef, headRef }
    : { reviewType };
createMutation.mutate(input);
```

List rows should link to:

```tsx
<Link
  to="/projects/$projectId/diff-reviews/$reviewId"
  params={{ projectId, reviewId: review.id }}
>
```

- [ ] **Step 5: Create `DiffReviewDetailPage`**

Create `apps/web/src/routes/diff-review-detail.tsx` by reusing the panel structure from `agent-run-detail.tsx`, replacing task context with related tasks.

Required imports:

```ts
import type {
  DiffReviewChangedFiles,
  DiffReviewDetailResponse,
  DiffReviewFinding,
  DiffReviewStatus,
  UpdateDiffReviewStatusRequest
} from "@specops/contracts";
```

Required actions:

```tsx
{status === "ready_for_review" ? (
  <>
    <button className="button-primary" type="button" disabled={disabled} onClick={() => onUpdateStatus("accepted")}>
      Mark accepted
    </button>
    <button className="button-secondary" type="button" disabled={disabled} onClick={() => onUpdateStatus("needs_followup")}>
      Needs follow-up
    </button>
  </>
) : null}
{!isTerminal ? (
  <button className="button-secondary" type="button" disabled={disabled} onClick={() => onUpdateStatus("superseded")}>
    Supersede
  </button>
) : null}
```

Render panels named:

- `Changed Files`
- `Findings`
- `Affected Specs`
- `Related Tasks`
- `Validation Commands`

- [ ] **Step 6: Register routes**

In `apps/web/src/app.tsx`, import:

```ts
import { DiffReviewDetailPage } from "./routes/diff-review-detail.js";
import { DiffReviewsPage } from "./routes/diff-reviews.js";
```

Add routes after `agentRunDetailRoute`:

```ts
const diffReviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/diff-reviews",
  component: () => {
    const { projectId } = diffReviewsRoute.useParams();
    return <DiffReviewsPage projectId={projectId} />;
  }
});

const diffReviewDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/diff-reviews/$reviewId",
  component: () => {
    const { projectId, reviewId } = diffReviewDetailRoute.useParams();
    return <DiffReviewDetailPage projectId={projectId} reviewId={reviewId} />;
  }
});
```

Add both to `routeTree`.

- [ ] **Step 7: Add project navigation link**

In `apps/web/src/components/project-actions.tsx`, add a `Diff Reviews` link near the existing `Agent Runs` link:

```tsx
<Link
  to="/projects/$projectId/diff-reviews"
  params={{ projectId }}
  className="button-secondary"
>
  Diff Reviews
</Link>
```

- [ ] **Step 8: Run web tests and typecheck**

Run:

```bash
pnpm --filter web test -- diff-reviews.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/api/queries.ts apps/web/src/routes/diff-reviews.tsx apps/web/src/routes/diff-review-detail.tsx apps/web/src/routes/diff-reviews.test.tsx apps/web/src/app.tsx apps/web/src/components/project-actions.tsx
git commit -m "feat: add local diff review ui"
```

---

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend verification**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "diff review|agent run"
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @specops/contracts typecheck
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 3: Run frontend verification**

Run:

```bash
pnpm --filter web test -- diff-reviews.test.tsx agent-runs.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 4: Run workspace verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: PASS. If DB-backed route tests are skipped locally because `TEST_DATABASE_URL` is absent, rerun the API command from Step 1 after exporting `TEST_DATABASE_URL`.

- [ ] **Step 5: Manual browser verification**

Start services:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open:

```text
http://127.0.0.1:5176
```

Verify:

- project actions include `Diff Reviews`,
- `/projects/:projectId/diff-reviews` renders create controls,
- working tree review creates a detail page,
- detail page shows changed files, affected specs, related tasks, findings, and commands,
- status actions update the review state,
- narrow viewport does not overlap text or controls.

- [ ] **Step 6: Commit verification fixes**

If verification required code fixes:

```bash
git add <changed-files>
git commit -m "fix: polish local diff review"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Local working tree, staged, and ref range reviews are covered in Tasks 2 and 4.
- Database storage and status lifecycle are covered in Tasks 1 and 4.
- Deterministic affected spec, source link, related task, validation, readiness, and missing-test findings are covered in Tasks 3 and 4.
- Web list, create form, detail page, status actions, and navigation are covered in Task 5.
- Focused and full verification are covered in Task 6.

Incomplete-marker scan:

- This plan has no incomplete markers, undefined acceptance steps, or unspecified error handling.

Type consistency:

- Contract names use the `DiffReview` prefix.
- API service method names use `createReview`, `listReviews`, `getReview`, and `updateReviewStatus`.
- Route params use `reviewId`.
- Web query keys use `diffReviewsRoot`, `diffReviews`, and `diffReview`.
