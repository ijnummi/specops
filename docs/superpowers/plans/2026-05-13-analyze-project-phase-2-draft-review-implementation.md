# Analyze Project Phase 2 Draft Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 run-scoped Spec Assembly Workspace so users assemble reviewed specs from source and AI draft inputs before markdown files are written.

**Architecture:** Add a typed assembly contract, persistent run-scoped assembly tables, an API service that derives assemblies from existing proposals, validates claim evidence, renders deterministic markdown, and accepts assemblies. Replace the current proposal-list review UI with a three-zone workspace backed by the new endpoints while preserving the existing analyze run route.

**Tech Stack:** TypeScript, Zod contracts, Drizzle/PostgreSQL, Fastify, React, TanStack Query, TanStack Router, Vitest, Tailwind CSS.

---

## Scope Check

The approved design is one coherent subsystem: run-scoped draft review for analyze runs. It touches contracts, DB, API, and one web route, but each task below produces independently testable software and commits at a stable boundary.

## File Map

- Create `packages/contracts/src/analyze-review-assemblies.ts`: shared schemas and DTO types for assembly statuses, inputs, claims, evidence, validation, list/create/update/accept requests, and responses.
- Modify `packages/contracts/src/index.ts`: export the new contract module.
- Create `packages/contracts/src/analyze-review-assemblies.test.ts`: contract parse tests for valid and invalid payloads.
- Modify `packages/db/src/schema.ts`: add four assembly tables and indexes.
- Modify `packages/db/migrations/0000_initial.sql`: add SQL for the new tables and indexes.
- Modify `packages/db/src/migrations.test.ts`: assert migration text creates the assembly tables and constraints.
- Modify `packages/db/src/schema.typecheck.ts`: assert selected Drizzle field types.
- Create `apps/api/src/services/analyze-review-renderer.ts`: deterministic markdown renderer for assemblies.
- Create `apps/api/src/services/analyze-review-renderer.test.ts`: renderer tests for facts, hypotheses, evidence, and frontmatter.
- Create `apps/api/src/services/analyze-review-assembly-service.ts`: derivation, list, create, patch, input, claim, evidence, validation, and accept logic.
- Create `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`: service tests with DB-backed fixtures.
- Create `apps/api/src/routes/analyze-review-assemblies.ts`: Fastify routes for assembly review state and mutations.
- Modify `apps/api/src/server.ts`: register the new routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: route coverage for the new endpoints.
- Modify `apps/web/src/api/queries.ts`: query keys, query options, and mutation helpers for review assemblies.
- Create `apps/web/src/components/analyze-review-model.ts`: UI grouping/sorting helpers.
- Create `apps/web/src/components/analyze-review-model.test.ts`: tests for grouping, sorting, and validation badges.
- Create `apps/web/src/components/analyze-review-workspace.tsx`: three-zone workspace component.
- Create `apps/web/src/components/analyze-review-workspace.test.tsx`: component interaction tests.
- Modify `apps/web/src/routes/analyze-run-review.tsx`: replace proposal markdown editor route with the workspace wrapper.
- Modify `apps/web/src/routes/analyze-runs.test.tsx`: update route-level tests for the new review workflow.

## Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/analyze-review-assemblies.ts`
- Create: `packages/contracts/src/analyze-review-assemblies.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `packages/contracts/src/analyze-review-assemblies.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  analyzeReviewAcceptResponseSchema,
  analyzeReviewAssemblySchema,
  analyzeReviewListResponseSchema,
  analyzeReviewValidationSeveritySchema
} from "./analyze-review-assemblies.js";

describe("analyze review assembly contracts", () => {
  it("parses an assembly with inputs, claims, evidence, and validation", () => {
    const assembly = analyzeReviewAssemblySchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      analyzeRunId: "33333333-3333-4333-8333-333333333333",
      status: "draft",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      filePath: "use-cases/review-drafts.md",
      renderedMarkdown: null,
      inputs: [
        {
          proposalId: "44444444-4444-4444-8444-444444444444",
          role: "primary",
          proposalType: "ai_spec_entity",
          title: "Review drafts",
          entityType: "use_case",
          entityId: "use-case.review-drafts",
          filePath: "use-cases/review-drafts.md",
          confidence: 0.82,
          assignmentState: "assigned",
          evidenceCount: 1
        }
      ],
      claims: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          text: "Users review generated draft inputs before accepting specs.",
          kind: "fact",
          confidence: 0.82,
          sortOrder: 0,
          evidence: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              proposalId: "44444444-4444-4444-8444-444444444444",
              sourceFilePath: "apps/web/src/routes/analyze-run-review.tsx",
              symbolName: "AnalyzeRunReviewPage",
              startLine: 60,
              endLine: 120,
              provenance: "ai",
              confidence: 0.82
            }
          ]
        }
      ],
      validation: {
        state: "ready",
        messages: []
      },
      createdAt: "2026-05-13T12:00:00.000Z",
      updatedAt: "2026-05-13T12:00:00.000Z",
      acceptedAt: null,
      discardedAt: null
    });

    expect(assembly.validation.state).toBe("ready");
    expect(assembly.claims[0]?.evidence).toHaveLength(1);
  });

  it("rejects invalid validation severities", () => {
    expect(() => analyzeReviewValidationSeveritySchema.parse("fatal")).toThrow();
  });

  it("parses a list response with unassigned inputs and counts", () => {
    const response = analyzeReviewListResponseSchema.parse({
      assemblies: [],
      unassignedInputs: [
        {
          proposalId: "44444444-4444-4444-8444-444444444444",
          proposalType: "source_spec_entity",
          title: "Project service",
          entityType: "interface",
          entityId: "interface.project-service",
          filePath: "interfaces/project-service.md",
          confidence: 0.7,
          assignmentState: "unassigned",
          evidenceCount: 2
        }
      ],
      counts: {
        assemblies: { draft: 0, accepted: 0, discarded: 0 },
        inputs: { assigned: 0, unassigned: 1, discarded: 0 },
        validation: { blocker: 0, warning: 0, ready: 0 }
      }
    });

    expect(response.unassignedInputs[0]?.assignmentState).toBe("unassigned");
  });

  it("parses an accept response with partial validation failures", () => {
    const response = analyzeReviewAcceptResponseSchema.parse({
      acceptedAssemblyIds: ["11111111-1111-4111-8111-111111111111"],
      failures: [
        {
          assemblyId: "22222222-2222-4222-8222-222222222222",
          messages: [
            {
              severity: "blocker",
              code: "fact_missing_evidence",
              message: "Fact claims require evidence.",
              field: "claims"
            }
          ]
        }
      ],
      indexRun: null
    });

    expect(response.failures[0]?.messages[0]?.code).toBe("fact_missing_evidence");
  });
});
```

- [ ] **Step 2: Run the failing contract test**

Run:

```bash
pnpm --filter @specops/contracts test -- analyze-review-assemblies.test.ts
```

Expected: FAIL because `analyze-review-assemblies.js` does not exist.

- [ ] **Step 3: Add the contract module**

Create `packages/contracts/src/analyze-review-assemblies.ts`:

```ts
import { z } from "zod";

