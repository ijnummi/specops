# Analyze Project Phase 5 Project Graph Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scanner-only, index-run-versioned project graph facts layer with contracts, persistence, API access, index integration, and minimal web inspection.

**Architecture:** The graph is built after a successful index from existing indexed source, spec, and annotation tables. A current graph is the latest `ready` or `limited` graph version, with nodes and edges stored separately and every edge carrying provenance and confidence. The first UI is a simple project graph inspection route; system maps and draft review continue using their current data paths.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle/PostgreSQL, Fastify, Zod contracts, React, TanStack Query, TanStack Router, Vitest.

---

## File Structure

- Create `packages/contracts/src/project-graph.ts`: Zod schemas and DTO types for graph versions, nodes, edges, list response, node detail response, and query inputs.
- Create `packages/contracts/src/project-graph.test.ts`: contract parsing tests.
- Modify `packages/contracts/src/index.ts`: export graph contracts.
- Modify `packages/db/src/schema.ts`: add graph version, node, and edge tables.
- Modify `packages/db/src/schema.typecheck.ts`: compile-time schema checks for graph table select/insert shapes.
- Modify `packages/db/migrations/0000_initial.sql`: add graph tables, constraints, indexes, and idempotent constraint guards.
- Modify `packages/db/src/migrations.test.ts`: assert migration includes graph storage and constraints.
- Create `apps/api/src/services/project-graph-service.ts`: graph builder, latest graph lookup, node detail lookup, mapping to DTOs.
- Create `apps/api/src/__tests__/project-graph-service.test.ts`: DB-backed graph build tests.
- Modify `apps/api/src/services/indexer-service.ts`: trigger graph build after index success without failing the index if graph build fails.
- Modify `apps/api/src/__tests__/indexer-service.test.ts`: confirm graph build exists after indexing.
- Create `apps/api/src/routes/project-graph.ts`: Fastify routes for latest graph and node detail.
- Modify `apps/api/src/server.ts`: register graph routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: route coverage for graph list and node detail.
- Modify `apps/web/src/api/queries.ts`: graph query keys and query helpers.
- Create `apps/web/src/routes/project-graph.tsx`: minimal graph inspection page.
- Create `apps/web/src/routes/project-graph.test.tsx`: rendering tests for graph status, counts, diagnostics, samples, and node detail query behavior.
- Modify `apps/web/src/app.tsx`: add `/projects/$projectId/graph` route.
- Modify `apps/web/src/routes/project-detail.tsx`: add a project graph link in the inspector when graph data exists or latest index exists.

---

### Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/project-graph.ts`
- Create: `packages/contracts/src/project-graph.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/project-graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  projectGraphListResponseSchema,
  projectGraphNodeDetailSchema,
  projectGraphNodeSchema,
  projectGraphVersionSchema
} from "./project-graph.js";

const timestamp = "2026-05-14T10:00:00.000Z";

describe("project graph contracts", () => {
  it("parses a graph version", () => {
    const parsed = projectGraphVersionSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      indexRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Graph contains 4 nodes and 3 edges.",
      coverage: {
        nodeCounts: { file: 1, symbol: 1, spec_entity: 1, external_dependency: 1 },
        edgeCounts: { defines: 1, imports: 1, supports_spec: 1 },
        sourceFileCount: 1,
        specEntityCount: 1,
        unresolvedImportCount: 1,
        heuristicEdgeCount: 0
      },
      diagnostics: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(parsed.status).toBe("ready");
    expect(parsed.coverage.edgeCounts.imports).toBe(1);
  });

  it("parses graph nodes and list response samples", () => {
    const node = projectGraphNodeSchema.parse({
      id: "00000000-0000-4000-8000-000000000010",
      projectId: "00000000-0000-4000-8000-000000000002",
      graphVersionId: "00000000-0000-4000-8000-000000000001",
      nodeKey: "file:apps/api/src/routes/projects.ts",
      nodeType: "file",
      label: "projects.ts",
      path: "apps/api/src/routes/projects.ts",
      symbolName: null,
      entityId: null,
      sourceRef: { sourceFileId: "00000000-0000-4000-8000-000000000011" },
      metadata: { classification: "route", language: "typescript", kind: "source" },
      confidence: 1,
      createdAt: timestamp
    });

    const parsed = projectGraphListResponseSchema.parse({
      version: {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        indexRunId: "00000000-0000-4000-8000-000000000003",
        status: "ready",
        summary: "Graph contains 1 node and 0 edges.",
        coverage: {
          nodeCounts: { file: 1 },
          edgeCounts: {},
          sourceFileCount: 1,
          specEntityCount: 0,
          unresolvedImportCount: 0,
          heuristicEdgeCount: 0
        },
        diagnostics: [],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      nodeCounts: { file: 1 },
      edgeCounts: {},
      nodes: [node],
      edges: []
    });

    expect(parsed.nodes[0]?.metadata.classification).toBe("route");
  });

  it("parses node detail with grouped edges", () => {
    const parsed = projectGraphNodeDetailSchema.parse({
      node: {
        id: "00000000-0000-4000-8000-000000000010",
        projectId: "00000000-0000-4000-8000-000000000002",
        graphVersionId: "00000000-0000-4000-8000-000000000001",
        nodeKey: "file:apps/api/src/routes/projects.ts",
        nodeType: "file",
        label: "projects.ts",
        path: "apps/api/src/routes/projects.ts",
        symbolName: null,
        entityId: null,
        sourceRef: {},
        metadata: {},
        confidence: 1,
        createdAt: timestamp
      },
      incomingEdges: {},
      outgoingEdges: {
        defines: [
          {
            id: "00000000-0000-4000-8000-000000000020",
            projectId: "00000000-0000-4000-8000-000000000002",
            graphVersionId: "00000000-0000-4000-8000-000000000001",
            fromNodeId: "00000000-0000-4000-8000-000000000010",
            toNodeId: "00000000-0000-4000-8000-000000000011",
            edgeType: "defines",
            provenance: "scanner_symbol",
            sourceRef: {},
            metadata: {},
            confidence: 1,
            createdAt: timestamp
          }
        ]
      },
      neighboringNodes: []
    });

    expect(parsed.outgoingEdges.defines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- project-graph.test.ts
```

Expected: FAIL with an import error for `./project-graph.js`.

- [ ] **Step 3: Add graph contracts**

Create `packages/contracts/src/project-graph.ts`:

```ts
import { z } from "zod";

export const projectGraphStatusSchema = z.enum(["building", "ready", "limited", "failed", "superseded"]);

export const projectGraphNodeTypeSchema = z.enum([
  "package",
  "module",
  "file",
  "symbol",
  "route",
  "data_model",
  "test",
  "spec_entity",
  "external_dependency"
]);

export const projectGraphEdgeTypeSchema = z.enum([
  "contains",
  "defines",
  "imports",
  "exports",
  "depends_on",
  "tests",
  "references",
  "supports_spec"
]);

export const projectGraphProvenanceSchema = z.enum([
  "scanner_path",
  "scanner_import",
  "scanner_export",
  "scanner_symbol",
  "scanner_kind",
  "annotation",
  "heuristic_test"
]);

export const projectGraphDiagnosticSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const projectGraphCountsSchema = z.record(z.string(), z.number().int().min(0));

export const projectGraphCoverageSchema = z.object({
  nodeCounts: projectGraphCountsSchema,
  edgeCounts: projectGraphCountsSchema,
  sourceFileCount: z.number().int().min(0),
  specEntityCount: z.number().int().min(0),
  unresolvedImportCount: z.number().int().min(0),
  heuristicEdgeCount: z.number().int().min(0)
});

export const projectGraphVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  indexRunId: z.string().uuid().nullable(),
  status: projectGraphStatusSchema,
  summary: z.string(),
  coverage: projectGraphCoverageSchema,
  diagnostics: z.array(projectGraphDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const projectGraphNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  graphVersionId: z.string().uuid(),
  nodeKey: z.string().min(1),
  nodeType: projectGraphNodeTypeSchema,
  label: z.string().min(1),
  path: z.string().min(1).nullable(),
  symbolName: z.string().min(1).nullable(),
  entityId: z.string().min(1).nullable(),
  sourceRef: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime()
});

export const projectGraphEdgeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  graphVersionId: z.string().uuid(),
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  edgeType: projectGraphEdgeTypeSchema,
  provenance: projectGraphProvenanceSchema,
  sourceRef: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime()
});

export const projectGraphQuerySchema = z.object({
  nodeType: projectGraphNodeTypeSchema.optional(),
  edgeType: projectGraphEdgeTypeSchema.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const projectGraphListResponseSchema = z.object({
  version: projectGraphVersionSchema,
  nodeCounts: projectGraphCountsSchema,
  edgeCounts: projectGraphCountsSchema,
  nodes: z.array(projectGraphNodeSchema),
  edges: z.array(projectGraphEdgeSchema)
});

export const projectGraphNodeDetailSchema = z.object({
  node: projectGraphNodeSchema,
  incomingEdges: z.record(z.string(), z.array(projectGraphEdgeSchema)),
  outgoingEdges: z.record(z.string(), z.array(projectGraphEdgeSchema)),
  neighboringNodes: z.array(projectGraphNodeSchema)
});

export type ProjectGraphStatus = z.infer<typeof projectGraphStatusSchema>;
export type ProjectGraphNodeType = z.infer<typeof projectGraphNodeTypeSchema>;
export type ProjectGraphEdgeType = z.infer<typeof projectGraphEdgeTypeSchema>;
export type ProjectGraphProvenance = z.infer<typeof projectGraphProvenanceSchema>;
export type ProjectGraphDiagnostic = z.infer<typeof projectGraphDiagnosticSchema>;
export type ProjectGraphCoverage = z.infer<typeof projectGraphCoverageSchema>;
export type ProjectGraphVersionDto = z.infer<typeof projectGraphVersionSchema>;
export type ProjectGraphNodeDto = z.infer<typeof projectGraphNodeSchema>;
export type ProjectGraphEdgeDto = z.infer<typeof projectGraphEdgeSchema>;
export type ProjectGraphQuery = z.infer<typeof projectGraphQuerySchema>;
export type ProjectGraphListResponse = z.infer<typeof projectGraphListResponseSchema>;
export type ProjectGraphNodeDetail = z.infer<typeof projectGraphNodeDetailSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./project-graph.js";
```

