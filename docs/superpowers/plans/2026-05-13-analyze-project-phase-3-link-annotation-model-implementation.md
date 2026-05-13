# Analyze Project Phase 3 Link Annotation Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 3 structured source/spec annotation model so SpecOps can answer what code supports a spec and what spec explains a source file.

**Architecture:** Add first-class annotation contracts, DB storage, API routes, and a backend service that replaces the product role of `source_spec_links`. Scanner `@specops` comments and accepted Phase 2 claim evidence both write annotations; entity and source UI read annotations through one query model grouped by relationship type.

**Tech Stack:** pnpm monorepo, TypeScript, Zod contracts, Drizzle/PostgreSQL, Fastify, React, TanStack Query, Vitest.

---

## File Structure

Create:

- `packages/contracts/src/annotations.ts`: Zod schemas and DTO/request types for source/spec annotations.
- `apps/api/src/services/annotation-service.ts`: annotation CRUD, filters, scanner ingestion helpers, validation helpers, and source excerpts.
- `apps/api/src/routes/annotations.ts`: project-scoped annotation routes.
- `apps/api/src/__tests__/annotation-service.test.ts`: DB-backed unit tests for service behavior.
- `apps/web/src/components/annotation-panels.tsx`: grouped annotation panel for entity/source detail surfaces.
- `apps/web/src/components/annotation-panels.test.tsx`: UI tests for grouping, stale state, and reverse source-to-spec rendering.

Modify:

- `packages/contracts/src/index.ts`: export annotation contracts.
- `packages/contracts/src/source.ts`: remove `SourceSpecLinkDto` from new annotation paths while leaving the old type only until obsolete callers are gone.
- `packages/contracts/src/impact.ts`: add relationship type fields to source evidence because impact still includes source nodes.
- `packages/db/src/schema.ts`: add `sourceSpecAnnotations`; keep `sourceSpecLinks` only if old tests still need it during migration.
- `packages/db/src/migrations.test.ts`: assert annotation table and indexes exist in `0000_initial.sql`.
- `packages/db/migrations/0000_initial.sql`: create annotation table/indexes and migrate or supersede `source_spec_links`.
- `packages/db/src/schema.typecheck.ts`: include annotation select/insert type checks.
- `apps/api/src/server.ts`: register annotation routes.
- `apps/api/src/services/source-scan-service.ts`: persist scanner annotations through `annotation-service`.
- `apps/api/src/services/analyze-review-assembly-service.ts`: promote accepted evidence to annotations and render annotation-aware markdown.
- `apps/api/src/services/analyze-review-renderer.ts`: render inline evidence footnotes and grouped source links.
- `apps/api/src/services/impact-service.ts`: read source annotations instead of `sourceSpecLinks`.
- `apps/api/src/services/spec-readiness-service.ts`: use active annotations for source-backed entity checks.
- `apps/api/src/services/project-overview-service.ts`: count source-backed entities from annotations.
- `apps/api/src/services/review-summary-service.ts`: use annotations for changed source/spec summaries.
- `apps/api/src/services/admin-database-service.ts`: expose `source_spec_annotations`.
- `apps/api/src/routes/entities.ts`: remove `/source-links` dependency.
- `apps/api/src/routes/source.ts`: leave source-file detail unchanged and use `/annotations?sourceFileId=` for source-to-spec annotation reads.
- `apps/api/src/__tests__/routes.test.ts`: replace source link route expectations with annotation route expectations.
- `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`: assert accept creates annotations.
- `apps/api/src/services/analyze-review-renderer.test.ts`: assert new markdown evidence format.
- `apps/web/src/api/queries.ts`: add annotation query/mutation helpers and query keys.
- `apps/web/src/components/source-link-tabs.tsx`: replace with annotation-aware tabs or keep component name while switching prop type.
- `apps/web/src/components/source-link-tabs.test.tsx`: update expectations to annotation DTOs.
- `apps/web/src/components/entity-detail.tsx`: query annotations and pass them to annotation panels.
- `apps/web/src/routes/analyze-run-review.tsx`: invalidate annotation queries after accept and show annotation save outcome.

---

### Task 1: Contracts And DB Schema

**Files:**

- Create: `packages/contracts/src/annotations.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`
- Test: `packages/contracts/src/annotations.test.ts`

- [ ] **Step 1: Write contract tests**

Create `packages/contracts/src/annotations.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  annotationCreateRequestSchema,
  annotationListQuerySchema,
  sourceSpecAnnotationSchema,
  sourceSpecAnnotationUpdateRequestSchema
} from "./annotations.js";

describe("annotation contracts", () => {
  it("parses a source/spec annotation DTO", () => {
    const parsed = sourceSpecAnnotationSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      sourceFileId: "00000000-0000-4000-8000-000000000003",
      sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
      symbolName: "registerAnalyzeReviewAssemblyRoutes",
      symbolKind: "function",
      startLine: 10,
      endLine: 42,
      annotationLine: 12,
      sourceContentHash: "hash-source",
      entityId: "use-case.review-drafts",
      specFilePath: "use-cases/review-drafts.md",
      claimId: "00000000-0000-4000-8000-000000000004",
      relationshipType: "implements",
      confidence: 0.82,
      provenance: "ai",
      status: "active",
      analyzeRunId: "00000000-0000-4000-8000-000000000005",
      proposalId: "00000000-0000-4000-8000-000000000006",
      assemblyId: "00000000-0000-4000-8000-000000000007",
      claimEvidenceId: "00000000-0000-4000-8000-000000000008",
      indexRunId: "00000000-0000-4000-8000-000000000009",
      excerpt: {
        status: "available",
        startLine: 8,
        endLine: 44,
        text: "export function registerAnalyzeReviewAssemblyRoutes() {}"
      },
      createdAt: "2026-05-13T10:00:00.000Z",
      updatedAt: "2026-05-13T10:00:00.000Z"
    });

    expect(parsed.relationshipType).toBe("implements");
    expect(parsed.provenance).toBe("ai");
    expect(parsed.status).toBe("active");
  });

  it("parses list filters", () => {
    const parsed = annotationListQuerySchema.parse({
      entityId: "use-case.review-drafts",
      filePath: "apps/api/src/routes/analyze-review-assemblies.ts",
      relationshipType: "implements",
      status: "active",
      provenance: "ai"
    });

    expect(parsed).toMatchObject({
      entityId: "use-case.review-drafts",
      relationshipType: "implements",
      status: "active",
      provenance: "ai"
    });
  });

  it("requires a source target, entity id, and relationship type to create an annotation", () => {
    const parsed = annotationCreateRequestSchema.parse({
      sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
      entityId: "use-case.review-drafts",
      relationshipType: "implements",
      symbolName: "registerAnalyzeReviewAssemblyRoutes",
      startLine: 10,
      endLine: 42,
      claimId: "00000000-0000-4000-8000-000000000004",
      confidence: 1
    });

    expect(parsed.sourceFilePath).toBe("apps/api/src/routes/analyze-review-assemblies.ts");
  });

  it("validates update requests", () => {
    const parsed = sourceSpecAnnotationUpdateRequestSchema.parse({
      relationshipType: "references",
      status: "stale",
      confidence: 0.5
    });

    expect(parsed.status).toBe("stale");
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- annotations.test.ts
```

Expected: FAIL because `packages/contracts/src/annotations.ts` does not exist.

- [ ] **Step 3: Add annotation contracts**

Create `packages/contracts/src/annotations.ts`:

```ts
import { z } from "zod";

import { sourceExcerptSchema } from "./source.js";

export const annotationRelationshipTypeSchema = z.enum([
  "implements",
  "uses",
  "defines",
  "tests",
  "references"
]);

export const annotationProvenanceSchema = z.enum(["scanner", "ai", "user"]);
export const annotationStatusSchema = z.enum(["active", "stale"]);

const validLineRange = (value: { startLine?: number | null; endLine?: number | null }) =>
  value.startLine === undefined ||
  value.startLine === null ||
  value.endLine === undefined ||
  value.endLine === null ||
  value.endLine >= value.startLine;

const lineRangeMessage = {
  message: "endLine must be greater than or equal to startLine",
  path: ["endLine"]
};

const nullableUuid = z.string().uuid().nullable();

export const sourceSpecAnnotationSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    sourceFileId: nullableUuid,
    sourceFilePath: z.string().min(1),
    symbolName: z.string().min(1).nullable(),
    symbolKind: z.string().min(1).nullable(),
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
    annotationLine: z.number().int().min(1).nullable(),
    sourceContentHash: z.string().min(1).nullable(),
    entityId: z.string().min(1),
    specFilePath: z.string().min(1),
    claimId: nullableUuid,
    relationshipType: annotationRelationshipTypeSchema,
    confidence: z.number().min(0).max(1).nullable(),
    provenance: annotationProvenanceSchema,
    status: annotationStatusSchema,
    analyzeRunId: nullableUuid,
    proposalId: nullableUuid,
    assemblyId: nullableUuid,
    claimEvidenceId: nullableUuid,
    indexRunId: nullableUuid,
    excerpt: sourceExcerptSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .refine(validLineRange, lineRangeMessage);

export const annotationListQuerySchema = z.object({
  entityId: z.string().min(1).optional(),
  sourceFileId: z.string().uuid().optional(),
  filePath: z.string().min(1).optional(),
  relationshipType: annotationRelationshipTypeSchema.optional(),
  status: annotationStatusSchema.optional(),
  provenance: annotationProvenanceSchema.optional(),
  includeExcerpt: z.coerce.boolean().default(false)
});

export const annotationCreateRequestSchema = z
  .object({
    sourceFileId: z.string().uuid().optional(),
    sourceFilePath: z.string().min(1).optional(),
    symbolName: z.string().min(1).nullable().default(null),
    symbolKind: z.string().min(1).nullable().default(null),
    startLine: z.number().int().min(1).nullable().default(null),
    endLine: z.number().int().min(1).nullable().default(null),
    annotationLine: z.number().int().min(1).nullable().default(null),
    entityId: z.string().min(1),
    specFilePath: z.string().min(1).optional(),
    claimId: z.string().uuid().nullable().default(null),
    relationshipType: annotationRelationshipTypeSchema,
    confidence: z.number().min(0).max(1).nullable().default(1)
  })
  .refine((value) => value.sourceFileId !== undefined || value.sourceFilePath !== undefined, {
    message: "Expected sourceFileId or sourceFilePath",
    path: ["sourceFilePath"]
  })
  .refine(validLineRange, lineRangeMessage);

export const sourceSpecAnnotationUpdateRequestSchema = z
  .object({
    relationshipType: annotationRelationshipTypeSchema.optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    status: annotationStatusSchema.optional(),
    claimId: z.string().uuid().nullable().optional(),
    startLine: z.number().int().min(1).nullable().optional(),
    endLine: z.number().int().min(1).nullable().optional(),
    annotationLine: z.number().int().min(1).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected at least one annotation field"
  })
  .refine(validLineRange, lineRangeMessage);

export type AnnotationRelationshipType = z.infer<typeof annotationRelationshipTypeSchema>;
export type AnnotationProvenance = z.infer<typeof annotationProvenanceSchema>;
export type AnnotationStatus = z.infer<typeof annotationStatusSchema>;
export type SourceSpecAnnotationDto = z.infer<typeof sourceSpecAnnotationSchema>;
export type AnnotationListQuery = z.infer<typeof annotationListQuerySchema>;
export type AnnotationCreateRequest = z.infer<typeof annotationCreateRequestSchema>;
export type SourceSpecAnnotationUpdateRequest = z.infer<
  typeof sourceSpecAnnotationUpdateRequestSchema
>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./agent-runs.js";
export * from "./analyze-review-assemblies.js";
export * from "./analyze-runs.js";
export * from "./annotations.js";
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

- [ ] **Step 4: Run contract test to verify it passes**

Run:

```bash
pnpm --filter @specops/contracts test -- annotations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write DB migration/schema tests**

Append to `packages/db/src/migrations.test.ts`:

```ts
  it("creates source spec annotation storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS source_spec_annotations");
    expect(migration).toContain("relationship_type text NOT NULL");
    expect(migration).toContain("provenance text NOT NULL");
    expect(migration).toContain("status text NOT NULL");
    expect(migration).toContain("annotation_line integer");
    expect(migration).toContain("claim_id uuid REFERENCES analyze_review_claims(id) ON DELETE SET NULL");
    expect(migration).toContain("CONSTRAINT source_spec_annotations_source_file_fk");
    expect(migration).toContain("source_spec_annotations_project_entity_idx");
    expect(migration).toContain("source_spec_annotations_project_source_file_idx");
    expect(migration).toContain("source_spec_annotations_project_relationship_status_idx");
    expect(migration).toContain("source_spec_annotations_active_dedupe_idx");
  });
```

- [ ] **Step 6: Run DB migration test to verify it fails**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because `source_spec_annotations` is not in the migration.

- [ ] **Step 7: Add Drizzle table**

Modify `packages/db/src/schema.ts` imports to include `index` and `uniqueIndex` as already present. Add this table after `analyzeReviewClaimEvidence` so the optional claim/evidence foreign keys reference tables that are already declared:

```ts
export const sourceSpecAnnotations = pgTable(
  "source_spec_annotations",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id").references(() => sourceFiles.id, { onDelete: "set null" }),
    sourceFilePath: text("source_file_path").notNull(),
    symbolName: text("symbol_name"),
    symbolKind: text("symbol_kind"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    annotationLine: integer("annotation_line"),
    sourceContentHash: text("source_content_hash"),
    entityId: text("entity_id").notNull(),
    specFilePath: text("spec_file_path").notNull(),
    claimId: uuid("claim_id").references(() => analyzeReviewClaims.id, { onDelete: "set null" }),
    relationshipType: text("relationship_type").notNull(),
    confidence: doublePrecision("confidence"),
    provenance: text("provenance").notNull(),
    status: text("status").notNull().default("active"),
    analyzeRunId: uuid("analyze_run_id").references(() => analyzeRuns.id, { onDelete: "set null" }),
    proposalId: uuid("proposal_id").references(() => aiProposals.id, { onDelete: "set null" }),
    assemblyId: uuid("assembly_id").references(() => analyzeReviewAssemblies.id, {
      onDelete: "set null"
    }),
    claimEvidenceId: uuid("claim_evidence_id").references(() => analyzeReviewClaimEvidence.id, {
      onDelete: "set null"
    }),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectEntityIdx: index("source_spec_annotations_project_entity_idx").on(
      table.projectId,
      table.entityId
    ),
    projectSourceFileIdx: index("source_spec_annotations_project_source_file_idx").on(
      table.projectId,
      table.sourceFilePath
    ),
    projectRelationshipStatusIdx: index(
      "source_spec_annotations_project_relationship_status_idx"
    ).on(table.projectId, table.relationshipType, table.status),
    analyzeOriginIdx: index("source_spec_annotations_analyze_origin_idx").on(
      table.projectId,
      table.analyzeRunId,
      table.assemblyId
    ),
    activeDedupeIdx: uniqueIndex("source_spec_annotations_active_dedupe_idx")
      .on(
        table.projectId,
        table.sourceFilePath,
        table.entityId,
        table.relationshipType,
        table.provenance,
        sql`coalesce(${table.claimId}::text, '')`,
        sql`coalesce(${table.symbolName}, '')`,
        sql`coalesce(${table.startLine}, 0)`,
        sql`coalesce(${table.endLine}, 0)`
      )
      .where(sql`${table.status} = 'active'`),
  }),
);
```

Update `packages/db/src/schema.typecheck.ts` with:

```ts
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { sourceSpecAnnotations } from "./schema.js";

type SourceSpecAnnotation = InferSelectModel<typeof sourceSpecAnnotations>;
type NewSourceSpecAnnotation = InferInsertModel<typeof sourceSpecAnnotations>;

const _sourceSpecAnnotation: SourceSpecAnnotation | null = null;
const _newSourceSpecAnnotation: NewSourceSpecAnnotation | null = null;
void _sourceSpecAnnotation;
void _newSourceSpecAnnotation;
```

If `schema.typecheck.ts` already has imports and dummy variables, merge these names into the existing file instead of replacing it.

- [ ] **Step 8: Update SQL migration**

Add to `packages/db/migrations/0000_initial.sql` after analyze review tables:

```sql
CREATE TABLE IF NOT EXISTS source_spec_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid,
  source_file_path text NOT NULL,
  symbol_name text,
  symbol_kind text,
  start_line integer,
  end_line integer,
  annotation_line integer,
  source_content_hash text,
  entity_id text NOT NULL,
  spec_file_path text NOT NULL,
  claim_id uuid REFERENCES analyze_review_claims(id) ON DELETE SET NULL,
  relationship_type text NOT NULL,
  confidence double precision,
  provenance text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  analyze_run_id uuid REFERENCES analyze_runs(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES ai_proposals(id) ON DELETE SET NULL,
  assembly_id uuid REFERENCES analyze_review_assemblies(id) ON DELETE SET NULL,
  claim_evidence_id uuid REFERENCES analyze_review_claim_evidence(id) ON DELETE SET NULL,
  index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_spec_annotations_source_file_fk
    FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS source_spec_annotations_project_entity_idx
  ON source_spec_annotations(project_id, entity_id);
CREATE INDEX IF NOT EXISTS source_spec_annotations_project_source_file_idx
  ON source_spec_annotations(project_id, source_file_path);
CREATE INDEX IF NOT EXISTS source_spec_annotations_project_relationship_status_idx
  ON source_spec_annotations(project_id, relationship_type, status);
CREATE INDEX IF NOT EXISTS source_spec_annotations_analyze_origin_idx
  ON source_spec_annotations(project_id, analyze_run_id, assembly_id);
CREATE UNIQUE INDEX IF NOT EXISTS source_spec_annotations_active_dedupe_idx
  ON source_spec_annotations(
    project_id,
    source_file_path,
    entity_id,
    relationship_type,
    provenance,
    coalesce(claim_id::text, ''),
    coalesce(symbol_name, ''),
    coalesce(start_line, 0),
    coalesce(end_line, 0)
  )
  WHERE status = 'active';
```

