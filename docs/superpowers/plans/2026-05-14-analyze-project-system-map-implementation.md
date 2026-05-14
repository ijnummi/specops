# Analyze Project System Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-scoped, scanner-first system map to Analyze Project so first-time users review a project skeleton alongside generated draft specs.

**Architecture:** Add contracts and Drizzle tables for system map snapshots and areas, then build a focused API service that derives map areas from indexed source inventory and links proposals by source evidence. Integrate the service into analyze-run execution and expose the snapshot through a project/run-scoped route. Update the Analyze Review UI to load the map and present a map-led review shell around the existing assembly workspace.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, Drizzle/PostgreSQL, Fastify, React, TanStack Query, TanStack Router, Vitest.

---

## File Structure

Create:

- `packages/contracts/src/system-map.ts`: Zod schemas and DTO types for system map snapshots, areas, evidence, diagnostics, and response payloads.
- `packages/contracts/src/system-map.test.ts`: contract parser tests.
- `apps/api/src/services/system-map-service.ts`: scanner-first map construction, retrieval, proposal linking, and DTO mapping.
- `apps/api/src/__tests__/system-map-service.test.ts`: DB-backed tests for classification, persistence, retrieval, and proposal linking.
- `apps/web/src/components/system-map-review-panel.tsx`: map navigation and selected-area detail used by Analyze Review.
- `apps/web/src/components/system-map-review-panel.test.tsx`: component tests for grouping, selection, evidence, diagnostics, and related drafts.

Modify:

- `packages/contracts/src/index.ts`: export system map contracts.
- `packages/contracts/src/analyze-runs.ts`: add `build_system_map` and `link_map_to_drafts` to analyze run step names.
- `packages/db/src/schema.ts`: add `systemMapSnapshots` and `systemMapAreas` tables.
- `packages/db/src/schema.typecheck.ts`: add select/insert type checks for the new tables.
- `packages/db/migrations/0000_initial.sql`: add SQL tables, indexes, and project/run foreign keys.
- `packages/db/src/migrations.test.ts`: assert the new tables and indexes exist.
- `apps/api/src/services/analyze-run-service.ts`: execute `build_system_map` after indexing and `link_map_to_drafts` after proposal generation.
- `apps/api/src/routes/analyze-runs.ts`: add `GET /projects/:projectId/analyze-runs/:runId/system-map`.
- `apps/api/src/__tests__/analyze-run-service.test.ts`: update step-order expectations and assert map counts.
- `apps/api/src/__tests__/routes.test.ts`: add route-level system map tests.
- `apps/web/src/api/queries.ts`: add system map query key and query helper.
- `apps/web/src/routes/analyze-run-detail.tsx`: show the new progress steps and rename the review CTA.
- `apps/web/src/routes/analyze-runs.test.tsx`: update analyze progress expectations.
- `apps/web/src/routes/analyze-run-review.tsx`: fetch system map and pass it to the review shell.
- `apps/web/src/components/analyze-review-workspace.tsx`: accept optional map context or wrap existing workspace without changing assembly semantics.
- `apps/web/src/components/analyze-review-workspace.test.tsx`: verify existing review behavior still works when map data is present.

---

### Task 1: Contracts And Database Schema

**Files:**

- Create: `packages/contracts/src/system-map.ts`
- Create: `packages/contracts/src/system-map.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/analyze-runs.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`

- [ ] **Step 1: Write the failing system map contract test**

Create `packages/contracts/src/system-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  systemMapAreaSchema,
  systemMapResponseSchema,
  systemMapSnapshotSchema
} from "./system-map.js";

const timestamp = "2026-05-14T10:00:00.000Z";

describe("system map contracts", () => {
  it("parses a system map snapshot", () => {
    const parsed = systemMapSnapshotSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      analyzeRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Backend routes, services, frontend views, tests, config, and packages were mapped.",
      coverage: {
        sourceFileCount: 8,
        mappedSourceFileCount: 7,
        unmappedSourceFileCount: 1,
        areaCounts: {
          backend_routes: 1,
          backend_services: 1,
          frontend_routes: 1,
          frontend_components: 1,
          data_models: 1,
          tests: 1,
          config: 1,
          packages: 1,
          unknown: 0
        }
      },
      diagnostics: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(parsed.status).toBe("ready");
    expect(parsed.coverage.areaCounts.backend_routes).toBe(1);
  });

  it("parses an area with source evidence and related drafts", () => {
    const parsed = systemMapAreaSchema.parse({
      id: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000001",
      areaType: "backend_routes",
      name: "API routes",
      summary: "Fastify route registration files define the project API surface.",
      confidence: 0.9,
      evidence: [
        {
          sourceFileId: "00000000-0000-4000-8000-000000000020",
          sourceFilePath: "apps/api/src/routes/projects.ts",
          symbolName: "registerProjectRoutes",
          symbolKind: "function",
          startLine: 12,
          relationship: "defines"
        }
      ],
      keyFiles: ["apps/api/src/routes/projects.ts"],
      keySymbols: ["registerProjectRoutes"],
      relatedProposalIds: ["00000000-0000-4000-8000-000000000030"],
      diagnostics: [],
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(parsed.areaType).toBe("backend_routes");
    expect(parsed.relatedProposalIds).toHaveLength(1);
  });

  it("parses the response payload", () => {
    const parsed = systemMapResponseSchema.parse({
      snapshot: {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        analyzeRunId: "00000000-0000-4000-8000-000000000003",
        status: "limited",
        summary: "No supported source files were available for mapping.",
        coverage: {
          sourceFileCount: 0,
          mappedSourceFileCount: 0,
          unmappedSourceFileCount: 0,
          areaCounts: {}
        },
        diagnostics: [
          {
            level: "warning",
            code: "no_supported_source",
            message: "No indexed source files were available for the system map."
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      areas: []
    });

    expect(parsed.snapshot.status).toBe("limited");
    expect(parsed.areas).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- system-map.test.ts
```

Expected: FAIL because `packages/contracts/src/system-map.ts` does not exist.

- [ ] **Step 3: Add system map contracts**

Create `packages/contracts/src/system-map.ts`:

```ts
import { z } from "zod";

export const systemMapStatusSchema = z.enum(["building", "ready", "limited", "failed"]);

export const systemMapAreaTypeSchema = z.enum([
  "backend_routes",
  "backend_services",
  "frontend_routes",
  "frontend_components",
  "data_models",
  "tests",
  "config",
  "packages",
  "unknown"
]);

export const systemMapDiagnosticSchema = z.object({
  level: z.enum(["info", "warning"]),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const systemMapAreaCountsSchema = z.record(z.string(), z.number().int().min(0));

export const systemMapCoverageSchema = z.object({
  sourceFileCount: z.number().int().min(0),
  mappedSourceFileCount: z.number().int().min(0),
  unmappedSourceFileCount: z.number().int().min(0),
  areaCounts: systemMapAreaCountsSchema
});

export const systemMapSnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analyzeRunId: z.string().uuid(),
  status: systemMapStatusSchema,
  summary: z.string(),
  coverage: systemMapCoverageSchema,
  diagnostics: z.array(systemMapDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const systemMapEvidenceSchema = z.object({
  sourceFileId: z.string().uuid().nullable(),
  sourceFilePath: z.string().min(1),
  symbolName: z.string().min(1).nullable(),
  symbolKind: z.string().min(1).nullable(),
  startLine: z.number().int().min(1).nullable(),
  relationship: z.enum(["defines", "uses", "tests", "configures", "references"])
});

export const systemMapAreaSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  areaType: systemMapAreaTypeSchema,
  name: z.string().min(1),
  summary: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(systemMapEvidenceSchema),
  keyFiles: z.array(z.string().min(1)),
  keySymbols: z.array(z.string().min(1)),
  relatedProposalIds: z.array(z.string().uuid()),
  diagnostics: z.array(systemMapDiagnosticSchema),
  sortOrder: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const systemMapResponseSchema = z.object({
  snapshot: systemMapSnapshotSchema,
  areas: z.array(systemMapAreaSchema)
});

export type SystemMapStatus = z.infer<typeof systemMapStatusSchema>;
export type SystemMapAreaType = z.infer<typeof systemMapAreaTypeSchema>;
export type SystemMapDiagnostic = z.infer<typeof systemMapDiagnosticSchema>;
export type SystemMapCoverage = z.infer<typeof systemMapCoverageSchema>;
export type SystemMapSnapshotDto = z.infer<typeof systemMapSnapshotSchema>;
export type SystemMapEvidenceDto = z.infer<typeof systemMapEvidenceSchema>;
export type SystemMapAreaDto = z.infer<typeof systemMapAreaSchema>;
export type SystemMapResponseDto = z.infer<typeof systemMapResponseSchema>;
```

- [ ] **Step 4: Export system map contracts and extend analyze run steps**

Modify `packages/contracts/src/index.ts` by adding:

```ts
export * from "./system-map.js";
```

Modify `packages/contracts/src/analyze-runs.ts` so `analyzeRunStepNameSchema` is:

```ts
export const analyzeRunStepNameSchema = z.enum([
  "initialize",
  "index",
  "build_system_map",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill",
  "link_map_to_drafts",
]);
```

- [ ] **Step 5: Run contracts tests**

Run:

```bash
pnpm --filter @specops/contracts test -- system-map.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write schema and migration checks before schema implementation**

Modify `packages/db/src/migrations.test.ts` to assert the new tables exist. Add these expectations in the existing migration assertions:

```ts
expect(tableNames).toContain("system_map_snapshots");
expect(tableNames).toContain("system_map_areas");
```

If the test already asserts index names, add:

```ts
expect(indexNames).toContain("system_map_snapshots_project_run_idx");
expect(indexNames).toContain("system_map_areas_snapshot_type_idx");
```

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because the migration has no system map tables.

- [ ] **Step 7: Add Drizzle schema tables**

Modify `packages/db/src/schema.ts` after `analyzeRuns`:

```ts
export const systemMapSnapshots = pgTable(
  "system_map_snapshots",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    analyzeRunId: uuid("analyze_run_id")
      .notNull()
      .references(() => analyzeRuns.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    coverageJson: jsonb("coverage_json").notNull().default(sql`'{}'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("system_map_snapshots_project_id_idx").on(table.projectId),
    projectRunIdx: index("system_map_snapshots_project_run_idx").on(
      table.projectId,
      table.analyzeRunId,
    ),
    analyzeRunProjectFk: foreignKey({
      name: "system_map_snapshots_analyze_run_project_fk",
      columns: [table.analyzeRunId, table.projectId],
      foreignColumns: [analyzeRuns.id, analyzeRuns.projectId],
    }).onDelete("cascade"),
    runUnique: unique("system_map_snapshots_analyze_run_id_unique").on(table.analyzeRunId),
    idProjectUnique: unique("system_map_snapshots_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
  }),
);

export const systemMapAreas = pgTable(
  "system_map_areas",
  {
    id: primaryId(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => systemMapSnapshots.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    areaType: text("area_type").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    confidence: doublePrecision("confidence"),
    evidenceJson: jsonb("evidence_json").notNull().default(sql`'[]'::jsonb`),
    keyFilesJson: jsonb("key_files_json").notNull().default(sql`'[]'::jsonb`),
    keySymbolsJson: jsonb("key_symbols_json").notNull().default(sql`'[]'::jsonb`),
    relatedProposalIdsJson: jsonb("related_proposal_ids_json").notNull().default(sql`'[]'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    snapshotIdx: index("system_map_areas_snapshot_id_idx").on(table.snapshotId),
    snapshotTypeIdx: index("system_map_areas_snapshot_type_idx").on(
      table.snapshotId,
      table.areaType,
    ),
    projectIdx: index("system_map_areas_project_id_idx").on(table.projectId),
    snapshotProjectFk: foreignKey({
      name: "system_map_areas_snapshot_project_fk",
      columns: [table.snapshotId, table.projectId],
      foreignColumns: [systemMapSnapshots.id, systemMapSnapshots.projectId],
    }).onDelete("cascade"),
  }),
);
```

- [ ] **Step 8: Add typecheck coverage for new tables**

Modify `packages/db/src/schema.typecheck.ts` by importing the new tables and adding type assertions matching the file's existing pattern:

```ts
import { systemMapAreas, systemMapSnapshots } from "./schema.js";

type SystemMapSnapshotSelect = typeof systemMapSnapshots.$inferSelect;
type SystemMapSnapshotInsert = typeof systemMapSnapshots.$inferInsert;
type SystemMapAreaSelect = typeof systemMapAreas.$inferSelect;
type SystemMapAreaInsert = typeof systemMapAreas.$inferInsert;

const systemMapSnapshotSelect = {} as SystemMapSnapshotSelect;
const systemMapSnapshotInsert = {} as SystemMapSnapshotInsert;
const systemMapAreaSelect = {} as SystemMapAreaSelect;
const systemMapAreaInsert = {} as SystemMapAreaInsert;