Add it next to the other `export *` lines.

- [ ] **Step 4: Run contract test to verify it passes**

Run:

```bash
pnpm --filter @specops/contracts test -- project-graph.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```bash
git add packages/contracts/src/project-graph.ts packages/contracts/src/project-graph.test.ts packages/contracts/src/index.ts
git commit -m "feat: add project graph contracts"
```

---

### Task 2: Database Schema And Migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`

- [ ] **Step 1: Write failing migration assertions**

Add this test to `packages/db/src/migrations.test.ts` after the system map storage test:

```ts
  it("creates project graph storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_graph_versions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_graph_nodes"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_graph_edges"');
    expect(migration).toContain('CONSTRAINT "project_graph_versions_id_project_id_unique" UNIQUE("id","project_id")');
    expect(migration).toContain('CONSTRAINT "project_graph_nodes_id_project_id_unique" UNIQUE("id","project_id")');
    expect(migration).toContain('CONSTRAINT "project_graph_nodes_version_key_unique" UNIQUE("graph_version_id","node_key")');
    expect(migration).toContain("project_graph_versions_project_id_idx");
    expect(migration).toContain("project_graph_versions_project_status_created_idx");
    expect(migration).toContain("project_graph_nodes_version_type_idx");
    expect(migration).toContain("project_graph_nodes_project_type_idx");
    expect(migration).toContain("project_graph_edges_version_type_idx");
    expect(migration).toContain("project_graph_edges_from_node_idx");
    expect(migration).toContain("project_graph_edges_to_node_idx");
    for (const constraintName of [
      "project_graph_versions_index_run_project_fk",
      "project_graph_nodes_version_project_fk",
      "project_graph_edges_version_project_fk",
      "project_graph_edges_from_node_project_fk",
      "project_graph_edges_to_node_project_fk"
    ]) {
      expect(migration).toContain(`conname = '${constraintName}'`);
    }
  });
```

- [ ] **Step 2: Run DB migration test to verify it fails**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because project graph tables are not present in the migration.

- [ ] **Step 3: Add Drizzle schema tables**

In `packages/db/src/schema.ts`, add these exports after `systemMapAreas`:

```ts
export const projectGraphVersions = pgTable(
  "project_graph_versions",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    coverageJson: jsonb("coverage_json").notNull().default(sql`'{}'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("project_graph_versions_project_id_idx").on(table.projectId),
    projectStatusCreatedIdx: index("project_graph_versions_project_status_created_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    indexRunIdx: index("project_graph_versions_index_run_id_idx").on(table.indexRunId),
    indexRunProjectFk: foreignKey({
      name: "project_graph_versions_index_run_project_fk",
      columns: [table.indexRunId, table.projectId],
      foreignColumns: [indexRuns.id, indexRuns.projectId],
    }).onDelete("set null"),
    idProjectUnique: unique("project_graph_versions_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
  }),
);

export const projectGraphNodes = pgTable(
  "project_graph_nodes",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    graphVersionId: uuid("graph_version_id")
      .notNull()
      .references(() => projectGraphVersions.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    nodeType: text("node_type").notNull(),
    label: text("label").notNull(),
    path: text("path"),
    symbolName: text("symbol_name"),
    entityId: text("entity_id"),
    sourceRefJson: jsonb("source_ref_json").notNull().default(sql`'{}'::jsonb`),
    metadataJson: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    versionIdx: index("project_graph_nodes_graph_version_id_idx").on(table.graphVersionId),
    versionTypeIdx: index("project_graph_nodes_version_type_idx").on(
      table.graphVersionId,
      table.nodeType,
    ),
    projectTypeIdx: index("project_graph_nodes_project_type_idx").on(table.projectId, table.nodeType),
    versionKeyUnique: unique("project_graph_nodes_version_key_unique").on(
      table.graphVersionId,
      table.nodeKey,
    ),
    idProjectUnique: unique("project_graph_nodes_id_project_id_unique").on(table.id, table.projectId),
    versionProjectFk: foreignKey({
      name: "project_graph_nodes_version_project_fk",
      columns: [table.graphVersionId, table.projectId],
      foreignColumns: [projectGraphVersions.id, projectGraphVersions.projectId],
    }).onDelete("cascade"),
  }),
);

export const projectGraphEdges = pgTable(
  "project_graph_edges",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    graphVersionId: uuid("graph_version_id")
      .notNull()
      .references(() => projectGraphVersions.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id").notNull(),
    toNodeId: uuid("to_node_id").notNull(),
    edgeType: text("edge_type").notNull(),
    provenance: text("provenance").notNull(),
    sourceRefJson: jsonb("source_ref_json").notNull().default(sql`'{}'::jsonb`),
    metadataJson: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    versionIdx: index("project_graph_edges_graph_version_id_idx").on(table.graphVersionId),
    versionTypeIdx: index("project_graph_edges_version_type_idx").on(
      table.graphVersionId,
      table.edgeType,
    ),
    fromNodeIdx: index("project_graph_edges_from_node_idx").on(table.fromNodeId),
    toNodeIdx: index("project_graph_edges_to_node_idx").on(table.toNodeId),
    versionProjectFk: foreignKey({
      name: "project_graph_edges_version_project_fk",
      columns: [table.graphVersionId, table.projectId],
      foreignColumns: [projectGraphVersions.id, projectGraphVersions.projectId],
    }).onDelete("cascade"),
    fromNodeProjectFk: foreignKey({
      name: "project_graph_edges_from_node_project_fk",
      columns: [table.fromNodeId, table.projectId],
      foreignColumns: [projectGraphNodes.id, projectGraphNodes.projectId],
    }).onDelete("cascade"),
    toNodeProjectFk: foreignKey({
      name: "project_graph_edges_to_node_project_fk",
      columns: [table.toNodeId, table.projectId],
      foreignColumns: [projectGraphNodes.id, projectGraphNodes.projectId],
    }).onDelete("cascade"),
  }),
);
```

- [ ] **Step 4: Add schema type checks**

In `packages/db/src/schema.typecheck.ts`, import the new tables and add these checks:

```ts
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
```

Add below the system map type aliases:

```ts
type ProjectGraphVersionSelect = typeof projectGraphVersions.$inferSelect;
type ProjectGraphVersionInsert = typeof projectGraphVersions.$inferInsert;
type ProjectGraphNodeSelect = typeof projectGraphNodes.$inferSelect;
type ProjectGraphNodeInsert = typeof projectGraphNodes.$inferInsert;
type ProjectGraphEdgeSelect = typeof projectGraphEdges.$inferSelect;
type ProjectGraphEdgeInsert = typeof projectGraphEdges.$inferInsert;
```

Add below the existing expectations:

```ts
type _ProjectGraphVersionStatusIsString = Expect<Equal<ProjectGraphVersionSelect["status"], string>>;
type _ProjectGraphNodeConfidenceIsNullable = Expect<
  Equal<ProjectGraphNodeSelect["confidence"], number | null>