- [ ] **Step 9: Run DB tests and typecheck**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/contracts/src/annotations.ts packages/contracts/src/annotations.test.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/src/migrations.test.ts packages/db/migrations/0000_initial.sql
git commit -m "feat: add source spec annotation model"
```

---

### Task 2: Annotation Service And Scanner Ingestion

**Files:**

- Create: `apps/api/src/services/annotation-service.ts`
- Test: `apps/api/src/__tests__/annotation-service.test.ts`
- Modify: `apps/api/src/services/source-scan-service.ts`
- Modify: `apps/api/src/services/admin-database-service.ts`

- [ ] **Step 1: Write annotation service tests**

Create `apps/api/src/__tests__/annotation-service.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Db } from "@specops/db";
import { createDb, projects, sourceFiles, sourceSpecAnnotations, specEntities } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAnnotationService } from "../services/annotation-service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createAnnotationService", () => {
  const projectIds: string[] = [];
  const tempRoots: string[] = [];
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    pool = new Pool({ connectionString: testDatabaseUrl });
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    db = createDb(testDatabaseUrl);
  });

  afterEach(async () => {
    for (const projectId of projectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await closeDb(db);
    await pool?.end();
  });

  it("creates and lists a user annotation scoped to one project", async () => {
    const { project, sourceFile } = await createFixture();
    const service = createAnnotationService(db);

    const created = await service.createUserAnnotation(project.id, {
      sourceFileId: sourceFile.id,
      entityId: "use-case.review-drafts",
      relationshipType: "implements",
      symbolName: "registerAnalyzeReviewAssemblyRoutes",
      startLine: 1,
      endLine: 3,
      confidence: 1
    });

    const annotations = await service.listAnnotations(project.id, {
      entityId: "use-case.review-drafts",
      includeExcerpt: false
    });

    expect(created.provenance).toBe("user");
    expect(created.status).toBe("active");
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      id: created.id,
      sourceFilePath: sourceFile.path,
      entityId: "use-case.review-drafts",
      relationshipType: "implements"
    });
  });

  it("deduplicates active scanner annotations", async () => {
    const { project, sourceFile } = await createFixture();
    const service = createAnnotationService(db);

    await service.replaceScannerAnnotations(project.id, "00000000-0000-4000-8000-000000000101", [
      {
        sourceFileId: sourceFile.id,
        sourceFilePath: sourceFile.path,
        symbolName: "Decision",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: sourceFile.contentHash,
        entityId: "use-case.review-drafts",
        specFilePath: "use-cases/review-drafts.md",
        relationshipType: "references",
        confidence: 1
      },
      {
        sourceFileId: sourceFile.id,
        sourceFilePath: sourceFile.path,
        symbolName: "Decision",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: sourceFile.contentHash,
        entityId: "use-case.review-drafts",
        specFilePath: "use-cases/review-drafts.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);

    const rows = await db
      .select()
      .from(sourceSpecAnnotations)
      .where(eq(sourceSpecAnnotations.projectId, project.id));

    expect(rows).toHaveLength(1);
  });

  it("returns source excerpts when requested", async () => {
    const { project, sourceFile, repoPath } = await createFixture({
      sourceContent:
        "/** @specops use-case.review-drafts */\nexport interface Decision {\n  id: string;\n}\n"
    });
    const service = createAnnotationService(db);
    await service.createUserAnnotation(project.id, {
      sourceFileId: sourceFile.id,
      entityId: "use-case.review-drafts",
      relationshipType: "defines",
      symbolName: "Decision",
      startLine: 1,
      endLine: 4,
      confidence: 1
    });

    const annotations = await service.listAnnotations(project.id, {
      entityId: "use-case.review-drafts",
      includeExcerpt: true
    });

    expect(annotations[0]?.excerpt).toMatchObject({
      status: "available",
      startLine: 1,
      endLine: 4
    });
    expect(annotations[0]?.excerpt?.status === "available" ? annotations[0].excerpt.text : "").toContain(
      "export interface Decision"
    );
    expect(repoPath).toContain("specops-annotations-");
  });

  async function createFixture(input: { sourceContent?: string } = {}) {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "specops-annotations-"));
    tempRoots.push(repoPath);
    await mkdir(path.join(repoPath, "src"), { recursive: true });
    const sourcePath = path.join(repoPath, "src/decision.ts");
    const sourceContent = input.sourceContent ?? "export function registerAnalyzeReviewAssemblyRoutes() {}\n";
    await writeFile(sourcePath, sourceContent);

    const [project] = await db
      .insert(projects)
      .values({
        name: "Annotations",
        slug: `annotations-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        repoPath,
        specopsPath: path.join(repoPath, "specops")
      })
      .returning();
    projectIds.push(project!.id);

    const [entity] = await db
      .insert(specEntities)
      .values({
        projectId: project!.id,
        entityId: "use-case.review-drafts",
        type: "use_case",
        title: "Review drafts",
        status: "draft",
        filePath: "use-cases/review-drafts.md",
        frontmatterJson: {},
        bodyMarkdown: "Review generated drafts.",
        bodyText: "Review generated drafts.",
        contentHash: "hash-spec"
      })
      .returning();

    const [sourceFile] = await db
      .insert(sourceFiles)
      .values({
        projectId: project!.id,
        path: "src/decision.ts",
        language: "typescript",
        kind: "source",
        sizeBytes: Buffer.byteLength(sourceContent),
        contentHash: "hash-source"
      })
      .returning();

    expect(entity).toBeDefined();
    expect(sourceFile).toBeDefined();
    return { project: project!, sourceFile: sourceFile!, repoPath };
  }
});

async function closeDb(db: Db | undefined) {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } })?.$client;
  await client?.end();
}
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- annotation-service.test.ts
```

Expected: FAIL because `annotation-service.ts` is missing.

- [ ] **Step 3: Implement annotation service**

Create `apps/api/src/services/annotation-service.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AnnotationCreateRequest,
  AnnotationListQuery,
  AnnotationRelationshipType,
  SourceExcerptDto,
  SourceSpecAnnotationDto,
  SourceSpecAnnotationUpdateRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  sourceFiles,
  sourceSpecAnnotations,
  specEntities
} from "@specops/db";
import { and, asc, eq, sql } from "drizzle-orm";

import { BadRequestError, NotFoundError } from "../lib/http-errors.js";
import { assertAbsolutePath, assertInsideDirectory } from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

type AnnotationRow = typeof sourceSpecAnnotations.$inferSelect;
type AnnotationClient = Pick<Db, "delete" | "insert" | "select" | "update">;

export type ScannerAnnotationInput = {
  sourceFileId: string | null;
  sourceFilePath: string;
  symbolName: string | null;
  symbolKind: string | null;
  startLine: number | null;
  endLine: number | null;
  annotationLine: number | null;
  sourceContentHash: string | null;
  entityId: string;
  specFilePath: string;
  relationshipType: AnnotationRelationshipType;
  confidence: number | null;
};

export type AcceptedEvidenceAnnotationInput = ScannerAnnotationInput & {
  claimId: string | null;
  analyzeRunId: string;
  proposalId: string | null;
  assemblyId: string;
  claimEvidenceId: string;
  provenance: "scanner" | "ai" | "user";
};

export function createAnnotationService(db: Db) {
  const projectService = createProjectService(db);

  return {
    async listAnnotations(
      projectId: string,
      query: AnnotationListQuery
    ): Promise<SourceSpecAnnotationDto[]> {
      const project = await projectService.getProject(projectId);
      const conditions = [eq(sourceSpecAnnotations.projectId, projectId)];
      if (query.entityId) conditions.push(eq(sourceSpecAnnotations.entityId, query.entityId));
      if (query.sourceFileId) conditions.push(eq(sourceSpecAnnotations.sourceFileId, query.sourceFileId));
      if (query.filePath) conditions.push(eq(sourceSpecAnnotations.sourceFilePath, query.filePath));
      if (query.relationshipType) {
        conditions.push(eq(sourceSpecAnnotations.relationshipType, query.relationshipType));
      }
      if (query.status) conditions.push(eq(sourceSpecAnnotations.status, query.status));
      if (query.provenance) conditions.push(eq(sourceSpecAnnotations.provenance, query.provenance));

      const rows = await db
        .select()
        .from(sourceSpecAnnotations)
        .where(and(...conditions))
        .orderBy(
          asc(sourceSpecAnnotations.relationshipType),
          asc(sourceSpecAnnotations.sourceFilePath),
          asc(sourceSpecAnnotations.symbolName),
          asc(sourceSpecAnnotations.id)
        );

      return Promise.all(
        rows.map(async (row) =>
          mapAnnotation(row, {
            repoPath: project.repoPath,
            includeExcerpt: query.includeExcerpt
          })
        )
      );
    },

    async createUserAnnotation(
      projectId: string,
      input: AnnotationCreateRequest
    ): Promise<SourceSpecAnnotationDto> {
      const project = await projectService.getProject(projectId);
      const entity = await getEntity(projectId, input.entityId);
      const source = await resolveSource(projectId, input);
      const [row] = await db
        .insert(sourceSpecAnnotations)
        .values({
          projectId,
          sourceFileId: source.id,
          sourceFilePath: source.path,
          symbolName: input.symbolName,
          symbolKind: input.symbolKind,
          startLine: input.startLine,
          endLine: input.endLine,
          annotationLine: input.annotationLine,
          sourceContentHash: source.contentHash,
          entityId: entity.entityId,
          specFilePath: input.specFilePath ?? entity.filePath,
          claimId: input.claimId,
          relationshipType: input.relationshipType,
          confidence: input.confidence,
          provenance: "user",
          status: "active"
        })
        .onConflictDoNothing()
        .returning();

      if (!row) {
        throw new BadRequestError("Duplicate active annotation");
      }

      return mapAnnotation(row, { repoPath: project.repoPath, includeExcerpt: false });
    },

    async patchAnnotation(
      projectId: string,
      annotationId: string,
      input: SourceSpecAnnotationUpdateRequest
    ): Promise<SourceSpecAnnotationDto> {
      const project = await projectService.getProject(projectId);
      const [row] = await db
        .update(sourceSpecAnnotations)
        .set({
          relationshipType: input.relationshipType,
          confidence: input.confidence,
          status: input.status,
          claimId: input.claimId,
          startLine: input.startLine,
          endLine: input.endLine,
          annotationLine: input.annotationLine,
          provenance: "user",
          updatedAt: new Date()
        })
        .where(and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.id, annotationId)))
        .returning();

      if (!row) {
        throw new NotFoundError("Annotation not found", { projectId, annotationId });
      }

      return mapAnnotation(row, { repoPath: project.repoPath, includeExcerpt: false });
    },

    async deleteAnnotation(projectId: string, annotationId: string): Promise<void> {
      const [row] = await db
        .delete(sourceSpecAnnotations)
        .where(and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.id, annotationId)))
        .returning({ id: sourceSpecAnnotations.id });

      if (!row) {
        throw new NotFoundError("Annotation not found", { projectId, annotationId });
      }
    },

    async replaceScannerAnnotations(
      projectId: string,
      indexRunId: string,
      annotations: ScannerAnnotationInput[],
      client: AnnotationClient = db
    ): Promise<void> {
      await client
        .delete(sourceSpecAnnotations)
        .where(
          and(
            eq(sourceSpecAnnotations.projectId, projectId),
            eq(sourceSpecAnnotations.provenance, "scanner")
          )
        );

      if (annotations.length === 0) return;

      await client
        .insert(sourceSpecAnnotations)
        .values(
          annotations.map((annotation) => ({
            projectId,
            sourceFileId: annotation.sourceFileId,
            sourceFilePath: annotation.sourceFilePath,
            symbolName: annotation.symbolName,
            symbolKind: annotation.symbolKind,
            startLine: annotation.startLine,
            endLine: annotation.endLine,
            annotationLine: annotation.annotationLine,
            sourceContentHash: annotation.sourceContentHash,
            entityId: annotation.entityId,
            specFilePath: annotation.specFilePath,
            relationshipType: annotation.relationshipType,
            confidence: annotation.confidence,
            provenance: "scanner",
            status: "active",
            indexRunId
          }))
        )
        .onConflictDoNothing();
    },

    async createAcceptedEvidenceAnnotations(
      projectId: string,
      annotations: AcceptedEvidenceAnnotationInput[],
      client: AnnotationClient = db
    ): Promise<number> {
      if (annotations.length === 0) return 0;

      const inserted = await client
        .insert(sourceSpecAnnotations)
        .values(
          annotations.map((annotation) => ({
            projectId,
            sourceFileId: annotation.sourceFileId,
            sourceFilePath: annotation.sourceFilePath,
            symbolName: annotation.symbolName,
            symbolKind: annotation.symbolKind,
            startLine: annotation.startLine,
            endLine: annotation.endLine,
            annotationLine: annotation.annotationLine,
            sourceContentHash: annotation.sourceContentHash,
            entityId: annotation.entityId,
            specFilePath: annotation.specFilePath,
            claimId: annotation.claimId,
            relationshipType: annotation.relationshipType,
            confidence: annotation.confidence,
            provenance: annotation.provenance,
            status: "active",
            analyzeRunId: annotation.analyzeRunId,
            proposalId: annotation.proposalId,
            assemblyId: annotation.assemblyId,
            claimEvidenceId: annotation.claimEvidenceId
          }))
        )
        .onConflictDoNothing()
        .returning({ id: sourceSpecAnnotations.id });

      return inserted.length;
    }
  };

  async function getEntity(projectId: string, entityId: string) {
    const [entity] = await db
      .select()
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, entityId)))
      .limit(1);

    if (!entity) {
      throw new NotFoundError("Entity not found", { projectId, entityId });
    }

    return entity;
  }

  async function resolveSource(projectId: string, input: AnnotationCreateRequest) {
    const conditions = [eq(sourceFiles.projectId, projectId)];
    if (input.sourceFileId) {
      conditions.push(eq(sourceFiles.id, input.sourceFileId));
    } else if (input.sourceFilePath) {
      conditions.push(eq(sourceFiles.path, input.sourceFilePath));
    }

    const [source] = await db.select().from(sourceFiles).where(and(...conditions)).limit(1);

    if (!source) {
      throw new NotFoundError("Source file not found", {
        projectId,
        sourceFileId: input.sourceFileId ?? null,
        sourceFilePath: input.sourceFilePath ?? null
      });
    }

    return source;
  }
}

async function mapAnnotation(
  row: AnnotationRow,
  options: { repoPath: string; includeExcerpt: boolean }
): Promise<SourceSpecAnnotationDto> {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceFileId: row.sourceFileId,
    sourceFilePath: row.sourceFilePath,
    symbolName: row.symbolName,
    symbolKind: row.symbolKind,
    startLine: row.startLine,
    endLine: row.endLine,
    annotationLine: row.annotationLine,
    sourceContentHash: row.sourceContentHash,
    entityId: row.entityId,
    specFilePath: row.specFilePath,
    claimId: row.claimId,
    relationshipType: row.relationshipType as SourceSpecAnnotationDto["relationshipType"],
    confidence: row.confidence,
    provenance: row.provenance as SourceSpecAnnotationDto["provenance"],
    status: row.status as SourceSpecAnnotationDto["status"],
    analyzeRunId: row.analyzeRunId,
    proposalId: row.proposalId,
    assemblyId: row.assemblyId,
    claimEvidenceId: row.claimEvidenceId,
    indexRunId: row.indexRunId,
    excerpt: options.includeExcerpt ? await readAnnotationExcerpt(options.repoPath, row) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function readAnnotationExcerpt(repoPath: string, row: AnnotationRow): Promise<SourceExcerptDto> {
  const absoluteRepoPath = assertAbsolutePath("repoPath", repoPath);
  const sourcePath = assertInsideDirectory(absoluteRepoPath, path.join(absoluteRepoPath, row.sourceFilePath));

  try {
    const content = await readFile(sourcePath, "utf8");
    const lines = content.split(/\r?\n/);
    const focusLine = row.annotationLine ?? row.startLine ?? 1;
    const startLine = Math.max(1, Math.min(row.startLine ?? focusLine - 8, lines.length || 1));
    const endLine = Math.min(lines.length || 1, Math.max(row.endLine ?? focusLine + 8, startLine));

    return {
      status: "available",
      startLine,
      endLine,
      text: lines.slice(startLine - 1, endLine).join("\n")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source excerpt unavailable.";
    return { status: "unavailable", message };
  }
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- annotation-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Move scanner ingestion to annotations**

Modify `apps/api/src/services/source-scan-service.ts`:

```ts
import { createAnnotationService, type ScannerAnnotationInput } from "./annotation-service.js";
```

After inserting `sourceFiles`, `sourceImports`, `sourceExports`, and `sourceSymbols`, replace the `sourceSpecLinkRows` insert block with annotation construction:

```ts
  const specEntityById = new Map(
    await db
      .select({ entityId: specEntities.entityId, filePath: specEntities.filePath })
      .from(specEntities)
      .where(eq(specEntities.projectId, projectId))
      .then((rows) => rows.map((row) => [row.entityId, row.filePath] as const))
  );
  const existingEntityIds = new Set(specEntityById.keys());

  const scannerAnnotations: ScannerAnnotationInput[] = result.files.flatMap((file) => {
    const sourceFileId = sourceFileIdsByPath.get(file.path);
    if (!sourceFileId) return [];

    return file.symbols.flatMap((symbol) =>
      symbol.specopsAnnotations
        .filter((annotation) => isValidSpecopsEntityId(annotation.entityId))
        .filter((annotation) => existingEntityIds.has(annotation.entityId))
        .map((annotation) => ({
          sourceFileId,
          sourceFilePath: file.path,
          symbolName: symbol.name,
          symbolKind: symbol.symbolKind,
          startLine: symbol.line,
          endLine: symbol.line,
          annotationLine: annotation.line,
          sourceContentHash: file.contentHash,
          entityId: annotation.entityId,
          specFilePath: specEntityById.get(annotation.entityId) ?? "",
          relationshipType: "references" as const,
          confidence: 1
        }))
    );
  });

  await createAnnotationService(db as Db).replaceScannerAnnotations(
    projectId,
    indexRunId,
    scannerAnnotations,
    db
  );
```

Keep the existing invalid annotation and missing entity validation warning logic. Remove the old `sourceSpecLinks` delete/insert only after all consumers are migrated in later tasks. If old route tests still depend on it before Task 5, keep writing both tables until Task 5 removes old consumers.

- [ ] **Step 6: Expose annotation table in admin database**

Modify `apps/api/src/services/admin-database-service.ts` imports and known table list:

```ts
import { sourceSpecAnnotations } from "@specops/db";
```

Add:

```ts
{ name: "source_spec_annotations", table: sourceSpecAnnotations, primaryKey: "id" },
```

- [ ] **Step 7: Run focused API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- annotation-service.test.ts routes.test.ts
```

Expected: PASS or old source-link route failures that are intentionally resolved in Task 5. Do not leave unrelated failures.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/api/src/services/annotation-service.ts apps/api/src/__tests__/annotation-service.test.ts apps/api/src/services/source-scan-service.ts apps/api/src/services/admin-database-service.ts
git commit -m "feat: persist source spec annotations"
```

---

### Task 3: Annotation API Routes

**Files:**

- Create: `apps/api/src/routes/annotations.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write route tests**

Add to the database-backed route suite in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("creates, lists, updates, and deletes source spec annotations", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeFile(path.join(project.repoPath, "src", "decision.ts"), "export interface Decision {}\n");
    await writeFile(
      path.join(project.specopsPath, "use-cases", "review-drafts.md"),
      [
        "---",
        "id: use-case.review-drafts",
        "type: use_case",
        "title: Review drafts",
        "status: draft",
        "---",
        "",
        "# Review drafts",
        "",
        "Review generated drafts."
      ].join("\n")
    );
    await createIndexerService(createDb(testDatabaseUrl!)).indexProject(project.id);

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/annotations`,
      payload: {
        sourceFilePath: "src/decision.ts",
        entityId: "use-case.review-drafts",
        relationshipType: "defines",
        symbolName: "Decision",
        startLine: 1,
        endLine: 1,
        confidence: 1
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      entityId: "use-case.review-drafts",
      relationshipType: "defines",
      provenance: "user",
      status: "active"
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/annotations?entityId=use-case.review-drafts&includeExcerpt=true`
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(1);

    const annotationId = createResponse.json().id;
    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/annotations/${annotationId}`,
      payload: { relationshipType: "references", status: "stale" }
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({
      relationshipType: "references",
      status: "stale",
      provenance: "user"
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/annotations/${annotationId}`
    });
    expect(deleteResponse.statusCode).toBe(204);
  });
```

- [ ] **Step 2: Run route test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t annotations
```

Expected: FAIL with 404 for `/annotations`.

- [ ] **Step 3: Implement annotation routes**

Create `apps/api/src/routes/annotations.ts`:

```ts
import {
  annotationCreateRequestSchema,
  annotationListQuerySchema,
  sourceSpecAnnotationUpdateRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAnnotationService } from "../services/annotation-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

const annotationParamsSchema = projectParamsSchema.extend({
  annotationId: z.string().uuid()
});

export const registerAnnotationRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const service = createAnnotationService(db);

  app.get("/projects/:projectId/annotations", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = annotationListQuerySchema.parse(request.query);
    return service.listAnnotations(projectId, query);
  });

  app.post("/projects/:projectId/annotations", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = annotationCreateRequestSchema.parse(request.body);
    const annotation = await service.createUserAnnotation(projectId, input);
    return reply.code(201).send(annotation);
  });

  app.patch("/projects/:projectId/annotations/:annotationId", async (request) => {
    const { projectId, annotationId } = annotationParamsSchema.parse(request.params);
    const input = sourceSpecAnnotationUpdateRequestSchema.parse(request.body);
    return service.patchAnnotation(projectId, annotationId, input);
  });

  app.delete("/projects/:projectId/annotations/:annotationId", async (request, reply) => {
    const { projectId, annotationId } = annotationParamsSchema.parse(request.params);
    await service.deleteAnnotation(projectId, annotationId);
    return reply.code(204).send();
  });
};
```

Modify `apps/api/src/server.ts`:

```ts
import { registerAnnotationRoutes } from "./routes/annotations.js";
```

Register before entity routes:

```ts
  app.register(registerAnnotationRoutes, { prefix: "/api", db });
```

- [ ] **Step 4: Run route test**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t annotations
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/api/src/routes/annotations.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose annotation api"
```

---

### Task 4: Promote Analyze Review Evidence And Render Markdown Links

**Files:**

- Modify: `apps/api/src/services/analyze-review-assembly-service.ts`
- Modify: `apps/api/src/services/analyze-review-renderer.ts`
- Modify: `apps/api/src/services/analyze-review-renderer.test.ts`
- Modify: `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`
- Modify: `packages/contracts/src/analyze-review-assemblies.ts`
- Modify: `apps/web/src/routes/analyze-run-review.tsx`

- [ ] **Step 1: Extend accept response contract test**

Modify `packages/contracts/src/analyze-review-assemblies.test.ts` accept response fixture to include annotation counts:

```ts
    const response = analyzeReviewAcceptResponseSchema.parse({
      acceptedAssemblyIds: ["00000000-0000-4000-8000-000000000001"],
      failures: [],
      annotationCount: 2,
      indexRun: null
    });

    expect(response.annotationCount).toBe(2);
```

- [ ] **Step 2: Update accept response schema**

Modify `packages/contracts/src/analyze-review-assemblies.ts`:

```ts
export const analyzeReviewAcceptResponseSchema = z.object({
  acceptedAssemblyIds: z.array(z.string().uuid()),
  failures: z.array(analyzeReviewAcceptFailureSchema),
  annotationCount: z.number().int().min(0).default(0),
  indexRun: indexRunSchema.nullable()
});
```

- [ ] **Step 3: Run contract test**

Run:

```bash
pnpm --filter @specops/contracts test -- analyze-review-assemblies.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write renderer tests for inline footnotes and grouped source links**

Replace the first test in `apps/api/src/services/analyze-review-renderer.test.ts` with:

```ts
  it("renders claim footnotes and grouped source links", () => {
    const markdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: "use-case.review-drafts",
      entityType: "use_case",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      claims: [
        {
          id: "claim-1",
          text: "Users can accept reviewed assemblies.",
          kind: "fact",
          evidence: [
            {
              sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
              symbolName: "registerAnalyzeReviewAssemblyRoutes",
              startLine: 20,
              endLine: 80,
              relationshipType: "implements"
            }
          ]
        }
      ],
      annotations: [
        {
          sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
          symbolName: "registerAnalyzeReviewAssemblyRoutes",
          startLine: 20,
          endLine: 80,
          relationshipType: "implements"
        }
      ],
      proposedLinks: []
    });

    expect(markdown).toContain("- Users can accept reviewed assemblies. [^claim-1-1]");
    expect(markdown).toContain("[^claim-1-1]: implements `apps/api/src/routes/analyze-review-assemblies.ts:20-80` (`registerAnalyzeReviewAssemblyRoutes`)");
    expect(markdown).toContain("## Source Links");
    expect(markdown).toContain("### Implements");
    expect(markdown).toContain("- `apps/api/src/routes/analyze-review-assemblies.ts:20-80` (`registerAnalyzeReviewAssemblyRoutes`)");
  });
```

- [ ] **Step 5: Update renderer implementation**

Modify `apps/api/src/services/analyze-review-renderer.ts` types and rendering:

```ts
type RenderEvidence = {
  sourceFilePath: string;
  symbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  relationshipType?: "implements" | "uses" | "defines" | "tests" | "references";
};

type RenderClaim = {
  id?: string;
  text: string;
  kind: "fact" | "hypothesis";
  evidence: RenderEvidence[];
};

type RenderAnnotation = RenderEvidence & {
  relationshipType: "implements" | "uses" | "defines" | "tests" | "references";
};

type RenderAssemblyInput = {
  entityId: string;
  entityType: "domain_entity" | "interface" | "use_case";
  title: string;
  summary: string;
  claims: RenderClaim[];
  annotations?: RenderAnnotation[];
  proposedLinks: RenderLink[];
};
```

Replace `renderClaims` and evidence rendering helpers:

```ts
function renderClaims(claims: RenderClaim[]): string[] {
  if (claims.length === 0) {
    return ["- None recorded.", ""];
  }

  return claims.flatMap((claim) => {
    const footnotes = claim.evidence.map((_item, index) => `[^${claimFootnoteId(claim, index)}]`);
    const suffix = footnotes.length > 0 ? ` ${footnotes.join(" ")}` : "";
    return [`- ${claim.text}${suffix}`, ""];
  });
}

function renderEvidence(claims: RenderClaim[]): string[] {
  const lines = claims.flatMap((claim) =>
    claim.evidence.map((item, index) => {
      const relationshipType = item.relationshipType ?? "references";
      return `[^${claimFootnoteId(claim, index)}]: ${relationshipType} ${formatSourceLocation(item)}`;
    })
  );

  if (lines.length === 0) {
    return ["- None recorded.", ""];
  }

  return lines.flatMap((line) => [line, ""]);
}

function renderSourceLinks(annotations: RenderAnnotation[] = []): string[] {
  if (annotations.length === 0) {
    return ["- None recorded.", ""];
  }

  const groups = ["implements", "uses", "defines", "tests", "references"] as const;
  return groups.flatMap((relationshipType) => {
    const items = annotations.filter((annotation) => annotation.relationshipType === relationshipType);
    if (items.length === 0) return [];
    return [
      `### ${titleCase(relationshipType)}`,
      "",
      ...items.flatMap((item) => [`- ${formatSourceLocation(item)}`, ""])
    ];
  });
}

