# Analyze Project Phase 4 Incremental Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class `Refresh analysis` workflow that detects changes since the latest successful index, re-indexes, generates AI-backed update proposals for impacted source, and applies accepted proposal updates to markdown and annotations.

**Architecture:** Add refresh-specific contracts, storage, API routes, backend services, and React views rather than overloading analyze runs. The backend reuses Git helpers, changed-file classification, indexing, source selection, AI prefill, annotations, and analyze-review markdown rendering where those existing boundaries already fit.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, Drizzle/PostgreSQL, Fastify, React, TanStack Query, TanStack Router, Vitest.

---

## File Structure

Create:

- `packages/contracts/src/refresh-runs.ts`: Zod contracts and DTO/request/response types for refresh runs, refresh proposals, review, and accept responses.
- `apps/api/src/services/refresh-run-service.ts`: refresh run lifecycle, baseline detection, run steps, impact derivation, proposal creation, and accept/apply orchestration.
- `apps/api/src/routes/refresh-runs.ts`: project-scoped refresh run routes.
- `apps/api/src/__tests__/refresh-run-service.test.ts`: DB-backed service tests for baseline, impact, proposal generation, stale annotations, and apply behavior.
- `apps/web/src/routes/refresh-run-detail.tsx`: refresh run progress page.
- `apps/web/src/routes/refresh-run-review.tsx`: refresh proposal review page.
- `apps/web/src/components/refresh-review-workspace.tsx`: grouped proposal review/apply UI.
- `apps/web/src/components/refresh-review-workspace.test.tsx`: UI tests for grouping, selection, validation messages, and apply controls.

Modify:

- `packages/contracts/src/index.ts`: export refresh run contracts.
- `packages/db/src/schema.ts`: add `refreshRuns` and `refreshProposals`.
- `packages/db/src/schema.typecheck.ts`: add select/insert type checks for refresh tables.
- `packages/db/migrations/0000_initial.sql`: add refresh tables, indexes, and active-run partial unique index.
- `packages/db/src/migrations.test.ts`: assert refresh tables and indexes exist.
- `apps/api/src/server.ts`: register refresh routes.
- `apps/api/src/services/project-health-service.ts`: keep existing Git drift fields as the overview refresh reason source.
- `apps/api/src/__tests__/routes.test.ts`: add route-level refresh tests.
- `apps/web/src/api/queries.ts`: add refresh query keys, query helpers, and mutation helpers.
- `apps/web/src/app.tsx`: register refresh detail and review routes.
- `apps/web/src/routes/project-detail.tsx`: add refresh mutation and navigation.
- `apps/web/src/components/project-actions.tsx`: add secondary refresh action.
- `apps/web/src/components/project-overview-dashboard.tsx`: show refresh reason and action near Git drift.
- `apps/web/src/routes/refresh-runs.test.tsx`: cover progress page routing/rendering.
- `apps/web/src/routes/project-detail.test.tsx`: cover refresh action enablement and navigation.

---

### Task 1: Contracts And Database Schema

**Files:**

- Create: `packages/contracts/src/refresh-runs.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`
- Test: `packages/contracts/src/refresh-runs.test.ts`

- [ ] **Step 1: Write refresh contract tests**

Create `packages/contracts/src/refresh-runs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  refreshProposalPatchRequestSchema,
  refreshReviewResponseSchema,
  refreshRunAcceptRequestSchema,
  refreshRunAcceptResponseSchema,
  refreshRunDetailSchema,
  refreshRunStartRequestSchema
} from "./refresh-runs.js";

const timestamp = "2026-05-13T10:00:00.000Z";

describe("refresh run contracts", () => {
  it("parses a refresh run detail", () => {
    const parsed = refreshRunDetailSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      status: "succeeded",
      currentStep: null,
      steps: [
        {
          name: "detect_changes",
          status: "succeeded",
          startedAt: timestamp,
          finishedAt: timestamp,
          message: null,
          counts: { changedFileCount: 2 }
        }
      ],
      baselineIndexRunId: "00000000-0000-4000-8000-000000000003",
      baselineGitCommit: "abc123",
      headGitCommit: "def456",
      indexRunId: "00000000-0000-4000-8000-000000000004",
      changedFiles: {
        specs: [".specops/use-cases/review.md"],
        source: ["apps/api/src/routes/review.ts"],
        tests: [],
        other: []
      },
      impactSummary: {
        affectedSpecs: [{ entityId: "use-case.review", reason: "linked_source" }],
        unlinkedSourceFiles: ["apps/api/src/routes/new-route.ts"],
        staleAnnotationIds: ["00000000-0000-4000-8000-000000000005"]
      },
      selection: {
        selectedSourceFileIds: ["source-file-1"],
        selectedPaths: ["apps/api/src/routes/review.ts"],
        eligibleHighSignalFileCount: 1,
        skippedHighSignalFileCount: 0,
        categories: [{ category: "entrypoints_routes", count: 1 }],
        diagnostics: []
      },
      proposalCounts: {
        draft: 2,
        accepted: 0,
        discarded: 1,
        byType: { new_spec: 1, update_spec: 1, stale_annotation: 1 }
      },
      errorMessage: null,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: timestamp
    });

    expect(parsed.status).toBe("succeeded");
    expect(parsed.changedFiles.source).toEqual(["apps/api/src/routes/review.ts"]);
  });

  it("defaults start options to AI enabled", () => {
    const parsed = refreshRunStartRequestSchema.parse({});

    expect(parsed).toEqual({
      includeAi: true,
      selectedPaths: [],
      maxAiFiles: null
    });
  });

  it("parses refresh review proposals", () => {
    const parsed = refreshReviewResponseSchema.parse({
      runId: "00000000-0000-4000-8000-000000000001",
      proposals: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          projectId: "00000000-0000-4000-8000-000000000002",
          refreshRunId: "00000000-0000-4000-8000-000000000001",
          proposalType: "update_spec",
          status: "draft",
          targetEntityId: "use-case.review",
          targetSpecFilePath: "use-cases/review.md",
          title: "Review drafts",
          summary: "Refresh source links for review drafts.",
          confidence: 0.8,
          provenance: "ai",
          sourceEvidence: [
            {
              sourceFilePath: "apps/api/src/routes/review.ts",
              symbolName: "registerReviewRoutes",
              startLine: 10,
              endLine: 40,
              relationshipType: "implements"
            }
          ],
          proposedClaims: [
            {
              text: "Review drafts are accepted through a project-scoped route.",
              kind: "fact",
              confidence: 0.8
            }
          ],
          proposedMarkdown: "## Reviewed Facts\n\n- Review drafts are accepted.\n",
          relatedAnnotationIds: [],
          validation: { state: "ready", messages: [] },
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      counts: {
        draft: 1,
        accepted: 0,
        discarded: 0,
        byType: { update_spec: 1 }
      }
    });

    expect(parsed.proposals[0]?.proposalType).toBe("update_spec");
  });

  it("validates proposal patch and accept requests", () => {
    expect(
      refreshProposalPatchRequestSchema.parse({
        title: "Updated title",
        status: "discarded"
      })
    ).toMatchObject({ title: "Updated title", status: "discarded" });

    expect(
      refreshRunAcceptRequestSchema.parse({
        proposalIds: ["00000000-0000-4000-8000-000000000010"]
      })
    ).toMatchObject({ proposalIds: ["00000000-0000-4000-8000-000000000010"] });

    expect(
      refreshRunAcceptResponseSchema.parse({
        acceptedProposalIds: ["00000000-0000-4000-8000-000000000010"],
        failures: [],
        markdownFilesWritten: ["use-cases/review.md"],
        annotationsCreated: 1,
        annotationsMarkedStale: 0,
        indexRunId: null
      })
    ).toMatchObject({ annotationsCreated: 1 });
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- refresh-runs.test.ts
```

Expected: FAIL because `packages/contracts/src/refresh-runs.ts` does not exist.

- [ ] **Step 3: Add refresh contracts**

Create `packages/contracts/src/refresh-runs.ts`:

```ts
import { z } from "zod";

import { analyzeRunSelectionSummarySchema } from "./analyze-runs.js";
import { annotationRelationshipTypeSchema, annotationProvenanceSchema } from "./annotations.js";
import { indexRunSchema } from "./indexing.js";

export const refreshRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export const refreshRunStepNameSchema = z.enum([
  "detect_changes",
  "index",
  "derive_impacts",
  "generate_update_proposals",
  "prepare_review"
]);
export const refreshRunStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "skipped",
  "failed"
]);
export const refreshProposalTypeSchema = z.enum([
  "new_spec",
  "update_spec",
  "stale_annotation",
  "stale_claim",
  "source_link_update",
  "needs_review"
]);
export const refreshProposalStatusSchema = z.enum(["draft", "accepted", "discarded"]);
export const refreshProposalClaimKindSchema = z.enum(["fact", "hypothesis"]);
export const refreshValidationStateSchema = z.enum(["blocker", "warning", "ready"]);
export const refreshValidationSeveritySchema = z.enum(["blocker", "warning"]);

export const refreshChangedFilesSchema = z.object({
  specs: z.array(z.string().min(1)),
  source: z.array(z.string().min(1)),
  tests: z.array(z.string().min(1)),
  other: z.array(z.string().min(1))
});

export const refreshAffectedSpecSchema = z.object({
  entityId: z.string().min(1),
  reason: z.enum(["changed_spec", "linked_source", "test_evidence", "stale_annotation"])
});

export const refreshImpactSummarySchema = z.object({
  affectedSpecs: z.array(refreshAffectedSpecSchema),
  unlinkedSourceFiles: z.array(z.string().min(1)),
  staleAnnotationIds: z.array(z.string().uuid())
});

export const refreshRunStepSchema = z.object({
  name: refreshRunStepNameSchema,
  status: refreshRunStepStatusSchema,
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  message: z.string().nullable(),
  counts: z.record(z.string(), z.number().min(0))
});

export const refreshProposalCountsSchema = z.object({
  draft: z.number().int().min(0),
  accepted: z.number().int().min(0),
  discarded: z.number().int().min(0),
  byType: z.record(refreshProposalTypeSchema, z.number().int().min(0)).default({})
});

export const refreshRunDetailSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: refreshRunStatusSchema,
  currentStep: refreshRunStepNameSchema.nullable(),
  steps: z.array(refreshRunStepSchema),
  baselineIndexRunId: z.string().uuid().nullable(),
  baselineGitCommit: z.string().nullable(),
  headGitCommit: z.string().nullable(),
  indexRunId: z.string().uuid().nullable(),
  changedFiles: refreshChangedFilesSchema,
  impactSummary: refreshImpactSummarySchema,
  selection: analyzeRunSelectionSummarySchema.nullable(),
  proposalCounts: refreshProposalCountsSchema,
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable()
});

export const refreshRunStartRequestSchema = z.object({
  includeAi: z.boolean().default(true),
  selectedPaths: z.array(z.string().min(1)).default([]),
  maxAiFiles: z.number().int().min(1).nullable().default(null)
});

export const refreshProposalEvidenceSchema = z
  .object({
    sourceFilePath: z.string().min(1),
    symbolName: z.string().min(1).nullable(),
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
    relationshipType: annotationRelationshipTypeSchema
  })
  .refine(
    (value) => value.startLine === null || value.endLine === null || value.endLine >= value.startLine,
    { message: "endLine must be greater than or equal to startLine", path: ["endLine"] }
  );

export const refreshProposalClaimSchema = z.object({
  text: z.string().min(1),
  kind: refreshProposalClaimKindSchema,
  confidence: z.number().min(0).max(1).nullable()
});

export const refreshValidationMessageSchema = z.object({
  severity: refreshValidationSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().min(1).nullable().default(null)
});

export const refreshValidationSummarySchema = z.object({
  state: refreshValidationStateSchema,
  messages: z.array(refreshValidationMessageSchema)
});

export const refreshProposalSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  refreshRunId: z.string().uuid(),
  proposalType: refreshProposalTypeSchema,
  status: refreshProposalStatusSchema,
  targetEntityId: z.string().min(1).nullable(),
  targetSpecFilePath: z.string().min(1).nullable(),
  title: z.string().min(1),
  summary: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  provenance: annotationProvenanceSchema,
  sourceEvidence: z.array(refreshProposalEvidenceSchema),
  proposedClaims: z.array(refreshProposalClaimSchema),
  proposedMarkdown: z.string().nullable(),
  relatedAnnotationIds: z.array(z.string().uuid()),
  validation: refreshValidationSummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const refreshReviewResponseSchema = z.object({
  runId: z.string().uuid(),
  proposals: z.array(refreshProposalSchema),
  counts: refreshProposalCountsSchema
});

export const refreshProposalPatchRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    targetEntityId: z.string().min(1).nullable().optional(),
    targetSpecFilePath: z.string().min(1).nullable().optional(),
    summary: z.string().optional(),
    proposedClaims: z.array(refreshProposalClaimSchema).optional(),
    proposedMarkdown: z.string().nullable().optional(),
    status: refreshProposalStatusSchema.extract(["draft", "discarded"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one refresh proposal field"
  });

export const refreshRunAcceptRequestSchema = z.object({
  proposalIds: z.array(z.string().uuid()).nonempty()
});

export const refreshRunAcceptFailureSchema = z.object({
  proposalId: z.string().uuid(),
  messages: z.array(refreshValidationMessageSchema)
});

export const refreshRunAcceptResponseSchema = z.object({
  acceptedProposalIds: z.array(z.string().uuid()),
  failures: z.array(refreshRunAcceptFailureSchema),
  markdownFilesWritten: z.array(z.string().min(1)),
  annotationsCreated: z.number().int().min(0),
  annotationsMarkedStale: z.number().int().min(0),
  indexRunId: indexRunSchema.shape.id.nullable()
});

export type RefreshRunStatus = z.infer<typeof refreshRunStatusSchema>;
export type RefreshRunStepName = z.infer<typeof refreshRunStepNameSchema>;
export type RefreshRunStepStatus = z.infer<typeof refreshRunStepStatusSchema>;
export type RefreshChangedFiles = z.infer<typeof refreshChangedFilesSchema>;
export type RefreshImpactSummary = z.infer<typeof refreshImpactSummarySchema>;
export type RefreshRunStepDto = z.infer<typeof refreshRunStepSchema>;
export type RefreshRunDetailDto = z.infer<typeof refreshRunDetailSchema>;
export type RefreshRunStartRequest = z.infer<typeof refreshRunStartRequestSchema>;
export type RefreshProposalType = z.infer<typeof refreshProposalTypeSchema>;
export type RefreshProposalStatus = z.infer<typeof refreshProposalStatusSchema>;
export type RefreshProposalDto = z.infer<typeof refreshProposalSchema>;
export type RefreshReviewResponse = z.infer<typeof refreshReviewResponseSchema>;
export type RefreshProposalPatchRequest = z.infer<typeof refreshProposalPatchRequestSchema>;
export type RefreshRunAcceptRequest = z.infer<typeof refreshRunAcceptRequestSchema>;
export type RefreshRunAcceptFailure = z.infer<typeof refreshRunAcceptFailureSchema>;
export type RefreshRunAcceptResponse = z.infer<typeof refreshRunAcceptResponseSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./refresh-runs.js";
```

- [ ] **Step 4: Run contract test to verify it passes**

Run:

```bash
pnpm --filter @specops/contracts test -- refresh-runs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write DB migration tests**

Append to `packages/db/src/migrations.test.ts`:

```ts
  it("creates refresh run and proposal storage", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS refresh_runs");
    expect(migration).toContain("baseline_index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL");
    expect(migration).toContain("changed_files_json jsonb NOT NULL DEFAULT '{\"specs\":[],\"source\":[],\"tests\":[],\"other\":[]}'::jsonb");
    expect(migration).toContain("impact_summary_json jsonb NOT NULL DEFAULT '{\"affectedSpecs\":[],\"unlinkedSourceFiles\":[],\"staleAnnotationIds\":[]}'::jsonb");
    expect(migration).toContain("refresh_runs_one_active_per_project_idx");
    expect(migration).toContain("WHERE status IN ('queued', 'running')");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS refresh_proposals");
    expect(migration).toContain("proposal_type text NOT NULL");
    expect(migration).toContain("source_evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("proposed_claims_json jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("related_annotation_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("refresh_proposals_project_run_idx");
    expect(migration).toContain("refresh_proposals_run_status_idx");
    expect(migration).toContain(
      "CONSTRAINT refresh_proposals_run_project_fk FOREIGN KEY (refresh_run_id, project_id) REFERENCES refresh_runs(id, project_id) ON DELETE CASCADE",
    );
  });
```

- [ ] **Step 6: Run DB migration test to verify it fails**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because refresh tables do not exist in the migration.

- [ ] **Step 7: Add Drizzle schema tables**

Modify `packages/db/src/schema.ts` after `analyzeRuns`:

```ts
export const refreshRuns = pgTable(
  "refresh_runs",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    currentStep: text("current_step"),
    stepsJson: jsonb("steps_json").notNull().default(sql`'[]'::jsonb`),
    baselineIndexRunId: uuid("baseline_index_run_id").references(() => indexRuns.id, {
      onDelete: "set null",
    }),
    baselineGitCommit: text("baseline_git_commit"),
    headGitCommit: text("head_git_commit"),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    changedFilesJson: jsonb("changed_files_json")
      .notNull()
      .default(sql`'{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb`),
    impactSummaryJson: jsonb("impact_summary_json")
      .notNull()
      .default(sql`'{"affectedSpecs":[],"unlinkedSourceFiles":[],"staleAnnotationIds":[]}'::jsonb`),
    selectionJson: jsonb("selection_json"),
    proposalIdsJson: jsonb("proposal_ids_json").notNull().default(sql`'[]'::jsonb`),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index("refresh_runs_project_id_idx").on(table.projectId),
    projectStatusIdx: index("refresh_runs_project_status_idx").on(table.projectId, table.status),
    projectCreatedAtIdx: index("refresh_runs_project_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
    baselineIndexRunIdx: index("refresh_runs_baseline_index_run_id_idx").on(table.baselineIndexRunId),
    indexRunIdx: index("refresh_runs_index_run_id_idx").on(table.indexRunId),
    idProjectUnique: unique("refresh_runs_id_project_id_unique").on(table.id, table.projectId),
    oneActivePerProjectIdx: uniqueIndex("refresh_runs_one_active_per_project_idx")
      .on(table.projectId)
      .where(sql`${table.status} in ('queued', 'running')`),
  }),
);