>;
type _ProjectGraphEdgeProvenanceIsString = Expect<Equal<ProjectGraphEdgeSelect["provenance"], string>>;
```

Add below the existing `void` statements:

```ts
const projectGraphVersionSelect = null as unknown as ProjectGraphVersionSelect;
const projectGraphVersionInsert = null as unknown as ProjectGraphVersionInsert;
const projectGraphNodeSelect = null as unknown as ProjectGraphNodeSelect;
const projectGraphNodeInsert = null as unknown as ProjectGraphNodeInsert;
const projectGraphEdgeSelect = null as unknown as ProjectGraphEdgeSelect;
const projectGraphEdgeInsert = null as unknown as ProjectGraphEdgeInsert;
void projectGraphVersionSelect;
void projectGraphVersionInsert;
void projectGraphNodeSelect;
void projectGraphNodeInsert;
void projectGraphEdgeSelect;
void projectGraphEdgeInsert;
```

- [ ] **Step 5: Add SQL migration block**

In `packages/db/migrations/0000_initial.sql`, add graph table DDL after the system map tables and before analyze review tables. Use the quoted style already used for system map tables:

```sql
CREATE TABLE IF NOT EXISTS "project_graph_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "index_run_id" uuid REFERENCES "index_runs"("id") ON DELETE set null,
  "status" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "coverage_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "diagnostics_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_graph_versions_id_project_id_unique" UNIQUE("id","project_id")
);

CREATE TABLE IF NOT EXISTS "project_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "graph_version_id" uuid NOT NULL REFERENCES "project_graph_versions"("id") ON DELETE cascade,
  "node_key" text NOT NULL,
  "node_type" text NOT NULL,
  "label" text NOT NULL,
  "path" text,
  "symbol_name" text,
  "entity_id" text,
  "source_ref_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_graph_nodes_version_key_unique" UNIQUE("graph_version_id","node_key"),
  CONSTRAINT "project_graph_nodes_id_project_id_unique" UNIQUE("id","project_id")
);

CREATE TABLE IF NOT EXISTS "project_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "graph_version_id" uuid NOT NULL REFERENCES "project_graph_versions"("id") ON DELETE cascade,
  "from_node_id" uuid NOT NULL,
  "to_node_id" uuid NOT NULL,
  "edge_type" text NOT NULL,
  "provenance" text NOT NULL,
  "source_ref_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
```

Add idempotent constraint guards after the table block:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_versions_index_run_project_fk'
      AND conrelid = 'project_graph_versions'::regclass
  ) THEN
    ALTER TABLE "project_graph_versions"
      ADD CONSTRAINT "project_graph_versions_index_run_project_fk"
      FOREIGN KEY ("index_run_id","project_id") REFERENCES "index_runs"("id","project_id") ON DELETE set null;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_nodes_version_project_fk'
      AND conrelid = 'project_graph_nodes'::regclass
  ) THEN
    ALTER TABLE "project_graph_nodes"
      ADD CONSTRAINT "project_graph_nodes_version_project_fk"
      FOREIGN KEY ("graph_version_id","project_id") REFERENCES "project_graph_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_edges_version_project_fk'
      AND conrelid = 'project_graph_edges'::regclass
  ) THEN
    ALTER TABLE "project_graph_edges"
      ADD CONSTRAINT "project_graph_edges_version_project_fk"
      FOREIGN KEY ("graph_version_id","project_id") REFERENCES "project_graph_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_edges_from_node_project_fk'
      AND conrelid = 'project_graph_edges'::regclass
  ) THEN
    ALTER TABLE "project_graph_edges"
      ADD CONSTRAINT "project_graph_edges_from_node_project_fk"
      FOREIGN KEY ("from_node_id","project_id") REFERENCES "project_graph_nodes"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_edges_to_node_project_fk'
      AND conrelid = 'project_graph_edges'::regclass
  ) THEN
    ALTER TABLE "project_graph_edges"
      ADD CONSTRAINT "project_graph_edges_to_node_project_fk"
      FOREIGN KEY ("to_node_id","project_id") REFERENCES "project_graph_nodes"("id","project_id") ON DELETE cascade;
  END IF;
END $$;
```

Add indexes after the graph constraints:

```sql
CREATE INDEX IF NOT EXISTS "project_graph_versions_project_id_idx"
  ON "project_graph_versions" ("project_id");
CREATE INDEX IF NOT EXISTS "project_graph_versions_project_status_created_idx"
  ON "project_graph_versions" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "project_graph_versions_index_run_id_idx"
  ON "project_graph_versions" ("index_run_id");
CREATE INDEX IF NOT EXISTS "project_graph_nodes_graph_version_id_idx"
  ON "project_graph_nodes" ("graph_version_id");
CREATE INDEX IF NOT EXISTS "project_graph_nodes_version_type_idx"
  ON "project_graph_nodes" ("graph_version_id","node_type");
CREATE INDEX IF NOT EXISTS "project_graph_nodes_project_type_idx"
  ON "project_graph_nodes" ("project_id","node_type");
CREATE INDEX IF NOT EXISTS "project_graph_edges_graph_version_id_idx"
  ON "project_graph_edges" ("graph_version_id");
CREATE INDEX IF NOT EXISTS "project_graph_edges_version_type_idx"
  ON "project_graph_edges" ("graph_version_id","edge_type");
CREATE INDEX IF NOT EXISTS "project_graph_edges_from_node_idx"
  ON "project_graph_edges" ("from_node_id");
CREATE INDEX IF NOT EXISTS "project_graph_edges_to_node_idx"
  ON "project_graph_edges" ("to_node_id");
```

- [ ] **Step 6: Run DB checks**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit DB schema**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add project graph storage"
```

---

### Task 3: Graph Builder Service

**Files:**
- Create: `apps/api/src/services/project-graph-service.ts`
- Create: `apps/api/src/__tests__/project-graph-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/src/__tests__/project-graph-service.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { projectGraphListResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  createDb,
  projects,
  sourceSpecAnnotations,
  specEntities
} from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createIndexerService } from "../services/indexer-service.js";
import { createProjectGraphService } from "../services/project-graph-service.js";
import { createProjectService } from "../services/project-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createProjectGraphService", () => {
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

  it("builds graph nodes and deterministic edges from indexed facts", async () => {
    const project = await createProjectFixture();
    await writeGraphFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);

    const graph = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id
    });

    expect(projectGraphListResponseSchema.parse(graph)).toEqual(graph);
    expect(graph.version.status).toBe("ready");
    expect(graph.nodeCounts.file).toBeGreaterThanOrEqual(4);
    expect(graph.nodeCounts.symbol).toBeGreaterThanOrEqual(3);
    expect(graph.edgeCounts.contains).toBeGreaterThan(0);
    expect(graph.edgeCounts.defines).toBeGreaterThan(0);
    expect(graph.edgeCounts.imports).toBeGreaterThan(0);
    expect(graph.edgeCounts.exports).toBeGreaterThan(0);
    expect(graph.edgeCounts.tests).toBeGreaterThan(0);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        nodeKey: "file:apps/api/src/routes/projects.ts",
        nodeType: "file",
        metadata: expect.objectContaining({ classification: "route" })
      })
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        nodeKey: "external:fastify",
        nodeType: "external_dependency"
      })
    );
  });

  it("projects active source spec annotations into supports_spec edges", async () => {
    const project = await createProjectFixture();
    await writeGraphFixture(project.repoPath);
    const indexRun = await createIndexerService(db).indexProject(project.id);
    const [entity] = await db
      .select()
      .from(specEntities)
      .where(eq(specEntities.projectId, project.id))
      .limit(1);
    if (!entity) throw new Error("Expected spec entity fixture");

    await db.insert(sourceSpecAnnotations).values({
      projectId: project.id,
      sourceFilePath: "apps/api/src/routes/projects.ts",
      sourceFileId: null,
      symbolName: "registerProjectRoutes",
      symbolKind: "function",
      startLine: 3,
      endLine: null,
      annotationLine: null,
      sourceContentHash: null,
      entityId: entity.entityId,
      specFilePath: entity.filePath,
      relationshipType: "implements",
      confidence: 0.9,
      provenance: "user",
      status: "active"
    });

    const graph = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id
    });

    expect(graph.edgeCounts.supports_spec).toBe(1);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        edgeType: "supports_spec",
        provenance: "annotation",
        confidence: 0.9,
        metadata: expect.objectContaining({ relationshipType: "implements" })
      })
    );
  });

  it("creates a limited graph when only specs exist", async () => {
    const project = await createProjectFixture();
    await mkdir(path.join(project.repoPath, ".specops", "domain"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, ".specops", "domain", "only-spec.md"),
      "---\nid: domain.only\ntype: domain\nstatus: draft\n---\n\n# Only Spec\n",
      "utf8"
    );
    const indexRun = await createIndexerService(db).indexProject(project.id);

    const graph = await createProjectGraphService(db).buildProjectGraph({
      projectId: project.id,
      indexRunId: indexRun.id
    });

    expect(graph.version.status).toBe("limited");
    expect(graph.nodeCounts.spec_entity).toBe(1);
    expect(graph.version.diagnostics).toContainEqual(
      expect.objectContaining({ code: "no_source_files" })
    );
  });

  async function createProjectFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-project-graph-"));
    tempRoots.push(root);
    const project = await createProjectService(db).createProject({
      name: `Graph ${Date.now()}`,
      repoPath: root
    });
    projectIds.push(project.id);
    return project;
  }
});