function claimFootnoteId(claim: RenderClaim, index: number) {
  return `${slugify(claim.id ?? claim.text)}-${index + 1}`;
}

function formatSourceLocation(item: RenderEvidence) {
  const location =
    item.startLine && item.endLine
      ? `${item.sourceFilePath}:${item.startLine}-${item.endLine}`
      : item.sourceFilePath;
  const symbol = item.symbolName ? ` (\`${item.symbolName}\`)` : "";
  return `\`${location}\`${symbol}`;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "claim";
}
```

Insert the source links section in the `lines` array:

```ts
    "## Source Links",
    "",
    ...renderSourceLinks(input.annotations),
```

- [ ] **Step 6: Write accept promotion test**

In `apps/api/src/__tests__/analyze-review-assembly-service.test.ts`, add a test near existing accept tests:

```ts
  it("promotes accepted claim evidence into source spec annotations", async () => {
    const { db, project, run } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db, {
      acceptTestHooks: {
        indexProject: () => ({
          id: "00000000-0000-4000-8000-000000000111",
          projectId: project.id,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "succeeded",
          entityCount: 1,
          linkCount: 0,
          errorCount: 0,
          warningCount: 0,
          gitCommit: null,
          sourceFileCount: 1,
          sourceImportCount: 0,
          sourceExportCount: 0,
          sourceSymbolCount: 1
        })
      }
    });
    const review = await service.listReviewAssemblies(project.id, run.id);
    const assembly = review.assemblies[0]!;

    const response = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });

    const annotations = await db
      .select()
      .from(sourceSpecAnnotations)
      .where(eq(sourceSpecAnnotations.projectId, project.id));

    expect(response.annotationCount).toBeGreaterThan(0);
    expect(annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: assembly.entityId,
          specFilePath: assembly.filePath,
          provenance: "ai",
          status: "active"
        })
      ])
    );
  });