import { indexRunSchema } from "./indexing.js";
import { proposalTypeSchema } from "./proposals.js";

export const analyzeReviewAssemblyStatusSchema = z.enum(["draft", "accepted", "discarded"]);
export const analyzeReviewInputRoleSchema = z.enum([
  "primary",
  "supporting",
  "duplicate",
  "evidence_only"
]);
export const analyzeReviewClaimKindSchema = z.enum(["fact", "hypothesis"]);
export const analyzeReviewEvidenceProvenanceSchema = z.enum(["scanner", "ai", "user"]);
export const analyzeReviewInputAssignmentStateSchema = z.enum([
  "assigned",
  "unassigned",
  "discarded"
]);
export const analyzeReviewValidationSeveritySchema = z.enum(["blocker", "warning"]);
export const analyzeReviewValidationStateSchema = z.enum(["blocker", "warning", "ready"]);

export const analyzeReviewEntityTypeSchema = z.enum([
  "domain_entity",
  "interface",
  "use_case"
]);

export const analyzeReviewInputSchema = z.object({
  proposalId: z.string().uuid(),
  role: analyzeReviewInputRoleSchema.optional(),
  proposalType: proposalTypeSchema,
  title: z.string().min(1),
  entityType: analyzeReviewEntityTypeSchema,
  entityId: z.string().min(1),
  filePath: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  assignmentState: analyzeReviewInputAssignmentStateSchema,
  evidenceCount: z.number().int().min(0)
});

export const analyzeReviewEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    proposalId: z.string().uuid(),
    sourceFilePath: z.string().min(1),
    symbolName: z.string().min(1).nullable(),
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
    provenance: analyzeReviewEvidenceProvenanceSchema,
    confidence: z.number().min(0).max(1).nullable()
  })
  .refine(
    (value) =>
      value.startLine === null ||
      value.endLine === null ||
      value.endLine >= value.startLine,
    {
      message: "endLine must be greater than or equal to startLine",
      path: ["endLine"]
    }
  );

export const analyzeReviewClaimSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  kind: analyzeReviewClaimKindSchema,
  confidence: z.number().min(0).max(1).nullable(),
  sortOrder: z.number().int().min(0),
  evidence: z.array(analyzeReviewEvidenceSchema)
});

export const analyzeReviewValidationMessageSchema = z.object({
  severity: analyzeReviewValidationSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().min(1).nullable().default(null)
});

export const analyzeReviewValidationSummarySchema = z.object({
  state: analyzeReviewValidationStateSchema,
  messages: z.array(analyzeReviewValidationMessageSchema)
});

export const analyzeReviewAssemblySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analyzeRunId: z.string().uuid(),
  status: analyzeReviewAssemblyStatusSchema,
  entityType: analyzeReviewEntityTypeSchema,
  entityId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  filePath: z.string().min(1),
  renderedMarkdown: z.string().nullable(),
  inputs: z.array(analyzeReviewInputSchema),
  claims: z.array(analyzeReviewClaimSchema),
  validation: analyzeReviewValidationSummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  discardedAt: z.string().datetime().nullable()
});

export const analyzeReviewCountsSchema = z.object({
  assemblies: z.object({
    draft: z.number().int().min(0),
    accepted: z.number().int().min(0),
    discarded: z.number().int().min(0)
  }),
  inputs: z.object({
    assigned: z.number().int().min(0),
    unassigned: z.number().int().min(0),
    discarded: z.number().int().min(0)
  }),
  validation: z.object({
    blocker: z.number().int().min(0),
    warning: z.number().int().min(0),
    ready: z.number().int().min(0)
  })
});

export const analyzeReviewListResponseSchema = z.object({
  assemblies: z.array(analyzeReviewAssemblySchema),
  unassignedInputs: z.array(analyzeReviewInputSchema),
  counts: analyzeReviewCountsSchema
});

export const analyzeReviewCreateAssemblyRequestSchema = z.object({
  proposalIds: z.array(z.string().uuid()).default([]),
  title: z.string().min(1).optional(),
  entityType: analyzeReviewEntityTypeSchema.optional(),
  entityId: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  summary: z.string().optional()
});

export const analyzeReviewUpdateAssemblyRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    entityType: analyzeReviewEntityTypeSchema.optional(),
    entityId: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    summary: z.string().optional(),
    status: analyzeReviewAssemblyStatusSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one assembly field"
  });

export const analyzeReviewAttachInputRequestSchema = z.object({
  proposalId: z.string().uuid(),
  role: analyzeReviewInputRoleSchema
});

export const analyzeReviewCreateClaimRequestSchema = z.object({
  text: z.string().min(1),
  kind: analyzeReviewClaimKindSchema,
  confidence: z.number().min(0).max(1).nullable().default(null)
});

export const analyzeReviewUpdateClaimRequestSchema = z
  .object({
    text: z.string().min(1).optional(),
    kind: analyzeReviewClaimKindSchema.optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    sortOrder: z.number().int().min(0).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one claim field"
  });

export const analyzeReviewAttachEvidenceRequestSchema = z.object({
  proposalId: z.string().uuid(),
  sourceFilePath: z.string().min(1),
  symbolName: z.string().min(1).nullable().default(null),
  startLine: z.number().int().min(1).nullable().default(null),
  endLine: z.number().int().min(1).nullable().default(null),
  provenance: analyzeReviewEvidenceProvenanceSchema,
  confidence: z.number().min(0).max(1).nullable().default(null)
});

export const analyzeReviewAcceptRequestSchema = z.object({
  assemblyIds: z.array(z.string().uuid()).nonempty()
});

export const analyzeReviewAcceptFailureSchema = z.object({
  assemblyId: z.string().uuid(),
  messages: z.array(analyzeReviewValidationMessageSchema)
});