void systemMapSnapshotSelect;
void systemMapSnapshotInsert;
void systemMapAreaSelect;
void systemMapAreaInsert;
```

Use the exact placement/style already used in `schema.typecheck.ts`; do not duplicate an import if the file already has a grouped schema import.

- [ ] **Step 9: Add migration SQL**

Modify `packages/db/migrations/0000_initial.sql` by adding these tables after `analyze_runs`:

```sql
CREATE TABLE IF NOT EXISTS "system_map_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "analyze_run_id" uuid NOT NULL,
  "status" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "coverage_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "diagnostics_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_map_snapshots_analyze_run_id_unique" UNIQUE("analyze_run_id"),
  CONSTRAINT "system_map_snapshots_id_project_id_unique" UNIQUE("id","project_id")
);

CREATE TABLE IF NOT EXISTS "system_map_areas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "area_type" text NOT NULL,
  "name" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "confidence" double precision,
  "evidence_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "key_files_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "key_symbols_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_proposal_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "diagnostics_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "system_map_snapshots"
  ADD CONSTRAINT "system_map_snapshots_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;

ALTER TABLE "system_map_snapshots"
  ADD CONSTRAINT "system_map_snapshots_analyze_run_id_analyze_runs_id_fk"
  FOREIGN KEY ("analyze_run_id") REFERENCES "analyze_runs"("id") ON DELETE cascade;

ALTER TABLE "system_map_snapshots"
  ADD CONSTRAINT "system_map_snapshots_analyze_run_project_fk"
  FOREIGN KEY ("analyze_run_id","project_id") REFERENCES "analyze_runs"("id","project_id") ON DELETE cascade;

ALTER TABLE "system_map_areas"
  ADD CONSTRAINT "system_map_areas_snapshot_id_system_map_snapshots_id_fk"
  FOREIGN KEY ("snapshot_id") REFERENCES "system_map_snapshots"("id") ON DELETE cascade;

ALTER TABLE "system_map_areas"
  ADD CONSTRAINT "system_map_areas_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;

ALTER TABLE "system_map_areas"
  ADD CONSTRAINT "system_map_areas_snapshot_project_fk"
  FOREIGN KEY ("snapshot_id","project_id") REFERENCES "system_map_snapshots"("id","project_id") ON DELETE cascade;

CREATE INDEX IF NOT EXISTS "system_map_snapshots_project_id_idx"
  ON "system_map_snapshots" ("project_id");

CREATE INDEX IF NOT EXISTS "system_map_snapshots_project_run_idx"
  ON "system_map_snapshots" ("project_id","analyze_run_id");

CREATE INDEX IF NOT EXISTS "system_map_areas_snapshot_id_idx"
  ON "system_map_areas" ("snapshot_id");

CREATE INDEX IF NOT EXISTS "system_map_areas_snapshot_type_idx"
  ON "system_map_areas" ("snapshot_id","area_type");

CREATE INDEX IF NOT EXISTS "system_map_areas_project_id_idx"
  ON "system_map_areas" ("project_id");
```

If the migration groups all foreign keys and indexes near the bottom, place the `CREATE TABLE` statements with tables and place the `ALTER TABLE` and `CREATE INDEX` statements in those existing sections.

- [ ] **Step 10: Run DB tests and typecheck**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit contracts and schema**

```bash
git add packages/contracts/src/system-map.ts packages/contracts/src/system-map.test.ts packages/contracts/src/index.ts packages/contracts/src/analyze-runs.ts packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add system map contracts and schema"
```

---

### Task 2: System Map Service

**Files:**

- Create: `apps/api/src/services/system-map-service.ts`
- Create: `apps/api/src/__tests__/system-map-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

Create `apps/api/src/__tests__/system-map-service.test.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { systemMapResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import { aiProposals, analyzeRuns, createDb, projects } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createIndexerService } from "../services/indexer-service.js";
import { createProjectService } from "../services/project-service.js";
import { createSystemMapService } from "../services/system-map-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
describeWithDb("createSystemMapService", () => {
  const tempRoots: string[] = [];
  const projectIds: string[] = [];
  let db: Db;

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    await migrateTestDatabase(testDatabaseUrl);
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
  });

  it("builds a scanner-first map from indexed source inventory", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);

    const result = await createSystemMapService(db).buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id
    });

    expect(systemMapResponseSchema.parse(result)).toEqual(result);
    expect(result.snapshot.status).toBe("ready");
    expect(result.areas.map((area) => area.areaType)).toEqual(
      expect.arrayContaining([
        "backend_routes",
        "backend_services",
        "frontend_routes",
        "frontend_components",
        "data_models",
        "tests",
        "config",
        "packages"
      ])
    );
    expect(result.areas.find((area) => area.areaType === "backend_routes")).toMatchObject({
      name: "Backend routes",
      keyFiles: expect.arrayContaining(["apps/api/src/routes/projects.ts"])
    });
  });

  it("creates a limited map with diagnostics when no source files exist", async () => {
    const project = await createProjectFixture();
    await mkdir(path.join(project.repoPath, ".specops"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, ".specops", "README.md"),
      "# Empty\n",
      "utf8"
    );
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);

    const result = await createSystemMapService(db).buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id
    });

    expect(result.snapshot.status).toBe("limited");
    expect(result.snapshot.diagnostics).toContainEqual({
      level: "warning",
      code: "no_supported_source",
      message: "No indexed source files were available for the system map."
    });
    expect(result.areas).toEqual([]);
  });

  it("links proposals to map areas by source evidence path", async () => {
    const project = await createProjectFixture();
    await writeSystemMapFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const analyzeRun = await insertAnalyzeRun(project.id);
    const service = createSystemMapService(db);
    const built = await service.buildSystemMap({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      indexRunId: indexRun.id
    });
    const [proposal] = await db
      .insert(aiProposals)
      .values({
        projectId: project.id,
        proposalType: "ai_spec_entity",
        title: "Project routes",
        payloadJson: {
          entityId: "interface.project-routes",
          entityType: "interface",
          filePath: "interfaces/project-routes.md",
          summary: "Project routes expose project APIs."
        },
        evidenceJson: {
          sourceFiles: [
            {
              path: "apps/api/src/routes/projects.ts",
              symbols: ["registerProjectRoutes"]
            }
          ]
        },
        confidence: 0.8,
        status: "pending"
      })
      .returning();

    await service.linkMapToDrafts({
      projectId: project.id,
      analyzeRunId: analyzeRun.id,
      proposalIds: [proposal!.id]
    });

    const linked = await service.getSystemMap(project.id, analyzeRun.id);
    expect(
      linked.areas.find((area) => area.id === built.areas.find((area) => area.areaType === "backend_routes")?.id)
        ?.relatedProposalIds
    ).toContain(proposal!.id);
  });

  async function createProjectFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-system-map-"));
    tempRoots.push(root);
    const project = await createProjectService(db).createProject({
      name: `System Map ${Date.now()} ${Math.random()}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    });
    projectIds.push(project.id);
    return project;
  }

  async function insertAnalyzeRun(projectId: string) {
    const [run] = await db
      .insert(analyzeRuns)
      .values({
        projectId,
        status: "running",
        stepsJson: []
      })
      .returning();
    return run!;
  }
});