export const refreshProposals = pgTable(
  "refresh_proposals",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    refreshRunId: uuid("refresh_run_id")
      .notNull()
      .references(() => refreshRuns.id, { onDelete: "cascade" }),
    proposalType: text("proposal_type").notNull(),
    status: text("status").notNull(),
    targetEntityId: text("target_entity_id"),
    targetSpecFilePath: text("target_spec_file_path"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    confidence: doublePrecision("confidence"),
    provenance: text("provenance").notNull(),
    sourceEvidenceJson: jsonb("source_evidence_json").notNull().default(sql`'[]'::jsonb`),
    proposedClaimsJson: jsonb("proposed_claims_json").notNull().default(sql`'[]'::jsonb`),
    proposedMarkdown: text("proposed_markdown"),
    relatedAnnotationIdsJson: jsonb("related_annotation_ids_json").notNull().default(sql`'[]'::jsonb`),
    validationJson: jsonb("validation_json")
      .notNull()
      .default(sql`'{"state":"ready","messages":[]}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectRunIdx: index("refresh_proposals_project_run_idx").on(table.projectId, table.refreshRunId),
    runStatusIdx: index("refresh_proposals_run_status_idx").on(table.refreshRunId, table.status),
    projectTypeIdx: index("refresh_proposals_project_type_idx").on(table.projectId, table.proposalType),
    idProjectUnique: unique("refresh_proposals_id_project_id_unique").on(table.id, table.projectId),
    refreshRunProjectFk: foreignKey({
      name: "refresh_proposals_run_project_fk",
      columns: [table.refreshRunId, table.projectId],
      foreignColumns: [refreshRuns.id, refreshRuns.projectId],
    }).onDelete("cascade"),
  }),
);
```

- [ ] **Step 8: Add migration SQL**

Modify `packages/db/migrations/0000_initial.sql` with matching SQL:

```sql
CREATE TABLE IF NOT EXISTS refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  current_step text,
  steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline_index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL,
  baseline_git_commit text,
  head_git_commit text,
  index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL,
  changed_files_json jsonb NOT NULL DEFAULT '{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb,
  impact_summary_json jsonb NOT NULL DEFAULT '{"affectedSpecs":[],"unlinkedSourceFiles":[],"staleAnnotationIds":[]}'::jsonb,
  selection_json jsonb,
  proposal_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT refresh_runs_id_project_id_unique UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS refresh_runs_project_id_idx ON refresh_runs(project_id);
CREATE INDEX IF NOT EXISTS refresh_runs_project_status_idx ON refresh_runs(project_id, status);
CREATE INDEX IF NOT EXISTS refresh_runs_project_created_at_idx ON refresh_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS refresh_runs_baseline_index_run_id_idx ON refresh_runs(baseline_index_run_id);
CREATE INDEX IF NOT EXISTS refresh_runs_index_run_id_idx ON refresh_runs(index_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_runs_one_active_per_project_idx
  ON refresh_runs(project_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS refresh_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  refresh_run_id uuid NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  proposal_type text NOT NULL,
  status text NOT NULL,
  target_entity_id text,
  target_spec_file_path text,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  confidence double precision,
  provenance text NOT NULL,
  source_evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_claims_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_markdown text,
  related_annotation_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_json jsonb NOT NULL DEFAULT '{"state":"ready","messages":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refresh_proposals_id_project_id_unique UNIQUE (id, project_id),
  CONSTRAINT refresh_proposals_run_project_fk FOREIGN KEY (refresh_run_id, project_id) REFERENCES refresh_runs(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS refresh_proposals_project_run_idx ON refresh_proposals(project_id, refresh_run_id);
CREATE INDEX IF NOT EXISTS refresh_proposals_run_status_idx ON refresh_proposals(refresh_run_id, status);
CREATE INDEX IF NOT EXISTS refresh_proposals_project_type_idx ON refresh_proposals(project_id, proposal_type);
```

- [ ] **Step 9: Add schema type checks**

Modify `packages/db/src/schema.typecheck.ts`:

```ts
import type {
  refreshProposals,
  refreshRuns,
} from "./schema.js";

type RefreshRun = InferSelectModel<typeof refreshRuns>;
type NewRefreshRun = InferInsertModel<typeof refreshRuns>;
type RefreshProposal = InferSelectModel<typeof refreshProposals>;
type NewRefreshProposal = InferInsertModel<typeof refreshProposals>;

type _RefreshRunStatusIsString = Expect<Equal<RefreshRun["status"], string>>;
type _RefreshRunBaselineGitCommitIsNullable = Expect<Equal<RefreshRun["baselineGitCommit"], string | null>>;
type _NewRefreshRunChangedFilesIsOptional = Expect<
  Equal<NewRefreshRun["changedFilesJson"], unknown | undefined>
>;
type _RefreshProposalConfidenceIsNullable = Expect<
  Equal<RefreshProposal["confidence"], number | null>
>;
type _NewRefreshProposalProposedMarkdownIsOptional = Expect<
  Equal<NewRefreshProposal["proposedMarkdown"], string | null | undefined>
>;

const _refreshRun = null as unknown as RefreshRun;
void _refreshRun;

const _refreshProposal = null as unknown as RefreshProposal;
void _refreshProposal;
```

Place these additions in the existing `import type { ... } from "./schema.js";` block at the top of `packages/db/src/schema.typecheck.ts`.

- [ ] **Step 10: Run DB and contract validation**

Run:

```bash
pnpm --filter @specops/contracts test -- refresh-runs.test.ts
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: all commands PASS.

- [ ] **Step 11: Commit contracts and schema**

```bash
git add packages/contracts/src/refresh-runs.ts packages/contracts/src/refresh-runs.test.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add refresh run contracts and schema"
```

---

### Task 2: Refresh Baseline And Impact Service

**Files:**

- Create: `apps/api/src/services/refresh-run-service.ts`
- Test: `apps/api/src/__tests__/refresh-run-service.test.ts`

- [ ] **Step 1: Write baseline and impact tests**

Create `apps/api/src/__tests__/refresh-run-service.test.ts` with these initial tests, using the same DB test setup helpers used by nearby API service tests:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, indexRuns, projects, refreshRuns, sourceFiles, sourceSpecAnnotations, specEntities } from "@specops/db";

import { createRefreshRunService } from "../services/refresh-run-service.js";

const execFileAsync = promisify(execFile);

describe("refresh-run-service", () => {
  let repoPath: string;
  let specopsPath: string;
  let db: ReturnType<typeof createDb>;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), "specops-refresh-"));
    specopsPath = path.join(repoPath, ".specops");
    db = createDb(process.env.TEST_DATABASE_URL ?? "");
  });

  afterEach(async () => {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  });

  it("detects committed changes since the latest successful indexed commit plus dirty files", async () => {
    await git(repoPath, ["init"]);
    await git(repoPath, ["config", "user.email", "refresh@example.test"]);
    await git(repoPath, ["config", "user.name", "Refresh Test"]);
    await writeFile(path.join(repoPath, "service.ts"), "export const before = true;\n");
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "initial"]);
    const baseline = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath })).stdout.trim();

    const [project] = await db.insert(projects).values({
      name: "Refresh",
      slug: `refresh-${Date.now()}`,
      repoPath,
      specopsPath
    }).returning();
    await db.insert(indexRuns).values({
      projectId: project!.id,
      status: "succeeded",
      finishedAt: new Date(),
      gitCommit: baseline
    });

    await writeFile(path.join(repoPath, "service.ts"), "export const after = true;\n");
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "change service"]);
    await writeFile(path.join(repoPath, "dirty.ts"), "export const dirty = true;\n");

    const result = await createRefreshRunService(db, testOptions()).detectRefreshChanges(project!.id, {});

    expect(result.changedFiles.source).toContain("service.ts");
    expect(result.changedFiles.source).toContain("dirty.ts");
    expect(result.baselineGitCommit).toBe(baseline);
    expect(result.baselineIndexRunId).toBeTruthy();
  });

  it("derives impacted specs from active source annotations and changed spec paths", async () => {
    const [project] = await db.insert(projects).values({
      name: "Impact",
      slug: `impact-${Date.now()}`,
      repoPath,
      specopsPath
    }).returning();
    await db.insert(specEntities).values({
      projectId: project!.id,
      entityId: "use-case.review",
      type: "use_case",
      title: "Review",
      status: "draft",
      filePath: "use-cases/review.md",
      bodyMarkdown: "# Review\n",
      bodyText: "Review",
      contentHash: "hash"
    });
    await db.insert(sourceSpecAnnotations).values({
      projectId: project!.id,
      sourceFilePath: "src/review.ts",
      entityId: "use-case.review",
      specFilePath: "use-cases/review.md",
      relationshipType: "implements",
      provenance: "ai",
      status: "active"
    });

    const impact = await createRefreshRunService(db, testOptions()).deriveRefreshImpact(project!.id, {
      specs: [".specops/use-cases/review.md"],
      source: ["src/review.ts", "src/unlinked.ts"],
      tests: [],
      other: []
    });

    expect(impact.affectedSpecs).toContainEqual({ entityId: "use-case.review", reason: "changed_spec" });
    expect(impact.affectedSpecs).toContainEqual({ entityId: "use-case.review", reason: "linked_source" });
    expect(impact.unlinkedSourceFiles).toEqual(["src/unlinked.ts"]);
  });
});

function testOptions() {
  return {
    aiPrefillConfig: {
      ollamaBaseUrl: "http://127.0.0.1:11434",
      openAiBaseUrl: "https://api.openai.com/v1",
      openAiApiKey: undefined,
      timeoutMs: 60_000,
      maxFiles: 5,
      maxTotalBytes: 60_000
    }
  };
}

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}
```

If the repo already has a shared DB test harness in `apps/api/src/__tests__/test-utils.ts`, use that harness instead of duplicating setup.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- refresh-run-service.test.ts
```

Expected: FAIL because `createRefreshRunService` does not exist.

- [ ] **Step 3: Implement baseline and impact helpers**

Create `apps/api/src/services/refresh-run-service.ts`:

```ts
import type {
  RefreshChangedFiles,
  RefreshImpactSummary,
  RefreshRunDetailDto,
  RefreshRunStartRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { indexRuns, projects, refreshProposals, refreshRuns, sourceSpecAnnotations, specEntities } from "@specops/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { ApiConfig } from "../config.js";
import { ConflictError, NotFoundError } from "../lib/http-errors.js";
import { readGitHeadCommit, readGitRefRangeChangedFiles, readGitStatus, readGitWorkingTreeChangedFiles } from "./git-service.js";
import { classifyChangedFiles, countChangedFiles, normalizePath, sortChangedFiles } from "./review-summary-service.js";

type RefreshRunServiceOptions = {
  aiPrefillConfig: ApiConfig["aiPrefill"];
};

const EMPTY_CHANGED_FILES: RefreshChangedFiles = {
  specs: [],
  source: [],
  tests: [],
  other: []
};

const EMPTY_IMPACT: RefreshImpactSummary = {
  affectedSpecs: [],
  unlinkedSourceFiles: [],
  staleAnnotationIds: []
};

export function createRefreshRunService(db: Db, options: RefreshRunServiceOptions) {
  void options;

  async function detectRefreshChanges(projectId: string, input: Partial<RefreshRunStartRequest>) {
    const project = await loadProject(projectId);
    const baseline = await loadLatestSuccessfulIndexRun(projectId);
    if (!baseline) {
      throw new ConflictError("Refresh analysis requires a successful baseline index", { projectId });
    }

    const gitStatus = await readGitStatus(project.repoPath, { includeEntries: false });
    if (!gitStatus.isRepo || !baseline.gitCommit) {
      return {
        baselineIndexRunId: baseline.id,
        baselineGitCommit: baseline.gitCommit,
        headGitCommit: gitStatus.headCommit,
        changedFiles: EMPTY_CHANGED_FILES,
        gitComparisonUnavailable: true
      };
    }

    const committedPaths = await readGitRefRangeChangedFiles(project.repoPath, baseline.gitCommit, gitStatus.headCommit ?? "HEAD");
    const dirtyPaths = await readGitWorkingTreeChangedFiles(project.repoPath);
    const selected = input.selectedPaths && input.selectedPaths.length > 0
      ? new Set(input.selectedPaths.map(normalizePath))
      : null;
    const paths = [...new Set([...committedPaths, ...dirtyPaths].map(normalizePath))]
      .filter((filePath) => !selected || selected.has(filePath))
      .sort();

    return {
      baselineIndexRunId: baseline.id,
      baselineGitCommit: baseline.gitCommit,
      headGitCommit: gitStatus.headCommit,
      changedFiles: classifyChangedFiles(project, paths),
      gitComparisonUnavailable: false
    };
  }

  async function deriveRefreshImpact(
    projectId: string,
    changedFiles: RefreshChangedFiles
  ): Promise<RefreshImpactSummary> {
    const project = await loadProject(projectId);
    const [entities, sourceAnnotations, staleGenerated] = await Promise.all([
      db.select().from(specEntities).where(eq(specEntities.projectId, projectId)),
      changedFiles.source.length + changedFiles.tests.length > 0
        ? db.select().from(sourceSpecAnnotations).where(
            and(
              eq(sourceSpecAnnotations.projectId, projectId),
              eq(sourceSpecAnnotations.status, "active"),
              inArray(sourceSpecAnnotations.sourceFilePath, [...changedFiles.source, ...changedFiles.tests])
            )
          )
        : Promise.resolve([]),
      db.select().from(sourceSpecAnnotations).where(
        and(
          eq(sourceSpecAnnotations.projectId, projectId),
          eq(sourceSpecAnnotations.status, "active"),
          inArray(sourceSpecAnnotations.provenance, ["scanner", "ai"])
        )
      )
    ]);
    const specopsPrefix = toSpecopsPrefix(project.repoPath, project.specopsPath);
    const entitiesByPath = new Map(entities.map((entity) => [entity.filePath, entity]));
    const affected = new Map<string, Set<RefreshImpactSummary["affectedSpecs"][number]["reason"]>>();

    for (const specPath of changedFiles.specs) {
      const entity = entitiesByPath.get(stripSpecopsPrefix(specPath, specopsPrefix));
      if (entity) addAffected(affected, entity.entityId, "changed_spec");
    }

    const linkedSourcePaths = new Set<string>();
    for (const annotation of sourceAnnotations) {
      linkedSourcePaths.add(annotation.sourceFilePath);
      addAffected(
        affected,
        annotation.entityId,
        annotation.relationshipType === "tests" ? "test_evidence" : "linked_source"
      );
    }

    const unlinkedSourceFiles = changedFiles.source
      .filter((filePath) => !linkedSourcePaths.has(filePath))
      .sort();

    return {
      affectedSpecs: [...affected.entries()]
        .flatMap(([entityId, reasons]) => [...reasons].map((reason) => ({ entityId, reason })))
        .sort((left, right) => left.entityId.localeCompare(right.entityId) || left.reason.localeCompare(right.reason)),
      unlinkedSourceFiles,
      staleAnnotationIds: staleGenerated
        .filter((annotation) => annotation.sourceFilePath && !linkedSourcePaths.has(annotation.sourceFilePath))
        .map((annotation) => annotation.id)
        .sort()
    };
  }

  async function startRefreshRun(projectId: string, input: RefreshRunStartRequest): Promise<RefreshRunDetailDto> {
    await loadProject(projectId);
    await assertNoActiveRefreshRun(projectId);
    const [row] = await db.insert(refreshRuns).values({
      projectId,
      status: "queued",
      currentStep: null,
      stepsJson: createInitialSteps()
    }).returning();
    if (!row) throw new Error("Failed to create refresh run");
    return mapRefreshRun(row, []);
  }

  async function getRefreshRun(projectId: string, runId: string): Promise<RefreshRunDetailDto> {
    const row = await loadRefreshRun(projectId, runId);
    const proposals = await db.select().from(refreshProposals).where(eq(refreshProposals.refreshRunId, runId));
    return mapRefreshRun(row, proposals);
  }

  async function assertNoActiveRefreshRun(projectId: string) {
    const [active] = await db
      .select({ id: refreshRuns.id })
      .from(refreshRuns)
      .where(and(eq(refreshRuns.projectId, projectId), inArray(refreshRuns.status, ["queued", "running"])))
      .limit(1);
    if (active) throw new ConflictError("Refresh run is already active", { activeRunId: active.id });
  }

  return {
    detectRefreshChanges,
    deriveRefreshImpact,
    startRefreshRun,
    getRefreshRun
  };

  async function loadProject(projectId: string) {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new NotFoundError("Project not found", { projectId });
    return project;
  }

  async function loadLatestSuccessfulIndexRun(projectId: string) {
    const [row] = await db
      .select()
      .from(indexRuns)
      .where(and(eq(indexRuns.projectId, projectId), inArray(indexRuns.status, ["succeeded", "completed"])))
      .orderBy(desc(indexRuns.finishedAt), desc(indexRuns.startedAt), desc(indexRuns.id))
      .limit(1);
    return row ?? null;
  }

  async function loadRefreshRun(projectId: string, runId: string) {
    const [row] = await db
      .select()
      .from(refreshRuns)
      .where(and(eq(refreshRuns.projectId, projectId), eq(refreshRuns.id, runId)))
      .limit(1);
    if (!row) throw new NotFoundError("Refresh run not found", { projectId, runId });
    return row;
  }
}

function createInitialSteps() {
  return ["detect_changes", "index", "derive_impacts", "generate_update_proposals", "prepare_review"].map((name) => ({
    name,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    message: null,
    counts: {}
  }));
}

function addAffected(
  affected: Map<string, Set<RefreshImpactSummary["affectedSpecs"][number]["reason"]>>,
  entityId: string,
  reason: RefreshImpactSummary["affectedSpecs"][number]["reason"]
) {
  const reasons = affected.get(entityId) ?? new Set();
  reasons.add(reason);
  affected.set(entityId, reasons);
}

function toSpecopsPrefix(repoPath: string, specopsPath: string) {
  const relative = normalizePath(specopsPath.replace(`${repoPath}/`, ""));
  return relative || ".specops";
}

function stripSpecopsPrefix(filePath: string, specopsPrefix: string) {
  const normalized = normalizePath(filePath);
  return normalized.startsWith(`${specopsPrefix}/`)
    ? normalized.slice(specopsPrefix.length + 1)
    : normalized;
}

function readJson<T>(value: unknown, fallback: T): T {
  return value && typeof value === "object" ? (value as T) : fallback;
}

function mapRefreshRun(row: typeof refreshRuns.$inferSelect, proposals: Array<typeof refreshProposals.$inferSelect>): RefreshRunDetailDto {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as RefreshRunDetailDto["status"],
    currentStep: row.currentStep as RefreshRunDetailDto["currentStep"],
    steps: readJson(row.stepsJson, createInitialSteps()) as RefreshRunDetailDto["steps"],
    baselineIndexRunId: row.baselineIndexRunId,
    baselineGitCommit: row.baselineGitCommit,
    headGitCommit: row.headGitCommit,
    indexRunId: row.indexRunId,
    changedFiles: readJson(row.changedFilesJson, EMPTY_CHANGED_FILES),
    impactSummary: readJson(row.impactSummaryJson, EMPTY_IMPACT),
    selection: row.selectionJson as RefreshRunDetailDto["selection"],
    proposalCounts: countProposals(proposals),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null
  };
}

function countProposals(proposals: Array<typeof refreshProposals.$inferSelect>): RefreshRunDetailDto["proposalCounts"] {
  const counts: RefreshRunDetailDto["proposalCounts"] = {
    draft: 0,
    accepted: 0,
    discarded: 0,
    byType: {}
  };
  for (const proposal of proposals) {
    if (proposal.status === "draft" || proposal.status === "accepted" || proposal.status === "discarded") {
      counts[proposal.status] += 1;
    }
    counts.byType[proposal.proposalType as keyof typeof counts.byType] =
      (counts.byType[proposal.proposalType as keyof typeof counts.byType] ?? 0) + 1;
  }
  return counts;
}
```

The service file should compile without unused imports and without disabled lint comments.

- [ ] **Step 4: Run targeted service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- refresh-run-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit baseline and impact service**

```bash
git add apps/api/src/services/refresh-run-service.ts apps/api/src/__tests__/refresh-run-service.test.ts
git commit -m "feat: derive refresh changes and impact"
```

---

### Task 3: Refresh Run Execution And API Routes

**Files:**

- Modify: `apps/api/src/services/refresh-run-service.ts`
- Create: `apps/api/src/routes/refresh-runs.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`
- Test: `apps/api/src/__tests__/refresh-run-service.test.ts`

- [ ] **Step 1: Add route tests**

Append to `apps/api/src/__tests__/routes.test.ts`:

```ts
it("starts and fetches a refresh run", async () => {
  const project = await createProjectFixture();
  await pool.query(
    "insert into index_runs (project_id, started_at, finished_at, status, git_commit) values ($1, now(), now(), 'succeeded', 'abc123')",
    [project.id]
  );

  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/refresh-runs`,
    payload: {}
  });

  expect(created.statusCode).toBe(201);
  const body = created.json();
  expect(body.status).toBe("queued");

  const fetched = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/refresh-runs/${body.id}`
  });

  expect(fetched.statusCode).toBe(200);
  expect(fetched.json()).toMatchObject({ id: body.id, projectId: project.id });
});
```

If `createProjectFixture` is not the local helper name, use the project fixture helper already used in that file.

- [ ] **Step 2: Run route test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "starts and fetches a refresh run"
```

Expected: FAIL with 404 because refresh routes are not registered.

- [ ] **Step 3: Add refresh routes**

Create `apps/api/src/routes/refresh-runs.ts`:

```ts
import {
  refreshProposalPatchRequestSchema,
  refreshRunAcceptRequestSchema,
  refreshRunStartRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import {
  createRefreshRunService,
  type RefreshAiPrefillProviderFactory
} from "../services/refresh-run-service.js";

type RouteOptions = {
  db: Db;
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: RefreshAiPrefillProviderFactory;
};

const runParamsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid()
});

const proposalParamsSchema = runParamsSchema.extend({
  proposalId: z.string().uuid()
});

export const registerRefreshRunRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db, aiPrefillConfig, aiPrefillProviderFactory }
) => {
  const service = createRefreshRunService(db, { aiPrefillConfig, aiPrefillProviderFactory });

  app.post("/projects/:projectId/refresh-runs", async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const input = refreshRunStartRequestSchema.parse(request.body ?? {});
    const run = await service.startRefreshRun(projectId, input);
    return reply.code(201).send(run);
  });

  app.get("/projects/:projectId/refresh-runs/:runId", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    return service.getRefreshRun(projectId, runId);
  });

  app.get("/projects/:projectId/refresh-runs/:runId/review", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    return service.getRefreshReview(projectId, runId);
  });

  app.patch("/projects/:projectId/refresh-runs/:runId/proposals/:proposalId", async (request) => {
    const { projectId, runId, proposalId } = proposalParamsSchema.parse(request.params);
    const input = refreshProposalPatchRequestSchema.parse(request.body);
    return service.patchRefreshProposal(projectId, runId, proposalId, input);
  });

  app.post("/projects/:projectId/refresh-runs/:runId/accept", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    const input = refreshRunAcceptRequestSchema.parse(request.body);
    return service.acceptRefreshProposals(projectId, runId, input);
  });
};
```

- [ ] **Step 4: Register routes in server**

Modify `apps/api/src/server.ts`:

```ts
import { registerRefreshRunRoutes } from "./routes/refresh-runs.js";
```

Register after analyze routes:

```ts
  app.register(registerRefreshRunRoutes, {
    prefix: "/api",
    db,
    aiPrefillConfig,
    aiPrefillProviderFactory: options.aiPrefillProviderFactory
  });
```

- [ ] **Step 5: Implement run execution**

Extend `apps/api/src/services/refresh-run-service.ts`:

```ts
import {
  createAiPrefillService,
  type AiPrefillProviderFactory
} from "./ai-prefill-service.js";
import { selectAnalyzeSourceFiles, type AnalyzeSourceCandidate } from "./analyze-source-selection.js";
import { createIndexerService } from "./indexer-service.js";

export type RefreshAiPrefillProviderFactory = AiPrefillProviderFactory;

const aiPrefillDefaults = {
  provider: "ollama" as const,
  model: "gemma4",
  temperature: 0.1
};
```

Update `RefreshRunServiceOptions`:

```ts
type RefreshRunServiceOptions = {
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};
```

In `startRefreshRun`, after inserting the row:

```ts
    setTimeout(() => {
      void executeRefreshRun(projectId, row.id, input).catch(() => undefined);
    }, 0);
```

Add `executeRefreshRun` inside `createRefreshRunService`:

```ts
  async function executeRefreshRun(
    projectId: string,
    runId: string,
    input: RefreshRunStartRequest
  ): Promise<void> {
    let steps = createInitialSteps();
    let currentStep: RefreshRunStepName | null = null;
    let changedFiles: RefreshChangedFiles = EMPTY_CHANGED_FILES;
    let impactSummary: RefreshImpactSummary = EMPTY_IMPACT;
    let proposalIds: string[] = [];

    try {
      await updateRun(runId, { status: "running", startedAt: new Date(), stepsJson: steps });

      await runStep("detect_changes", async () => {
        const detection = await detectRefreshChanges(projectId, input);
        changedFiles = detection.changedFiles;
        await updateRun(runId, {
          baselineIndexRunId: detection.baselineIndexRunId,
          baselineGitCommit: detection.baselineGitCommit,
          headGitCommit: detection.headGitCommit,
          changedFilesJson: changedFiles
        });
        return {
          status: "succeeded",
          message: detection.gitComparisonUnavailable ? "Git comparison unavailable; refresh will run a full index." : null,
          counts: { changedFileCount: countChangedFiles(changedFiles) }
        };
      });

      await runStep("index", async () => {
        const indexRun = await createIndexerService(db).indexProject(projectId);
        await updateRun(runId, { indexRunId: indexRun.id });
        return {
          status: "succeeded",
          counts: {
            entityCount: indexRun.entityCount,
            sourceFileCount: indexRun.sourceFileCount ?? 0,
            warningCount: indexRun.warningCount,
            errorCount: indexRun.errorCount
          }
        };
      });

      await runStep("derive_impacts", async () => {
        impactSummary = await deriveRefreshImpact(projectId, changedFiles);
        await updateRun(runId, { impactSummaryJson: impactSummary });
        return {
          status: "succeeded",
          counts: {
            affectedSpecCount: impactSummary.affectedSpecs.length,
            unlinkedSourceFileCount: impactSummary.unlinkedSourceFiles.length,
            staleAnnotationCount: impactSummary.staleAnnotationIds.length
          }
        };
      });

      await runStep("generate_update_proposals", async () => {
        if (!input.includeAi) {
          return { status: "skipped", message: "AI proposal generation disabled", counts: {} };
        }
        const result = await generateRefreshProposals(projectId, runId, changedFiles, impactSummary, input);
        proposalIds = result.proposalIds;
        await updateRun(runId, {
          selectionJson: result.selection,
          proposalIdsJson: proposalIds
        });
        return {
          status: "succeeded",
          counts: {
            selectedSourceFileCount: result.selection?.selectedSourceFileIds.length ?? 0,
            proposalCount: proposalIds.length
          }
        };
      });

      await runStep("prepare_review", async () => ({
        status: "succeeded",
        counts: { proposalCount: proposalIds.length }
      }));

      await updateRun(runId, {
        status: "succeeded",
        currentStep: null,
        stepsJson: steps,
        finishedAt: new Date()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (currentStep) {
        steps = finishStep(steps, currentStep, { status: "failed", message });
      }
      await updateRun(runId, {
        status: "failed",
        currentStep: null,
        stepsJson: steps,
        errorMessage: message,
        finishedAt: new Date()
      });
    }

    async function runStep(
      name: RefreshRunStepName,
      callback: () => Promise<{ status: RefreshRunStepStatus; message?: string | null; counts?: Record<string, number> }>
    ) {
      currentStep = name;
      steps = steps.map((step) => step.name === name ? {
        ...step,
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        message: null
      } : step);
      await updateRun(runId, { currentStep: name, stepsJson: steps });
      const patch = await callback();
      steps = finishStep(steps, name, patch);
      await updateRun(runId, { stepsJson: steps });
      currentStep = null;
    }
  }
```

Add support helpers:

```ts
  async function updateRun(projectId: string, runId: string, patch: Partial<typeof refreshRuns.$inferInsert>) {
    await db
      .update(refreshRuns)
      .set(patch)
      .where(and(eq(refreshRuns.projectId, projectId), eq(refreshRuns.id, runId)));
  }
```

Add `finishStep`:

```ts
function finishStep(
  steps: RefreshRunStepDto[],
  name: RefreshRunStepName,
  patch: { status: RefreshRunStepStatus; message?: string | null; counts?: Record<string, number> }
): RefreshRunStepDto[] {
  const finishedAt = new Date().toISOString();
  return steps.map((step) =>
    step.name === name
      ? {
          ...step,
          status: patch.status,
          finishedAt,
          message: patch.message ?? null,
          counts: patch.counts ?? step.counts
        }
      : step
  );
}
```

- [ ] **Step 6: Implement review stubs so routes compile**

Add these methods in the service return object and implementation; Task 4 will expand them:

```ts
  async function getRefreshReview(projectId: string, runId: string): Promise<RefreshReviewResponse> {
    await loadRefreshRun(projectId, runId);
    const rows = await db
      .select()
      .from(refreshProposals)
      .where(and(eq(refreshProposals.projectId, projectId), eq(refreshProposals.refreshRunId, runId)))
      .orderBy(asc(refreshProposals.createdAt), asc(refreshProposals.id));

    return {
      runId,
      proposals: rows.map(mapRefreshProposal),
      counts: countProposals(rows)
    };
  }

  async function patchRefreshProposal(
    projectId: string,
    runId: string,
    proposalId: string,
    input: RefreshProposalPatchRequest
  ): Promise<RefreshProposalDto> {
    await loadRefreshRun(projectId, runId);
    const [updated] = await db
      .update(refreshProposals)
      .set({
        title: input.title,
        targetEntityId: input.targetEntityId,
        targetSpecFilePath: input.targetSpecFilePath,
        summary: input.summary,
        proposedClaimsJson: input.proposedClaims,
        proposedMarkdown: input.proposedMarkdown,
        status: input.status,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(refreshProposals.projectId, projectId),
          eq(refreshProposals.refreshRunId, runId),
          eq(refreshProposals.id, proposalId)
        )
      )
      .returning();
    if (!updated) throw new NotFoundError("Refresh proposal not found", { projectId, runId, proposalId });
    return mapRefreshProposal(updated);
  }

  async function acceptRefreshProposals(
    projectId: string,
    runId: string,
    input: RefreshRunAcceptRequest
  ): Promise<RefreshRunAcceptResponse> {
    await loadRefreshRun(projectId, runId);
    return {
      acceptedProposalIds: [],
      failures: input.proposalIds.map((proposalId) => ({
        proposalId,
        messages: [{ severity: "blocker", code: "apply_unavailable", message: "Refresh apply is unavailable until proposal apply behavior is installed.", field: null }]
      })),
      markdownFilesWritten: [],
      annotationsCreated: 0,
      annotationsMarkedStale: 0,
      indexRunId: null
    };
  }
```

Add `mapRefreshProposal`:

```ts
function mapRefreshProposal(row: typeof refreshProposals.$inferSelect): RefreshProposalDto {
  return {
    id: row.id,
    projectId: row.projectId,
    refreshRunId: row.refreshRunId,
    proposalType: row.proposalType as RefreshProposalDto["proposalType"],
    status: row.status as RefreshProposalDto["status"],
    targetEntityId: row.targetEntityId,
    targetSpecFilePath: row.targetSpecFilePath,
    title: row.title,
    summary: row.summary,
    confidence: row.confidence,
    provenance: row.provenance as RefreshProposalDto["provenance"],
    sourceEvidence: readJson(row.sourceEvidenceJson, []),
    proposedClaims: readJson(row.proposedClaimsJson, []),
    proposedMarkdown: row.proposedMarkdown,
    relatedAnnotationIds: readJson(row.relatedAnnotationIdsJson, []),
    validation: readJson(row.validationJson, { state: "ready", messages: [] }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
```

- [ ] **Step 7: Run route and type checks**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "starts and fetches a refresh run"
pnpm --filter api typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit routes and run execution**

```bash
git add apps/api/src/services/refresh-run-service.ts apps/api/src/routes/refresh-runs.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add refresh run API"
```

---

### Task 4: Refresh Proposals, Markdown Apply, And Annotations

**Files:**

- Modify: `apps/api/src/services/refresh-run-service.ts`
- Test: `apps/api/src/__tests__/refresh-run-service.test.ts`

- [ ] **Step 1: Add proposal generation and accept tests**

Append tests to `apps/api/src/__tests__/refresh-run-service.test.ts`:

```ts
it("creates update and stale annotation proposals for impacted source", async () => {
  const project = await createIndexedProjectWithAnnotation(db, repoPath, specopsPath);
  const service = createRefreshRunService(db, testOptions());

  const run = await service.startRefreshRun(project.id, {
    includeAi: false,
    selectedPaths: [],
    maxAiFiles: null
  });
  await service.createReviewProposalsForTest(project.id, run.id, {
    changedFiles: { specs: [], source: ["src/review.ts"], tests: [], other: [] },
    impactSummary: {
      affectedSpecs: [{ entityId: "use-case.review", reason: "linked_source" }],
      unlinkedSourceFiles: ["src/new.ts"],
      staleAnnotationIds: [project.annotationId]
    }
  });

  const review = await service.getRefreshReview(project.id, run.id);

  expect(review.proposals.map((proposal) => proposal.proposalType)).toEqual([
    "update_spec",
    "new_spec",
    "stale_annotation"
  ]);
});

it("accepts a new spec proposal by writing markdown and creating annotations", async () => {
  const project = await createIndexedProjectWithAnnotation(db, repoPath, specopsPath);
  const service = createRefreshRunService(db, testOptions());
  const run = await service.startRefreshRun(project.id, {
    includeAi: false,
    selectedPaths: [],
    maxAiFiles: null
  });
  const proposal = await service.insertRefreshProposalForTest(project.id, run.id, {
    proposalType: "new_spec",
    targetEntityId: "use-case.new-refresh",
    targetSpecFilePath: "use-cases/new-refresh.md",
    title: "New Refresh",
    summary: "New refresh behavior.",
    sourceEvidence: [
      {
        sourceFilePath: "src/new-refresh.ts",
        symbolName: "newRefresh",
        startLine: 1,
        endLine: 5,
        relationshipType: "implements"
      }
    ],
    proposedClaims: [{ text: "New refresh behavior is implemented.", kind: "fact", confidence: 0.9 }]
  });

  const result = await service.acceptRefreshProposals(project.id, run.id, {
    proposalIds: [proposal.id]
  });

  expect(result.acceptedProposalIds).toEqual([proposal.id]);
  expect(result.markdownFilesWritten).toEqual(["use-cases/new-refresh.md"]);
  expect(result.annotationsCreated).toBe(1);
});
```

Use fixture helpers in the test file to insert directly into `refresh_proposals`; keep production service exports limited to runtime API methods.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- refresh-run-service.test.ts -t "creates update and stale|accepts a new spec"
```

Expected: FAIL because proposal generation and accept behavior are not implemented.

- [ ] **Step 3: Implement deterministic refresh proposal creation**

Add `generateRefreshProposals` inside `createRefreshRunService`:

```ts
  async function generateRefreshProposals(
    projectId: string,
    runId: string,
    changedFiles: RefreshChangedFiles,
    impactSummary: RefreshImpactSummary,
    input: RefreshRunStartRequest
  ): Promise<{ proposalIds: string[]; selection: AnalyzeRunSelectionSummary | null }> {
    const selection = await selectImpactedSourceFiles(projectId, changedFiles, input);
    const proposalIds: string[] = [];

    for (const affected of impactSummary.affectedSpecs) {
      const [entity] = await db
        .select()
        .from(specEntities)
        .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, affected.entityId)))
        .limit(1);
      if (!entity) continue;
      const [proposal] = await db.insert(refreshProposals).values({
        projectId,
        refreshRunId: runId,
        proposalType: "update_spec",
        status: "draft",
        targetEntityId: entity.entityId,
        targetSpecFilePath: entity.filePath,
        title: entity.title,
        summary: `Refresh ${entity.title} because ${affected.reason.replaceAll("_", " ")} changed.`,
        confidence: 0.7,
        provenance: "ai",
        sourceEvidenceJson: changedFiles.source.map((sourceFilePath) => ({
          sourceFilePath,
          symbolName: null,
          startLine: null,
          endLine: null,
          relationshipType: "references"
        })),
        proposedClaimsJson: [],
        proposedMarkdown: null,
        relatedAnnotationIdsJson: [],
        validationJson: { state: "ready", messages: [] }
      }).returning();
      if (proposal) proposalIds.push(proposal.id);
    }

    for (const sourceFilePath of impactSummary.unlinkedSourceFiles) {
      const title = titleFromPath(sourceFilePath);
      const entityId = `use-case.${slugify(title)}`;
      const [proposal] = await db.insert(refreshProposals).values({
        projectId,
        refreshRunId: runId,
        proposalType: "new_spec",
        status: "draft",
        targetEntityId: entityId,
        targetSpecFilePath: `use-cases/${slugify(title)}.md`,
        title,
        summary: `Create a reviewed spec for ${sourceFilePath}.`,
        confidence: 0.6,
        provenance: "ai",
        sourceEvidenceJson: [{
          sourceFilePath,
          symbolName: null,
          startLine: null,
          endLine: null,
          relationshipType: "references"
        }],
        proposedClaimsJson: [{
          text: `${title} is present in ${sourceFilePath}.`,
          kind: "hypothesis",
          confidence: 0.6
        }],
        proposedMarkdown: null,
        relatedAnnotationIdsJson: [],
        validationJson: { state: "warning", messages: [{ severity: "warning", code: "unlinked_source", message: "AI found unlinked changed source.", field: null }] }
      }).returning();
      if (proposal) proposalIds.push(proposal.id);
    }

    for (const annotationId of impactSummary.staleAnnotationIds) {
      const [proposal] = await db.insert(refreshProposals).values({
        projectId,
        refreshRunId: runId,
        proposalType: "stale_annotation",
        status: "draft",
        targetEntityId: null,
        targetSpecFilePath: null,
        title: "Mark stale source annotation",
        summary: "A generated source/spec annotation no longer matches indexed source state.",
        confidence: 1,
        provenance: "scanner",
        sourceEvidenceJson: [],
        proposedClaimsJson: [],
        proposedMarkdown: null,
        relatedAnnotationIdsJson: [annotationId],
        validationJson: { state: "ready", messages: [] }
      }).returning();
      if (proposal) proposalIds.push(proposal.id);
    }

    return { proposalIds, selection };
  }