export const analyzeReviewAcceptResponseSchema = z.object({
  acceptedAssemblyIds: z.array(z.string().uuid()),
  failures: z.array(analyzeReviewAcceptFailureSchema),
  indexRun: indexRunSchema.nullable()
});

export type AnalyzeReviewAssemblyStatus = z.infer<typeof analyzeReviewAssemblyStatusSchema>;
export type AnalyzeReviewInputRole = z.infer<typeof analyzeReviewInputRoleSchema>;
export type AnalyzeReviewClaimKind = z.infer<typeof analyzeReviewClaimKindSchema>;
export type AnalyzeReviewValidationState = z.infer<typeof analyzeReviewValidationStateSchema>;
export type AnalyzeReviewInputDto = z.infer<typeof analyzeReviewInputSchema>;
export type AnalyzeReviewEvidenceDto = z.infer<typeof analyzeReviewEvidenceSchema>;
export type AnalyzeReviewClaimDto = z.infer<typeof analyzeReviewClaimSchema>;
export type AnalyzeReviewAssemblyDto = z.infer<typeof analyzeReviewAssemblySchema>;
export type AnalyzeReviewListResponse = z.infer<typeof analyzeReviewListResponseSchema>;
export type AnalyzeReviewCreateAssemblyRequest = z.infer<
  typeof analyzeReviewCreateAssemblyRequestSchema
>;
export type AnalyzeReviewUpdateAssemblyRequest = z.infer<
  typeof analyzeReviewUpdateAssemblyRequestSchema
>;
export type AnalyzeReviewAttachInputRequest = z.infer<typeof analyzeReviewAttachInputRequestSchema>;
export type AnalyzeReviewCreateClaimRequest = z.infer<typeof analyzeReviewCreateClaimRequestSchema>;
export type AnalyzeReviewUpdateClaimRequest = z.infer<typeof analyzeReviewUpdateClaimRequestSchema>;
export type AnalyzeReviewAttachEvidenceRequest = z.infer<
  typeof analyzeReviewAttachEvidenceRequestSchema
>;
export type AnalyzeReviewAcceptRequest = z.infer<typeof analyzeReviewAcceptRequestSchema>;
export type AnalyzeReviewAcceptResponse = z.infer<typeof analyzeReviewAcceptResponseSchema>;
```

Update `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./agent-runs.js";
export * from "./analyze-review-assemblies.js";
export * from "./analyze-runs.js";
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

- [ ] **Step 4: Run contract tests**

Run:

```bash
pnpm --filter @specops/contracts test -- analyze-review-assemblies.test.ts
pnpm --filter @specops/contracts typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```bash
git add packages/contracts/src/analyze-review-assemblies.ts packages/contracts/src/analyze-review-assemblies.test.ts packages/contracts/src/index.ts
git commit -m "feat: add analyze review assembly contracts"
```

## Task 2: Database Schema And Migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`
- Modify: `packages/db/src/schema.typecheck.ts`

- [ ] **Step 1: Write failing migration and type tests**

Add this test to `packages/db/src/migrations.test.ts`:

```ts
  it("creates analyze review assembly storage", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_assemblies");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_assembly_inputs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_claims");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_claim_evidence");
    expect(migration).toContain("analyze_review_assemblies_run_idx");
    expect(migration).toContain("analyze_review_assembly_inputs_assembly_idx");
    expect(migration).toContain("analyze_review_claims_assembly_idx");
    expect(migration).toContain("analyze_review_claim_evidence_claim_idx");
    expect(migration).toContain(
      "FOREIGN KEY (analyze_run_id) REFERENCES analyze_runs(id) ON DELETE CASCADE"
    );
    expect(migration).toContain(
      "FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id) ON DELETE CASCADE"
    );
  });
```

Update `packages/db/src/schema.typecheck.ts` imports and type assertions:

```ts
import type {
  aiProposals,
  analyzeReviewAssemblies,
  analyzeReviewClaims,
  analyzeRuns,
  indexRuns,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specLinks,
} from "./schema.js";
```

```ts
type AnalyzeReviewAssembly = InferSelectModel<typeof analyzeReviewAssemblies>;
type AnalyzeReviewClaim = InferSelectModel<typeof analyzeReviewClaims>;
type _AnalyzeReviewAssemblyRenderedMarkdownIsNullable = Expect<
  Equal<AnalyzeReviewAssembly["renderedMarkdown"], string | null>
>;
type _AnalyzeReviewClaimConfidenceIsNullable = Expect<
  Equal<AnalyzeReviewClaim["confidence"], number | null>
>;
```

- [ ] **Step 2: Run failing DB tests**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts schema.typecheck.ts
```

Expected: FAIL because the tables and exports do not exist.

- [ ] **Step 3: Add Drizzle tables**

In `packages/db/src/schema.ts`, import `primaryKey` if it is not already imported. Add the tables after `analyzeRuns`:

```ts
export const analyzeReviewAssemblies = pgTable(
  "analyze_review_assemblies",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    analyzeRunId: uuid("analyze_run_id")
      .notNull()
      .references(() => analyzeRuns.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    filePath: text("file_path").notNull(),
    renderedMarkdown: text("rendered_markdown"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index("analyze_review_assemblies_project_idx").on(table.projectId),
    runIdx: index("analyze_review_assemblies_run_idx").on(table.analyzeRunId),
    runStatusIdx: index("analyze_review_assemblies_run_status_idx").on(
      table.analyzeRunId,
      table.status,
    ),
  }),
);

export const analyzeReviewAssemblyInputs = pgTable(
  "analyze_review_assembly_inputs",
  {
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => analyzeReviewAssemblies.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => aiProposals.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.assemblyId, table.proposalId] }),
    assemblyIdx: index("analyze_review_assembly_inputs_assembly_idx").on(table.assemblyId),
    proposalIdx: index("analyze_review_assembly_inputs_proposal_idx").on(table.proposalId),
  }),
);