```

Add `sourceSpecAnnotations` to imports.

- [ ] **Step 7: Implement promotion in accept service**

In `apps/api/src/services/analyze-review-assembly-service.ts`, import:

```ts
import { createAnnotationService, type AcceptedEvidenceAnnotationInput } from "./annotation-service.js";
```

Track annotation count:

```ts
    let annotationCount = 0;
```

Inside the transaction after rendered markdown validation and before assembly status update:

```ts
          const evidenceAnnotations = buildAcceptedEvidenceAnnotations({
            projectId,
            runId,
            assembly
          });
          annotationCount += await createAnnotationService(db).createAcceptedEvidenceAnnotations(
            projectId,
            evidenceAnnotations,
            tx
          );
```

Return:

```ts
    return { acceptedAssemblyIds, failures, annotationCount, indexRun };
```

Add helper near mapping helpers:

```ts
function buildAcceptedEvidenceAnnotations(input: {
  projectId: string;
  runId: string;
  assembly: AnalyzeReviewAssemblyDto;
}): AcceptedEvidenceAnnotationInput[] {
  return input.assembly.claims.flatMap((claim) =>
    claim.evidence.map((evidence) => ({
      sourceFileId: null,
      sourceFilePath: evidence.sourceFilePath,
      symbolName: evidence.symbolName,
      symbolKind: null,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      annotationLine: null,
      sourceContentHash: null,
      entityId: input.assembly.entityId,
      specFilePath: input.assembly.filePath,
      claimId: claim.id,
      relationshipType: inferRelationshipType(evidence.sourceFilePath, input.assembly.entityType),
      confidence: evidence.confidence ?? claim.confidence,
      analyzeRunId: input.runId,
      proposalId: evidence.proposalId,
      assemblyId: input.assembly.id,
      claimEvidenceId: evidence.id,
      provenance: evidence.provenance
    }))
  );
}