```

Add helpers:

```ts
  async function selectImpactedSourceFiles(
    projectId: string,
    changedFiles: RefreshChangedFiles,
    input: RefreshRunStartRequest
  ): Promise<AnalyzeRunSelectionSummary | null> {
    const candidates = await loadAnalyzeSourceCandidates(projectId, changedFiles.source);
    if (candidates.length === 0) return null;
    return selectAnalyzeSourceFiles({
      files: candidates,
      maxFiles: input.maxAiFiles ?? options.aiPrefillConfig.maxFiles,
      maxTotalBytes: options.aiPrefillConfig.maxTotalBytes
    });
  }

  async function loadAnalyzeSourceCandidates(
    projectId: string,
    sourcePaths: string[]
  ): Promise<AnalyzeSourceCandidate[]> {
    if (sourcePaths.length === 0) return [];
    const rows = await db
      .select()
      .from(sourceFiles)
      .where(and(eq(sourceFiles.projectId, projectId), inArray(sourceFiles.path, sourcePaths)));
    return rows.map((file) => ({
      id: file.id,
      path: file.path,
      language: file.language,
      kind: file.kind,
      sizeBytes: file.sizeBytes,
      importCount: 0,
      exportCount: 0,
      symbolCount: 0
    }));
  }

function titleFromPath(filePath: string) {
  const name = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "source";
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "refresh";
}
```

- [ ] **Step 4: Implement accept/apply behavior**

Replace the Task 3 accept stub in `apps/api/src/services/refresh-run-service.ts`:

```ts
  async function acceptRefreshProposals(
    projectId: string,
    runId: string,
    input: RefreshRunAcceptRequest
  ): Promise<RefreshRunAcceptResponse> {
    const run = await loadRefreshRun(projectId, runId);
    const acceptedProposalIds: string[] = [];
    const failures: RefreshRunAcceptResponse["failures"] = [];
    const markdownFilesWritten: string[] = [];
    let annotationsCreated = 0;
    let annotationsMarkedStale = 0;

    for (const proposalId of input.proposalIds) {
      const [proposal] = await db
        .select()
        .from(refreshProposals)
        .where(
          and(
            eq(refreshProposals.projectId, projectId),
            eq(refreshProposals.refreshRunId, runId),
            eq(refreshProposals.id, proposalId),
            eq(refreshProposals.status, "draft")
          )
        )
        .limit(1);

      if (!proposal) {
        failures.push({
          proposalId,
          messages: [{ severity: "blocker", code: "missing_proposal", message: "Refresh proposal is not available for acceptance.", field: null }]
        });
        continue;
      }

      const validation = validateProposalForApply(proposal);
      if (validation.messages.length > 0 && validation.state === "blocker") {
        failures.push({ proposalId, messages: validation.messages });
        continue;
      }

      try {
        const result = await applyRefreshProposal(projectId, proposal);
        markdownFilesWritten.push(...result.markdownFilesWritten);
        annotationsCreated += result.annotationsCreated;
        annotationsMarkedStale += result.annotationsMarkedStale;
        acceptedProposalIds.push(proposalId);
        await db
          .update(refreshProposals)
          .set({ status: "accepted", updatedAt: new Date() })
          .where(and(eq(refreshProposals.projectId, projectId), eq(refreshProposals.id, proposalId)));
      } catch (error) {
        failures.push({
          proposalId,
          messages: [{
            severity: "blocker",
            code: "apply_failed",
            message: error instanceof Error ? error.message : String(error),
            field: null
          }]
        });
      }
    }

    return {
      acceptedProposalIds,
      failures,
      markdownFilesWritten: [...new Set(markdownFilesWritten)].sort(),
      annotationsCreated,
      annotationsMarkedStale,
      indexRunId: run.indexRunId
    };
  }