export const analyzeReviewClaims = pgTable(
  "analyze_review_claims",
  {
    id: primaryId(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => analyzeReviewAssemblies.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: text("kind").notNull(),
    confidence: doublePrecision("confidence"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    assemblyIdx: index("analyze_review_claims_assembly_idx").on(table.assemblyId),
  }),
);

export const analyzeReviewClaimEvidence = pgTable(
  "analyze_review_claim_evidence",
  {
    id: primaryId(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => analyzeReviewClaims.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => aiProposals.id, { onDelete: "cascade" }),
    sourceFilePath: text("source_file_path").notNull(),
    symbolName: text("symbol_name"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    provenance: text("provenance").notNull(),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    claimIdx: index("analyze_review_claim_evidence_claim_idx").on(table.claimId),
    proposalIdx: index("analyze_review_claim_evidence_proposal_idx").on(table.proposalId),
  }),
);
```

- [ ] **Step 4: Add migration SQL**

Append matching `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements to `packages/db/migrations/0000_initial.sql`. Use existing migration style. Include:

```sql
CREATE TABLE IF NOT EXISTS analyze_review_assemblies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analyze_run_id uuid NOT NULL,
  status text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  file_path text NOT NULL,
  rendered_markdown text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  discarded_at timestamptz,
  FOREIGN KEY (analyze_run_id) REFERENCES analyze_runs(id) ON DELETE CASCADE
);
```

Add equivalent SQL for the other three tables using the schema from Step 3, then add indexes named in the migration test.

- [ ] **Step 5: Run DB verification**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit DB changes**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts packages/db/src/schema.typecheck.ts
git commit -m "feat: add analyze review assembly storage"
```

## Task 3: Renderer

**Files:**
- Create: `apps/api/src/services/analyze-review-renderer.ts`
- Create: `apps/api/src/services/analyze-review-renderer.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Create `apps/api/src/services/analyze-review-renderer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderAnalyzeReviewAssemblyMarkdown } from "./analyze-review-renderer.js";

describe("renderAnalyzeReviewAssemblyMarkdown", () => {
  it("renders deterministic markdown with facts, hypotheses, evidence, and frontmatter", () => {
    const markdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: "use-case.review-drafts",
      entityType: "use_case",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      claims: [
        {
          text: "Users can accept reviewed assemblies.",
          kind: "fact",
          evidence: [
            {
              sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
              symbolName: "registerAnalyzeReviewAssemblyRoutes",
              startLine: 20,
              endLine: 80
            }
          ]
        },
        {
          text: "The review model may later feed refresh workflows.",
          kind: "hypothesis",
          evidence: []
        }
      ],
      proposedLinks: [
        {
          linkType: "relates_to",
          targetEntityId: "interface.proposal-service",
          rationale: "Assemblies are built from proposal inputs."
        }
      ]
    });

    expect(markdown).toContain("id: use-case.review-drafts");
    expect(markdown).toContain("type: use_case");
    expect(markdown).toContain("# Review drafts");
    expect(markdown).toContain("## Reviewed Facts");
    expect(markdown).toContain("Users can accept reviewed assemblies.");
    expect(markdown).toContain("apps/api/src/routes/analyze-review-assemblies.ts:20-80");
    expect(markdown).toContain("## Hypotheses and Unknowns");
    expect(markdown).toContain("The review model may later feed refresh workflows.");
    expect(markdown).toContain("## Proposed Links");
  });
});
```

- [ ] **Step 2: Run failing renderer test**

Run:

```bash
pnpm --filter api test -- src/services/analyze-review-renderer.test.ts
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement renderer**

Create `apps/api/src/services/analyze-review-renderer.ts`:

```ts
type RenderEvidence = {
  sourceFilePath: string;
  symbolName: string | null;
  startLine: number | null;
  endLine: number | null;
};

type RenderClaim = {
  text: string;
  kind: "fact" | "hypothesis";
  evidence: RenderEvidence[];
};

type RenderLink = {
  linkType: string;
  targetEntityId: string;
  rationale: string;
};

type RenderAssemblyInput = {
  entityId: string;
  entityType: "domain_entity" | "interface" | "use_case";
  title: string;
  summary: string;
  claims: RenderClaim[];
  proposedLinks: RenderLink[];
};

export function renderAnalyzeReviewAssemblyMarkdown(input: RenderAssemblyInput): string {
  const facts = input.claims.filter((claim) => claim.kind === "fact");
  const hypotheses = input.claims.filter((claim) => claim.kind === "hypothesis");
  const lines = [
    "---",
    `id: ${input.entityId}`,
    `type: ${input.entityType}`,
    `title: ${input.title}`,
    "status: draft",
    "---",
    "",
    `# ${input.title}`,
    "",
    input.summary.trim(),
    "",
    "## Reviewed Facts",
    "",
    ...renderClaims(facts),
    "## Hypotheses and Unknowns",
    "",
    ...renderClaims(hypotheses),
    "## Source Evidence",
    "",
    ...renderEvidence(input.claims),
    "## Proposed Links",
    "",
    ...renderLinks(input.proposedLinks)
  ];

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderClaims(claims: RenderClaim[]): string[] {
  if (claims.length === 0) {
    return ["- None recorded.", ""];
  }

  return claims.flatMap((claim) => [`- ${claim.text}`, ""]);
}

function renderEvidence(claims: RenderClaim[]): string[] {
  const evidence = claims.flatMap((claim) =>
    claim.evidence.map((item) => ({ claim: claim.text, ...item }))
  );

  if (evidence.length === 0) {
    return ["- None recorded.", ""];
  }

  return evidence.flatMap((item) => {
    const location =
      item.startLine && item.endLine
        ? `${item.sourceFilePath}:${item.startLine}-${item.endLine}`
        : item.sourceFilePath;
    const symbol = item.symbolName ? ` (${item.symbolName})` : "";
    return [`- ${location}${symbol}: ${item.claim}`, ""];
  });
}

function renderLinks(links: RenderLink[]): string[] {
  if (links.length === 0) {
    return ["- None proposed.", ""];
  }

  return links.flatMap((link) => [
    `- ${link.linkType}: ${link.targetEntityId}`,
    `  - ${link.rationale}`,
    ""
  ]);
}
```

- [ ] **Step 4: Run renderer tests**

Run:

```bash
pnpm --filter api test -- src/services/analyze-review-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit renderer**

```bash
git add apps/api/src/services/analyze-review-renderer.ts apps/api/src/services/analyze-review-renderer.test.ts
git commit -m "feat: render analyze review assemblies"
```

## Task 4: Assembly Service Core

**Files:**
- Create: `apps/api/src/services/analyze-review-assembly-service.ts`
- Create: `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`

- [ ] **Step 1: Write failing service tests for derivation and list**

Create `apps/api/src/__tests__/analyze-review-assembly-service.test.ts` with tests that:

```ts
import { describe, expect, it } from "vitest";

import { createAnalyzeReviewAssemblyService } from "../services/analyze-review-assembly-service.js";

describe("createAnalyzeReviewAssemblyService", () => {
  it("derives one draft assembly per run proposal and is idempotent", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);

    const first = await service.listReviewAssemblies(project.id, run.id);
    const second = await service.listReviewAssemblies(project.id, run.id);

    expect(first.assemblies).toHaveLength(1);
    expect(second.assemblies).toHaveLength(1);
    expect(first.assemblies[0]?.inputs[0]?.proposalId).toBe(proposal.id);
    expect(first.assemblies[0]?.validation.state).toBe("ready");
  });

  it("attaches and removes proposal inputs", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md",
      summary: "Review generated drafts.",
      proposalIds: []
    });

    await service.attachInput(project.id, run.id, assembly.id, {
      proposalId: proposal.id,
      role: "primary"
    });
    let review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.inputs).toHaveLength(1);

    await service.removeInput(project.id, run.id, assembly.id, proposal.id);
    review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.inputs).toHaveLength(0);
    expect(review.unassignedInputs).toHaveLength(1);
  });
});
```

Implement `createReviewFixture` in this test using existing route-test fixture patterns from `apps/api/src/__tests__/routes.test.ts`: create a project, insert an analyze run with `proposal_ids_json`, and insert one `ai_proposals` row with valid `ai_spec_entity` payload/evidence.

- [ ] **Step 2: Run failing service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/analyze-review-assembly-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement core service methods**

Create `apps/api/src/services/analyze-review-assembly-service.ts` with:

```ts
export function createAnalyzeReviewAssemblyService(db: Db) {
  return {
    listReviewAssemblies,
    createAssembly,
    patchAssembly,
    attachInput,
    removeInput,
    createClaim,
    patchClaim,
    attachEvidence,
    removeEvidence,
    acceptAssemblies
  };
}
```

Implement these first:

- `listReviewAssemblies(projectId, runId)`: assert run exists, call `ensureInitialAssemblies`, return mapped assemblies and unassigned inputs.
- `ensureInitialAssemblies(projectId, runId)`: if any assemblies exist for run, do nothing; otherwise create one assembly per `analyzeRuns.proposalIdsJson` proposal.
- `createAssembly(projectId, runId, input)`: insert draft assembly and attach requested proposal ids.
- `patchAssembly(projectId, runId, assemblyId, input)`: update fields and `updatedAt`.
- `attachInput(projectId, runId, assemblyId, input)`: verify proposal belongs to `proposalIdsJson`; block non-`evidence_only` duplicate active assignment.
- `removeInput(projectId, runId, assemblyId, proposalId)`: delete join row.

Mapping rules:

- derive `entityType`, `entityId`, `filePath`, and `title` from `payloadJson`.
- map source proposal evidence and AI selected source evidence into claim evidence.
- create one initial fact claim from source proposal title or first AI claim when evidence exists.
- create one hypothesis claim when no parseable evidence exists.
- validation state is `blocker` if a fact claim lacks evidence, `warning` if any hypothesis exists, otherwise `ready`.

- [ ] **Step 4: Run core service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/analyze-review-assembly-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit service core**

```bash
git add apps/api/src/services/analyze-review-assembly-service.ts apps/api/src/__tests__/analyze-review-assembly-service.test.ts
git commit -m "feat: derive analyze review assemblies"
```

## Task 5: Claims, Evidence, Validation, And Accept

**Files:**
- Modify: `apps/api/src/services/analyze-review-assembly-service.ts`
- Modify: `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`

- [ ] **Step 1: Add failing service tests for claims and accept**

Add tests to `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`:

```ts
  it("blocks accepting fact claims without evidence and accepts unrelated ready assemblies", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const blocked = await service.createAssembly(project.id, run.id, {
      title: "Blocked",
      entityType: "use_case",
      entityId: "use-case.blocked",
      filePath: "use-cases/blocked.md",
      summary: "Blocked assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, blocked.id, {
      text: "This fact has no evidence.",
      kind: "fact",
      confidence: 0.5
    });

    const ready = await service.createAssembly(project.id, run.id, {
      title: "Ready",
      entityType: "use_case",
      entityId: "use-case.ready",
      filePath: "use-cases/ready.md",
      summary: "Ready assembly.",
      proposalIds: []
    });
    const claim = await service.createClaim(project.id, run.id, ready.id, {
      text: "This fact has evidence.",
      kind: "fact",
      confidence: 0.9
    });
    await service.attachEvidence(project.id, run.id, ready.id, claim.id, {
      proposalId: run.proposalIds[0],
      sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
      symbolName: "acceptAssemblies",
      startLine: 1,
      endLine: 20,
      provenance: "user",
      confidence: 0.9
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [blocked.id, ready.id]
    });

    expect(result.acceptedAssemblyIds).toEqual([ready.id]);
    expect(result.failures[0]?.assemblyId).toBe(blocked.id);
    expect(result.failures[0]?.messages[0]?.code).toBe("fact_missing_evidence");
  });

  it("renders hypotheses under a labeled section when accepted", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Hypothesis",
      entityType: "use_case",
      entityId: "use-case.hypothesis",
      filePath: "use-cases/hypothesis.md",
      summary: "Hypothesis assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "This needs user confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });

    expect(result.acceptedAssemblyIds).toEqual([assembly.id]);
    const review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.renderedMarkdown).toContain("## Hypotheses and Unknowns");
  });
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/analyze-review-assembly-service.test.ts
```

Expected: FAIL because claim/evidence/accept methods are incomplete.

- [ ] **Step 3: Implement claims and evidence**

In `analyze-review-assembly-service.ts`, implement:

- `createClaim`: insert claim with next `sortOrder`.
- `patchClaim`: update claim fields after verifying assembly/run/project ownership.
- `attachEvidence`: insert evidence after verifying proposal belongs to run and claim belongs to assembly.
- `removeEvidence`: delete evidence after ownership verification.
- `validateAssembly`: returns blocker for missing title/entity/file path, blocker for fact with no evidence, warning for hypotheses, ready otherwise.

- [ ] **Step 4: Implement accept**

In `acceptAssemblies`:

1. Load selected assemblies.
2. Validate each assembly.
3. For valid assemblies, render markdown using `renderAnalyzeReviewAssemblyMarkdown`.
4. Use the same path-safety pattern as `proposal-service.ts` to write under `project.specopsPath`.
5. Parse rendered markdown with `parseSpecMarkdown`.
6. Mark valid assemblies `accepted`, set `acceptedAt`, and store `renderedMarkdown`.
7. Mark attached pending proposal rows as `accepted` with `reviewedAt`.
8. Run `createIndexerService(db).indexProject(projectId)` after at least one write.
9. Return `acceptedAssemblyIds`, `failures`, and nullable `indexRun`.

- [ ] **Step 5: Run service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/analyze-review-assembly-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit service accept**

```bash
git add apps/api/src/services/analyze-review-assembly-service.ts apps/api/src/__tests__/analyze-review-assembly-service.test.ts
git commit -m "feat: accept analyze review assemblies"
```

## Task 6: API Routes

**Files:**
- Create: `apps/api/src/routes/analyze-review-assemblies.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Add route tests in `apps/api/src/__tests__/routes.test.ts` near analyze-run tests:

```ts
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
```

- [ ] **Step 2: Run failing route tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: FAIL with 404 for review assembly routes.

- [ ] **Step 3: Implement routes**

Create `apps/api/src/routes/analyze-review-assemblies.ts`:

```ts
import {
  analyzeReviewAcceptRequestSchema,
  analyzeReviewAttachEvidenceRequestSchema,
  analyzeReviewAttachInputRequestSchema,
  analyzeReviewCreateAssemblyRequestSchema,
  analyzeReviewCreateClaimRequestSchema,
  analyzeReviewUpdateAssemblyRequestSchema,
  analyzeReviewUpdateClaimRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAnalyzeReviewAssemblyService } from "../services/analyze-review-assembly-service.js";

type RouteOptions = { db: Db };

const runParamsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid()
});
const assemblyParamsSchema = runParamsSchema.extend({ assemblyId: z.string().uuid() });
const inputParamsSchema = assemblyParamsSchema.extend({ proposalId: z.string().uuid() });
const claimParamsSchema = assemblyParamsSchema.extend({ claimId: z.string().uuid() });
const evidenceParamsSchema = claimParamsSchema.extend({ evidenceId: z.string().uuid() });

export const registerAnalyzeReviewAssemblyRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db }
) => {
  const service = createAnalyzeReviewAssemblyService(db);

  app.get("/projects/:projectId/analyze-runs/:runId/review-assemblies", async (request) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    return service.listReviewAssemblies(projectId, runId);
  });

  app.post("/projects/:projectId/analyze-runs/:runId/review-assemblies", async (request, reply) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    const input = analyzeReviewCreateAssemblyRequestSchema.parse(request.body);
    return reply.code(201).send(await service.createAssembly(projectId, runId, input));
  });

  app.patch(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId",
    async (request) => {
      const { projectId, runId, assemblyId } = assemblyParamsSchema.parse(request.params);
      const input = analyzeReviewUpdateAssemblyRequestSchema.parse(request.body);
      return service.patchAssembly(projectId, runId, assemblyId, input);
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/inputs",
    async (request, reply) => {
      const { projectId, runId, assemblyId } = assemblyParamsSchema.parse(request.params);
      const input = analyzeReviewAttachInputRequestSchema.parse(request.body);
      return reply.code(201).send(await service.attachInput(projectId, runId, assemblyId, input));
    }
  );

  app.delete(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/inputs/:proposalId",
    async (request, reply) => {
      const { projectId, runId, assemblyId, proposalId } = inputParamsSchema.parse(request.params);
      await service.removeInput(projectId, runId, assemblyId, proposalId);
      return reply.code(204).send();
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims",
    async (request, reply) => {
      const { projectId, runId, assemblyId } = assemblyParamsSchema.parse(request.params);
      const input = analyzeReviewCreateClaimRequestSchema.parse(request.body);
      return reply.code(201).send(await service.createClaim(projectId, runId, assemblyId, input));
    }
  );

  app.patch(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId",
    async (request) => {
      const { projectId, runId, assemblyId, claimId } = claimParamsSchema.parse(request.params);
      const input = analyzeReviewUpdateClaimRequestSchema.parse(request.body);
      return service.patchClaim(projectId, runId, assemblyId, claimId, input);
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId/evidence",
    async (request, reply) => {
      const { projectId, runId, assemblyId, claimId } = claimParamsSchema.parse(request.params);
      const input = analyzeReviewAttachEvidenceRequestSchema.parse(request.body);
      return reply
        .code(201)
        .send(await service.attachEvidence(projectId, runId, assemblyId, claimId, input));
    }
  );

  app.delete(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId/evidence/:evidenceId",
    async (request, reply) => {
      const { projectId, runId, assemblyId, claimId, evidenceId } = evidenceParamsSchema.parse(
        request.params
      );
      await service.removeEvidence(projectId, runId, assemblyId, claimId, evidenceId);
      return reply.code(204).send();
    }
  );

  app.post(
    "/projects/:projectId/analyze-runs/:runId/review-assemblies/accept",
    async (request) => {
      const { projectId, runId } = runParamsSchema.parse(request.params);
      const input = analyzeReviewAcceptRequestSchema.parse(request.body);
      return service.acceptAssemblies(projectId, runId, input);
    }
  );
};
```

Register in `apps/api/src/server.ts`:

```ts
import { registerAnalyzeReviewAssemblyRoutes } from "./routes/analyze-review-assemblies.js";
```

```ts
  app.register(registerAnalyzeReviewAssemblyRoutes, { prefix: "/api", db });
```

- [ ] **Step 4: Run API route tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts src/__tests__/analyze-review-assembly-service.test.ts
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit API routes**

```bash
git add apps/api/src/routes/analyze-review-assemblies.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose analyze review assembly api"
```

## Task 7: Web API Client And Model Helpers

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/analyze-review-model.ts`
- Create: `apps/web/src/components/analyze-review-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `apps/web/src/components/analyze-review-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  groupAnalyzeReviewInputs,
  sortAnalyzeReviewAssemblies
} from "./analyze-review-model.js";

describe("analyze review model", () => {
  it("groups inputs by entity type and unknown confidence", () => {
    const groups = groupAnalyzeReviewInputs([
      input({ entityType: "domain_entity", title: "Project" }),
      input({ entityType: "interface", title: "Project service" }),
      input({ entityType: "use_case", title: "Review drafts", confidence: null })
    ]);

    expect(groups.Domain).toHaveLength(1);
    expect(groups.Interfaces).toHaveLength(1);
    expect(groups.Unknowns).toHaveLength(1);
  });

  it("sorts blocker assemblies before warnings and ready assemblies", () => {
    const sorted = sortAnalyzeReviewAssemblies([
      assembly("ready", "Ready"),
      assembly("blocker", "Blocked"),
      assembly("warning", "Warning")
    ]);

    expect(sorted.map((item) => item.title)).toEqual(["Blocked", "Warning", "Ready"]);
  });
});
```

Add local test builders in the same file for `input` and `assembly`.

- [ ] **Step 2: Run failing web model tests**

Run:

```bash
pnpm --filter web test -- src/components/analyze-review-model.test.ts
```

Expected: FAIL because the model helper file does not exist.

- [ ] **Step 3: Add query helpers**

In `apps/web/src/api/queries.ts`, import new contract types and add:

```ts
  analyzeReviewAssemblies: (projectId: string, runId: string) =>
    ["projects", projectId, "analyze-runs", runId, "review-assemblies"] as const,
```

Add functions:

```ts
export function analyzeReviewAssembliesQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.analyzeReviewAssemblies(projectId, runId),
    queryFn: () =>
      apiGet<AnalyzeReviewListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
          runId
        )}/review-assemblies`
      )
  });
}

export function createAnalyzeReviewAssembly(
  projectId: string,
  runId: string,
  input: AnalyzeReviewCreateAssemblyRequest
) {
  return apiSend<AnalyzeReviewAssemblyDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies`,
    input
  );
}
```

Add the remaining mutation helpers:

```ts
export function patchAnalyzeReviewAssembly(
  projectId: string,
  runId: string,
  assemblyId: string,
  input: AnalyzeReviewUpdateAssemblyRequest
) {
  return apiSend<AnalyzeReviewAssemblyDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}`,
    input
  );
}

export function attachAnalyzeReviewInput(
  projectId: string,
  runId: string,
  assemblyId: string,
  input: AnalyzeReviewAttachInputRequest
) {
  return apiSend<AnalyzeReviewAssemblyDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}/inputs`,
    input
  );
}