async function writeGraphFixture(repoPath: string) {
  await mkdir(path.join(repoPath, ".specops", "interfaces"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/api/src/routes"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/api/src/services"), { recursive: true });
  await mkdir(path.join(repoPath, "apps/api/src/db"), { recursive: true });
  await writeFile(
    path.join(repoPath, ".specops", "interfaces", "project-routes.md"),
    "---\nid: interface.project-routes\ntype: interface\nstatus: draft\n---\n\n# Project Routes\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/routes/projects.ts"),
    [
      "import type { FastifyInstance } from \"fastify\";",
      "import { listProjects } from \"../services/project-service.js\";",
      "export function registerProjectRoutes(app: FastifyInstance) {",
      "  app.get('/projects', listProjects);",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/services/project-service.ts"),
    "export function listProjects() { return []; }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/services/project-service.test.ts"),
    "import { listProjects } from './project-service.js';\nlistProjects();\n",
    "utf8"
  );
  await writeFile(
    path.join(repoPath, "apps/api/src/db/schema.ts"),
    "export type ProjectRecord = { id: string };\n",
    "utf8"
  );
}

async function migrateTestDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const migration = await import("@specops/db/migrate");
  await migration.migrate(databaseUrl);
  await pool.end();
}

async function closeDb(db: Db | undefined) {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } } | undefined)?.$client;
  await client?.end();
}

function readTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL;
}
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- project-graph-service.test.ts
```

Expected: FAIL with an import error for `project-graph-service.js`.

- [ ] **Step 3: Implement graph service**

Create `apps/api/src/services/project-graph-service.ts`. Use this structure:

```ts
import path from "node:path";

import type {
  ProjectGraphDiagnostic,
  ProjectGraphEdgeDto,
  ProjectGraphListResponse,
  ProjectGraphNodeDetail,
  ProjectGraphNodeDto,
  ProjectGraphNodeType,
  ProjectGraphQuery
} from "@specops/contracts";
import {
  projectGraphListResponseSchema,
  projectGraphNodeDetailSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecAnnotations,
  sourceSymbols,
  specEntities
} from "@specops/db";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

type SourceFileRow = typeof sourceFiles.$inferSelect;
type SourceImportRow = typeof sourceImports.$inferSelect;
type SourceExportRow = typeof sourceExports.$inferSelect;
type SourceSymbolRow = typeof sourceSymbols.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;
type AnnotationRow = typeof sourceSpecAnnotations.$inferSelect;
type GraphVersionRow = typeof projectGraphVersions.$inferSelect;
type GraphNodeRow = typeof projectGraphNodes.$inferSelect;
type GraphEdgeRow = typeof projectGraphEdges.$inferSelect;

type BuildProjectGraphInput = {
  projectId: string;
  indexRunId: string | null;
};

type BuiltNode = {
  nodeKey: string;
  nodeType: ProjectGraphNodeType;
  label: string;
  path: string | null;
  symbolName: string | null;
  entityId: string | null;
  sourceRefJson: Record<string, unknown>;
  metadataJson: Record<string, unknown>;
  confidence: number | null;
};

type BuiltEdge = {
  fromNodeKey: string;
  toNodeKey: string;
  edgeType: string;
  provenance: string;
  sourceRefJson: Record<string, unknown>;
  metadataJson: Record<string, unknown>;
  confidence: number | null;
};