async function writeSystemMapFixture(repoPath: string) {
  await mkdir(path.join(repoPath, "apps/api/src/routes"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/api/src/services"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/web/src/routes"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/web/src/components"), { recursive: true });
  await mkdir(path.join(repoPath, "packages/db/src"), { recursive: true });
  await mkdir(path.join(repoPath, "packages/domain/src"), { recursive: true });
  await mkdir(path.join(repoPath, ".specops"), { recursive: true });

  await writeFile(
    path.join(repoPath, "apps/api/src/routes/projects.ts"),
    "export function registerProjectRoutes() { return 'routes'; }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/services/project-service.ts"),
    "export class ProjectService { listProjects() { return []; } }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/web/src/routes/projects.tsx"),
    "export function ProjectsPage() { return null; }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/web/src/components/project-card.tsx"),
    "export function ProjectCard() { return null; }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "packages/db/src/schema.ts"),
    "export const projects = {};\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/routes/projects.test.ts"),
    "export function testProjectRoutes() { return true; }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "vite.config.ts"),
    "export default {};\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "packages/domain/src/index.ts"),
    "export type Decision = { id: string };\n",
    "utf8"
  );
}

function readTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? "";
}

async function migrateTestDatabase(databaseUrl: string) {
  const { migrate } = await import("@specops/db/migrate");
  await migrate(databaseUrl);
}

async function closeDb(db: Db | undefined) {
  const pool = (db as unknown as { $client?: pg.Pool } | undefined)?.$client;
  await pool?.end();
}
```

- [ ] **Step 2: Run the service test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- system-map-service.test.ts
```

Expected: FAIL because `apps/api/src/services/system-map-service.ts` does not exist. If PostgreSQL is not running, start it with `docker compose up -d postgres` and create `specops_test` before re-running.

- [ ] **Step 3: Implement the system map service**

Create `apps/api/src/services/system-map-service.ts`:

```ts
import type {
  SystemMapAreaDto,
  SystemMapAreaType,
  SystemMapCoverage,
  SystemMapDiagnostic,
  SystemMapEvidenceDto,
  SystemMapResponseDto
} from "@specops/contracts";
import { systemMapResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSymbols,
  systemMapAreas,
  systemMapSnapshots
} from "@specops/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

type SourceFileRow = typeof sourceFiles.$inferSelect;
type SourceSymbolRow = typeof sourceSymbols.$inferSelect;
type SourceImportRow = typeof sourceImports.$inferSelect;
type SourceExportRow = typeof sourceExports.$inferSelect;
type SystemMapSnapshotRow = typeof systemMapSnapshots.$inferSelect;
type SystemMapAreaRow = typeof systemMapAreas.$inferSelect;

type BuildSystemMapInput = {
  projectId: string;
  analyzeRunId: string;
  indexRunId: string | null;
};

type LinkMapToDraftsInput = {
  projectId: string;
  analyzeRunId: string;
  proposalIds: string[];
};

const areaOrder: SystemMapAreaType[] = [
  "backend_routes",
  "backend_services",
  "frontend_routes",
  "frontend_components",
  "data_models",
  "tests",
  "config",
  "packages",
  "unknown"
];

const areaLabels: Record<SystemMapAreaType, string> = {
  backend_routes: "Backend routes",
  backend_services: "Backend services",
  frontend_routes: "Frontend routes",
  frontend_components: "Frontend components",
  data_models: "Data models",
  tests: "Tests",
  config: "Config",
  packages: "Packages",
  unknown: "Unknown"
};

export function createSystemMapService(db: Db) {
  async function buildSystemMap(input: BuildSystemMapInput): Promise<SystemMapResponseDto> {
    await db
      .delete(systemMapSnapshots)
      .where(
        and(
          eq(systemMapSnapshots.projectId, input.projectId),
          eq(systemMapSnapshots.analyzeRunId, input.analyzeRunId)
        )
      );

    const files = await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.projectId, input.projectId))
      .orderBy(asc(sourceFiles.path), asc(sourceFiles.id));
    const fileIds = files.map((file) => file.id);
    const symbols = fileIds.length > 0 ? await loadSymbols(input.projectId, fileIds) : [];
    const imports = fileIds.length > 0 ? await loadImports(input.projectId, fileIds) : [];
    const exports = fileIds.length > 0 ? await loadExports(input.projectId, fileIds) : [];
    const areas = buildAreas(files, symbols, imports, exports);
    const diagnostics: SystemMapDiagnostic[] =
      files.length === 0
        ? [
            {
              level: "warning",
              code: "no_supported_source",
              message: "No indexed source files were available for the system map."
            }
          ]
        : [];
    const coverage = buildCoverage(files, areas);
    const [snapshot] = await db
      .insert(systemMapSnapshots)
      .values({
        projectId: input.projectId,
        analyzeRunId: input.analyzeRunId,
        status: files.length === 0 ? "limited" : "ready",
        summary: summarizeMap(files.length, areas),
        coverageJson: coverage,
        diagnosticsJson: diagnostics
      })
      .returning();

    if (!snapshot) {
      throw new Error("Failed to create system map snapshot");
    }

    if (areas.length > 0) {
      await db.insert(systemMapAreas).values(
        areas.map((area, index) => ({
          snapshotId: snapshot.id,
          projectId: input.projectId,
          areaType: area.areaType,
          name: area.name,
          summary: area.summary,
          confidence: area.confidence,
          evidenceJson: area.evidence,
          keyFilesJson: area.keyFiles,
          keySymbolsJson: area.keySymbols,
          relatedProposalIdsJson: [],
          diagnosticsJson: area.diagnostics,
          sortOrder: index
        }))
      );
    }

    return getSystemMap(input.projectId, input.analyzeRunId);
  }

  async function linkMapToDrafts(input: LinkMapToDraftsInput): Promise<SystemMapResponseDto> {
    const snapshot = await getSnapshotRow(input.projectId, input.analyzeRunId);
    const areas = await db
      .select()
      .from(systemMapAreas)
      .where(eq(systemMapAreas.snapshotId, snapshot.id))
      .orderBy(asc(systemMapAreas.sortOrder), asc(systemMapAreas.id));

    if (areas.length === 0 || input.proposalIds.length === 0) {
      return getSystemMap(input.projectId, input.analyzeRunId);
    }

    const proposals = await db
      .select()
      .from(aiProposals)
      .where(
        and(
          eq(aiProposals.projectId, input.projectId),
          inArray(aiProposals.id, input.proposalIds)
        )
      );

    for (const area of areas) {
      const evidencePaths = new Set(readEvidence(area.evidenceJson).map((item) => item.sourceFilePath));
      const relatedProposalIds = proposals
        .filter((proposal) =>
          proposalEvidencePaths(proposal.evidenceJson).some((filePath) => evidencePaths.has(filePath))
        )
        .map((proposal) => proposal.id);

      if (relatedProposalIds.length > 0) {
        await db
          .update(systemMapAreas)
          .set({ relatedProposalIdsJson: relatedProposalIds, updatedAt: new Date() })
          .where(eq(systemMapAreas.id, area.id));
      }
    }

    return getSystemMap(input.projectId, input.analyzeRunId);
  }

  async function getSystemMap(projectId: string, analyzeRunId: string): Promise<SystemMapResponseDto> {
    const snapshot = await getSnapshotRow(projectId, analyzeRunId);
    const areas = await db
      .select()
      .from(systemMapAreas)
      .where(eq(systemMapAreas.snapshotId, snapshot.id))
      .orderBy(asc(systemMapAreas.sortOrder), asc(systemMapAreas.id));

    return systemMapResponseSchema.parse({
      snapshot: mapSnapshot(snapshot),
      areas: areas.map(mapArea)
    });
  }

  async function getSnapshotRow(projectId: string, analyzeRunId: string): Promise<SystemMapSnapshotRow> {
    const [snapshot] = await db
      .select()
      .from(systemMapSnapshots)
      .where(
        and(
          eq(systemMapSnapshots.projectId, projectId),
          eq(systemMapSnapshots.analyzeRunId, analyzeRunId)
        )
      )
      .limit(1);

    if (!snapshot) {
      throw new NotFoundError("System map not found", { projectId, analyzeRunId });
    }

    return snapshot;
  }

  async function loadSymbols(projectId: string, sourceFileIds: string[]) {
    return db
      .select()
      .from(sourceSymbols)
      .where(and(eq(sourceSymbols.projectId, projectId), inArray(sourceSymbols.sourceFileId, sourceFileIds)))
      .orderBy(asc(sourceSymbols.filePath), asc(sourceSymbols.line), asc(sourceSymbols.name));
  }

  async function loadImports(projectId: string, sourceFileIds: string[]) {
    return db
      .select()
      .from(sourceImports)
      .where(and(eq(sourceImports.projectId, projectId), inArray(sourceImports.sourceFileId, sourceFileIds)))
      .orderBy(asc(sourceImports.filePath), asc(sourceImports.specifier));
  }

  async function loadExports(projectId: string, sourceFileIds: string[]) {
    return db
      .select()
      .from(sourceExports)
      .where(and(eq(sourceExports.projectId, projectId), inArray(sourceExports.sourceFileId, sourceFileIds)))
      .orderBy(asc(sourceExports.filePath), asc(sourceExports.exportedName));
  }

  return {
    buildSystemMap,
    linkMapToDrafts,
    getSystemMap
  };
}

type BuiltArea = {
  areaType: SystemMapAreaType;
  name: string;
  summary: string;
  confidence: number;
  evidence: SystemMapEvidenceDto[];
  keyFiles: string[];
  keySymbols: string[];
  diagnostics: SystemMapDiagnostic[];
  sortOrder: number;
};

function buildAreas(
  files: SourceFileRow[],
  symbols: SourceSymbolRow[],
  imports: SourceImportRow[],
  exports: SourceExportRow[]
): BuiltArea[] {
  const symbolsByFile = groupBy(symbols, (symbol) => symbol.sourceFileId);
  const importsByFile = groupBy(imports, (sourceImport) => sourceImport.sourceFileId);
  const exportsByFile = groupBy(exports, (sourceExport) => sourceExport.sourceFileId);
  const filesByArea = new Map<SystemMapAreaType, SourceFileRow[]>();

  for (const file of files) {
    const areaType = classifyArea(file.path, file.kind);
    filesByArea.set(areaType, [...(filesByArea.get(areaType) ?? []), file]);
  }

  return areaOrder.flatMap((areaType, sortIndex) => {
    const areaFiles = filesByArea.get(areaType) ?? [];
    if (areaFiles.length === 0) return [];

    const areaEvidence = areaFiles.flatMap((file) => {
      const fileSymbols = symbolsByFile.get(file.id) ?? [];
      if (fileSymbols.length === 0) {
        return [
          {
            sourceFileId: file.id,
            sourceFilePath: file.path,
            symbolName: null,
            symbolKind: null,
            startLine: null,
            relationship: relationshipForArea(areaType)
          } satisfies SystemMapEvidenceDto
        ];
      }

      return fileSymbols.slice(0, 8).map((symbol) => ({
        sourceFileId: file.id,
        sourceFilePath: file.path,
        symbolName: symbol.name,
        symbolKind: symbol.symbolKind,
        startLine: symbol.line,
        relationship: relationshipForArea(areaType)
      }));
    });

    const keySymbols = uniqueStrings(
      areaFiles.flatMap((file) => (symbolsByFile.get(file.id) ?? []).map((symbol) => symbol.name))
    ).slice(0, 12);
    const importCount = areaFiles.reduce((total, file) => total + (importsByFile.get(file.id)?.length ?? 0), 0);
    const exportCount = areaFiles.reduce((total, file) => total + (exportsByFile.get(file.id)?.length ?? 0), 0);

    return [
      {
        areaType,
        name: areaLabels[areaType],
        summary: `${areaLabels[areaType]} include ${areaFiles.length} source ${areaFiles.length === 1 ? "file" : "files"}, ${keySymbols.length} key ${keySymbols.length === 1 ? "symbol" : "symbols"}, ${importCount} imports, and ${exportCount} exports.`,
        confidence: areaType === "unknown" ? 0.35 : 0.8,
        evidence: areaEvidence,
        keyFiles: areaFiles.map((file) => file.path),
        keySymbols,
        diagnostics: areaType === "unknown"
          ? [
              {
                level: "info",
                code: "unknown_area_classification",
                message: "These files did not match a stronger system map classification."
              }
            ]
          : [],
        sortOrder: sortIndex
      }
    ];
  });
}

function classifyArea(filePath: string, kind: string): SystemMapAreaType {
  const normalized = filePath.toLowerCase();
  if (kind === "test" || /\.test\.[tj]sx?$/.test(normalized) || /\.spec\.[tj]sx?$/.test(normalized)) return "tests";
  if (kind === "config" || normalized.includes("config") || normalized.endsWith(".config.ts")) return "config";
  if (normalized.includes("/routes/") && normalized.endsWith(".tsx")) return "frontend_routes";
  if (normalized.includes("/routes/")) return "backend_routes";
  if (normalized.includes("/services/") || normalized.includes("/service")) return "backend_services";
  if (normalized.includes("/components/") || normalized.includes("/pages/")) return "frontend_components";
  if (normalized.includes("/schema") || normalized.includes("/model") || normalized.includes("/domain") || normalized.includes("/db/")) return "data_models";
  if (normalized.startsWith("packages/")) return "packages";
  return "unknown";
}

function relationshipForArea(areaType: SystemMapAreaType): SystemMapEvidenceDto["relationship"] {
  if (areaType === "tests") return "tests";
  if (areaType === "config") return "configures";
  if (areaType === "backend_routes" || areaType === "frontend_routes" || areaType === "data_models") return "defines";
  return "references";
}

function buildCoverage(files: SourceFileRow[], areas: BuiltArea[]): SystemMapCoverage {
  const mappedSourceFileCount = uniqueStrings(areas.flatMap((area) => area.keyFiles)).length;
  return {
    sourceFileCount: files.length,
    mappedSourceFileCount,
    unmappedSourceFileCount: Math.max(files.length - mappedSourceFileCount, 0),
    areaCounts: Object.fromEntries(areas.map((area) => [area.areaType, 1]))
  };
}

function summarizeMap(sourceFileCount: number, areas: BuiltArea[]): string {
  if (sourceFileCount === 0) {
    return "No supported source files were available for the system map.";
  }

  const labels = areas.map((area) => area.name.toLowerCase()).join(", ");
  return `Mapped ${sourceFileCount} source files into ${areas.length} system areas: ${labels}.`;
}

function mapSnapshot(row: SystemMapSnapshotRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    analyzeRunId: row.analyzeRunId,
    status: row.status,
    summary: row.summary,
    coverage: row.coverageJson,
    diagnostics: row.diagnosticsJson,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function mapArea(row: SystemMapAreaRow): SystemMapAreaDto {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    areaType: row.areaType,
    name: row.name,
    summary: row.summary,
    confidence: row.confidence,
    evidence: readEvidence(row.evidenceJson),
    keyFiles: readStringArray(row.keyFilesJson),
    keySymbols: readStringArray(row.keySymbolsJson),
    relatedProposalIds: readStringArray(row.relatedProposalIdsJson),
    diagnostics: readDiagnostics(row.diagnosticsJson),
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function proposalEvidencePaths(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const sourceFilesValue = record.sourceFiles;
  if (!Array.isArray(sourceFilesValue)) return [];
  return sourceFilesValue.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const pathValue = (item as Record<string, unknown>).path;
    return typeof pathValue === "string" && pathValue.length > 0 ? [pathValue] : [];
  });
}

function readEvidence(value: unknown): SystemMapEvidenceDto[] {
  return Array.isArray(value) ? (value as SystemMapEvidenceDto[]) : [];
}

function readDiagnostics(value: unknown): SystemMapDiagnostic[] {
  return Array.isArray(value) ? (value as SystemMapDiagnostic[]) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- system-map-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run API typecheck**

Run:

```bash
pnpm --filter api typecheck
```

Expected: PASS. If TypeScript reports `row.areaType` or `row.status` is `string` rather than a contract union, parse through `systemMapResponseSchema` as shown in `getSystemMap` rather than widening DTO return types.

- [ ] **Step 6: Commit system map service**

```bash
git add apps/api/src/services/system-map-service.ts apps/api/src/__tests__/system-map-service.test.ts
git commit -m "feat: build analyze system maps from source inventory"
```

---

### Task 3: Analyze Run Integration And API Route

**Files:**

- Modify: `apps/api/src/services/analyze-run-service.ts`
- Modify: `apps/api/src/routes/analyze-runs.ts`
- Modify: `apps/api/src/__tests__/analyze-run-service.test.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update analyze-run service test expectations first**