export function removeAnalyzeReviewInput(
  projectId: string,
  runId: string,
  assemblyId: string,
  proposalId: string
) {
  return apiSend<void>(
    "DELETE",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}/inputs/${encodeURIComponent(
      proposalId
    )}`
  );
}

export function createAnalyzeReviewClaim(
  projectId: string,
  runId: string,
  assemblyId: string,
  input: AnalyzeReviewCreateClaimRequest
) {
  return apiSend<AnalyzeReviewClaimDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}/claims`,
    input
  );
}

export function patchAnalyzeReviewClaim(
  projectId: string,
  runId: string,
  assemblyId: string,
  claimId: string,
  input: AnalyzeReviewUpdateClaimRequest
) {
  return apiSend<AnalyzeReviewClaimDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}/claims/${encodeURIComponent(
      claimId
    )}`,
    input
  );
}

export function attachAnalyzeReviewEvidence(
  projectId: string,
  runId: string,
  assemblyId: string,
  claimId: string,
  input: AnalyzeReviewAttachEvidenceRequest
) {
  return apiSend<AnalyzeReviewEvidenceDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}/claims/${encodeURIComponent(
      claimId
    )}/evidence`,
    input
  );
}

export function removeAnalyzeReviewEvidence(
  projectId: string,
  runId: string,
  assemblyId: string,
  claimId: string,
  evidenceId: string
) {
  return apiSend<void>(
    "DELETE",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/${encodeURIComponent(assemblyId)}/claims/${encodeURIComponent(
      claimId
    )}/evidence/${encodeURIComponent(evidenceId)}`
  );
}

export function acceptAnalyzeReviewAssemblies(
  projectId: string,
  runId: string,
  input: AnalyzeReviewAcceptRequest
) {
  return apiSend<AnalyzeReviewAcceptResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
      runId
    )}/review-assemblies/accept`,
    input
  );
}
```

- [ ] **Step 4: Add model helpers**

Create `apps/web/src/components/analyze-review-model.ts`:

```ts
import type {
  AnalyzeReviewAssemblyDto,
  AnalyzeReviewInputDto,
  AnalyzeReviewValidationState
} from "@specops/contracts";