export function createProjectGraphService(db: Db) {
  async function buildProjectGraph(input: BuildProjectGraphInput): Promise<ProjectGraphListResponse> {
    const [files, imports, exports, symbols, entities, annotations] = await Promise.all([
      db.select().from(sourceFiles).where(eq(sourceFiles.projectId, input.projectId)).orderBy(asc(sourceFiles.path)),
      db.select().from(sourceImports).where(eq(sourceImports.projectId, input.projectId)),
      db.select().from(sourceExports).where(eq(sourceExports.projectId, input.projectId)),
      db.select().from(sourceSymbols).where(eq(sourceSymbols.projectId, input.projectId)),
      db.select().from(specEntities).where(eq(specEntities.projectId, input.projectId)),
      db
        .select()
        .from(sourceSpecAnnotations)
        .where(and(eq(sourceSpecAnnotations.projectId, input.projectId), eq(sourceSpecAnnotations.status, "active")))
    ]);

    const diagnostics: ProjectGraphDiagnostic[] = [];
    if (files.length === 0) {
      diagnostics.push({
        level: "warning",
        code: "no_source_files",
        message: "No indexed source files were available for graph construction."
      });
    }

    const { nodes, edges } = buildGraphFacts({
      files,
      imports,
      exports,
      symbols,
      entities,
      annotations,
      diagnostics
    });
    const status = files.length === 0 || nodes.length === 0 ? "limited" : "ready";
    const coverage = buildCoverage(nodes, edges, files, entities);

    const versionId = await db.transaction(async (tx) => {
      if (input.indexRunId) {
        await tx
          .update(projectGraphVersions)
          .set({ status: "superseded", updatedAt: new Date() })
          .where(
            and(
              eq(projectGraphVersions.projectId, input.projectId),
              eq(projectGraphVersions.indexRunId, input.indexRunId)
            )
          );
      }

      const [version] = await tx
        .insert(projectGraphVersions)
        .values({
          projectId: input.projectId,
          indexRunId: input.indexRunId,
          status,
          summary: summarizeGraph(nodes.length, edges.length),
          coverageJson: coverage,
          diagnosticsJson: diagnostics
        })
        .returning();

      if (!version) throw new Error("Failed to create project graph version");

      if (nodes.length > 0) {
        await tx.insert(projectGraphNodes).values(
          nodes.map((node) => ({
            ...node,
            projectId: input.projectId,
            graphVersionId: version.id
          }))
        );
      }

      const insertedNodes = await tx
        .select()
        .from(projectGraphNodes)
        .where(eq(projectGraphNodes.graphVersionId, version.id));
      const nodeIds = new Map(insertedNodes.map((node) => [node.nodeKey, node.id]));
      const insertEdges = edges.flatMap((edge) => {
        const fromNodeId = nodeIds.get(edge.fromNodeKey);
        const toNodeId = nodeIds.get(edge.toNodeKey);
        if (!fromNodeId || !toNodeId) return [];
        return [{
          projectId: input.projectId,
          graphVersionId: version.id,
          fromNodeId,
          toNodeId,
          edgeType: edge.edgeType,
          provenance: edge.provenance,
          sourceRefJson: edge.sourceRefJson,
          metadataJson: edge.metadataJson,
          confidence: edge.confidence
        }];
      });

      if (insertEdges.length > 0) {
        await tx.insert(projectGraphEdges).values(insertEdges);
      }

      return version.id;
    });

    return getProjectGraph(input.projectId, { limit: 50 }, versionId);
  }

  async function getProjectGraph(
    projectId: string,
    query: Partial<ProjectGraphQuery> = {},
    versionId?: string
  ): Promise<ProjectGraphListResponse> {
    const version = versionId
      ? await getGraphVersionById(projectId, versionId)
      : await getCurrentGraphVersion(projectId);
    const limit = query.limit ?? 50;
    const nodeFilters = [eq(projectGraphNodes.graphVersionId, version.id)];
    if (query.nodeType) nodeFilters.push(eq(projectGraphNodes.nodeType, query.nodeType));
    if (query.q) {
      nodeFilters.push(
        or(
          ilike(projectGraphNodes.label, `%${query.q}%`),
          ilike(projectGraphNodes.nodeKey, `%${query.q}%`),
          ilike(projectGraphNodes.path, `%${query.q}%`)
        )!
      );
    }

    const edgeFilters = [eq(projectGraphEdges.graphVersionId, version.id)];
    if (query.edgeType) edgeFilters.push(eq(projectGraphEdges.edgeType, query.edgeType));

    const [nodes, edges] = await Promise.all([
      db
        .select()
        .from(projectGraphNodes)
        .where(and(...nodeFilters))
        .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.nodeKey))
        .limit(limit),
      db
        .select()
        .from(projectGraphEdges)
        .where(and(...edgeFilters))
        .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
        .limit(limit)
    ]);

    const coverage = readCoverage(version.coverageJson);
    return projectGraphListResponseSchema.parse({
      version: mapVersion(version),
      nodeCounts: coverage.nodeCounts,
      edgeCounts: coverage.edgeCounts,
      nodes: nodes.map(mapNode),
      edges: edges.map(mapEdge)
    });
  }

  async function getGraphNode(projectId: string, nodeId: string): Promise<ProjectGraphNodeDetail> {
    const [node] = await db
      .select()
      .from(projectGraphNodes)
      .where(and(eq(projectGraphNodes.projectId, projectId), eq(projectGraphNodes.id, nodeId)))
      .limit(1);
    if (!node) throw new NotFoundError("Project graph node not found", { projectId, nodeId });

    const incoming = await db
      .select()
      .from(projectGraphEdges)
      .where(and(eq(projectGraphEdges.projectId, projectId), eq(projectGraphEdges.toNodeId, node.id)))
      .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
      .limit(100);
    const outgoing = await db
      .select()
      .from(projectGraphEdges)
      .where(and(eq(projectGraphEdges.projectId, projectId), eq(projectGraphEdges.fromNodeId, node.id)))
      .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
      .limit(100);
    const neighborIds = [...new Set([...incoming.map((edge) => edge.fromNodeId), ...outgoing.map((edge) => edge.toNodeId)])];
    const neighbors = neighborIds.length === 0
      ? []
      : await db
        .select()
        .from(projectGraphNodes)
        .where(and(eq(projectGraphNodes.projectId, projectId), inArray(projectGraphNodes.id, neighborIds)));

    return projectGraphNodeDetailSchema.parse({
      node: mapNode(node),
      incomingEdges: groupEdges(incoming),
      outgoingEdges: groupEdges(outgoing),
      neighboringNodes: neighbors.map(mapNode)
    });
  }

  async function getGraphVersionById(projectId: string, versionId: string): Promise<GraphVersionRow> {
    const [version] = await db
      .select()
      .from(projectGraphVersions)
      .where(and(eq(projectGraphVersions.projectId, projectId), eq(projectGraphVersions.id, versionId)))
      .limit(1);
    if (!version) throw new NotFoundError("Project graph version not found", { projectId, versionId });
    return version;
  }

  async function getCurrentGraphVersion(projectId: string): Promise<GraphVersionRow> {
    const [version] = await db
      .select()
      .from(projectGraphVersions)
      .where(
        and(
          eq(projectGraphVersions.projectId, projectId),
          inArray(projectGraphVersions.status, ["ready", "limited"])
        )
      )
      .orderBy(desc(projectGraphVersions.createdAt), desc(projectGraphVersions.id))
      .limit(1);
    if (!version) throw new NotFoundError("Project graph not found", { projectId });
    return version;
  }

  return { buildProjectGraph, getProjectGraph, getGraphNode };
}
```

Add helper functions in the same file below the service. Keep them private:

```ts
function buildGraphFacts(input: {
  files: SourceFileRow[];
  imports: SourceImportRow[];
  exports: SourceExportRow[];
  symbols: SourceSymbolRow[];
  entities: SpecEntityRow[];
  annotations: AnnotationRow[];
  diagnostics: ProjectGraphDiagnostic[];
}) {
  const nodes = new Map<string, BuiltNode>();
  const edges = new Map<string, BuiltEdge>();
  const filePathSet = new Set(input.files.map((file) => file.path));

  function addNode(node: BuiltNode) {
    if (!nodes.has(node.nodeKey)) nodes.set(node.nodeKey, node);
  }

  function addEdge(edge: BuiltEdge) {
    const key = `${edge.fromNodeKey}\u0000${edge.toNodeKey}\u0000${edge.edgeType}\u0000${edge.provenance}`;
    if (!edges.has(key)) edges.set(key, edge);
  }

  for (const file of input.files) {
    for (const boundary of pathBoundaries(file.path)) {
      addNode({
        nodeKey: `${boundary.type}:${boundary.path}`,
        nodeType: boundary.type,
        label: path.posix.basename(boundary.path),
        path: boundary.path,
        symbolName: null,
        entityId: null,
        sourceRefJson: { path: boundary.path },
        metadataJson: {},
        confidence: 0.9
      });
    }

    addNode(fileNode(file));
    const nearest = nearestModuleKey(file.path);
    if (nearest) {
      addEdge({
        fromNodeKey: nearest,
        toNodeKey: `file:${file.path}`,
        edgeType: "contains",
        provenance: "scanner_path",
        sourceRefJson: { sourceFileId: file.id, path: file.path },
        metadataJson: {},
        confidence: 1
      });
    }
  }

  for (const symbol of input.symbols) {
    const symbolKey = `symbol:${symbol.filePath}#${symbol.name}`;
    addNode({
      nodeKey: symbolKey,
      nodeType: "symbol",
      label: symbol.name,
      path: symbol.filePath,
      symbolName: symbol.name,
      entityId: null,
      sourceRefJson: { sourceSymbolId: symbol.id, sourceFileId: symbol.sourceFileId },
      metadataJson: { symbolKind: symbol.symbolKind, isExported: symbol.isExported, line: symbol.line },
      confidence: 1
    });
    addEdge({
      fromNodeKey: `file:${symbol.filePath}`,
      toNodeKey: symbolKey,
      edgeType: "defines",
      provenance: "scanner_symbol",
      sourceRefJson: { sourceSymbolId: symbol.id },
      metadataJson: { symbolKind: symbol.symbolKind },
      confidence: 1
    });
  }

  for (const sourceExport of input.exports) {
    const symbolKey = `symbol:${sourceExport.filePath}#${sourceExport.exportedName}`;
    if (!nodes.has(symbolKey)) continue;
    addEdge({
      fromNodeKey: `file:${sourceExport.filePath}`,
      toNodeKey: symbolKey,
      edgeType: "exports",
      provenance: "scanner_export",
      sourceRefJson: { sourceExportId: sourceExport.id },
      metadataJson: { exportKind: sourceExport.exportKind },
      confidence: 1
    });
  }

  for (const sourceImport of input.imports) {
    const fromNodeKey = `file:${sourceImport.filePath}`;
    const toNodeKey = sourceImport.resolvedPath && filePathSet.has(sourceImport.resolvedPath)
      ? `file:${sourceImport.resolvedPath}`
      : `external:${externalDependencyName(sourceImport.specifier)}`;
    if (toNodeKey.startsWith("external:")) {
      addNode({
        nodeKey: toNodeKey,
        nodeType: "external_dependency",
        label: toNodeKey.replace("external:", ""),
        path: null,
        symbolName: null,
        entityId: null,
        sourceRefJson: { specifier: sourceImport.specifier },
        metadataJson: { importKind: sourceImport.importKind },
        confidence: sourceImport.isRelative ? 0.6 : 0.9
      });
    }
    addEdge({
      fromNodeKey,
      toNodeKey,
      edgeType: "imports",
      provenance: "scanner_import",
      sourceRefJson: { sourceImportId: sourceImport.id },
      metadataJson: { specifier: sourceImport.specifier, importedNames: sourceImport.importedNames },
      confidence: sourceImport.resolvedPath ? 1 : 0.7
    });
  }

  for (const file of input.files.filter((candidate) => candidate.kind === "test" || classifyFile(candidate).classification === "test")) {
    const matchedPath = matchTestTarget(file.path, filePathSet);
    if (matchedPath) {
      addEdge({
        fromNodeKey: `file:${file.path}`,
        toNodeKey: `file:${matchedPath}`,
        edgeType: "tests",
        provenance: "heuristic_test",
        sourceRefJson: { sourceFileId: file.id, path: file.path },
        metadataJson: { matchedPath },
        confidence: 0.65
      });
    }
  }

  for (const entity of input.entities) {
    addNode({
      nodeKey: `spec:${entity.entityId}`,
      nodeType: "spec_entity",
      label: entity.title,
      path: entity.filePath,
      symbolName: null,
      entityId: entity.entityId,
      sourceRefJson: { specEntityId: entity.id },
      metadataJson: { type: entity.type, status: entity.status },
      confidence: 1
    });
  }

  for (const annotation of input.annotations) {
    const sourceKey = annotation.symbolName
      ? `symbol:${annotation.sourceFilePath}#${annotation.symbolName}`
      : `file:${annotation.sourceFilePath}`;
    const targetKey = `spec:${annotation.entityId}`;
    if (!nodes.has(sourceKey) || !nodes.has(targetKey)) {
      input.diagnostics.push({
        level: "warning",
        code: "annotation_target_missing",
        message: `Annotation ${annotation.id} could not be projected into the graph.`
      });
      continue;
    }
    addEdge({
      fromNodeKey: sourceKey,
      toNodeKey: targetKey,
      edgeType: "supports_spec",
      provenance: "annotation",
      sourceRefJson: { annotationId: annotation.id },
      metadataJson: {
        relationshipType: annotation.relationshipType,
        annotationProvenance: annotation.provenance,
        claimId: annotation.claimId
      },
      confidence: annotation.confidence
    });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
```

Add the remaining helpers:

```ts
function fileNode(file: SourceFileRow): BuiltNode {
  const classification = classifyFile(file);
  return {
    nodeKey: `file:${file.path}`,
    nodeType: "file",
    label: path.posix.basename(file.path),
    path: file.path,
    symbolName: null,
    entityId: null,
    sourceRefJson: { sourceFileId: file.id },
    metadataJson: {
      classification: classification.classification,
      language: file.language,
      kind: file.kind,
      pathSegments: file.path.split("/")
    },
    confidence: classification.confidence
  };
}

function classifyFile(file: SourceFileRow): { classification: string; confidence: number } {
  const normalized = file.path.replace(/\\/g, "/").toLowerCase();
  if (file.kind === "test" || /\.test\.[cm]?[jt]sx?$/.test(normalized) || /\.spec\.[cm]?[jt]sx?$/.test(normalized)) {
    return { classification: "test", confidence: 1 };
  }
  if (file.kind === "config" || normalized.includes("config") || normalized.endsWith(".config.ts")) {
    return { classification: "config", confidence: 0.9 };
  }
  if (normalized.includes("/routes/")) return { classification: "route", confidence: 0.9 };
  if (normalized.includes("/schema") || normalized.includes("/model") || normalized.includes("/db/")) {
    return { classification: "data_model", confidence: 0.85 };
  }
  if (file.kind === "source") return { classification: "source", confidence: 0.8 };
  return { classification: "unknown", confidence: 0.5 };
}

function pathBoundaries(filePath: string): Array<{ type: "package" | "module"; path: string }> {
  const parts = filePath.split("/");
  const boundaries: Array<{ type: "package" | "module"; path: string }> = [];
  if ((parts[0] === "apps" || parts[0] === "packages") && parts[1]) {
    boundaries.push({ type: "package", path: `${parts[0]}/${parts[1]}` });
  }
  if (parts.length > 3) {
    boundaries.push({ type: "module", path: parts.slice(0, -1).join("/") });
  }
  return boundaries;
}

function nearestModuleKey(filePath: string): string | null {
  const boundaries = pathBoundaries(filePath);
  const moduleBoundary = [...boundaries].reverse().find((boundary) => boundary.type === "module");
  const packageBoundary = boundaries.find((boundary) => boundary.type === "package");
  const boundary = moduleBoundary ?? packageBoundary;
  return boundary ? `${boundary.type}:${boundary.path}` : null;
}

function externalDependencyName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  if (specifier.startsWith(".") || specifier.startsWith("/")) return specifier;
  return specifier.split("/")[0] ?? specifier;
}

function matchTestTarget(testPath: string, filePathSet: Set<string>): string | null {
  const candidates = [
    testPath.replace(/\.test(\.[cm]?[jt]sx?)$/, "$1"),
    testPath.replace(/\.spec(\.[cm]?[jt]sx?)$/, "$1")
  ];
  return candidates.find((candidate) => candidate !== testPath && filePathSet.has(candidate)) ?? null;
}

function buildCoverage(
  nodes: BuiltNode[],
  edges: BuiltEdge[],
  files: SourceFileRow[],
  entities: SpecEntityRow[]
) {
  return {
    nodeCounts: countBy(nodes, (node) => node.nodeType),
    edgeCounts: countBy(edges, (edge) => edge.edgeType),
    sourceFileCount: files.length,
    specEntityCount: entities.length,
    unresolvedImportCount: edges.filter((edge) => edge.edgeType === "imports" && edge.toNodeKey.startsWith("external:")).length,
    heuristicEdgeCount: edges.filter((edge) => edge.provenance === "heuristic_test").length
  };
}

function summarizeGraph(nodeCount: number, edgeCount: number) {
  return `Graph contains ${nodeCount} nodes and ${edgeCount} edges.`;
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function readCoverage(value: unknown) {
  const coverage = value as {
    nodeCounts?: Record<string, number>;
    edgeCounts?: Record<string, number>;
    sourceFileCount?: number;
    specEntityCount?: number;
    unresolvedImportCount?: number;
    heuristicEdgeCount?: number;
  };
  return {
    nodeCounts: coverage.nodeCounts ?? {},
    edgeCounts: coverage.edgeCounts ?? {},
    sourceFileCount: coverage.sourceFileCount ?? 0,
    specEntityCount: coverage.specEntityCount ?? 0,
    unresolvedImportCount: coverage.unresolvedImportCount ?? 0,
    heuristicEdgeCount: coverage.heuristicEdgeCount ?? 0
  };
}
```

Add DTO mapping helpers:

```ts
function mapVersion(row: GraphVersionRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    indexRunId: row.indexRunId,
    status: row.status,
    summary: row.summary,
    coverage: readCoverage(row.coverageJson),
    diagnostics: Array.isArray(row.diagnosticsJson) ? row.diagnosticsJson : [],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function mapNode(row: GraphNodeRow): ProjectGraphNodeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    graphVersionId: row.graphVersionId,
    nodeKey: row.nodeKey,
    nodeType: row.nodeType as ProjectGraphNodeDto["nodeType"],
    label: row.label,
    path: row.path,
    symbolName: row.symbolName,
    entityId: row.entityId,
    sourceRef: readRecord(row.sourceRefJson),
    metadata: readRecord(row.metadataJson),
    confidence: row.confidence,
    createdAt: toIso(row.createdAt)
  };
}

function mapEdge(row: GraphEdgeRow): ProjectGraphEdgeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    graphVersionId: row.graphVersionId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    edgeType: row.edgeType as ProjectGraphEdgeDto["edgeType"],
    provenance: row.provenance as ProjectGraphEdgeDto["provenance"],
    sourceRef: readRecord(row.sourceRefJson),
    metadata: readRecord(row.metadataJson),
    confidence: row.confidence,
    createdAt: toIso(row.createdAt)
  };
}