function inferRelationshipType(
  sourceFilePath: string,
  entityType: AnalyzeReviewEntityType
): AcceptedEvidenceAnnotationInput["relationshipType"] {
  const lowerPath = sourceFilePath.toLowerCase();
  if (lowerPath.includes(".test.") || lowerPath.includes(".spec.") || lowerPath.includes("/__tests__/")) {
    return "tests";
  }
  if (
    lowerPath.includes("schema") ||
    lowerPath.includes("model") ||
    lowerPath.includes("types") ||
    lowerPath.includes("contracts")
  ) {
    return "defines";
  }
  if (
    entityType === "use_case" &&
    (lowerPath.includes("route") ||
      lowerPath.includes("service") ||
      lowerPath.includes("handler") ||
      lowerPath.includes("component"))
  ) {
    return "implements";
  }
  return "references";
}
```

When calling `renderAnalyzeReviewAssemblyMarkdown`, pass claim ids and annotations:

```ts
            claims: assembly.claims.map((claim) => ({
              id: claim.id,
              text: claim.text,
              kind: claim.kind,
              evidence: claim.evidence.map((evidence) => ({
                sourceFilePath: evidence.sourceFilePath,
                symbolName: evidence.symbolName,
                startLine: evidence.startLine,
                endLine: evidence.endLine,
                relationshipType: inferRelationshipType(evidence.sourceFilePath, assembly.entityType)
              }))
            })),
            annotations: buildAcceptedEvidenceAnnotations({ projectId, runId, assembly }).map((annotation) => ({
              sourceFilePath: annotation.sourceFilePath,
              symbolName: annotation.symbolName,
              startLine: annotation.startLine,
              endLine: annotation.endLine,
              relationshipType: annotation.relationshipType
            })),
```

- [ ] **Step 8: Show annotation result in review UI**

Modify `apps/web/src/routes/analyze-run-review.tsx`:

```ts
import type { AnalyzeReviewAcceptResponse } from "@specops/contracts";
```

Add state:

```ts
  const [acceptResult, setAcceptResult] = useState<AnalyzeReviewAcceptResponse | null>(null);
```

In accept success:

```ts
      setAcceptResult(response);
```

Render above `AnalyzeReviewWorkspace`:

```tsx
      {acceptResult ? (
        <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved {acceptResult.acceptedAssemblyIds.length} assemblies and {acceptResult.annotationCount} source/spec annotations.
        </p>
      ) : null}
```

Invalidate annotation queries after accept once Task 6 adds query keys.

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm --filter @specops/contracts test -- analyze-review-assemblies.test.ts
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- analyze-review-renderer.test.ts analyze-review-assembly-service.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/contracts/src/analyze-review-assemblies.ts packages/contracts/src/analyze-review-assemblies.test.ts apps/api/src/services/analyze-review-assembly-service.ts apps/api/src/services/analyze-review-renderer.ts apps/api/src/services/analyze-review-renderer.test.ts apps/api/src/__tests__/analyze-review-assembly-service.test.ts apps/web/src/routes/analyze-run-review.tsx
git commit -m "feat: promote review evidence to annotations"
```

---

### Task 5: Migrate Backend Consumers From Source Links To Annotations

**Files:**

- Modify: `apps/api/src/services/impact-service.ts`
- Modify: `apps/api/src/services/spec-readiness-service.ts`
- Modify: `apps/api/src/services/project-overview-service.ts`
- Modify: `apps/api/src/services/review-summary-service.ts`
- Modify: `apps/api/src/routes/entities.ts`
- Modify: `apps/api/src/routes/source.ts`
- Modify: `packages/contracts/src/impact.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`
- Modify: `apps/api/src/__tests__/impact-service.test.ts`
- Modify: `apps/api/src/__tests__/spec-readiness-service.test.ts`

- [ ] **Step 1: Update route tests for entity-to-source annotations**

Replace tests that call `/entities/:entityId/source-links` with:

```ts
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/annotations?entityId=domain.decision&includeExcerpt=true`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        entityId: "domain.decision",
        relationshipType: "references",
        provenance: "scanner",
        status: "active",
        excerpt: expect.objectContaining({ status: "available" })
      })
    ]);
```

Add a source-to-spec route test:

```ts
    const sourceFilesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/source-files`
    });
    const sourceFileId = sourceFilesResponse.json()[0].id;
    const annotationResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/annotations?sourceFileId=${sourceFileId}`
    });

    expect(annotationResponse.statusCode).toBe(200);
    expect(annotationResponse.json()[0]).toMatchObject({
      sourceFileId,
      entityId: "domain.decision"
    });
```

- [ ] **Step 2: Run affected route tests to verify failures**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "source spec"
```

Expected: FAIL where old route behavior still returns `source_spec_links` or annotation ingestion is incomplete.

- [ ] **Step 3: Remove entity source-links route**

Modify `apps/api/src/routes/entities.ts` by deleting the route:

```ts
  app.get("/projects/:projectId/entities/:entityId/source-links", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    const project = await projectService.getProject(projectId);
    await getEntity(db, projectId, entityId);
    return sourceScanService.listSourceSpecLinksForEntity({
      projectId,
      repoPath: project.repoPath,
      entityId
    });
  });
```