export type AnalyzeReviewInputGroupName =
  | "Domain"
  | "Services"
  | "Interfaces"
  | "Use Cases"
  | "Data Models"
  | "Unknowns";

const validationRank: Record<AnalyzeReviewValidationState, number> = {
  blocker: 0,
  warning: 1,
  ready: 2
};

export function groupAnalyzeReviewInputs(inputs: AnalyzeReviewInputDto[]) {
  const groups: Record<AnalyzeReviewInputGroupName, AnalyzeReviewInputDto[]> = {
    Domain: [],
    Services: [],
    Interfaces: [],
    "Use Cases": [],
    "Data Models": [],
    Unknowns: []
  };

  for (const input of inputs) {
    groups[groupForInput(input)].push(input);
  }

  return groups;
}

export function sortAnalyzeReviewAssemblies(assemblies: AnalyzeReviewAssemblyDto[]) {
  return [...assemblies].sort((left, right) => {
    const validation =
      validationRank[left.validation.state] - validationRank[right.validation.state];
    if (validation !== 0) {
      return validation;
    }
    return left.title.localeCompare(right.title);
  });
}

function groupForInput(input: AnalyzeReviewInputDto): AnalyzeReviewInputGroupName {
  if (input.confidence === null || input.confidence < 0.35) {
    return "Unknowns";
  }

  if (input.entityType === "domain_entity") {
    return "Domain";
  }

  if (input.entityType === "interface") {
    return input.title.toLowerCase().includes("model") ? "Data Models" : "Interfaces";
  }

  return "Use Cases";
}
```

- [ ] **Step 5: Run web helper tests**

Run:

```bash
pnpm --filter web test -- src/components/analyze-review-model.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit web API/model**

```bash
git add apps/web/src/api/queries.ts apps/web/src/components/analyze-review-model.ts apps/web/src/components/analyze-review-model.test.ts
git commit -m "feat: add analyze review web client model"
```

## Task 8: Workspace UI

**Files:**
- Create: `apps/web/src/components/analyze-review-workspace.tsx`
- Create: `apps/web/src/components/analyze-review-workspace.test.tsx`
- Modify: `apps/web/src/routes/analyze-run-review.tsx`
- Modify: `apps/web/src/routes/analyze-runs.test.tsx`