Modify the first test in `apps/api/src/__tests__/analyze-run-service.test.ts` so the expected step names are:

```ts
expect(run.steps.map((step) => step.name)).toEqual([
  "initialize",
  "index",
  "build_system_map",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill",
  "link_map_to_drafts"
]);
```

Modify the success-status expectation to include seven steps:

```ts
expect(finished.steps.map((step) => step.status)).toEqual([
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded",
  "succeeded"
]);
```

Add an assertion in the successful execution test:

```ts
expect(finished.steps.find((step) => step.name === "build_system_map")?.counts).toMatchObject({
  systemMapAreaCount: expect.any(Number)
});
expect(finished.steps.find((step) => step.name === "link_map_to_drafts")?.counts).toMatchObject({
  linkedProposalCount: expect.any(Number)
});
```

- [ ] **Step 2: Run analyze-run service test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- analyze-run-service.test.ts
```

Expected: FAIL because the service still has five steps.

- [ ] **Step 3: Integrate system map service into analyze runs**

Modify `apps/api/src/services/analyze-run-service.ts`:

Add the import:

```ts
import { createSystemMapService } from "./system-map-service.js";
```

Replace `stepNames` with:

```ts
const stepNames: AnalyzeRunStepName[] = [
  "initialize",
  "index",
  "build_system_map",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill",
  "link_map_to_drafts"
];
```

Add this step immediately after the existing `index` step:

```ts
      await runStep("build_system_map", async () => {
        const map = await createSystemMapService(db).buildSystemMap({
          projectId,
          analyzeRunId: runId,
          indexRunId: (await getAnalyzeRunRow(projectId, runId)).indexRunId
        });
        return {
          status: "succeeded",
          counts: {
            systemMapAreaCount: map.areas.length,
            mappedSourceFileCount: map.snapshot.coverage.mappedSourceFileCount,
            unmappedSourceFileCount: map.snapshot.coverage.unmappedSourceFileCount
          }
        };
      });
```

Add this step after AI prefill is complete or skipped:

```ts
      await runStep("link_map_to_drafts", async () => {
        const map = await createSystemMapService(db).linkMapToDrafts({
          projectId,
          analyzeRunId: runId,
          proposalIds
        });
        const linkedProposalCount = new Set(
          map.areas.flatMap((area) => area.relatedProposalIds)
        ).size;
        return {
          status: "succeeded",
          counts: {
            linkedProposalCount,
            unmappedProposalCount: Math.max(proposalIds.length - linkedProposalCount, 0)
          }
        };
      });