Remove the unused `sourceScanService` variable and import if no longer needed.

- [ ] **Step 4: Update impact source evidence**

In `apps/api/src/services/impact-service.ts`, replace `sourceSpecLinks` with `sourceSpecAnnotations` and filter active annotations:

```ts
import { sourceSpecAnnotations, specEntities, specLinks } from "@specops/db";
import { and, asc, eq } from "drizzle-orm";
```

Replace the source rows query:

```ts
      const sourceRows = input.includeSource
        ? await db
            .select()
            .from(sourceSpecAnnotations)
            .where(
              and(
                eq(sourceSpecAnnotations.projectId, input.projectId),
                eq(sourceSpecAnnotations.status, "active")
              )
            )
            .orderBy(
              asc(sourceSpecAnnotations.entityId),
              asc(sourceSpecAnnotations.sourceFilePath),
              asc(sourceSpecAnnotations.symbolName)
            )
        : [];
```

Map:

```ts
        sourceEvidence: sourceRows.map((annotation) => ({
          entityId: annotation.entityId,
          filePath: annotation.sourceFilePath,
          sourceFileId: annotation.sourceFileId ?? "",
          symbolName: annotation.symbolName ?? annotation.sourceFilePath,
          symbolKind: annotation.symbolKind ?? annotation.relationshipType,
          symbolLine: annotation.startLine,
          annotationLine: annotation.annotationLine,
          relationshipType: annotation.relationshipType as ImpactSourceEvidenceDto["relationshipType"]
        }))
```

Modify `packages/contracts/src/impact.ts` source evidence schema to include:

```ts
relationshipType: annotationRelationshipTypeSchema.optional()
```

- [ ] **Step 5: Update readiness and overview services**

In `apps/api/src/services/spec-readiness-service.ts`, replace `sourceSpecLinks` queries with active `sourceSpecAnnotations`:

```ts
import { sourceSpecAnnotations } from "@specops/db";
```

Use:

```ts
      db
        .select({ entityId: sourceSpecAnnotations.entityId })
        .from(sourceSpecAnnotations)
        .where(
          and(
            eq(sourceSpecAnnotations.projectId, projectId),
            eq(sourceSpecAnnotations.status, "active")
          )
        )
        .orderBy(asc(sourceSpecAnnotations.entityId)),
```

Apply the same active annotation query in `apps/api/src/services/project-overview-service.ts` and `apps/api/src/services/review-summary-service.ts`.

- [ ] **Step 6: Run backend tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts impact-service.test.ts spec-readiness-service.test.ts
pnpm --filter @specops/contracts test -- impact.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/contracts/src/impact.ts apps/api/src/services/impact-service.ts apps/api/src/services/spec-readiness-service.ts apps/api/src/services/project-overview-service.ts apps/api/src/services/review-summary-service.ts apps/api/src/routes/entities.ts apps/api/src/routes/source.ts apps/api/src/__tests__/routes.test.ts
git commit -m "refactor: read source relationships from annotations"
```

---

### Task 6: Web Annotation Queries And Panels

**Files:**

- Create: `apps/web/src/components/annotation-panels.tsx`
- Create: `apps/web/src/components/annotation-panels.test.tsx`
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/components/entity-detail.tsx`
- Modify: `apps/web/src/components/source-link-tabs.tsx`
- Modify: `apps/web/src/components/source-link-tabs.test.tsx`
- Modify: `apps/web/src/routes/analyze-run-review.tsx`

- [ ] **Step 1: Write annotation panel tests**

Create `apps/web/src/components/annotation-panels.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SourceSpecAnnotationDto } from "@specops/contracts";

import { AnnotationSummaryPanel } from "./annotation-panels.js";

describe("AnnotationSummaryPanel", () => {
  it("groups annotations by relationship type", () => {
    const { container } = render(
      <AnnotationSummaryPanel
        annotations={[
          annotation({ relationshipType: "implements", sourceFilePath: "src/service.ts" }),
          annotation({ relationshipType: "tests", sourceFilePath: "src/service.test.ts" })
        ]}
      />
    );

    expect(container.textContent).toContain("Implements");
    expect(container.textContent).toContain("src/service.ts");
    expect(container.textContent).toContain("Tests");
    expect(container.textContent).toContain("src/service.test.ts");
  });

  it("shows stale and claim-backed metadata", () => {
    const { container } = render(
      <AnnotationSummaryPanel
        annotations={[
          annotation({
            status: "stale",
            claimId: "00000000-0000-4000-8000-000000000010",
            confidence: 0.62
          })
        ]}
      />
    );

    expect(container.textContent).toContain("stale");
    expect(container.textContent).toContain("claim");
    expect(container.textContent).toContain("62%");
  });
});

function annotation(
  overrides: Partial<SourceSpecAnnotationDto> = {}
): SourceSpecAnnotationDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    sourceFileId: "00000000-0000-4000-8000-000000000003",
    sourceFilePath: "src/decision.ts",
    symbolName: "Decision",
    symbolKind: "interface",
    startLine: 1,
    endLine: 3,
    annotationLine: null,
    sourceContentHash: "hash",
    entityId: "domain.decision",
    specFilePath: "domain/decision.md",
    claimId: null,
    relationshipType: "defines",
    confidence: 1,
    provenance: "user",
    status: "active",
    analyzeRunId: null,
    proposalId: null,
    assemblyId: null,
    claimEvidenceId: null,
    indexRunId: null,
    createdAt: "2026-05-13T10:00:00.000Z",
    updatedAt: "2026-05-13T10:00:00.000Z",
    ...overrides
  };
}
```

- [ ] **Step 2: Run panel test to verify it fails**

Run:

```bash
pnpm --filter web test -- annotation-panels.test.tsx
```

Expected: FAIL because `annotation-panels.tsx` does not exist.

- [ ] **Step 3: Add query helpers**

Modify imports in `apps/web/src/api/queries.ts`:

```ts
  AnnotationCreateRequest,
  AnnotationListQuery,
  SourceSpecAnnotationDto,
  SourceSpecAnnotationUpdateRequest,
```

Add query keys:

```ts
  annotations: (projectId: string, input: AnnotationListQuery = {}) =>
    ["projects", projectId, "annotations", input] as const,
  annotationsRoot: (projectId: string) => ["projects", projectId, "annotations"] as const,
```

Add helpers:

```ts
export function annotationsQuery(projectId: string, input: AnnotationListQuery = {}) {
  const search = new URLSearchParams();
  if (input.entityId) search.set("entityId", input.entityId);
  if (input.sourceFileId) search.set("sourceFileId", input.sourceFileId);
  if (input.filePath) search.set("filePath", input.filePath);
  if (input.relationshipType) search.set("relationshipType", input.relationshipType);
  if (input.status) search.set("status", input.status);
  if (input.provenance) search.set("provenance", input.provenance);
  if (input.includeExcerpt !== undefined) search.set("includeExcerpt", String(input.includeExcerpt));
  const suffix = search.toString() ? `?${search.toString()}` : "";

  return queryOptions({
    queryKey: queryKeys.annotations(projectId, input),
    queryFn: () =>
      apiGet<SourceSpecAnnotationDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/annotations${suffix}`
      )
  });
}

export function createAnnotation(projectId: string, input: AnnotationCreateRequest) {
  return apiSend<SourceSpecAnnotationDto>(
    `/api/projects/${encodeURIComponent(projectId)}/annotations`,
    { method: "POST", body: input }
  );
}

export function patchAnnotation(
  projectId: string,
  annotationId: string,
  input: SourceSpecAnnotationUpdateRequest
) {
  return apiSend<SourceSpecAnnotationDto>(
    `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: "PATCH", body: input }
  );
}

export function deleteAnnotation(projectId: string, annotationId: string) {
  return apiSend<void>(
    `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: "DELETE" }
  );
}
```

- [ ] **Step 4: Add annotation panel**

Create `apps/web/src/components/annotation-panels.tsx`:

```tsx
import type { SourceSpecAnnotationDto } from "@specops/contracts";

const relationshipOrder = ["implements", "uses", "defines", "tests", "references"] as const;

type AnnotationSummaryPanelProps = {
  annotations: SourceSpecAnnotationDto[];
  emptyMessage?: string;
};