```

Add apply helpers:

```ts
  function validateProposalForApply(
    proposal: typeof refreshProposals.$inferSelect
  ): RefreshValidationSummary {
    const messages: RefreshValidationMessage[] = [];
    if ((proposal.proposalType === "new_spec" || proposal.proposalType === "update_spec") && !proposal.targetSpecFilePath) {
      messages.push({ severity: "blocker", code: "missing_spec_path", message: "Proposal requires a target spec path.", field: "targetSpecFilePath" });
    }
    if ((proposal.proposalType === "new_spec" || proposal.proposalType === "update_spec") && !proposal.targetEntityId) {
      messages.push({ severity: "blocker", code: "missing_entity_id", message: "Proposal requires a target entity id.", field: "targetEntityId" });
    }
    return {
      state: messages.some((message) => message.severity === "blocker") ? "blocker" : "ready",
      messages
    };
  }

  async function applyRefreshProposal(projectId: string, proposal: typeof refreshProposals.$inferSelect) {
    if (proposal.proposalType === "stale_annotation") {
      const ids = readJson<string[]>(proposal.relatedAnnotationIdsJson, []);
      if (ids.length === 0) {
        return { markdownFilesWritten: [], annotationsCreated: 0, annotationsMarkedStale: 0 };
      }
      const updated = await db
        .update(sourceSpecAnnotations)
        .set({ status: "stale", updatedAt: new Date() })
        .where(
          and(
            eq(sourceSpecAnnotations.projectId, projectId),
            inArray(sourceSpecAnnotations.id, ids),
            inArray(sourceSpecAnnotations.provenance, ["scanner", "ai"])
          )
        )
        .returning();
      return { markdownFilesWritten: [], annotationsCreated: 0, annotationsMarkedStale: updated.length };
    }

    if (!proposal.targetEntityId || !proposal.targetSpecFilePath) {
      throw new Error("Proposal requires target entity and spec path");
    }

    const markdown = renderRefreshMarkdown(proposal);
    await writeRefreshMarkdown(projectId, proposal.targetSpecFilePath, markdown);
    const annotationsCreated = await createAcceptedRefreshAnnotations(projectId, proposal);

    return {
      markdownFilesWritten: [proposal.targetSpecFilePath],
      annotationsCreated,
      annotationsMarkedStale: 0
    };
  }