function groupEdges(rows: GraphEdgeRow[]) {
  return rows.reduce<Record<string, ProjectGraphEdgeDto[]>>((grouped, row) => {
    grouped[row.edgeType] = [...(grouped[row.edgeType] ?? []), mapEdge(row)];
    return grouped;
  }, {});
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- project-graph-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit graph service**

```bash
git add apps/api/src/services/project-graph-service.ts apps/api/src/__tests__/project-graph-service.test.ts
git commit -m "feat: build project graph facts"
```

---

### Task 4: Indexer Integration

**Files:**
- Modify: `apps/api/src/services/indexer-service.ts`
- Modify: `apps/api/src/__tests__/indexer-service.test.ts`

- [ ] **Step 1: Write failing indexer integration test**

In `apps/api/src/__tests__/indexer-service.test.ts`, add imports:

```ts
import { projectGraphVersions } from "@specops/db";
import { and, eq } from "drizzle-orm";
```

Add a test near other successful index tests:

```ts
  it("builds a project graph after a successful index", async () => {
    const project = await createProjectFixture();
    await mkdir(path.join(project.repoPath, ".specops", "domain"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, ".specops", "domain", "project.md"),
      "---\nid: domain.project\ntype: domain\nstatus: draft\n---\n\n# Project\n",
      "utf8"
    );
    await writeFile(path.join(project.repoPath, "src", "project.ts"), "export const project = 1;\n", "utf8");

    const indexRun = await createIndexerService(db).indexProject(project.id);
    const [graphVersion] = await db
      .select()
      .from(projectGraphVersions)
      .where(
        and(
          eq(projectGraphVersions.projectId, project.id),
          eq(projectGraphVersions.indexRunId, indexRun.id)
        )
      )
      .limit(1);

    expect(graphVersion).toMatchObject({
      projectId: project.id,
      indexRunId: indexRun.id,
      status: "ready"
    });
  });
```

- [ ] **Step 2: Run indexer test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- indexer-service.test.ts
```

Expected: FAIL because indexing does not build a graph yet.

- [ ] **Step 3: Trigger graph build after index success**

Modify `apps/api/src/services/indexer-service.ts`.

Add import:

```ts
import { createProjectGraphService } from "./project-graph-service.js";
```

After `if (!finishedRun) { ... }` and before `return mapIndexRun(finishedRun);`, add:

```ts
        await createProjectGraphService(db)
          .buildProjectGraph({
            projectId,
            indexRunId: finishedRun.id
          })
          .catch(async (error) => {
            await createProjectGraphService(db).recordFailedGraphVersion({
              projectId,
              indexRunId: finishedRun.id,
              error
            });
          });
```

Add `recordFailedGraphVersion` to `createProjectGraphService`:

```ts
  async function recordFailedGraphVersion(input: {
    projectId: string;
    indexRunId: string | null;
    error: unknown;
  }) {
    const [version] = await db
      .insert(projectGraphVersions)
      .values({
        projectId: input.projectId,
        indexRunId: input.indexRunId,
        status: "failed",
        summary: "Project graph build failed.",
        coverageJson: {
          nodeCounts: {},
          edgeCounts: {},
          sourceFileCount: 0,
          specEntityCount: 0,
          unresolvedImportCount: 0,
          heuristicEdgeCount: 0
        },
        diagnosticsJson: [
          {
            level: "error",
            code: "graph_build_failed",
            message: input.error instanceof Error ? input.error.message : String(input.error)
          }
        ]
      })
      .returning();
    return version ? mapVersion(version) : null;
  }
```

Include it in the service return object:

```ts
  return { buildProjectGraph, getProjectGraph, getGraphNode, recordFailedGraphVersion };
```

- [ ] **Step 4: Run indexer test**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- indexer-service.test.ts project-graph-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit integration**

```bash
git add apps/api/src/services/indexer-service.ts apps/api/src/services/project-graph-service.ts apps/api/src/__tests__/indexer-service.test.ts
git commit -m "feat: build graph after indexing"
```

---

### Task 5: API Routes

**Files:**
- Create: `apps/api/src/routes/project-graph.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

In `apps/api/src/__tests__/routes.test.ts`, import:

```ts
import { projectGraphListResponseSchema, projectGraphNodeDetailSchema } from "@specops/contracts";
```

Add a DB-backed route test near index/source route tests:

```ts
  it("returns current project graph and node detail", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.repoPath, ".specops", "domain"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, ".specops", "domain", "project.md"),
      "---\nid: domain.project\ntype: domain\nstatus: draft\n---\n\n# Project\n",
      "utf8"
    );
    await writeFile(path.join(project.repoPath, "src", "project.ts"), "export const project = 1;\n", "utf8");
    await createIndexerService(createDb(testDatabaseUrl!)).indexProject(project.id);

    const graphResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/graph`
    });
    expect(graphResponse.statusCode).toBe(200);
    const graph = projectGraphListResponseSchema.parse(graphResponse.json());
    expect(graph.nodeCounts.file).toBeGreaterThanOrEqual(1);

    const fileNode = graph.nodes.find((node) => node.nodeType === "file");
    expect(fileNode).toBeTruthy();
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/graph/nodes/${fileNode!.id}`
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(projectGraphNodeDetailSchema.parse(detailResponse.json()).node.id).toBe(fileNode!.id);
  });
```