export function AnnotationSummaryPanel({
  annotations,
  emptyMessage = "No source/spec annotations."
}: AnnotationSummaryPanelProps) {
  if (annotations.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {relationshipOrder.map((relationshipType) => {
        const group = annotations.filter((annotation) => annotation.relationshipType === relationshipType);
        if (group.length === 0) return null;

        return (
          <section key={relationshipType} className="rounded border border-slate-200 bg-white">
            <h3 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {titleCase(relationshipType)}
            </h3>
            <ul className="divide-y divide-slate-100">
              {group.map((annotation) => (
                <li key={annotation.id} className="grid gap-1 px-3 py-2 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-slate-900">
                      {formatLocation(annotation)}
                    </span>
                    {annotation.status === "stale" ? (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                        stale
                      </span>
                    ) : null}
                    {annotation.claimId ? (
                      <span className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                        claim
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{annotation.provenance}</span>
                    <span>{formatConfidence(annotation.confidence)}</span>
                    <span>{annotation.entityId}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function formatLocation(annotation: SourceSpecAnnotationDto) {
  const lineSuffix =
    annotation.startLine && annotation.endLine
      ? `:${annotation.startLine}-${annotation.endLine}`
      : "";
  const symbol = annotation.symbolName ? ` (${annotation.symbolName})` : "";
  return `${annotation.sourceFilePath}${lineSuffix}${symbol}`;
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "unknown confidence" : `${Math.round(confidence * 100)}%`;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
```

- [ ] **Step 5: Replace entity source links query usage**

Modify `apps/web/src/components/entity-detail.tsx` imports:

```ts
  annotationsQuery,
```

Replace:

```ts
  const sourceLinks = useQuery({
    ...entitySourceLinksQuery(projectId, entityId),
    enabled: Boolean(entityId)
  });
```

With:

```ts
  const annotations = useQuery({
    ...annotationsQuery(projectId, { entityId, includeExcerpt: true }),
    enabled: Boolean(entityId)
  });
```

Replace `SourceLinkTabs` props:

```tsx
          annotations={annotations.data ?? []}
          annotationsError={annotations.error?.message ?? null}
```

Invalidate query after save:

```ts
        queryClient.invalidateQueries({ queryKey: queryKeys.annotationsRoot(projectId) }),
```

- [ ] **Step 6: Adapt source link tabs to annotations**

Modify `apps/web/src/components/source-link-tabs.tsx` to use `SourceSpecAnnotationDto`:

```ts
import type { SourceSpecAnnotationDto } from "@specops/contracts";
import { AnnotationSummaryPanel } from "./annotation-panels.js";
```

Change props:

```ts
  annotations: SourceSpecAnnotationDto[];
  annotationsError?: string | null;
```

Use `visibleAnnotations`, `activeAnnotation`, and show an annotation summary above or beside source tabs:

```tsx
        <AnnotationSummaryPanel annotations={visibleAnnotations} />
```

In `SourceLinkPanel`, replace `sourceLink` with `annotation`, use:

```tsx
        <div className="min-w-0 flex-1 truncate font-mono text-slate-900">{annotation.sourceFilePath}</div>
        <div className="shrink-0">
          <span className="font-medium text-slate-700">{annotation.symbolKind ?? annotation.relationshipType}</span>{" "}
          <span>{annotation.symbolName ?? annotation.entityId}</span>
        </div>
```

Focus line:

```tsx
        focusLine={annotation.annotationLine ?? annotation.startLine}
```

Update label:

```ts
function sourceButtonLabel(annotation: SourceSpecAnnotationDto) {
  return `${basename(annotation.sourceFilePath)} · ${annotation.symbolName ?? annotation.relationshipType}`;
}
```

- [ ] **Step 7: Update analyze review invalidation**

In `apps/web/src/routes/analyze-run-review.tsx`, add to `invalidateAcceptedData`:

```ts
      queryClient.invalidateQueries({ queryKey: queryKeys.annotationsRoot(projectId) }),
```

- [ ] **Step 8: Run web tests**

Run:

```bash
pnpm --filter web test -- annotation-panels.test.tsx source-link-tabs.test.tsx entity-detail.test.tsx analyze-runs.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/web/src/api/queries.ts apps/web/src/components/annotation-panels.tsx apps/web/src/components/annotation-panels.test.tsx apps/web/src/components/entity-detail.tsx apps/web/src/components/source-link-tabs.tsx apps/web/src/components/source-link-tabs.test.tsx apps/web/src/routes/analyze-run-review.tsx
git commit -m "feat: show source spec annotations in web"
```

---

### Task 7: Validation And Stale Annotation Behavior

**Files:**

- Modify: `apps/api/src/services/annotation-service.ts`
- Modify: `apps/api/src/services/source-scan-service.ts`
- Modify: `apps/api/src/__tests__/annotation-service.test.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write stale validation tests**

Append to `apps/api/src/__tests__/annotation-service.test.ts`:

```ts
  it("marks generated annotations stale when source content hash changes", async () => {
    const { project, sourceFile } = await createFixture();
    const service = createAnnotationService(db);
    await service.replaceScannerAnnotations(project.id, "00000000-0000-4000-8000-000000000101", [
      {
        sourceFileId: sourceFile.id,
        sourceFilePath: sourceFile.path,
        symbolName: "Decision",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: "old-hash",
        entityId: "use-case.review-drafts",
        specFilePath: "use-cases/review-drafts.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);

    await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([[sourceFile.path, "new-hash"]])
    });

    const annotations = await service.listAnnotations(project.id, {
      entityId: "use-case.review-drafts"
    });

    expect(annotations[0]?.status).toBe("stale");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- annotation-service.test.ts -t stale
```

Expected: FAIL because `markStaleAnnotations` is missing.

- [ ] **Step 3: Implement stale marker**

Add to `createAnnotationService` return object:

```ts
    async markStaleAnnotations(
      projectId: string,
      input: { currentSourceHashes: Map<string, string> },
      client: Pick<Db, "select" | "update"> = db
    ): Promise<number> {
      const generatedRows = await client
        .select()
        .from(sourceSpecAnnotations)
        .where(
          and(
            eq(sourceSpecAnnotations.projectId, projectId),
            eq(sourceSpecAnnotations.status, "active")
          )
        );
      let staleCount = 0;

      for (const row of generatedRows) {
        if (row.provenance === "user") continue;
        const currentHash = input.currentSourceHashes.get(row.sourceFilePath);
        const stale =
          currentHash === undefined ||
          (row.sourceContentHash !== null && currentHash !== row.sourceContentHash);
        if (!stale) continue;

        await client
          .update(sourceSpecAnnotations)
          .set({ status: "stale", updatedAt: new Date() })
          .where(and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.id, row.id)));
        staleCount += 1;
      }

      return staleCount;
    },
```

- [ ] **Step 4: Call stale marker during scan before replacing scanner rows**

In `apps/api/src/services/source-scan-service.ts`, before `replaceScannerAnnotations`, build:

```ts
  const currentSourceHashes = new Map(result.files.map((file) => [file.path, file.contentHash]));
  await createAnnotationService(db as Db).markStaleAnnotations(projectId, { currentSourceHashes }, db);
```

Keep `replaceScannerAnnotations` after this call. User annotations are never changed by stale marker.

- [ ] **Step 5: Run focused tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- annotation-service.test.ts routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/api/src/services/annotation-service.ts apps/api/src/services/source-scan-service.ts apps/api/src/__tests__/annotation-service.test.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: preserve stale generated annotations"
```

---

### Task 8: Full Verification And Cleanup

**Files:**

- Review: all changed files from Tasks 1-7
- Modify: only files with failing tests or stale references

- [ ] **Step 1: Search for old source link consumers**

Run:

```bash
rg -n "sourceSpecLinks|SourceSpecLinkDto|source-links|sourceLinks|listSourceSpecLinksForEntity" apps packages
```

Expected: no active product path depends on `sourceSpecLinks` or `/source-links`. Remaining references are allowed only in tests that explicitly prove migration compatibility or in deleted-code-adjacent historical names that are being removed in this task.

- [ ] **Step 2: Remove obsolete references**

For every active reference found in Step 1, replace it with annotations:

```ts
import type { SourceSpecAnnotationDto } from "@specops/contracts";
```

Use `annotationsQuery(projectId, { entityId, includeExcerpt: true })` for entity-to-source reads and `/api/projects/:projectId/annotations?sourceFileId=...` for source-to-spec reads.

- [ ] **Step 3: Run full validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands pass. If DB-backed tests are skipped because `TEST_DATABASE_URL` is not set, run the DB-backed API subset explicitly:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test
```

Expected: PASS.

- [ ] **Step 4: Inspect generated markdown fixture output**

Run:

```bash
pnpm --filter api test -- analyze-review-renderer.test.ts --run
```

Expected: PASS and renderer snapshots/assertions include inline footnotes and grouped source links.

- [ ] **Step 5: Final commit**

Run:

```bash
git status --short
git add apps packages docs
git commit -m "test: verify annotation model integration"
```

If `git status --short` shows no changes after Step 3 cleanup, skip the commit and record that no cleanup commit is required.

---

## Self-Review

Spec coverage:

- First-class annotations: Tasks 1-3.
- Entity-level baseline with optional claim precision: Tasks 1 and 4.
- Accepted Phase 2 evidence promotion: Task 4.
- Scanner `@specops` ingestion: Task 2.
- Bidirectional spec/source reads: Tasks 3, 5, and 6.
- Markdown inline footnotes and grouped source links: Task 4.
- Stale preservation: Task 7.
- No full refresh workflow or project graph: excluded from tasks.

Placeholder scan:

- No unresolved placeholder markers or unspecified implementation steps remain.
- Each code-changing task includes concrete file paths, snippets, commands, and expected outcomes.

Type consistency:

- Contract DTO name is `SourceSpecAnnotationDto`.
- Relationship type schema is `annotationRelationshipTypeSchema`.
- DB table name is `sourceSpecAnnotations`.
- API route root is `/api/projects/:projectId/annotations`.