```

Use existing path-safety helpers and `renderAnalyzeReviewAssemblyMarkdown`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertExistingParentInsideDirectory,
  assertInsideDirectory
} from "../lib/path-safety.js";
import { renderAnalyzeReviewAssemblyMarkdown } from "./analyze-review-renderer.js";
```

```ts
  function renderRefreshMarkdown(proposal: typeof refreshProposals.$inferSelect) {
    return renderAnalyzeReviewAssemblyMarkdown({
      entityId: proposal.targetEntityId!,
      entityType: "use_case",
      title: proposal.title,
      summary: proposal.summary,
      claims: readJson(proposal.proposedClaimsJson, []).map((claim) => ({
        ...claim,
        evidence: readJson(proposal.sourceEvidenceJson, [])
      })),
      proposedLinks: []
    });
  }

  async function writeRefreshMarkdown(projectId: string, filePath: string, markdown: string) {
    const project = await loadProject(projectId);
    const targetPath = path.resolve(project.specopsPath, filePath);
    assertInsideDirectory(project.specopsPath, targetPath, "Refresh target path escapes .specops");
    await assertExistingParentInsideDirectory(project.specopsPath, targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, markdown, "utf8");
  }

  async function createAcceptedRefreshAnnotations(projectId: string, proposal: typeof refreshProposals.$inferSelect) {
    const evidence = readJson<RefreshProposalDto["sourceEvidence"]>(proposal.sourceEvidenceJson, []);
    if (!proposal.targetEntityId || !proposal.targetSpecFilePath) return 0;
    let count = 0;
    for (const item of evidence) {
      await db.insert(sourceSpecAnnotations).values({
        projectId,
        sourceFilePath: item.sourceFilePath,
        symbolName: item.symbolName,
        startLine: item.startLine,
        endLine: item.endLine,
        entityId: proposal.targetEntityId,
        specFilePath: proposal.targetSpecFilePath,
        relationshipType: item.relationshipType,
        confidence: proposal.confidence,
        provenance: proposal.provenance,
        status: "active"
      }).onConflictDoNothing();
      count += 1;
    }
    return count;
  }
```

- [ ] **Step 5: Run proposal and accept tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- refresh-run-service.test.ts
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit proposal and apply behavior**

```bash
git add apps/api/src/services/refresh-run-service.ts apps/api/src/__tests__/refresh-run-service.test.ts
git commit -m "feat: apply refresh proposals"
```

---

### Task 5: Web API, Routes, And Refresh Review UI

**Files:**

- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/routes/refresh-run-detail.tsx`
- Create: `apps/web/src/routes/refresh-run-review.tsx`
- Create: `apps/web/src/components/refresh-review-workspace.tsx`
- Test: `apps/web/src/routes/refresh-runs.test.tsx`
- Test: `apps/web/src/components/refresh-review-workspace.test.tsx`

- [ ] **Step 1: Add UI tests**

Create `apps/web/src/components/refresh-review-workspace.test.tsx`:

```ts
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RefreshReviewWorkspace } from "./refresh-review-workspace.js";

describe("RefreshReviewWorkspace", () => {
  it("groups refresh proposals and enables accepting selected draft proposals", () => {
    const html = renderToString(
      <RefreshReviewWorkspace
        projectId="project-1"
        runId="run-1"
        review={{
          runId: "run-1",
          counts: { draft: 2, accepted: 0, discarded: 0, byType: { new_spec: 1, update_spec: 1 } },
          proposals: [
            proposal("proposal-1", "new_spec", "New Checkout"),
            proposal("proposal-2", "update_spec", "Checkout Flow")
          ]
        }}
        mutationPending={false}
        acceptFailures={[]}
        onPatchProposal={vi.fn()}
        onAcceptProposals={vi.fn()}
      />
    );

    expect(html).toContain("New specs");
    expect(html).toContain("Spec updates");
    expect(html).toContain("New Checkout");
    expect(html).toContain("Checkout Flow");
    expect(html).toContain("Apply selected");
  });
});

function proposal(id: string, proposalType: "new_spec" | "update_spec", title: string) {
  return {
    id,
    projectId: "project-1",
    refreshRunId: "run-1",
    proposalType,
    status: "draft" as const,
    targetEntityId: "use-case.checkout",
    targetSpecFilePath: "use-cases/checkout.md",
    title,
    summary: "Refresh checkout.",
    confidence: 0.8,
    provenance: "ai" as const,
    sourceEvidence: [],
    proposedClaims: [],
    proposedMarkdown: null,
    relatedAnnotationIds: [],
    validation: { state: "ready" as const, messages: [] },
    createdAt: "2026-05-13T10:00:00.000Z",
    updatedAt: "2026-05-13T10:00:00.000Z"
  };
}
```

Create `apps/web/src/routes/refresh-runs.test.tsx` with mocks following `analyze-runs.test.tsx`:

```ts
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RefreshRunDetailPage } from "./refresh-run-detail.js";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isLoading: false,
    error: null,
    data: {
      id: "run-1",
      projectId: "project-1",
      status: "succeeded",
      currentStep: null,
      steps: [
        { name: "detect_changes", status: "succeeded", startedAt: null, finishedAt: null, message: null, counts: { changedFileCount: 2 } }
      ],
      baselineIndexRunId: "index-1",
      baselineGitCommit: "abc123",
      headGitCommit: "def456",
      indexRunId: "index-2",
      changedFiles: { specs: [], source: ["src/review.ts"], tests: [], other: [] },
      impactSummary: { affectedSpecs: [{ entityId: "use-case.review", reason: "linked_source" }], unlinkedSourceFiles: [], staleAnnotationIds: [] },
      selection: null,
      proposalCounts: { draft: 1, accepted: 0, discarded: 0, byType: { update_spec: 1 } },
      errorMessage: null,
      createdAt: "2026-05-13T10:00:00.000Z",
      startedAt: "2026-05-13T10:00:00.000Z",
      finishedAt: "2026-05-13T10:01:00.000Z"
    }
  })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>
}));

describe("RefreshRunDetailPage", () => {
  it("renders refresh run progress and review link", () => {
    const html = renderToString(<RefreshRunDetailPage projectId="project-1" runId="run-1" />);

    expect(html).toContain("Refresh analysis");
    expect(html).toContain("Detect changes");
    expect(html).toContain("Review refresh proposals");
  });
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
pnpm --filter web test -- refresh-review-workspace.test.tsx refresh-runs.test.tsx
```

Expected: FAIL because components and routes do not exist.

- [ ] **Step 3: Add web query helpers**

Modify `apps/web/src/api/queries.ts` imports:

```ts
  RefreshProposalPatchRequest,
  RefreshProposalDto,
  RefreshReviewResponse,
  RefreshRunAcceptRequest,
  RefreshRunAcceptResponse,
  RefreshRunDetailDto,
  RefreshRunStartRequest
```

Add query keys:

```ts
  refreshRunsRoot: (projectId: string) => ["projects", projectId, "refresh-runs"] as const,
  refreshRun: (projectId: string, runId: string) =>
    ["projects", projectId, "refresh-runs", runId] as const,
  refreshReview: (projectId: string, runId: string) =>
    ["projects", projectId, "refresh-runs", runId, "review"] as const,
```

Add helpers:

```ts
export function refreshRunQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.refreshRun(projectId, runId),
    queryFn: () =>
      apiGet<RefreshRunDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/refresh-runs/${encodeURIComponent(runId)}`
      )
  });
}

export function refreshReviewQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.refreshReview(projectId, runId),
    queryFn: () =>
      apiGet<RefreshReviewResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/refresh-runs/${encodeURIComponent(runId)}/review`
      )
  });
}

export function startRefreshRun(projectId: string, input: RefreshRunStartRequest = {}) {
  return apiSend<RefreshRunDetailDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/refresh-runs`,
    input
  );
}

export function patchRefreshProposal(
  projectId: string,
  runId: string,
  proposalId: string,
  input: RefreshProposalPatchRequest
) {
  return apiSend<RefreshProposalDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/refresh-runs/${encodeURIComponent(runId)}/proposals/${encodeURIComponent(proposalId)}`,
    input
  );
}

export function acceptRefreshProposals(
  projectId: string,
  runId: string,
  input: RefreshRunAcceptRequest
) {
  return apiSend<RefreshRunAcceptResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/refresh-runs/${encodeURIComponent(runId)}/accept`,
    input
  );
}
```

- [ ] **Step 4: Add refresh detail route component**

Create `apps/web/src/routes/refresh-run-detail.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { RefreshRunDetailDto } from "@specops/contracts";

import { refreshRunQuery } from "../api/queries.js";

type RefreshRunDetailPageProps = {
  projectId: string;
  runId: string;
};

export function RefreshRunDetailPage({ projectId, runId }: RefreshRunDetailPageProps) {
  const run = useQuery({
    ...refreshRunQuery(projectId, runId),
    refetchInterval: (query) => {
      const status = (query.state.data as RefreshRunDetailDto | undefined)?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    }
  });

  if (run.isLoading) return <div className="p-4 text-sm text-slate-600">Loading refresh run...</div>;
  if (run.error) return <div className="p-4 text-sm text-red-700">{run.error.message}</div>;
  if (!run.data) return <div className="p-4 text-sm text-slate-600">Refresh run is unavailable.</div>;

  const canReview = run.data.status === "succeeded" && run.data.proposalCounts.draft > 0;

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ q: undefined }}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              Back to project
            </Link>
            <h1 className="mt-1 text-base font-semibold text-slate-950">Refresh analysis</h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{run.data.status}</span>
              <span>Run {run.data.id}</span>
            </div>
          </div>
          {canReview ? (
            <Link
              to="/projects/$projectId/refresh-runs/$runId/review"
              params={{ projectId, runId: run.data.id }}
              className="button-primary"
            >
              Review refresh proposals
            </Link>
          ) : null}
        </div>
        {run.data.errorMessage ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {run.data.errorMessage}
          </p>
        ) : null}
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="section-heading">Progress</h2>
          <ol className="mt-3 divide-y divide-slate-200">
            {run.data.steps.map((step) => (
              <li key={step.name} className="py-3 first:pt-0 last:pb-0">
                <h3 className="text-sm font-medium text-slate-900">{stepLabel(step.name)}</h3>
                <p className="mt-1 text-xs text-slate-500">{step.status}</p>
                {Object.keys(step.counts).length > 0 ? (
                  <dl className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    {Object.entries(step.counts).map(([key, value]) => (
                      <div key={key} className="rounded bg-slate-50 px-2 py-1">
                        <dt className="inline font-medium text-slate-700">{key}</dt>{" "}
                        <dd className="inline">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="section-heading">Refresh Summary</h2>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700">
            <SummaryRow label="Changed source" value={run.data.changedFiles.source.length} />
            <SummaryRow label="Changed specs" value={run.data.changedFiles.specs.length} />
            <SummaryRow label="Affected specs" value={run.data.impactSummary.affectedSpecs.length} />
            <SummaryRow label="Draft proposals" value={run.data.proposalCounts.draft} />
          </dl>
        </section>
      </section>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function stepLabel(name: string) {
  return name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
```

- [ ] **Step 5: Add refresh review workspace**

Create `apps/web/src/components/refresh-review-workspace.tsx`:

```tsx
import { useMemo, useState } from "react";
import type {
  RefreshProposalDto,
  RefreshProposalPatchRequest,
  RefreshRunAcceptFailure,
  RefreshReviewResponse
} from "@specops/contracts";

type RefreshReviewWorkspaceProps = {
  projectId: string;
  runId: string;
  review: RefreshReviewResponse;
  mutationPending: boolean;
  acceptFailures: RefreshRunAcceptFailure[];
  onPatchProposal: (proposalId: string, input: RefreshProposalPatchRequest) => void;
  onAcceptProposals: (proposalIds: string[]) => void;
};

const GROUPS: Array<{ title: string; types: RefreshProposalDto["proposalType"][] }> = [
  { title: "New specs", types: ["new_spec"] },
  { title: "Spec updates", types: ["update_spec", "source_link_update"] },
  { title: "Stale links", types: ["stale_annotation", "stale_claim"] },
  { title: "Needs review", types: ["needs_review"] }
];

export function RefreshReviewWorkspace({
  acceptFailures,
  mutationPending,
  onAcceptProposals,
  onPatchProposal,
  review
}: RefreshReviewWorkspaceProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const draftIds = useMemo(
    () => new Set(review.proposals.filter((proposal) => proposal.status === "draft").map((proposal) => proposal.id)),
    [review.proposals]
  );
  const selectedDraftIds = [...selectedIds].filter((id) => draftIds.has(id));

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(16rem,0.45fr)_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold text-slate-950">Refresh review</h1>
          <button
            type="button"
            className="button-primary"
            disabled={selectedDraftIds.length === 0 || mutationPending}
            onClick={() => onAcceptProposals(selectedDraftIds)}
          >
            Apply selected
          </button>
        </div>
        {acceptFailures.length > 0 ? (
          <ul className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {acceptFailures.map((failure) => (
              <li key={failure.proposalId}>{failure.messages.map((message) => message.message).join("; ")}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 grid gap-3">
          {GROUPS.map((group) => {
            const proposals = review.proposals.filter((proposal) => group.types.includes(proposal.proposalType));
            if (proposals.length === 0) return null;
            return (
              <section key={group.title}>
                <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">{group.title}</h2>
                <ul className="grid gap-2">
                  {proposals.map((proposal) => (
                    <li key={proposal.id}>
                      <label className="flex cursor-pointer gap-2 rounded border border-slate-200 p-2 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(proposal.id)}
                          disabled={proposal.status !== "draft" || mutationPending}
                          onChange={() =>
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (next.has(proposal.id)) next.delete(proposal.id);
                              else next.add(proposal.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{proposal.title}</span>
                          <span className="block truncate text-xs text-slate-500">{proposal.targetSpecFilePath ?? proposal.proposalType}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </aside>
      <main className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3 shadow-sm">
        {review.proposals.length === 0 ? (
          <p className="text-sm text-slate-500">No refresh proposals are ready.</p>
        ) : (
          <div className="grid gap-3">
            {review.proposals.map((proposal) => (
              <article key={proposal.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-950">{proposal.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">{proposal.summary}</p>
                  </div>
                  {proposal.status === "draft" ? (
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={mutationPending}
                      onClick={() => onPatchProposal(proposal.id, { status: "discarded" })}
                    >
                      Discard
                    </button>
                  ) : null}
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                  <Fact label="Type" value={proposal.proposalType} />
                  <Fact label="Target" value={proposal.targetEntityId ?? "None"} />
                  <Fact label="Confidence" value={proposal.confidence === null ? "Unknown" : String(proposal.confidence)} />
                </dl>
                {proposal.proposedMarkdown ? (
                  <pre className="mt-3 max-h-80 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-50">
                    {proposal.proposedMarkdown}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase">{label}</dt>
      <dd className="mt-1 truncate text-slate-700">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 6: Add refresh review route**

Create `apps/web/src/routes/refresh-run-review.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { RefreshRunAcceptFailure } from "@specops/contracts";

import {
  acceptRefreshProposals,
  patchRefreshProposal,
  queryKeys,
  refreshReviewQuery
} from "../api/queries.js";
import { RefreshReviewWorkspace } from "../components/refresh-review-workspace.js";

type RefreshRunReviewPageProps = {
  projectId: string;
  runId: string;
};

export function RefreshRunReviewPage({ projectId, runId }: RefreshRunReviewPageProps) {
  const queryClient = useQueryClient();
  const review = useQuery(refreshReviewQuery(projectId, runId));
  const [acceptFailures, setAcceptFailures] = useState<RefreshRunAcceptFailure[]>([]);
  const invalidateRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.refreshRun(projectId, runId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.refreshReview(projectId, runId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.annotationsRoot(projectId) })
    ]);
  };
  const patchMutation = useMutation({
    mutationFn: (input: { proposalId: string; patch: Parameters<typeof patchRefreshProposal>[3] }) =>
      patchRefreshProposal(projectId, runId, input.proposalId, input.patch),
    onSuccess: invalidateRefresh
  });
  const acceptMutation = useMutation({
    mutationFn: (proposalIds: string[]) => acceptRefreshProposals(projectId, runId, { proposalIds }),
    onSuccess: async (result) => {
      setAcceptFailures(result.failures);
      await invalidateRefresh();
    }
  });

  if (review.isLoading) return <div className="p-4 text-sm text-slate-600">Loading refresh review...</div>;
  if (review.error) return <div className="p-4 text-sm text-red-700">{review.error.message}</div>;
  if (!review.data) return <div className="p-4 text-sm text-slate-600">Refresh review is unavailable.</div>;

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-hidden p-4">
      <Link
        to="/projects/$projectId/refresh-runs/$runId"
        params={{ projectId, runId }}
        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
      >
        Back to refresh run
      </Link>
      <RefreshReviewWorkspace
        projectId={projectId}
        runId={runId}
        review={review.data}
        mutationPending={patchMutation.isPending || acceptMutation.isPending}
        acceptFailures={acceptFailures}
        onPatchProposal={(proposalId, patch) => patchMutation.mutate({ proposalId, patch })}
        onAcceptProposals={(proposalIds) => acceptMutation.mutate(proposalIds)}
      />
    </div>
  );
}
```

- [ ] **Step 7: Register routes in app**

Modify `apps/web/src/app.tsx`:

```ts
import { RefreshRunDetailPage } from "./routes/refresh-run-detail.js";
import { RefreshRunReviewPage } from "./routes/refresh-run-review.js";
```

Add routes:

```tsx
const refreshRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/refresh-runs/$runId",
  component: () => {
    const { projectId, runId } = refreshRunDetailRoute.useParams();
    return <RefreshRunDetailPage projectId={projectId} runId={runId} />;
  }
});

const refreshRunReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/refresh-runs/$runId/review",
  component: () => {
    const { projectId, runId } = refreshRunReviewRoute.useParams();
    return <RefreshRunReviewPage projectId={projectId} runId={runId} />;
  }
});
```

Add both to `routeTree`.

- [ ] **Step 8: Run web tests and typecheck**

Run:

```bash
pnpm --filter web test -- refresh-review-workspace.test.tsx refresh-runs.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit web refresh routes**

```bash
git add apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/routes/refresh-run-detail.tsx apps/web/src/routes/refresh-run-review.tsx apps/web/src/components/refresh-review-workspace.tsx apps/web/src/components/refresh-review-workspace.test.tsx apps/web/src/routes/refresh-runs.test.tsx
git commit -m "feat: add refresh review UI"
```

---

### Task 6: Project Overview Refresh Entry Point

**Files:**

- Modify: `apps/web/src/routes/project-detail.tsx`
- Modify: `apps/web/src/components/project-actions.tsx`
- Modify: `apps/web/src/components/project-overview-dashboard.tsx`
- Test: `apps/web/src/routes/project-detail.test.tsx`
- Test: `apps/web/src/components/project-overview-dashboard.test.tsx`

- [ ] **Step 1: Add project detail refresh tests**

Append to `apps/web/src/routes/project-detail.test.tsx`:

```ts
it("starts refresh analysis and navigates to the refresh run", async () => {
  mocks.startRefreshRun = vi.fn().mockResolvedValue({ id: "refresh-1" });
  renderProjectDetail({ projectId: "project-1" });

  await clickButton("Refresh analysis");

  expect(mocks.startRefreshRun).toHaveBeenCalledWith("project-1", {});
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: "/projects/$projectId/refresh-runs/$runId",
    params: { projectId: "project-1", runId: "refresh-1" }
  });
});
```

Adapt to the local test harness names in the file.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web test -- project-detail.test.tsx -t "starts refresh analysis"
```

Expected: FAIL because `ProjectDetailPage` has no refresh mutation.

- [ ] **Step 3: Add refresh mutation to project detail**

Modify `apps/web/src/routes/project-detail.tsx` imports:

```ts
  startRefreshRun,
```

Add mutation near `analyzeMutation`:

```ts
  const refreshMutation = useMutation({
    mutationFn: () => startRefreshRun(projectId, {}),
    onSuccess: (run) =>
      navigate({
        to: "/projects/$projectId/refresh-runs/$runId",
        params: { projectId, runId: run.id }
      })
  });
```

Update pending state:

```ts
  const isProjectActionPending =
    initializeMutation.isPending ||
    indexMutation.isPending ||
    analyzeMutation.isPending ||
    refreshMutation.isPending;
```

Pass to `ProjectActions`:

```tsx
          isRefreshing={refreshMutation.isPending}
          onRefresh={() => refreshMutation.mutate()}
```

Pass to overview:

```tsx
          onRefresh={() => refreshMutation.mutate()}
          isRefreshing={refreshMutation.isPending}
```

Show mutation error:

```tsx
      {refreshMutation.error ? (
        <p className="mt-3 text-sm text-red-700">{refreshMutation.error.message}</p>
      ) : null}
```

- [ ] **Step 4: Add refresh action button**

Modify `apps/web/src/components/project-actions.tsx` props:

```ts
  isRefreshing: boolean;
  onRefresh: () => void;
```

Add a secondary action after Analyze:

```tsx
      <button
        type="button"
        className="button-secondary"
        disabled={isProjectActionPending}
        onClick={onRefresh}
      >
        {isRefreshing ? "Refreshing..." : "Refresh analysis"}
      </button>
```

Keep the existing Analyze, Initialize, Re-index, and Diff Review actions intact.

- [ ] **Step 5: Add overview panel action**

Modify `ProjectOverviewDashboardProps` in `apps/web/src/components/project-overview-dashboard.tsx`:

```ts
  onRefresh?: () => void;
  isRefreshing?: boolean;
```

Pass props into `GitDriftPanel`:

```tsx
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
```

Update `GitDriftPanel` props and render:

```tsx
function GitDriftPanel({
  projectId,
  health,
  healthError,
  isHealthLoading,
  onRefresh,
  isRefreshing = false
}: {
  projectId: string;
  health?: ProjectHealthDto;
  healthError?: Error | null;
  isHealthLoading: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
```

Inside the successful health rendering, add:

```tsx
      {onRefresh ? (
        <button
          type="button"
          className="button-secondary justify-self-start"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? "Refreshing..." : "Refresh analysis"}
        </button>
      ) : null}
```

- [ ] **Step 6: Run overview and project tests**

Run:

```bash
pnpm --filter web test -- project-detail.test.tsx project-overview-dashboard.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit refresh entry point**

```bash
git add apps/web/src/routes/project-detail.tsx apps/web/src/components/project-actions.tsx apps/web/src/components/project-overview-dashboard.tsx apps/web/src/routes/project-detail.test.tsx apps/web/src/components/project-overview-dashboard.test.tsx
git commit -m "feat: add refresh analysis entry point"
```

---

### Task 7: End-To-End Validation And Cleanup

**Files:**

- Modify only files needed to resolve failures found by the commands below.

- [ ] **Step 1: Run contracts, DB, API, and web tests**

Run:

```bash
pnpm --filter @specops/contracts test
pnpm --filter @specops/db test
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test
pnpm --filter web test
```

Expected: all commands PASS.

- [ ] **Step 2: Run typecheck and build validation**

Run:

```bash
pnpm typecheck
pnpm --filter web build
```

Expected: both commands PASS.

- [ ] **Step 3: Run a manual API smoke test**

Start dependencies if they are not already running:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

In another shell, create or use an existing project, then run:

```bash
PROJECT_ID=00000000-0000-4000-8000-000000000001
curl -s -X POST "http://127.0.0.1:4004/api/projects/${PROJECT_ID}/refresh-runs" \
  -H 'content-type: application/json' \
  -d '{}'
```

Expected: JSON response includes `id`, `status`, `steps`, and `changedFiles`.

- [ ] **Step 4: Inspect the web UI**

Open:

```text
http://127.0.0.1:5176/projects/00000000-0000-4000-8000-000000000001
```

Expected:

- Project actions include `Refresh analysis`.
- Git & Drift panel includes `Refresh analysis`.
- Starting refresh navigates to `/projects/00000000-0000-4000-8000-000000000001/refresh-runs/00000000-0000-4000-8000-000000000002`.
- Succeeded refresh with draft proposals links to `/review`.
- Applying proposals invalidates project overview, health, refresh run, refresh review, and annotations.

- [ ] **Step 5: Final cleanup commit**

When validation required fixes, stage the files reported by `git status --short`:

```bash
git status --short
git add packages/contracts/src/refresh-runs.ts packages/db/src/schema.ts apps/api/src/services/refresh-run-service.ts apps/web/src/routes/refresh-run-detail.tsx apps/web/src/routes/refresh-run-review.tsx
git commit -m "fix: stabilize refresh analysis workflow"
```

When `git status --short` prints no changed files after validation, skip this commit.