```

- [ ] **Step 4: Run analyze-run service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- analyze-run-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add route test**

Add a route-level test to `apps/api/src/__tests__/routes.test.ts` near the analyze-run route tests:

```ts
it("returns the system map for an analyze run", async () => {
  const project = await createProjectFixture();
  await mkdir(path.join(project.repoPath, "src"), { recursive: true });
  await writeFile(path.join(project.repoPath, "src", "routes.ts"), "export function registerRoutes() { return true; }\n", "utf8");

  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/analyze-runs`
  });
  expect(created.statusCode).toBe(201);
  const run = created.json<{ id: string }>();
  const finished = await waitForAnalyzeRun(project.id, run.id);
  expect(finished.status).toBe("succeeded");

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/analyze-runs/${run.id}/system-map`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    snapshot: {
      projectId: project.id,
      analyzeRunId: run.id
    },
    areas: expect.any(Array)
  });
});
```

If `routes.test.ts` uses different fixture helper names for project creation or waiting for analyze runs, use the existing helpers in that file and keep the assertion body identical.

- [ ] **Step 6: Run the route test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "returns the system map for an analyze run"
```

Expected: FAIL because the route does not exist.

- [ ] **Step 7: Add the system map route**

Modify `apps/api/src/routes/analyze-runs.ts`:

Add the import:

```ts
import { createSystemMapService } from "../services/system-map-service.js";
```

Add the route inside `registerAnalyzeRunRoutes`:

```ts
  app.get("/projects/:projectId/analyze-runs/:runId/system-map", async (request) => {
    const { projectId, runId } = analyzeRunParamsSchema.parse(request.params);
    return createSystemMapService(db).getSystemMap(projectId, runId);
  });
```

- [ ] **Step 8: Run API route and typecheck verification**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "returns the system map for an analyze run"
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit analyze integration and route**

```bash
git add apps/api/src/services/analyze-run-service.ts apps/api/src/routes/analyze-runs.ts apps/api/src/__tests__/analyze-run-service.test.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: include system maps in analyze runs"
```

---

### Task 4: Frontend Query And Map-Led Review UI

**Files:**

- Create: `apps/web/src/components/system-map-review-panel.tsx`
- Create: `apps/web/src/components/system-map-review-panel.test.tsx`
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/routes/analyze-run-detail.tsx`
- Modify: `apps/web/src/routes/analyze-run-review.tsx`
- Modify: `apps/web/src/routes/analyze-runs.test.tsx`
- Modify: `apps/web/src/components/analyze-review-workspace.test.tsx`

- [ ] **Step 1: Write the system map panel test**

Create `apps/web/src/components/system-map-review-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SystemMapReviewPanel } from "./system-map-review-panel.js";