- [ ] **Step 2: Run route test to verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: FAIL with 404 for `/api/projects/:projectId/graph`.

- [ ] **Step 3: Add graph routes**

Create `apps/api/src/routes/project-graph.ts`:

```ts
import { projectGraphQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectGraphService } from "../services/project-graph-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const nodeParamsSchema = projectParamsSchema.extend({
  nodeId: z.string().min(1)
});

export const registerProjectGraphRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const graphService = createProjectGraphService(db);

  app.get("/projects/:projectId/graph", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = projectGraphQuerySchema.parse(request.query);
    await projectService.getProject(projectId);
    return graphService.getProjectGraph(projectId, query);
  });

  app.get("/projects/:projectId/graph/nodes/:nodeId", async (request) => {
    const { projectId, nodeId } = nodeParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return graphService.getGraphNode(projectId, nodeId);
  });
};
```

Modify `apps/api/src/server.ts`:

```ts
import { registerProjectGraphRoutes } from "./routes/project-graph.js";
```

Register it near index routes:

```ts
  app.register(registerProjectGraphRoutes, { prefix: "/api", db });
```

- [ ] **Step 4: Run route tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit routes**

```bash
git add apps/api/src/routes/project-graph.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose project graph API"
```

---

### Task 6: Web Query Layer And Graph Route

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/routes/project-graph.tsx`
- Create: `apps/web/src/routes/project-graph.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/routes/project-detail.tsx`

- [ ] **Step 1: Write failing web route test**

Create `apps/web/src/routes/project-graph.test.tsx`:

```tsx
// @vitest-environment happy-dom

import type { ProjectGraphListResponse, ProjectGraphNodeDetail } from "@specops/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  graphState: {
    data: null as ProjectGraphListResponse | null,
    error: null as Error | null,
    isLoading: false
  },
  nodeState: {
    data: null as ProjectGraphNodeDetail | null,
    error: null as Error | null,
    isLoading: false
  },
  projectGraphQuery: vi.fn((projectId: string, input: Record<string, unknown>) => ({
    queryKey: ["projects", projectId, "graph", input],
    queryType: "projectGraph"
  })),
  projectGraphNodeQuery: vi.fn((projectId: string, nodeId: string | null) => ({
    queryKey: ["projects", projectId, "graph", "nodes", nodeId],
    queryType: "projectGraphNode",
    enabled: nodeId !== null
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) =>
    options.queryType === "projectGraphNode" ? mocks.nodeState : mocks.graphState
}));

vi.mock("../api/queries.js", () => ({
  projectGraphNodeQuery: mocks.projectGraphNodeQuery,
  projectGraphQuery: mocks.projectGraphQuery
}));

import { ProjectGraphPage } from "./project-graph.js";

describe("ProjectGraphPage", () => {
  it("renders graph counts, diagnostics, samples, and selected node detail", () => {
    mocks.graphState = {
      data: graphFixture(),
      error: null,
      isLoading: false
    };
    mocks.nodeState = {
      data: nodeDetailFixture(),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ProjectGraphPage projectId="project-1" />);

    expect(html).toContain("Project graph");
    expect(html).toContain("Graph contains 2 nodes and 1 edge.");
    expect(html).toContain("file");
    expect(html).toContain("defines");
    expect(html).toContain("No graph warnings");
    expect(html).toContain("apps/api/src/routes/projects.ts");
    expect(html).toContain("Outgoing");
  });
});

function graphFixture(): ProjectGraphListResponse {
  return {
    version: {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      indexRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Graph contains 2 nodes and 1 edge.",
      coverage: {
        nodeCounts: { file: 1, symbol: 1 },
        edgeCounts: { defines: 1 },
        sourceFileCount: 1,
        specEntityCount: 0,
        unresolvedImportCount: 0,
        heuristicEdgeCount: 0
      },
      diagnostics: [],
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z"
    },
    nodeCounts: { file: 1, symbol: 1 },
    edgeCounts: { defines: 1 },
    nodes: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        projectId: "00000000-0000-4000-8000-000000000002",
        graphVersionId: "00000000-0000-4000-8000-000000000001",
        nodeKey: "file:apps/api/src/routes/projects.ts",
        nodeType: "file",
        label: "projects.ts",
        path: "apps/api/src/routes/projects.ts",
        symbolName: null,
        entityId: null,
        sourceRef: {},
        metadata: { classification: "route" },
        confidence: 1,
        createdAt: "2026-05-14T10:00:00.000Z"
      }
    ],
    edges: []
  };
}