- [ ] **Step 1: Write failing workspace component tests**

Create `apps/web/src/components/analyze-review-workspace.test.tsx` with tests that render `AnalyzeReviewWorkspace` using fixture data and assert:

```ts
expect(container.textContent).toContain("Draft pool");
expect(container.textContent).toContain("Assembly list");
expect(container.textContent).toContain("Assembly detail");
expect(container.textContent).toContain("Review drafts");
expect(container.textContent).toContain("fact_missing_evidence");
```

Add interaction tests:

```ts
await clickButton(container, "Create assembly");
expect(mocks.createAssembly).toHaveBeenCalledWith("project-1", "run-1", expect.objectContaining({ proposalIds: [] }));

await clickButton(container, "Accept selected");
expect(mocks.acceptAssemblies).toHaveBeenCalledWith("project-1", "run-1", { assemblyIds: ["assembly-ready"] });
```

- [ ] **Step 2: Run failing UI tests**

Run:

```bash
pnpm --filter web test -- src/components/analyze-review-workspace.test.tsx
```

Expected: FAIL because the workspace component does not exist.

- [ ] **Step 3: Implement workspace component**

Create `apps/web/src/components/analyze-review-workspace.tsx` with props:

```ts
type AnalyzeReviewWorkspaceProps = {
  projectId: string;
  runId: string;
  review: AnalyzeReviewListResponse;
  onCreateAssembly: (input: AnalyzeReviewCreateAssemblyRequest) => void;
  onPatchAssembly: (assemblyId: string, input: AnalyzeReviewUpdateAssemblyRequest) => void;
  onAttachInput: (assemblyId: string, input: AnalyzeReviewAttachInputRequest) => void;
  onRemoveInput: (assemblyId: string, proposalId: string) => void;
  onCreateClaim: (assemblyId: string, input: AnalyzeReviewCreateClaimRequest) => void;
  onPatchClaim: (assemblyId: string, claimId: string, input: AnalyzeReviewUpdateClaimRequest) => void;
  onAcceptAssemblies: (assemblyIds: string[]) => void;
  mutationPending: boolean;
};
```

Implement:

- left draft pool grouped with `groupAnalyzeReviewInputs`
- middle assembly list sorted with `sortAnalyzeReviewAssemblies`
- right detail form with title, entity id, type, path, summary, claims, evidence, and markdown preview
- checkbox selection for ready assemblies
- buttons for create assembly, discard assembly, attach selected inputs, and accept selected
- compact validation messages with blocker/warning styles

Use existing utility classes such as `button-primary`, `button-secondary`, `panel-section`, and `section-heading`. Keep cards only for repeated rows and avoid nested cards.

- [ ] **Step 4: Replace route wrapper**

Modify `apps/web/src/routes/analyze-run-review.tsx` so it:

- fetches `analyzeReviewAssembliesQuery(projectId, runId)`
- wires mutations from `queries.ts`
- invalidates `queryKeys.analyzeReviewAssemblies(projectId, runId)` plus project/proposal/entity/index queries after accept
- renders `<AnalyzeReviewWorkspace />`
- keeps the back link to `/projects/$projectId/analyze-runs/$runId`

Remove the old proposal markdown editor implementation from this route after tests are updated.

- [ ] **Step 5: Update route tests**

In `apps/web/src/routes/analyze-runs.test.tsx`, update `AnalyzeRunReviewPage` tests to mock `analyzeReviewAssembliesQuery` and the new mutation helpers. Replace assertions for `source_spec_entity`, `ai_spec_entity`, and `Save markdown` with assertions for:

- `Draft pool`
- `Assembly list`
- `Assembly detail`
- validation blocker text
- `Accept selected`
- back link to progress

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm --filter web test -- src/components/analyze-review-model.test.ts src/components/analyze-review-workspace.test.tsx src/routes/analyze-runs.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit workspace UI**

```bash
git add apps/web/src/components/analyze-review-workspace.tsx apps/web/src/components/analyze-review-workspace.test.tsx apps/web/src/routes/analyze-run-review.tsx apps/web/src/routes/analyze-runs.test.tsx
git commit -m "feat: add analyze review assembly workspace"
```

## Task 9: Full Verification

**Files:**
- No planned source edits unless verification finds a bug.

- [ ] **Step 1: Run focused test suites**

Run:

```bash
pnpm --filter @specops/contracts test -- analyze-review-assemblies.test.ts
pnpm --filter @specops/db test -- migrations.test.ts
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/services/analyze-review-renderer.test.ts src/__tests__/analyze-review-assembly-service.test.ts src/__tests__/routes.test.ts
pnpm --filter web test -- src/components/analyze-review-model.test.ts src/components/analyze-review-workspace.test.tsx src/routes/analyze-runs.test.tsx
```

Expected: all commands PASS.

- [ ] **Step 2: Run repo validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands PASS.

- [ ] **Step 3: Browser verification**

Run the app:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5176`, start or open an analyze run, and navigate to `/projects/$projectId/analyze-runs/$runId/review`.

Verify:

- draft pool, assembly list, and detail panel all render without overlap at desktop width
- narrow width keeps text inside controls and rows
- blocker assemblies sort before warnings and ready assemblies
- fact claims without evidence block accept
- hypotheses render in the markdown preview under `Hypotheses and Unknowns`
- accepting a ready assembly writes a spec and returns to a clean review state

- [ ] **Step 4: Final commit if verification fixes were needed**

If verification required fixes:

```bash
git add packages/contracts/src/analyze-review-assemblies.ts packages/contracts/src/analyze-review-assemblies.test.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts packages/db/src/schema.typecheck.ts apps/api/src/services/analyze-review-renderer.ts apps/api/src/services/analyze-review-renderer.test.ts apps/api/src/services/analyze-review-assembly-service.ts apps/api/src/__tests__/analyze-review-assembly-service.test.ts apps/api/src/routes/analyze-review-assemblies.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts apps/web/src/api/queries.ts apps/web/src/components/analyze-review-model.ts apps/web/src/components/analyze-review-model.test.ts apps/web/src/components/analyze-review-workspace.tsx apps/web/src/components/analyze-review-workspace.test.tsx apps/web/src/routes/analyze-run-review.tsx apps/web/src/routes/analyze-runs.test.tsx
git commit -m "fix: stabilize analyze review assembly workflow"
```

If no fixes were needed, do not create an empty commit.