describe("SystemMapReviewPanel", () => {
  it("renders map areas, evidence, diagnostics, and related draft counts", () => {
    render(
      <SystemMapReviewPanel
        map={{
          snapshot: {
            id: "snapshot-1",
            projectId: "project-1",
            analyzeRunId: "run-1",
            status: "ready",
            summary: "Mapped 2 source files into 2 system areas.",
            coverage: {
              sourceFileCount: 2,
              mappedSourceFileCount: 2,
              unmappedSourceFileCount: 0,
              areaCounts: { backend_routes: 1, tests: 1 }
            },
            diagnostics: [],
            createdAt: "2026-05-14T10:00:00.000Z",
            updatedAt: "2026-05-14T10:00:00.000Z"
          },
          areas: [
            {
              id: "area-1",
              snapshotId: "snapshot-1",
              areaType: "backend_routes",
              name: "Backend routes",
              summary: "Route files define the API surface.",
              confidence: 0.8,
              evidence: [
                {
                  sourceFileId: "source-1",
                  sourceFilePath: "apps/api/src/routes/projects.ts",
                  symbolName: "registerProjectRoutes",
                  symbolKind: "function",
                  startLine: 4,
                  relationship: "defines"
                }
              ],
              keyFiles: ["apps/api/src/routes/projects.ts"],
              keySymbols: ["registerProjectRoutes"],
              relatedProposalIds: ["proposal-1", "proposal-2"],
              diagnostics: [],
              sortOrder: 0,
              createdAt: "2026-05-14T10:00:00.000Z",
              updatedAt: "2026-05-14T10:00:00.000Z"
            },
            {
              id: "area-2",
              snapshotId: "snapshot-1",
              areaType: "tests",
              name: "Tests",
              summary: "Tests cover API behavior.",
              confidence: 0.7,
              evidence: [],
              keyFiles: ["apps/api/src/routes/projects.test.ts"],
              keySymbols: [],
              relatedProposalIds: [],
              diagnostics: [
                {
                  level: "info",
                  code: "limited_symbols",
                  message: "No exported symbols were found for this area."
                }
              ],
              sortOrder: 1,
              createdAt: "2026-05-14T10:00:00.000Z",
              updatedAt: "2026-05-14T10:00:00.000Z"
            }
          ]
        }}
      />
    );

    expect(screen.getByText("Mapped 2 source files into 2 system areas.")).toBeInTheDocument();
    expect(screen.getByText("Backend routes")).toBeInTheDocument();
    expect(screen.getByText("2 drafts")).toBeInTheDocument();
    expect(screen.getByText("apps/api/src/routes/projects.ts")).toBeInTheDocument();
    expect(screen.getByText("registerProjectRoutes")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the panel test to verify it fails**

Run:

```bash
pnpm --filter web test -- system-map-review-panel.test.tsx
```

Expected: FAIL because `SystemMapReviewPanel` does not exist.

- [ ] **Step 3: Add query types and helper**

Modify `apps/web/src/api/queries.ts`:

Add `SystemMapResponseDto` to the `@specops/contracts` type import.

Add this query key:

```ts
  analyzeRunSystemMap: (projectId: string, runId: string) =>
    ["projects", projectId, "analyze-runs", runId, "system-map"] as const,
```

Add this query helper after `analyzeRunQuery`:

```ts
export function analyzeRunSystemMapQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.analyzeRunSystemMap(projectId, runId),
    queryFn: () =>
      apiGet<SystemMapResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(
          runId
        )}/system-map`
      )
  });
}
```

- [ ] **Step 4: Implement the system map panel**

Create `apps/web/src/components/system-map-review-panel.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { SystemMapAreaDto, SystemMapResponseDto } from "@specops/contracts";

type SystemMapReviewPanelProps = {
  map: SystemMapResponseDto;
};

export function SystemMapReviewPanel({ map }: SystemMapReviewPanelProps) {
  const sortedAreas = useMemo(
    () => [...map.areas].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [map.areas]
  );
  const [selectedAreaId, setSelectedAreaId] = useState(sortedAreas[0]?.id ?? null);
  const selectedArea =
    sortedAreas.find((area) => area.id === selectedAreaId) ?? sortedAreas[0] ?? null;

  return (
    <section className="grid min-h-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="section-heading">System Map</h2>
        <p className="mt-2 text-sm text-slate-600">{map.snapshot.summary}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Metric label="Files" value={map.snapshot.coverage.sourceFileCount} />
          <Metric label="Mapped" value={map.snapshot.coverage.mappedSourceFileCount} />
          <Metric label="Open" value={map.snapshot.coverage.unmappedSourceFileCount} />
        </div>
        {map.snapshot.diagnostics.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {map.snapshot.diagnostics.map((diagnostic) => (
              <li key={diagnostic.code} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                {diagnostic.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 grid gap-1">
          {sortedAreas.map((area) => (
            <button
              key={area.id}
              type="button"
              className={
                area.id === selectedArea?.id
                  ? "rounded border border-slate-900 bg-slate-900 px-2 py-2 text-left text-sm text-white"
                  : "rounded border border-slate-200 px-2 py-2 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }
              onClick={() => setSelectedAreaId(area.id)}
            >
              <span className="block font-medium">{area.name}</span>
              <span className={area.id === selectedArea?.id ? "text-slate-200" : "text-slate-500"}>
                {formatCount(area.keyFiles.length, "file", "files")} ·{" "}
                {formatCount(area.relatedProposalIds.length, "draft", "drafts")}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="min-w-0 rounded border border-slate-200 bg-white p-3 shadow-sm">
        {selectedArea ? <AreaDetail area={selectedArea} /> : <EmptyMapDetail />}
      </div>
    </section>
  );
}

function AreaDetail({ area }: { area: SystemMapAreaDto }) {
  return (
    <div className="grid gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-950">{area.name}</h2>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {area.areaType.replaceAll("_", " ")}
          </span>
          {area.confidence !== null ? (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {Math.round(area.confidence * 100)}% confidence
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-600">{area.summary}</p>
      </div>

      {area.diagnostics.length > 0 ? (
        <ul className="grid gap-2">
          {area.diagnostics.map((diagnostic) => (
            <li key={diagnostic.code} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}

      <DetailList title="Key files" items={area.keyFiles} />
      <DetailList title="Key symbols" items={area.keySymbols} />

      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">Source evidence</h3>
        {area.evidence.length > 0 ? (
          <ul className="mt-2 grid gap-2">
            {area.evidence.map((item, index) => (
              <li key={`${item.sourceFilePath}-${item.symbolName ?? "file"}-${index}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">{item.sourceFilePath}</span>
                {item.symbolName ? <span> · {item.symbolName}</span> : null}
                {item.startLine ? <span> · line {item.startLine}</span> : null}
                <span> · {item.relationship}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No source evidence recorded for this area.</p>
        )}
      </div>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No {title.toLowerCase()} recorded.</p>
      )}
    </div>
  );
}

function EmptyMapDetail() {
  return <p className="text-sm text-slate-500">No system map areas are available.</p>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-slate-50 p-2">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
```

- [ ] **Step 5: Run panel test**

Run:

```bash
pnpm --filter web test -- system-map-review-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Update Analyze Run progress UI**

Modify `apps/web/src/routes/analyze-run-detail.tsx`:

Change the review link text:

```tsx
Review system map and drafts
```

Add new labels in `stepLabel`:

```ts
    build_system_map: "Build system map",
    link_map_to_drafts: "Link map to drafts",
```

Keep the existing draft metrics panel. Do not add a new dashboard here; the run progress page only needs to show the new steps and CTA wording.

- [ ] **Step 7: Update Analyze Review route to fetch and render the map**

Modify `apps/web/src/routes/analyze-run-review.tsx`:

Add the query import:

```ts
  analyzeRunSystemMapQuery,
```

Add the component import:

```ts
import { SystemMapReviewPanel } from "../components/system-map-review-panel.js";
```

Inside `AnalyzeRunReviewPage`, add:

```ts
  const systemMap = useQuery(analyzeRunSystemMapQuery(projectId, runId));
```

Change the subtitle text to:

```tsx
Review the system map and draft assemblies generated by analyze run {runId}.
```

Render the map before `AnalyzeReviewWorkspace`:

```tsx
          {systemMap.error ? (
            <p className="panel-section mb-3 text-sm text-amber-700">
              System map is unavailable: {systemMap.error.message}
            </p>
          ) : systemMap.isLoading ? (
            <p className="panel-section mb-3 text-sm text-slate-500">Loading system map...</p>
          ) : systemMap.data ? (
            <div className="mb-3">
              <SystemMapReviewPanel map={systemMap.data} />
            </div>
          ) : null}
```

Keep the existing `AnalyzeReviewWorkspace` props unchanged so assembly behavior is not refactored in this task.

- [ ] **Step 8: Update route/component tests**

Modify `apps/web/src/routes/analyze-runs.test.tsx` to expect:

```ts
expect(html).toContain("Build system map");
expect(html).toContain("Link map to drafts");
expect(html).toContain("Review system map and drafts");
```

Modify `apps/web/src/components/analyze-review-workspace.test.tsx` only if test fixtures need updated run step names or query mocks. Existing assembly tests should continue to target `AnalyzeReviewWorkspace` directly.

- [ ] **Step 9: Run web tests and build**

Run:

```bash
pnpm --filter web test -- system-map-review-panel.test.tsx analyze-runs.test.tsx analyze-review-workspace.test.tsx
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 10: Commit frontend integration**

```bash
git add apps/web/src/components/system-map-review-panel.tsx apps/web/src/components/system-map-review-panel.test.tsx apps/web/src/api/queries.ts apps/web/src/routes/analyze-run-detail.tsx apps/web/src/routes/analyze-run-review.tsx apps/web/src/routes/analyze-runs.test.tsx apps/web/src/components/analyze-review-workspace.test.tsx
git commit -m "feat: show system maps in analyze review"
```

---

### Task 5: End-To-End Verification And Cleanup

**Files:**

- Modify only files that fail verification from Tasks 1-4.

- [ ] **Step 1: Run focused package checks**

Run:

```bash
pnpm --filter @specops/contracts test -- system-map.test.ts
pnpm --filter @specops/db test -- migrations.test.ts
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- system-map-service.test.ts analyze-run-service.test.ts
pnpm --filter web test -- system-map-review-panel.test.tsx analyze-runs.test.tsx analyze-review-workspace.test.tsx
```

Expected: all commands exit 0.

- [ ] **Step 2: Run repository validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected: `git diff --check` exits 0. Confirm the diff only contains system-map contracts, schema, backend service/routes/tests, and Analyze Project UI changes.

- [ ] **Step 4: Commit verification fixes if needed**

If Step 1 or Step 2 required fixes, commit them:

```bash
git add packages apps
git commit -m "fix: stabilize analyze system map workflow"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 5: Summarize implementation status**

Record the completed checks in the final handoff:

```text
Implemented Analyze Project system maps.
Verified with:
- pnpm typecheck
- pnpm test
- pnpm --filter web build
```