function nodeDetailFixture(): ProjectGraphNodeDetail {
  return {
    node: graphFixture().nodes[0]!,
    incomingEdges: {},
    outgoingEdges: { defines: [] },
    neighboringNodes: []
  };
}
```

- [ ] **Step 2: Run web test to verify it fails**

Run:

```bash
pnpm --filter web test -- project-graph.test.tsx
```

Expected: FAIL with import error for `./project-graph.js`.

- [ ] **Step 3: Add query helpers**

Modify imports in `apps/web/src/api/queries.ts`:

```ts
  ProjectGraphListResponse,
  ProjectGraphNodeDetail,
  ProjectGraphQuery,
```

Add query keys:

```ts
  projectGraph: (projectId: string, input: Partial<ProjectGraphQuery> = {}) =>
    ["projects", projectId, "graph", input] as const,
  projectGraphNode: (projectId: string, nodeId: string | null) =>
    ["projects", projectId, "graph", "nodes", nodeId] as const,
```

Add query helpers near `indexRunsQuery`:

```ts
export function projectGraphQuery(projectId: string, input: Partial<ProjectGraphQuery> = {}) {
  const search = new URLSearchParams();
  if (input.nodeType) search.set("nodeType", input.nodeType);
  if (input.edgeType) search.set("edgeType", input.edgeType);
  if (input.q) search.set("q", input.q);
  if (input.limit !== undefined) search.set("limit", String(input.limit));
  const suffix = search.toString() ? `?${search.toString()}` : "";

  return queryOptions({
    queryKey: queryKeys.projectGraph(projectId, input),
    queryFn: () =>
      apiGet<ProjectGraphListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/graph${suffix}`
      )
  });
}

export function projectGraphNodeQuery(projectId: string, nodeId: string | null) {
  return queryOptions({
    queryKey: queryKeys.projectGraphNode(projectId, nodeId),
    enabled: nodeId !== null,
    queryFn: () =>
      apiGet<ProjectGraphNodeDetail>(
        `/api/projects/${encodeURIComponent(projectId)}/graph/nodes/${encodeURIComponent(
          nodeId ?? ""
        )}`
      )
  });
}
```

- [ ] **Step 4: Add graph page**

Create `apps/web/src/routes/project-graph.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { projectGraphNodeQuery, projectGraphQuery } from "../api/queries.js";

type ProjectGraphPageProps = {
  projectId: string;
};

export function ProjectGraphPage({ projectId }: ProjectGraphPageProps) {
  const graph = useQuery(projectGraphQuery(projectId, { limit: 50 }));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const effectiveNodeId = selectedNodeId ?? graph.data?.nodes[0]?.id ?? null;
  const nodeDetail = useQuery(projectGraphNodeQuery(projectId, effectiveNodeId));
  const nodeCounts = useMemo(() => entries(graph.data?.nodeCounts ?? {}), [graph.data]);
  const edgeCounts = useMemo(() => entries(graph.data?.edgeCounts ?? {}), [graph.data]);

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Project graph</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Scanner-derived graph facts for project {projectId}.
          </p>
        </div>
        <Link to="/projects/$projectId" params={{ projectId }} className="button-secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to project
        </Link>
      </div>

      {graph.error ? (
        <p className="panel-section text-sm text-red-700">{graph.error.message}</p>
      ) : graph.isLoading ? (
        <p className="panel-section text-sm text-slate-500">Loading project graph...</p>
      ) : graph.data ? (
        <div className="grid min-h-0 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="panel-section min-h-0 overflow-auto">
            <h2 className="section-heading">Current graph</h2>
            <p className="mt-2 text-sm text-slate-600">{graph.data.version.summary}</p>
            <StatusLine label="Status" value={graph.data.version.status} />
            <StatusLine label="Index run" value={graph.data.version.indexRunId ?? "none"} />
            <CountList title="Nodes" counts={nodeCounts} />
            <CountList title="Edges" counts={edgeCounts} />
            {graph.data.version.diagnostics.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No graph warnings</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {graph.data.version.diagnostics.map((diagnostic) => (
                  <li key={`${diagnostic.level}-${diagnostic.code}`} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="panel-section min-h-0 overflow-auto">
              <h2 className="section-heading">Node sample</h2>
              <ul className="mt-3 grid gap-2">
                {graph.data.nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={
                        node.id === effectiveNodeId
                          ? "w-full rounded border border-slate-900 bg-slate-900 p-2 text-left text-sm text-white"
                          : "w-full rounded border border-slate-200 p-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      }
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <span className="block font-medium">{node.label}</span>
                      <span className="block truncate text-xs opacity-80">{node.nodeKey}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel-section min-h-0 overflow-auto">
              <h2 className="section-heading">Node detail</h2>
              {nodeDetail.error ? (
                <p className="mt-3 text-sm text-red-700">{nodeDetail.error.message}</p>
              ) : nodeDetail.isLoading ? (
                <p className="mt-3 text-sm text-slate-500">Loading node...</p>
              ) : nodeDetail.data ? (
                <div className="mt-3 grid gap-3 text-sm">
                  <StatusLine label="Type" value={nodeDetail.data.node.nodeType} />
                  <StatusLine label="Path" value={nodeDetail.data.node.path ?? "none"} />
                  <EdgeGroup title="Incoming" groups={nodeDetail.data.incomingEdges} />
                  <EdgeGroup title="Outgoing" groups={nodeDetail.data.outgoingEdges} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Select a graph node.</p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <p className="panel-section text-sm text-slate-500">Project graph is unavailable.</p>
      )}
    </main>
  );
}

function CountList({ title, counts }: { title: string; counts: Array<[string, number]> }) {
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      <dl className="mt-2 grid gap-1 text-xs">
        {counts.map(([key, value]) => (
          <StatusLine key={key} label={key} value={String(value)} />
        ))}
      </dl>
    </div>
  );
}

function EdgeGroup({ title, groups }: { title: string; groups: Record<string, unknown[]> }) {
  const grouped = entries(groups).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0] as const);
  return <CountList title={title} counts={grouped.map(([key, value]) => [key, value])} />;
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="truncate text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function entries(value: Record<string, unknown>): Array<[string, number]> {
  return Object.entries(value)
    .map(([key, count]) => [key, typeof count === "number" ? count : 0] as [string, number])
    .sort(([left], [right]) => left.localeCompare(right));
}
```

- [ ] **Step 5: Register route and project link**

Modify `apps/web/src/app.tsx`:

```ts
import { ProjectGraphPage } from "./routes/project-graph.js";
```

Add a route before `entityRoute`:

```tsx
const projectGraphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/graph",
  component: () => {
    const { projectId } = projectGraphRoute.useParams();
    return <ProjectGraphPage projectId={projectId} />;
  }
});
```

Add `projectGraphRoute` to `routeTree`.

Modify `apps/web/src/routes/project-detail.tsx` imports:

```ts
import { Link, useNavigate } from "@tanstack/react-router";
```

Add this inside the inspector before `ValidationPanel`:

```tsx
          {latestRun ? (
            <section className="panel-section">
              <h2 className="section-heading">Project Graph</h2>
              <Link
                to="/projects/$projectId/graph"
                params={{ projectId }}
                className="button-secondary mt-2 w-full justify-center"
              >
                Inspect graph
              </Link>
            </section>
          ) : null}
```

- [ ] **Step 6: Run web tests**

Run:

```bash
pnpm --filter web test -- project-graph.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit web graph route**

```bash
git add apps/web/src/api/queries.ts apps/web/src/routes/project-graph.tsx apps/web/src/routes/project-graph.test.tsx apps/web/src/app.tsx apps/web/src/routes/project-detail.tsx
git commit -m "feat: add project graph inspection UI"
```

---

### Task 7: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands PASS.

- [ ] **Step 2: Inspect git status**

Run:

```bash
git status --short
```

Expected: no uncommitted files except intentional local environment files.

- [ ] **Step 3: Summarize implementation**

Write a short completion note containing:

```md
Implemented project graph foundation:
- Added graph contracts and DB tables.
- Built scanner-only graph versions after indexing.
- Exposed graph API and minimal web inspection route.
- Verified with typecheck, tests, and web build.
```
