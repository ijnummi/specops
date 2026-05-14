# Analyze Project Phase 5 Concept Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual, AI-assisted, project-scoped concept graph built from the latest deterministic project graph, with durable read-only concept data and no markdown writes.

**Architecture:** The concept graph is a separate versioned layer tied to `project_graph_versions.id`. A manual API action builds a concept graph from bounded graph facts, normalizes mocked or real AI provider output, rejects unsupported evidence, persists concepts/memberships/relationships, and exposes latest/detail read APIs plus a read-only web inspection page.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle/PostgreSQL, Fastify, Zod contracts, React, TanStack Query, TanStack Router, Vitest, existing `@specops/ai-prefill` provider plumbing.

---

## File Structure

- Create `packages/contracts/src/concepts.ts`: concept graph Zod schemas, DTOs, request schemas, enums, and response types.
- Create `packages/contracts/src/concepts.test.ts`: contract parsing tests.
- Modify `packages/contracts/src/index.ts`: export concept contracts.
- Modify `packages/db/src/schema.ts`: add concept version, concept, membership, and relationship tables.
- Modify `packages/db/src/schema.typecheck.ts`: compile-time select/insert checks for concept tables.
- Modify `packages/db/migrations/0000_initial.sql`: add concept graph tables, constraints, indexes, and project/version safety foreign keys.
- Modify `packages/db/src/migrations.test.ts`: assert migration includes concept tables, uniqueness, and foreign keys.
- Modify `packages/ai-prefill/src/types.ts`: extend provider interface with `generateConceptGraph`.
- Modify `packages/ai-prefill/src/providers.ts`: implement provider call for concept graph generation using the same JSON chat path as AI prefill.
- Create `packages/ai-prefill/src/concepts.ts`: concept prompt packet builder and response normalizer.
- Create `packages/ai-prefill/src/__tests__/concepts.test.ts`: prompt and normalization tests.
- Modify `packages/ai-prefill/src/index.ts`: export concept helpers.
- Create `apps/api/src/services/concept-graph-service.ts`: latest graph lookup, evidence packet creation, provider invocation, normalization, persistence, and read DTO mapping.
- Create `apps/api/src/__tests__/concept-graph-service.test.ts`: DB-backed service tests with mocked providers.
- Create `apps/api/src/routes/concept-graphs.ts`: build/latest/detail routes.
- Modify `apps/api/src/server.ts`: register concept graph routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: route behavior tests.
- Modify `apps/web/src/api/queries.ts`: concept graph query keys, build mutation helper, latest/detail queries.
- Create `apps/web/src/routes/concepts.tsx`: read-only concept inspection page with build action.
- Create `apps/web/src/routes/concepts.test.tsx`: UI rendering tests.
- Modify `apps/web/src/app.tsx`: add `/projects/$projectId/concepts` route.
- Modify `apps/web/src/routes/project-graph.tsx`: add `Concepts` navigation/build entry point.

---

### Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/concepts.ts`
- Create: `packages/contracts/src/concepts.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/concepts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildConceptGraphRequestSchema,
  conceptDetailResponseSchema,
  conceptGraphLatestResponseSchema,
  projectConceptMembershipSchema,
  projectConceptRelationshipSchema,
  projectConceptSchema,
  projectConceptVersionSchema
} from "./concepts.js";

const timestamp = "2026-05-14T10:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000001";
const graphVersionId = "00000000-0000-4000-8000-000000000002";
const conceptVersionId = "00000000-0000-4000-8000-000000000003";
const conceptId = "00000000-0000-4000-8000-000000000004";
const nodeId = "00000000-0000-4000-8000-000000000005";

describe("concept graph contracts", () => {
  it("parses a build request", () => {
    const parsed = buildConceptGraphRequestSchema.parse({
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 120,
      maxGraphEdges: 240
    });

    expect(parsed.provider).toBe("openai");
    expect(parsed.maxGraphNodes).toBe(120);
  });

  it("parses concept version, concept, membership, and relationship DTOs", () => {
    const version = projectConceptVersionSchema.parse({
      id: conceptVersionId,
      projectId,
      projectGraphVersionId: graphVersionId,
      status: "ready",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "concept-graph-v1",
      summary: "Concept graph with one workflow.",
      coverage: {
        conceptCounts: { workflow: 1 },
        membershipCounts: { primary: 1 },
        relationshipCounts: {},
        rejectedConceptCount: 0,
        rejectedMembershipCount: 0,
        graphNodeCoverageCount: 1,
        lowConfidenceConceptCount: 0
      },
      diagnostics: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const concept = projectConceptSchema.parse({
      id: conceptId,
      projectId,
      conceptVersionId,
      conceptKey: "workflow:checkout",
      conceptType: "workflow",
      name: "Checkout",
      summary: "Coordinates checkout behavior.",
      confidence: 0.86,
      provenance: "ai",
      evidenceSummary: "Supported by checkout service graph nodes.",
      status: "active",
      metadata: { source: "provider" },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const membership = projectConceptMembershipSchema.parse({
      id: "00000000-0000-4000-8000-000000000006",
      projectId,
      conceptVersionId,
      conceptId,
      graphNodeId: nodeId,
      role: "primary",
      confidence: 0.9,
      rationale: "Main service node for the concept.",
      createdAt: timestamp
    });
    const relationship = projectConceptRelationshipSchema.parse({
      id: "00000000-0000-4000-8000-000000000007",
      projectId,
      conceptVersionId,
      fromConceptId: conceptId,
      toConceptId: "00000000-0000-4000-8000-000000000008",
      relationshipType: "uses",
      confidence: 0.7,
      rationale: "Workflow calls the downstream concept.",
      createdAt: timestamp
    });

    expect(version.status).toBe("ready");
    expect(concept.conceptType).toBe("workflow");
    expect(membership.role).toBe("primary");
    expect(relationship.relationshipType).toBe("uses");
  });

  it("parses latest and detail responses", () => {
    const version = projectConceptVersionSchema.parse({
      id: conceptVersionId,
      projectId,
      projectGraphVersionId: graphVersionId,
      status: "limited",
      provider: "ollama",
      model: "llama3.2",
      promptVersion: "concept-graph-v1",
      summary: "Limited concept graph.",
      coverage: {
        conceptCounts: { subsystem: 1 },
        membershipCounts: { supporting: 1 },
        relationshipCounts: { relates_to: 1 },
        rejectedConceptCount: 1,
        rejectedMembershipCount: 2,
        graphNodeCoverageCount: 1,
        lowConfidenceConceptCount: 1
      },
      diagnostics: [{ level: "warning", code: "limited_graph_evidence", message: "Only one node was usable." }],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const concept = projectConceptSchema.parse({
      id: conceptId,
      projectId,
      conceptVersionId,
      conceptKey: "subsystem:api",
      conceptType: "subsystem",
      name: "API",
      summary: "HTTP API subsystem.",
      confidence: 0.5,
      provenance: "ai",
      evidenceSummary: "Supported by one route file.",
      status: "active",
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const latest = conceptGraphLatestResponseSchema.parse({
      version,
      conceptCounts: { subsystem: 1 },
      membershipCounts: { supporting: 1 },
      relationshipCounts: { relates_to: 1 },
      concepts: [concept],
      diagnostics: version.diagnostics
    });
    const detail = conceptDetailResponseSchema.parse({
      concept,
      memberships: [],
      graphNodes: [],
      incomingRelationships: {},
      outgoingRelationships: {},
      relatedConcepts: []
    });

    expect(latest.concepts).toHaveLength(1);
    expect(detail.concept.name).toBe("API");
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- concepts.test.ts
```

Expected: FAIL with an import error for `./concepts.js`.

- [ ] **Step 3: Add concept contracts**

Create `packages/contracts/src/concepts.ts`:

```ts
import { z } from "zod";

export const conceptGraphStatusSchema = z.enum(["building", "ready", "limited", "failed", "superseded"]);
export const conceptTypeSchema = z.enum([
  "workflow",
  "subsystem",
  "domain_concept",
  "interface",
  "data_flow",
  "test_behavior",
  "cross_cutting",
  "unknown"
]);
export const conceptProvenanceSchema = z.enum(["ai"]);
export const conceptStatusSchema = z.enum(["active", "discarded", "superseded"]);
export const conceptMembershipRoleSchema = z.enum(["primary", "supporting", "entrypoint", "data", "test", "spec"]);
export const conceptRelationshipTypeSchema = z.enum(["depends_on", "uses", "implements", "exposes", "tests", "relates_to"]);

export const conceptGraphDiagnosticSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const conceptGraphCoverageSchema = z.object({
  conceptCounts: z.record(z.string(), z.number().int().min(0)),
  membershipCounts: z.record(z.string(), z.number().int().min(0)),
  relationshipCounts: z.record(z.string(), z.number().int().min(0)),
  rejectedConceptCount: z.number().int().min(0),
  rejectedMembershipCount: z.number().int().min(0),
  graphNodeCoverageCount: z.number().int().min(0),
  lowConfidenceConceptCount: z.number().int().min(0)
});

export const projectConceptVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectGraphVersionId: z.string().uuid(),
  status: conceptGraphStatusSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  summary: z.string(),
  coverage: conceptGraphCoverageSchema,
  diagnostics: z.array(conceptGraphDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const projectConceptSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptVersionId: z.string().uuid(),
  conceptKey: z.string().min(1),
  conceptType: conceptTypeSchema,
  name: z.string().min(1),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  provenance: conceptProvenanceSchema,
  evidenceSummary: z.string(),
  status: conceptStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const projectConceptMembershipSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptVersionId: z.string().uuid(),
  conceptId: z.string().uuid(),
  graphNodeId: z.string().uuid(),
  role: conceptMembershipRoleSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  createdAt: z.string().datetime()
});

export const projectConceptRelationshipSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptVersionId: z.string().uuid(),
  fromConceptId: z.string().uuid(),
  toConceptId: z.string().uuid(),
  relationshipType: conceptRelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  createdAt: z.string().datetime()
});

export const buildConceptGraphRequestSchema = z.object({
  provider: z.enum(["ollama", "openai"]),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.1),
  maxGraphNodes: z.number().int().min(1).max(500).default(150),
  maxGraphEdges: z.number().int().min(1).max(1000).default(300)
});

export const conceptGraphLatestResponseSchema = z.object({
  version: projectConceptVersionSchema,
  conceptCounts: z.record(z.string(), z.number().int().min(0)),
  membershipCounts: z.record(z.string(), z.number().int().min(0)),
  relationshipCounts: z.record(z.string(), z.number().int().min(0)),
  concepts: z.array(projectConceptSchema),
  diagnostics: z.array(conceptGraphDiagnosticSchema)
});

export const conceptDetailResponseSchema = z.object({
  concept: projectConceptSchema,
  memberships: z.array(projectConceptMembershipSchema),
  graphNodes: z.array(z.unknown()),
  incomingRelationships: z.record(z.string(), z.array(projectConceptRelationshipSchema)),
  outgoingRelationships: z.record(z.string(), z.array(projectConceptRelationshipSchema)),
  relatedConcepts: z.array(projectConceptSchema)
});

export type ConceptGraphStatus = z.infer<typeof conceptGraphStatusSchema>;
export type ConceptType = z.infer<typeof conceptTypeSchema>;
export type ConceptProvenance = z.infer<typeof conceptProvenanceSchema>;
export type ConceptStatus = z.infer<typeof conceptStatusSchema>;
export type ConceptMembershipRole = z.infer<typeof conceptMembershipRoleSchema>;
export type ConceptRelationshipType = z.infer<typeof conceptRelationshipTypeSchema>;
export type ConceptGraphDiagnostic = z.infer<typeof conceptGraphDiagnosticSchema>;
export type ConceptGraphCoverage = z.infer<typeof conceptGraphCoverageSchema>;
export type ProjectConceptVersionDto = z.infer<typeof projectConceptVersionSchema>;
export type ProjectConceptDto = z.infer<typeof projectConceptSchema>;
export type ProjectConceptMembershipDto = z.infer<typeof projectConceptMembershipSchema>;
export type ProjectConceptRelationshipDto = z.infer<typeof projectConceptRelationshipSchema>;
export type BuildConceptGraphRequest = z.infer<typeof buildConceptGraphRequestSchema>;
export type ConceptGraphLatestResponse = z.infer<typeof conceptGraphLatestResponseSchema>;
export type ConceptDetailResponse = z.infer<typeof conceptDetailResponseSchema>;
```

- [ ] **Step 4: Export concept contracts**

Modify `packages/contracts/src/index.ts` and add:

```ts
export * from "./concepts.js";
```

- [ ] **Step 5: Run contract tests**

Run:

```bash
pnpm --filter @specops/contracts test -- concepts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit contracts**

Run:

```bash
git add packages/contracts/src/concepts.ts packages/contracts/src/concepts.test.ts packages/contracts/src/index.ts
git commit -m "feat: add concept graph contracts"
```

---

### Task 2: Database Schema And Migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`

- [ ] **Step 1: Write failing migration assertions**

In `packages/db/src/migrations.test.ts`, extend the migration table assertions near the project graph expectations with:

```ts
expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_concept_versions"');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_concepts"');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_concept_memberships"');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_concept_relationships"');
expect(migration).toContain('CONSTRAINT "project_concept_versions_id_project_id_unique" UNIQUE("id","project_id")');
expect(migration).toContain('CONSTRAINT "project_concepts_version_key_unique" UNIQUE("concept_version_id","concept_key")');
expect(migration).toContain("project_concept_versions_project_status_created_idx");
expect(migration).toContain("project_concepts_version_type_idx");
expect(migration).toContain("project_concept_memberships_concept_id_idx");
expect(migration).toContain("project_concept_relationships_from_concept_idx");
expect(migration).toContain("project_concept_versions_graph_version_project_fk");
expect(migration).toContain("project_concepts_version_project_fk");
expect(migration).toContain("project_concept_memberships_graph_node_project_fk");
expect(migration).toContain("project_concept_relationships_to_concept_project_fk");
```

- [ ] **Step 2: Run migration test to verify it fails**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because the concept table strings are missing.

- [ ] **Step 3: Add Drizzle schema tables**

In `packages/db/src/schema.ts`, add these exports after `projectGraphEdges`:

```ts
export const projectConceptVersions = pgTable(
  "project_concept_versions",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectGraphVersionId: uuid("project_graph_version_id")
      .notNull()
      .references(() => projectGraphVersions.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    summary: text("summary").notNull().default(""),
    coverageJson: jsonb("coverage_json").notNull().default(sql`'{}'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("project_concept_versions_project_id_idx").on(table.projectId),
    projectStatusCreatedIdx: index("project_concept_versions_project_status_created_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    graphVersionIdx: index("project_concept_versions_graph_version_id_idx").on(table.projectGraphVersionId),
    idProjectUnique: unique("project_concept_versions_id_project_id_unique").on(table.id, table.projectId),
    graphVersionProjectFk: foreignKey({
      name: "project_concept_versions_graph_version_project_fk",
      columns: [table.projectGraphVersionId, table.projectId],
      foreignColumns: [projectGraphVersions.id, projectGraphVersions.projectId],
    }).onDelete("cascade"),
  }),
);

export const projectConcepts = pgTable(
  "project_concepts",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptVersionId: uuid("concept_version_id")
      .notNull()
      .references(() => projectConceptVersions.id, { onDelete: "cascade" }),
    conceptKey: text("concept_key").notNull(),
    conceptType: text("concept_type").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    confidence: doublePrecision("confidence").notNull(),
    provenance: text("provenance").notNull(),
    evidenceSummary: text("evidence_summary").notNull().default(""),
    status: text("status").notNull().default("active"),
    metadataJson: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    versionIdx: index("project_concepts_concept_version_id_idx").on(table.conceptVersionId),
    versionTypeIdx: index("project_concepts_version_type_idx").on(table.conceptVersionId, table.conceptType),
    projectStatusIdx: index("project_concepts_project_status_idx").on(table.projectId, table.status),
    versionKeyUnique: unique("project_concepts_version_key_unique").on(table.conceptVersionId, table.conceptKey),
    idProjectUnique: unique("project_concepts_id_project_id_unique").on(table.id, table.projectId),
    idProjectVersionUnique: unique("project_concepts_id_project_id_concept_version_id_unique").on(
      table.id,
      table.projectId,
      table.conceptVersionId,
    ),
    versionProjectFk: foreignKey({
      name: "project_concepts_version_project_fk",
      columns: [table.conceptVersionId, table.projectId],
      foreignColumns: [projectConceptVersions.id, projectConceptVersions.projectId],
    }).onDelete("cascade"),
  }),
);

export const projectConceptMemberships = pgTable(
  "project_concept_memberships",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptVersionId: uuid("concept_version_id")
      .notNull()
      .references(() => projectConceptVersions.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull(),
    graphNodeId: uuid("graph_node_id").notNull(),
    role: text("role").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    rationale: text("rationale").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => ({
    versionIdx: index("project_concept_memberships_concept_version_id_idx").on(table.conceptVersionId),
    conceptIdx: index("project_concept_memberships_concept_id_idx").on(table.conceptId),
    graphNodeIdx: index("project_concept_memberships_graph_node_id_idx").on(table.graphNodeId),
    conceptProjectFk: foreignKey({
      name: "project_concept_memberships_concept_project_fk",
      columns: [table.conceptId, table.projectId, table.conceptVersionId],
      foreignColumns: [projectConcepts.id, projectConcepts.projectId, projectConcepts.conceptVersionId],
    }).onDelete("cascade"),
    graphNodeProjectFk: foreignKey({
      name: "project_concept_memberships_graph_node_project_fk",
      columns: [table.graphNodeId, table.projectId],
      foreignColumns: [projectGraphNodes.id, projectGraphNodes.projectId],
    }).onDelete("cascade"),
  }),
);

export const projectConceptRelationships = pgTable(
  "project_concept_relationships",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptVersionId: uuid("concept_version_id")
      .notNull()
      .references(() => projectConceptVersions.id, { onDelete: "cascade" }),
    fromConceptId: uuid("from_concept_id").notNull(),
    toConceptId: uuid("to_concept_id").notNull(),
    relationshipType: text("relationship_type").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    rationale: text("rationale").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => ({
    versionIdx: index("project_concept_relationships_concept_version_id_idx").on(table.conceptVersionId),
    fromConceptIdx: index("project_concept_relationships_from_concept_idx").on(table.fromConceptId),
    toConceptIdx: index("project_concept_relationships_to_concept_idx").on(table.toConceptId),
    fromConceptProjectFk: foreignKey({
      name: "project_concept_relationships_from_concept_project_fk",
      columns: [table.fromConceptId, table.projectId, table.conceptVersionId],
      foreignColumns: [projectConcepts.id, projectConcepts.projectId, projectConcepts.conceptVersionId],
    }).onDelete("cascade"),
    toConceptProjectFk: foreignKey({
      name: "project_concept_relationships_to_concept_project_fk",
      columns: [table.toConceptId, table.projectId, table.conceptVersionId],
      foreignColumns: [projectConcepts.id, projectConcepts.projectId, projectConcepts.conceptVersionId],
    }).onDelete("cascade"),
  }),
);
```

- [ ] **Step 4: Add schema typecheck references**

In `packages/db/src/schema.typecheck.ts`, import and reference the new tables using the same type-level pattern as project graph tables:

```ts
import {
  projectConceptMemberships,
  projectConceptRelationships,
  projectConceptVersions,
  projectConcepts
} from "./schema.js";

type ProjectConceptVersionSelect = typeof projectConceptVersions.$inferSelect;
type ProjectConceptVersionInsert = typeof projectConceptVersions.$inferInsert;
type ProjectConceptSelect = typeof projectConcepts.$inferSelect;
type ProjectConceptInsert = typeof projectConcepts.$inferInsert;
type ProjectConceptMembershipSelect = typeof projectConceptMemberships.$inferSelect;
type ProjectConceptRelationshipSelect = typeof projectConceptRelationships.$inferSelect;

type _ProjectConceptVersionStatusIsString = Expect<Equal<ProjectConceptVersionSelect["status"], string>>;
type _ProjectConceptConfidenceIsNumber = Expect<Equal<ProjectConceptSelect["confidence"], number>>;
type _ProjectConceptMembershipRoleIsString = Expect<Equal<ProjectConceptMembershipSelect["role"], string>>;
type _ProjectConceptRelationshipTypeIsString = Expect<Equal<ProjectConceptRelationshipSelect["relationshipType"], string>>;

const projectConceptVersionInsert = null as unknown as ProjectConceptVersionInsert;
const projectConceptInsert = null as unknown as ProjectConceptInsert;
const projectConceptMembershipSelect = null as unknown as ProjectConceptMembershipSelect;
const projectConceptRelationshipSelect = null as unknown as ProjectConceptRelationshipSelect;
void projectConceptVersionInsert;
void projectConceptInsert;
void projectConceptMembershipSelect;
void projectConceptRelationshipSelect;
```

Adjust the existing import block instead of adding a duplicate import if the file already imports from `./schema.js`.

- [ ] **Step 5: Add SQL migration**

In `packages/db/migrations/0000_initial.sql`, add SQL after the project graph tables and indexes. Use this shape:

```sql
CREATE TABLE IF NOT EXISTS "project_concept_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_graph_version_id" uuid NOT NULL REFERENCES "project_graph_versions"("id") ON DELETE cascade,
  "status" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "coverage_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "diagnostics_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_concept_versions_id_project_id_unique" UNIQUE("id","project_id")
);

CREATE TABLE IF NOT EXISTS "project_concepts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "concept_version_id" uuid NOT NULL REFERENCES "project_concept_versions"("id") ON DELETE cascade,
  "concept_key" text NOT NULL,
  "concept_type" text NOT NULL,
  "name" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "confidence" double precision NOT NULL,
  "provenance" text NOT NULL,
  "evidence_summary" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_concepts_version_key_unique" UNIQUE("concept_version_id","concept_key"),
  CONSTRAINT "project_concepts_id_project_id_unique" UNIQUE("id","project_id"),
  CONSTRAINT "project_concepts_id_project_id_concept_version_id_unique" UNIQUE("id","project_id","concept_version_id")
);

CREATE TABLE IF NOT EXISTS "project_concept_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "concept_version_id" uuid NOT NULL REFERENCES "project_concept_versions"("id") ON DELETE cascade,
  "concept_id" uuid NOT NULL,
  "graph_node_id" uuid NOT NULL,
  "role" text NOT NULL,
  "confidence" double precision NOT NULL,
  "rationale" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_concept_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "concept_version_id" uuid NOT NULL REFERENCES "project_concept_versions"("id") ON DELETE cascade,
  "from_concept_id" uuid NOT NULL,
  "to_concept_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "confidence" double precision NOT NULL,
  "rationale" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "project_concept_versions" DROP CONSTRAINT IF EXISTS "project_concept_versions_graph_version_project_fk";
ALTER TABLE "project_concept_versions"
  ADD CONSTRAINT "project_concept_versions_graph_version_project_fk"
  FOREIGN KEY ("project_graph_version_id","project_id") REFERENCES "project_graph_versions"("id","project_id") ON DELETE cascade;

ALTER TABLE "project_concepts" DROP CONSTRAINT IF EXISTS "project_concepts_version_project_fk";
ALTER TABLE "project_concepts"
  ADD CONSTRAINT "project_concepts_version_project_fk"
  FOREIGN KEY ("concept_version_id","project_id") REFERENCES "project_concept_versions"("id","project_id") ON DELETE cascade;

ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_concept_project_fk";
ALTER TABLE "project_concept_memberships"
  ADD CONSTRAINT "project_concept_memberships_concept_project_fk"
  FOREIGN KEY ("concept_id","project_id","concept_version_id") REFERENCES "project_concepts"("id","project_id","concept_version_id") ON DELETE cascade;

ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_graph_node_project_fk";
ALTER TABLE "project_concept_memberships"
  ADD CONSTRAINT "project_concept_memberships_graph_node_project_fk"
  FOREIGN KEY ("graph_node_id","project_id") REFERENCES "project_graph_nodes"("id","project_id") ON DELETE cascade;

ALTER TABLE "project_concept_relationships" DROP CONSTRAINT IF EXISTS "project_concept_relationships_from_concept_project_fk";
ALTER TABLE "project_concept_relationships"
  ADD CONSTRAINT "project_concept_relationships_from_concept_project_fk"
  FOREIGN KEY ("from_concept_id","project_id","concept_version_id") REFERENCES "project_concepts"("id","project_id","concept_version_id") ON DELETE cascade;

ALTER TABLE "project_concept_relationships" DROP CONSTRAINT IF EXISTS "project_concept_relationships_to_concept_project_fk";
ALTER TABLE "project_concept_relationships"
  ADD CONSTRAINT "project_concept_relationships_to_concept_project_fk"
  FOREIGN KEY ("to_concept_id","project_id","concept_version_id") REFERENCES "project_concepts"("id","project_id","concept_version_id") ON DELETE cascade;

CREATE INDEX IF NOT EXISTS "project_concept_versions_project_id_idx"
  ON "project_concept_versions" ("project_id");
CREATE INDEX IF NOT EXISTS "project_concept_versions_project_status_created_idx"
  ON "project_concept_versions" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "project_concept_versions_graph_version_id_idx"
  ON "project_concept_versions" ("project_graph_version_id");
CREATE INDEX IF NOT EXISTS "project_concepts_concept_version_id_idx"
  ON "project_concepts" ("concept_version_id");
CREATE INDEX IF NOT EXISTS "project_concepts_version_type_idx"
  ON "project_concepts" ("concept_version_id","concept_type");
CREATE INDEX IF NOT EXISTS "project_concepts_project_status_idx"
  ON "project_concepts" ("project_id","status");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_concept_version_id_idx"
  ON "project_concept_memberships" ("concept_version_id");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_concept_id_idx"
  ON "project_concept_memberships" ("concept_id");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_graph_node_id_idx"
  ON "project_concept_memberships" ("graph_node_id");
CREATE INDEX IF NOT EXISTS "project_concept_relationships_concept_version_id_idx"
  ON "project_concept_relationships" ("concept_version_id");
CREATE INDEX IF NOT EXISTS "project_concept_relationships_from_concept_idx"
  ON "project_concept_relationships" ("from_concept_id");
CREATE INDEX IF NOT EXISTS "project_concept_relationships_to_concept_idx"
  ON "project_concept_relationships" ("to_concept_id");
```

- [ ] **Step 6: Run DB tests**

Run:

```bash
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit DB schema**

Run:

```bash
git add packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add concept graph storage"
```

---

### Task 3: AI Concept Prompt And Provider Plumbing

**Files:**
- Modify: `packages/ai-prefill/src/types.ts`
- Modify: `packages/ai-prefill/src/providers.ts`
- Create: `packages/ai-prefill/src/concepts.ts`
- Create: `packages/ai-prefill/src/__tests__/concepts.test.ts`
- Modify: `packages/ai-prefill/src/index.ts`

- [ ] **Step 1: Write failing AI concept tests**

Create `packages/ai-prefill/src/__tests__/concepts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildConceptGraphPromptPacket,
  normalizeConceptGraphProviderResponse
} from "../concepts.js";

const graphNode = {
  id: "00000000-0000-4000-8000-000000000001",
  nodeKey: "file:src/checkout.ts",
  nodeType: "file",
  label: "checkout.ts",
  path: "src/checkout.ts"
};

describe("concept graph prompt helpers", () => {
  it("builds a bounded prompt packet from graph facts", () => {
    const packet = buildConceptGraphPromptPacket({
      project: { id: "project-1", name: "Checkout" },
      graph: {
        versionId: "graph-1",
        summary: "Graph with checkout facts.",
        nodes: [graphNode],
        edges: []
      },
      limits: { maxGraphNodes: 10, maxGraphEdges: 20 }
    });

    expect(packet.promptVersion).toBe("concept-graph-v1");
    expect(packet.messages[0]?.role).toBe("system");
    expect(packet.messages[1]?.content).toContain("src/checkout.ts");
  });

  it("normalizes concepts and rejects unsupported memberships", () => {
    const normalized = normalizeConceptGraphProviderResponse({
      text: JSON.stringify({
        concepts: [
          {
            key: "workflow:checkout",
            type: "workflow",
            name: "Checkout",
            summary: "Handles checkout.",
            confidence: 0.92,
            evidenceSummary: "Supported by checkout service.",
            memberships: [
              {
                graphNodeId: graphNode.id,
                role: "primary",
                confidence: 0.9,
                rationale: "Primary implementation file."
              },
              {
                graphNodeId: "missing-node",
                role: "supporting",
                confidence: 0.9,
                rationale: "Unsupported."
              }
            ]
          },
          {
            key: "workflow:unsupported",
            type: "workflow",
            name: "Unsupported",
            summary: "No valid evidence.",
            confidence: 0.9,
            evidenceSummary: "No supported node.",
            memberships: []
          }
        ],
        relationships: []
      }),
      graphNodeIds: new Set([graphNode.id]),
      graphNodeKeys: new Map([[graphNode.nodeKey, graphNode.id]])
    });

    expect(normalized.concepts).toHaveLength(1);
    expect(normalized.concepts[0]?.memberships).toHaveLength(1);
    expect(normalized.diagnostics.some((diagnostic) => diagnostic.code === "unsupported_membership")).toBe(true);
    expect(normalized.rejectedConceptCount).toBe(1);
    expect(normalized.rejectedMembershipCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run AI test to verify it fails**

Run:

```bash
pnpm --filter @specops/ai-prefill test -- concepts.test.ts
```

Expected: FAIL with an import error for `../concepts.js`.

- [ ] **Step 3: Extend provider types**

In `packages/ai-prefill/src/types.ts`, add:

```ts
export type ConceptGraphPromptPacket = {
  promptVersion: "concept-graph-v1";
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export type ConceptGraphProviderInput = {
  packet: ConceptGraphPromptPacket;
  model: string;
  temperature: number;
};
```

Then change `AiPrefillProvider` to include:

```ts
generateConceptGraph(input: ConceptGraphProviderInput): Promise<AiPrefillProviderResult>;
```

- [ ] **Step 4: Implement provider call**

In `packages/ai-prefill/src/providers.ts`, add `generateConceptGraph` to both returned provider objects. For Ollama:

```ts
async generateConceptGraph(providerInput) {
  const json = await postJson({
    url: `${baseUrl}/api/chat`,
    timeoutMs,
    body: {
      model: providerInput.model,
      messages: providerInput.packet.messages,
      stream: false,
      format: "json",
      options: { temperature: providerInput.temperature }
    }
  });

  const text = readOllamaMessageContent(json);
  return result(input.provider, providerInput.model, text);
}
```

For OpenAI:

```ts
async generateConceptGraph(providerInput) {
  const json = await postJson({
    url: `${baseUrl}/chat/completions`,
    timeoutMs,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model: providerInput.model,
      messages: providerInput.packet.messages,
      temperature: providerInput.temperature,
      response_format: { type: "json_object" }
    }
  });

  const text = readOpenAiMessageContent(json);
  return result(input.provider, providerInput.model, text);
}
```

- [ ] **Step 5: Add concept prompt and normalizer**

Create `packages/ai-prefill/src/concepts.ts`:

```ts
import type { ConceptGraphPromptPacket } from "./types.js";

export type ConceptGraphPromptNode = {
  id: string;
  nodeKey: string;
  nodeType: string;
  label: string;
  path: string | null;
};

export type ConceptGraphPromptEdge = {
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
};

export type BuildConceptGraphPromptPacketInput = {
  project: { id: string; name: string };
  graph: {
    versionId: string;
    summary: string;
    nodes: ConceptGraphPromptNode[];
    edges: ConceptGraphPromptEdge[];
  };
  limits: { maxGraphNodes: number; maxGraphEdges: number };
};

export type NormalizedConceptGraph = {
  concepts: NormalizedConcept[];
  relationships: NormalizedConceptRelationship[];
  diagnostics: Array<{ level: "info" | "warning" | "error"; code: string; message: string }>;
  rejectedConceptCount: number;
  rejectedMembershipCount: number;
};

export type NormalizedConcept = {
  key: string;
  type: string;
  name: string;
  summary: string;
  confidence: number;
  evidenceSummary: string;
  memberships: NormalizedConceptMembership[];
};

export type NormalizedConceptMembership = {
  graphNodeId: string;
  role: string;
  confidence: number;
  rationale: string;
};

export type NormalizedConceptRelationship = {
  fromConceptKey: string;
  toConceptKey: string;
  relationshipType: string;
  confidence: number;
  rationale: string;
};

export function buildConceptGraphPromptPacket(input: BuildConceptGraphPromptPacketInput): ConceptGraphPromptPacket {
  const boundedNodes = input.graph.nodes.slice(0, input.limits.maxGraphNodes);
  const boundedEdges = input.graph.edges.slice(0, input.limits.maxGraphEdges);
  const payload = {
    project: input.project,
    graph: {
      versionId: input.graph.versionId,
      summary: input.graph.summary,
      nodes: boundedNodes,
      edges: boundedEdges
    },
    instructions: {
      conceptTypes: ["workflow", "subsystem", "domain_concept", "interface", "data_flow", "test_behavior", "cross_cutting", "unknown"],
      membershipRoles: ["primary", "supporting", "entrypoint", "data", "test", "spec"],
      relationshipTypes: ["depends_on", "uses", "implements", "exposes", "tests", "relates_to"],
      evidenceRule: "Every concept must include at least one membership referencing a supplied graph node id or node key.",
      outputShape: {
        concepts: "array",
        relationships: "array"
      }
    }
  };

  return {
    promptVersion: "concept-graph-v1",
    messages: [
      {
        role: "system",
        content: "You consolidate deterministic project graph facts into higher-level project concepts. Return only JSON."
      },
      {
        role: "user",
        content: JSON.stringify(payload)
      }
    ]
  };
}

export function normalizeConceptGraphProviderResponse(input: {
  text: string;
  graphNodeIds: Set<string>;
  graphNodeKeys: Map<string, string>;
}): NormalizedConceptGraph {
  const diagnostics: NormalizedConceptGraph["diagnostics"] = [];
  let rejectedConceptCount = 0;
  let rejectedMembershipCount = 0;
  const parsed = parseJsonObject(input.text);
  const rawConcepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  const concepts: NormalizedConcept[] = [];
  const acceptedKeys = new Set<string>();

  for (const rawConcept of rawConcepts) {
    const record = isRecord(rawConcept) ? rawConcept : {};
    const key = readString(record.key) || conceptKey(readString(record.type), readString(record.name));
    const memberships = normalizeMemberships(record.memberships, input.graphNodeIds, input.graphNodeKeys, diagnostics);
    rejectedMembershipCount += countRawMemberships(record.memberships) - memberships.length;
    if (memberships.length === 0) {
      rejectedConceptCount += 1;
      diagnostics.push({ level: "warning", code: "concept_without_membership", message: `Rejected concept ${key} because it has no supported graph membership.` });
      continue;
    }

    const concept: NormalizedConcept = {
      key,
      type: readString(record.type) || "unknown",
      name: readString(record.name) || key,
      summary: readString(record.summary),
      confidence: clampConfidence(readNumber(record.confidence), memberships),
      evidenceSummary: readString(record.evidenceSummary),
      memberships
    };
    concepts.push(concept);
    acceptedKeys.add(concept.key);
  }

  const relationships = normalizeRelationships(parsed.relationships, acceptedKeys, diagnostics);

  return { concepts, relationships, diagnostics, rejectedConceptCount, rejectedMembershipCount };
}

function normalizeMemberships(
  value: unknown,
  graphNodeIds: Set<string>,
  graphNodeKeys: Map<string, string>,
  diagnostics: NormalizedConceptGraph["diagnostics"]
): NormalizedConceptMembership[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = isRecord(item) ? item : {};
    const explicitId = readString(record.graphNodeId);
    const keyId = graphNodeKeys.get(readString(record.graphNodeKey));
    const graphNodeId = explicitId || keyId || "";
    if (!graphNodeIds.has(graphNodeId)) {
      diagnostics.push({ level: "warning", code: "unsupported_membership", message: "Dropped membership that did not reference a supplied graph node." });
      return [];
    }
    return [{
      graphNodeId,
      role: readString(record.role) || "supporting",
      confidence: clamp(readNumber(record.confidence), 0, 1, 0.5),
      rationale: readString(record.rationale)
    }];
  });
}

function normalizeRelationships(value: unknown, acceptedKeys: Set<string>, diagnostics: NormalizedConceptGraph["diagnostics"]): NormalizedConceptRelationship[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = isRecord(item) ? item : {};
    const fromConceptKey = readString(record.fromConceptKey);
    const toConceptKey = readString(record.toConceptKey);
    if (!acceptedKeys.has(fromConceptKey) || !acceptedKeys.has(toConceptKey)) {
      diagnostics.push({ level: "warning", code: "unsupported_relationship", message: "Dropped relationship that referenced an unknown concept." });
      return [];
    }
    return [{
      fromConceptKey,
      toConceptKey,
      relationshipType: readString(record.relationshipType) || "relates_to",
      confidence: clamp(readNumber(record.confidence), 0, 1, 0.5),
      rationale: readString(record.rationale)
    }];
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function countRawMemberships(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function clampConfidence(value: number | null, memberships: NormalizedConceptMembership[]): number {
  const base = clamp(value, 0, 1, 0.5);
  const maxMembership = Math.max(...memberships.map((membership) => membership.confidence), 0.5);
  return Math.min(base, maxMembership);
}

function conceptKey(type: string, name: string): string {
  return `${type || "unknown"}:${(name || "unnamed").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 6: Export concept helpers**

Modify `packages/ai-prefill/src/index.ts` and add:

```ts
export * from "./concepts.js";
```

- [ ] **Step 7: Run AI package tests**

Run:

```bash
pnpm --filter @specops/ai-prefill test -- concepts.test.ts
pnpm --filter @specops/ai-prefill typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit AI concept helpers**

Run:

```bash
git add packages/ai-prefill/src/types.ts packages/ai-prefill/src/providers.ts packages/ai-prefill/src/concepts.ts packages/ai-prefill/src/__tests__/concepts.test.ts packages/ai-prefill/src/index.ts
git commit -m "feat: add AI concept graph normalization"
```

---

### Task 4: Concept Graph Service

**Files:**
- Create: `apps/api/src/services/concept-graph-service.ts`
- Create: `apps/api/src/__tests__/concept-graph-service.test.ts`

- [ ] **Step 1: Write service tests**

Create `apps/api/src/__tests__/concept-graph-service.test.ts` with DB-backed tests that:

```ts
import { describe, expect, it, vi } from "vitest";

import { projectGraphNodes, projectGraphVersions, projects } from "@specops/db";
import type { AiPrefillProvider } from "@specops/ai-prefill";

import { describeWithDb } from "@specops/testing";
import { createConceptGraphService } from "../services/concept-graph-service.js";

describeWithDb("createConceptGraphService", ({ getDb }) => {
  it("builds a concept graph from the latest project graph", async () => {
    const db = getDb();
    const project = await insertProject(db);
    const graph = await insertGraph(db, project.id);
    const provider: AiPrefillProvider = {
      generateSpecProposals: vi.fn(),
      generateConceptGraph: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4.1-mini",
        text: JSON.stringify({
          concepts: [
            {
              key: "workflow:checkout",
              type: "workflow",
              name: "Checkout",
              summary: "Handles checkout.",
              confidence: 0.9,
              evidenceSummary: "Supported by checkout.ts.",
              memberships: [
                {
                  graphNodeId: graph.nodeId,
                  role: "primary",
                  confidence: 0.9,
                  rationale: "Primary file."
                }
              ]
            }
          ],
          relationships: []
        })
      })
    };

    const service = createConceptGraphService(db, {
      config: {
        openAiApiKey: "test",
        openAiBaseUrl: "http://example.test",
        ollamaBaseUrl: "http://127.0.0.1:11434",
        timeoutMs: 1000,
        maxFiles: 5,
        maxTotalBytes: 100000
      },
      providerFactory: () => provider
    });

    const built = await service.buildConceptGraph(project.id, {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 50,
      maxGraphEdges: 100
    });

    expect(built.version.status).toBe("ready");
    expect(built.concepts[0]?.name).toBe("Checkout");
    expect(built.membershipCounts.primary).toBe(1);
  });

  it("rejects unsupported concepts and records diagnostics", async () => {
    const db = getDb();
    const project = await insertProject(db);
    await insertGraph(db, project.id);
    const provider: AiPrefillProvider = {
      generateSpecProposals: vi.fn(),
      generateConceptGraph: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4.1-mini",
        text: JSON.stringify({
          concepts: [
            {
              key: "workflow:unsupported",
              type: "workflow",
              name: "Unsupported",
              summary: "Unsupported.",
              confidence: 0.9,
              evidenceSummary: "No evidence.",
              memberships: []
            }
          ],
          relationships: []
        })
      })
    };

    const service = createConceptGraphService(db, {
      config: testAiConfig(),
      providerFactory: () => provider
    });

    const built = await service.buildConceptGraph(project.id, {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 50,
      maxGraphEdges: 100
    });

    expect(built.version.status).toBe("limited");
    expect(built.concepts).toHaveLength(0);
    expect(built.version.coverage.rejectedConceptCount).toBe(1);
  });
});
```

Add local helper functions in the same test file:

```ts
async function insertProject(db: any) {
  const [project] = await db.insert(projects).values({
    name: "Checkout",
    slug: `checkout-${crypto.randomUUID()}`,
    repoPath: "/tmp/specops-checkout",
    specopsPath: "/tmp/specops-checkout/specops"
  }).returning();
  return project!;
}

async function insertGraph(db: any, projectId: string) {
  const [version] = await db.insert(projectGraphVersions).values({
    projectId,
    indexRunId: null,
    status: "ready",
    summary: "Graph with checkout node.",
    coverageJson: { nodeCounts: { file: 1 }, edgeCounts: {}, sourceFileCount: 1, specEntityCount: 0, unresolvedImportCount: 0, heuristicEdgeCount: 0 },
    diagnosticsJson: []
  }).returning();
  const [node] = await db.insert(projectGraphNodes).values({
    projectId,
    graphVersionId: version!.id,
    nodeKey: "file:src/checkout.ts",
    nodeType: "file",
    label: "checkout.ts",
    path: "src/checkout.ts",
    sourceRefJson: {},
    metadataJson: {},
    confidence: 1
  }).returning();
  return { versionId: version!.id, nodeId: node!.id };
}

function testAiConfig() {
  return {
    provider: "openai" as const,
    openAiApiKey: "test",
    openAiBaseUrl: "http://example.test",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    timeoutMs: 1000,
    maxFiles: 5,
    maxTotalBytes: 100000
  };
}
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```bash
pnpm --filter api test -- concept-graph-service.test.ts
```

Expected: FAIL with an import error for `concept-graph-service.js`.

- [ ] **Step 3: Implement concept graph service**

Create `apps/api/src/services/concept-graph-service.ts` with:

```ts
import type {
  BuildConceptGraphRequest,
  ConceptDetailResponse,
  ConceptGraphCoverage,
  ConceptGraphDiagnostic,
  ConceptGraphLatestResponse,
  ProjectConceptDto,
  ProjectConceptMembershipDto,
  ProjectConceptRelationshipDto,
  ProjectConceptVersionDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  projectConceptMemberships,
  projectConceptRelationships,
  projectConceptVersions,
  projectConcepts,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions
} from "@specops/db";
import {
  buildConceptGraphPromptPacket,
  createAiPrefillProvider,
  normalizeConceptGraphProviderResponse
} from "@specops/ai-prefill";
import type { AiPrefillProvider, CreateAiPrefillProviderInput } from "@specops/ai-prefill";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { ApiConfig } from "../config.js";
import { BadGatewayError, BadRequestError, NotFoundError } from "../lib/http-errors.js";

type AiPrefillConfig = ApiConfig["aiPrefill"];
type ProviderFactory = (input: CreateAiPrefillProviderInput) => AiPrefillProvider;

export function createConceptGraphService(
  db: Db,
  options: { config: AiPrefillConfig; providerFactory?: ProviderFactory }
) {
  async function buildConceptGraph(
    projectId: string,
    input: BuildConceptGraphRequest
  ): Promise<ConceptGraphLatestResponse> {
    const graphVersion = await getLatestProjectGraphVersion(projectId);
    const graphNodes = await db.select().from(projectGraphNodes).where(eq(projectGraphNodes.graphVersionId, graphVersion.id)).limit(input.maxGraphNodes);
    const graphEdges = await db.select().from(projectGraphEdges).where(eq(projectGraphEdges.graphVersionId, graphVersion.id)).limit(input.maxGraphEdges);

    if (graphNodes.length === 0) {
      return persistConceptVersion({
        projectId,
        graphVersionId: graphVersion.id,
        provider: input.provider,
        model: input.model,
        promptVersion: "concept-graph-v1",
        status: "limited",
        summary: "Limited concept graph: no graph nodes were available.",
        concepts: [],
        relationships: [],
        diagnostics: [{ level: "warning", code: "limited_graph_evidence", message: "No graph nodes were available for concept consolidation." }],
        rejectedConceptCount: 0,
        rejectedMembershipCount: 0
      });
    }

    const packet = buildConceptGraphPromptPacket({
      project: { id: projectId, name: projectId },
      graph: {
        versionId: graphVersion.id,
        summary: graphVersion.summary,
        nodes: graphNodes.map((node) => ({
          id: node.id,
          nodeKey: node.nodeKey,
          nodeType: node.nodeType,
          label: node.label,
          path: node.path
        })),
        edges: graphEdges.map((edge) => ({
          edgeType: edge.edgeType,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId
        }))
      },
      limits: { maxGraphNodes: input.maxGraphNodes, maxGraphEdges: input.maxGraphEdges }
    });

    const provider = createProvider(input.provider);
    let providerResult;
    try {
      providerResult = await provider.generateConceptGraph({
        packet,
        model: input.model,
        temperature: input.temperature
      });
    } catch (error) {
      throw new BadGatewayError("Concept graph provider request failed", { message: errorMessage(error) });
    }

    const normalized = normalizeConceptGraphProviderResponse({
      text: providerResult.text,
      graphNodeIds: new Set(graphNodes.map((node) => node.id)),
      graphNodeKeys: new Map(graphNodes.map((node) => [node.nodeKey, node.id]))
    });

    const status = normalized.concepts.length === 0 ? "limited" : "ready";
    return persistConceptVersion({
      projectId,
      graphVersionId: graphVersion.id,
      provider: providerResult.provider,
      model: providerResult.model,
      promptVersion: packet.promptVersion,
      status,
      summary: status === "ready" ? `Concept graph with ${normalized.concepts.length} concepts.` : "Limited concept graph: no supported concepts were produced.",
      concepts: normalized.concepts,
      relationships: normalized.relationships,
      diagnostics: normalized.diagnostics,
      rejectedConceptCount: normalized.rejectedConceptCount,
      rejectedMembershipCount: normalized.rejectedMembershipCount
    });
  }

  async function getLatestConceptGraph(projectId: string): Promise<ConceptGraphLatestResponse> {
    const [version] = await db.select().from(projectConceptVersions)
      .where(and(eq(projectConceptVersions.projectId, projectId), inArray(projectConceptVersions.status, ["ready", "limited", "failed"])))
      .orderBy(desc(projectConceptVersions.createdAt), desc(projectConceptVersions.id))
      .limit(1);
    if (!version) throw new NotFoundError("Concept graph not found", { projectId });
    return readConceptGraph(version.id, projectId);
  }

  async function getConceptDetail(projectId: string, conceptId: string): Promise<ConceptDetailResponse> {
    const [concept] = await db.select().from(projectConcepts)
      .where(and(eq(projectConcepts.projectId, projectId), eq(projectConcepts.id, conceptId)))
      .limit(1);
    if (!concept) throw new NotFoundError("Concept not found", { projectId, conceptId });
    const [memberships, incoming, outgoing] = await Promise.all([
      db.select().from(projectConceptMemberships).where(eq(projectConceptMemberships.conceptId, conceptId)),
      db.select().from(projectConceptRelationships).where(eq(projectConceptRelationships.toConceptId, conceptId)),
      db.select().from(projectConceptRelationships).where(eq(projectConceptRelationships.fromConceptId, conceptId))
    ]);
    const graphNodeIds = memberships.map((membership) => membership.graphNodeId);
    const relatedIds = [...new Set([...incoming.map((rel) => rel.fromConceptId), ...outgoing.map((rel) => rel.toConceptId)])];
    const graphNodes = graphNodeIds.length === 0 ? [] : await db.select().from(projectGraphNodes).where(inArray(projectGraphNodes.id, graphNodeIds));
    const relatedConcepts = relatedIds.length === 0 ? [] : await db.select().from(projectConcepts).where(inArray(projectConcepts.id, relatedIds));
    return {
      concept: mapConcept(concept),
      memberships: memberships.map(mapMembership),
      graphNodes: graphNodes.map((node) => ({ ...node, sourceRef: node.sourceRefJson, metadata: node.metadataJson })),
      incomingRelationships: groupRelationships(incoming.map(mapRelationship)),
      outgoingRelationships: groupRelationships(outgoing.map(mapRelationship)),
      relatedConcepts: relatedConcepts.map(mapConcept)
    };
  }

  async function getLatestProjectGraphVersion(projectId: string) {
    const [version] = await db.select().from(projectGraphVersions)
      .where(and(eq(projectGraphVersions.projectId, projectId), inArray(projectGraphVersions.status, ["ready", "limited"])))
      .orderBy(desc(projectGraphVersions.createdAt), desc(projectGraphVersions.id))
      .limit(1);
    if (!version) throw new BadRequestError("Project graph is required before concept consolidation", { projectId });
    return version;
  }

  async function persistConceptVersion(input: {
    projectId: string;
    graphVersionId: string;
    provider: string;
    model: string;
    promptVersion: string;
    status: "ready" | "limited" | "failed";
    summary: string;
    concepts: Array<import("@specops/ai-prefill").NormalizedConcept>;
    relationships: Array<import("@specops/ai-prefill").NormalizedConceptRelationship>;
    diagnostics: ConceptGraphDiagnostic[];
    rejectedConceptCount: number;
    rejectedMembershipCount: number;
  }): Promise<ConceptGraphLatestResponse> {
    return db.transaction(async (tx) => {
      await tx.update(projectConceptVersions)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(and(eq(projectConceptVersions.projectId, input.projectId), inArray(projectConceptVersions.status, ["ready", "limited"])));
      const coverage = buildCoverage(input);
      const [version] = await tx.insert(projectConceptVersions).values({
        projectId: input.projectId,
        projectGraphVersionId: input.graphVersionId,
        status: input.status,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        summary: input.summary,
        coverageJson: coverage,
        diagnosticsJson: input.diagnostics
      }).returning();
      if (!version) throw new Error("Failed to create concept graph version");

      const insertedConcepts = input.concepts.length === 0 ? [] : await tx.insert(projectConcepts).values(input.concepts.map((concept) => ({
        projectId: input.projectId,
        conceptVersionId: version.id,
        conceptKey: concept.key,
        conceptType: concept.type,
        name: concept.name,
        summary: concept.summary,
        confidence: concept.confidence,
        provenance: "ai",
        evidenceSummary: concept.evidenceSummary,
        status: "active",
        metadataJson: {}
      }))).returning();
      const conceptIdsByKey = new Map(insertedConcepts.map((concept) => [concept.conceptKey, concept.id]));

      const membershipRows = input.concepts.flatMap((concept) => concept.memberships.map((membership) => ({
        projectId: input.projectId,
        conceptVersionId: version.id,
        conceptId: conceptIdsByKey.get(concept.key)!,
        graphNodeId: membership.graphNodeId,
        role: membership.role,
        confidence: membership.confidence,
        rationale: membership.rationale
      })));
      if (membershipRows.length > 0) await tx.insert(projectConceptMemberships).values(membershipRows);

      const relationshipRows = input.relationships.flatMap((relationship) => {
        const fromConceptId = conceptIdsByKey.get(relationship.fromConceptKey);
        const toConceptId = conceptIdsByKey.get(relationship.toConceptKey);
        return fromConceptId && toConceptId ? [{
          projectId: input.projectId,
          conceptVersionId: version.id,
          fromConceptId,
          toConceptId,
          relationshipType: relationship.relationshipType,
          confidence: relationship.confidence,
          rationale: relationship.rationale
        }] : [];
      });
      if (relationshipRows.length > 0) await tx.insert(projectConceptRelationships).values(relationshipRows);

      return readConceptGraph(version.id, input.projectId);
    });
  }

  async function readConceptGraph(versionId: string, projectId: string): Promise<ConceptGraphLatestResponse> {
    const [version] = await db.select().from(projectConceptVersions).where(eq(projectConceptVersions.id, versionId)).limit(1);
    if (!version || version.projectId !== projectId) throw new NotFoundError("Concept graph not found", { projectId, versionId });
    const concepts = await db.select().from(projectConcepts).where(eq(projectConcepts.conceptVersionId, version.id));
    return {
      version: mapVersion(version),
      conceptCounts: readCoverage(version.coverageJson).conceptCounts,
      membershipCounts: readCoverage(version.coverageJson).membershipCounts,
      relationshipCounts: readCoverage(version.coverageJson).relationshipCounts,
      concepts: concepts.map(mapConcept),
      diagnostics: readDiagnostics(version.diagnosticsJson)
    };
  }

  function createProvider(provider: BuildConceptGraphRequest["provider"]) {
    return (options.providerFactory ?? createAiPrefillProvider)({
      provider,
      ollamaBaseUrl: options.config.ollamaBaseUrl,
      openAiApiKey: options.config.openAiApiKey,
      openAiBaseUrl: options.config.openAiBaseUrl,
      timeoutMs: options.config.timeoutMs
    });
  }

  return { buildConceptGraph, getLatestConceptGraph, getConceptDetail };
}
```

Add local mapper helpers at the bottom of the file:

```ts
function buildCoverage(input: {
  concepts: Array<import("@specops/ai-prefill").NormalizedConcept>;
  relationships: Array<import("@specops/ai-prefill").NormalizedConceptRelationship>;
  rejectedConceptCount: number;
  rejectedMembershipCount: number;
}): ConceptGraphCoverage {
  return {
    conceptCounts: countBy(input.concepts, (concept) => concept.type),
    membershipCounts: countBy(input.concepts.flatMap((concept) => concept.memberships), (membership) => membership.role),
    relationshipCounts: countBy(input.relationships, (relationship) => relationship.relationshipType),
    rejectedConceptCount: input.rejectedConceptCount,
    rejectedMembershipCount: input.rejectedMembershipCount,
    graphNodeCoverageCount: new Set(input.concepts.flatMap((concept) => concept.memberships.map((membership) => membership.graphNodeId))).size,
    lowConfidenceConceptCount: input.concepts.filter((concept) => concept.confidence < 0.6).length
  };
}

function countBy<T>(items: T[], readKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = readKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function mapVersion(row: typeof projectConceptVersions.$inferSelect): ProjectConceptVersionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectGraphVersionId: row.projectGraphVersionId,
    status: row.status as ProjectConceptVersionDto["status"],
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    summary: row.summary,
    coverage: readCoverage(row.coverageJson),
    diagnostics: readDiagnostics(row.diagnosticsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapConcept(row: typeof projectConcepts.$inferSelect): ProjectConceptDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conceptVersionId: row.conceptVersionId,
    conceptKey: row.conceptKey,
    conceptType: row.conceptType as ProjectConceptDto["conceptType"],
    name: row.name,
    summary: row.summary,
    confidence: row.confidence,
    provenance: row.provenance as "ai",
    evidenceSummary: row.evidenceSummary,
    status: row.status as ProjectConceptDto["status"],
    metadata: isRecord(row.metadataJson) ? row.metadataJson : {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapMembership(row: typeof projectConceptMemberships.$inferSelect): ProjectConceptMembershipDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conceptVersionId: row.conceptVersionId,
    conceptId: row.conceptId,
    graphNodeId: row.graphNodeId,
    role: row.role as ProjectConceptMembershipDto["role"],
    confidence: row.confidence,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString()
  };
}

function mapRelationship(row: typeof projectConceptRelationships.$inferSelect): ProjectConceptRelationshipDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conceptVersionId: row.conceptVersionId,
    fromConceptId: row.fromConceptId,
    toConceptId: row.toConceptId,
    relationshipType: row.relationshipType as ProjectConceptRelationshipDto["relationshipType"],
    confidence: row.confidence,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString()
  };
}

function groupRelationships(rows: ProjectConceptRelationshipDto[]) {
  return rows.reduce<Record<string, ProjectConceptRelationshipDto[]>>((groups, row) => {
    groups[row.relationshipType] = [...(groups[row.relationshipType] ?? []), row];
    return groups;
  }, {});
}

function readCoverage(value: unknown): ConceptGraphCoverage {
  return isRecord(value) ? value as ConceptGraphCoverage : {
    conceptCounts: {},
    membershipCounts: {},
    relationshipCounts: {},
    rejectedConceptCount: 0,
    rejectedMembershipCount: 0,
    graphNodeCoverageCount: 0,
    lowConfidenceConceptCount: 0
  };
}

function readDiagnostics(value: unknown): ConceptGraphDiagnostic[] {
  return Array.isArray(value) ? value as ConceptGraphDiagnostic[] : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter api test -- concept-graph-service.test.ts
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit service**

Run:

```bash
git add apps/api/src/services/concept-graph-service.ts apps/api/src/__tests__/concept-graph-service.test.ts
git commit -m "feat: build project concept graphs"
```

---

### Task 5: API Routes

**Files:**
- Create: `apps/api/src/routes/concept-graphs.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

In `apps/api/src/__tests__/routes.test.ts`, add route coverage inside `describeWithDb("database-backed routes", ...)`:

```ts
it("returns a clear error when building concepts before a project graph exists", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/concept-graphs`,
    payload: {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 50,
      maxGraphEdges: 100
    }
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({
    error: {
      code: "bad_request",
      message: "Project graph is required before concept consolidation"
    }
  });
});

it("returns not found when no concept graph has been built", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/concept-graphs/latest`
  });

  expect(response.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run route test to verify it fails**

Run:

```bash
pnpm --filter api test -- routes.test.ts
```

Expected: FAIL because concept graph routes are not registered.

- [ ] **Step 3: Add route plugin**

Create `apps/api/src/routes/concept-graphs.ts`:

```ts
import { buildConceptGraphRequestSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import type { AiPrefillProviderFactory } from "../services/ai-prefill-service.js";
import { createConceptGraphService } from "../services/concept-graph-service.js";
import { createProjectService } from "../services/project-service.js";

type RouteOptions = {
  db: Db;
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

const conceptParamsSchema = projectParamsSchema.extend({
  conceptId: z.string().uuid()
});

export const registerConceptGraphRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db, aiPrefillConfig, aiPrefillProviderFactory }
) => {
  const projectService = createProjectService(db);
  const conceptService = createConceptGraphService(db, {
    config: aiPrefillConfig,
    providerFactory: aiPrefillProviderFactory
  });

  app.post("/projects/:projectId/concept-graphs", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const body = buildConceptGraphRequestSchema.parse(request.body);
    await projectService.getProject(projectId);
    return conceptService.buildConceptGraph(projectId, body);
  });

  app.get("/projects/:projectId/concept-graphs/latest", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return conceptService.getLatestConceptGraph(projectId);
  });

  app.get("/projects/:projectId/concepts/:conceptId", async (request) => {
    const { projectId, conceptId } = conceptParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return conceptService.getConceptDetail(projectId, conceptId);
  });
};
```

- [ ] **Step 4: Register routes**

In `apps/api/src/server.ts`, import and register:

```ts
import { registerConceptGraphRoutes } from "./routes/concept-graphs.js";
```

Then in the route registration block, use the existing `buildServer` local variables:

```ts
app.register(registerConceptGraphRoutes, {
  prefix: "/api",
  db,
  aiPrefillConfig,
  aiPrefillProviderFactory: options.aiPrefillProviderFactory
});
```

- [ ] **Step 5: Run route and API typecheck**

Run:

```bash
pnpm --filter api test -- routes.test.ts
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit routes**

Run:

```bash
git add apps/api/src/routes/concept-graphs.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose concept graph API"
```

---

### Task 6: Web Query Helpers

**Files:**
- Modify: `apps/web/src/api/queries.ts`

- [ ] **Step 1: Add query tests or extend existing query tests**

In `apps/web/src/api/queries.test.ts`, add assertions for concept graph helpers:

```ts
it("builds concept graph query keys and URLs", async () => {
  expect(queryKeys.conceptGraph("project-1")).toEqual(["projects", "project-1", "concept-graph"]);
  expect(queryKeys.conceptDetail("project-1", "concept-1")).toEqual(["projects", "project-1", "concepts", "concept-1"]);
});
```

- [ ] **Step 2: Run query test to verify it fails**

Run:

```bash
pnpm --filter web test -- queries.test.ts
```

Expected: FAIL because the query keys are missing.

- [ ] **Step 3: Add web query helpers**

In `apps/web/src/api/queries.ts`, add imports:

```ts
import type {
  BuildConceptGraphRequest,
  ConceptDetailResponse,
  ConceptGraphLatestResponse
} from "@specops/contracts";
```

Add query keys:

```ts
conceptGraph: (projectId: string) => ["projects", projectId, "concept-graph"] as const,
conceptDetail: (projectId: string, conceptId: string | null) =>
  ["projects", projectId, "concepts", conceptId] as const,
```

Add helpers near project graph helpers:

```ts
export function conceptGraphQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.conceptGraph(projectId),
    queryFn: () =>
      apiGet<ConceptGraphLatestResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/concept-graphs/latest`
      )
  });
}

export function conceptDetailQuery(projectId: string, conceptId: string | null) {
  return queryOptions({
    queryKey: queryKeys.conceptDetail(projectId, conceptId),
    enabled: conceptId !== null,
    queryFn: () =>
      apiGet<ConceptDetailResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/concepts/${encodeURIComponent(conceptId ?? "")}`
      )
  });
}

export async function buildConceptGraph(projectId: string, input: BuildConceptGraphRequest) {
  return apiPost<ConceptGraphLatestResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/concept-graphs`,
    input
  );
}
```

- [ ] **Step 4: Run web query tests and typecheck**

Run:

```bash
pnpm --filter web test -- queries.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit query wiring**

Run:

```bash
git add apps/web/src/api/queries.ts apps/web/src/api/queries.test.ts
git commit -m "feat: wire concept graph web queries"
```

---

### Task 7: Concepts Inspection UI

**Files:**
- Create: `apps/web/src/routes/concepts.tsx`
- Create: `apps/web/src/routes/concepts.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/routes/project-graph.tsx`

- [ ] **Step 1: Write UI tests**

Create `apps/web/src/routes/concepts.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ConceptGraphLatestResponse } from "@specops/contracts";

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => ({ data: conceptGraphFixture(), isLoading: false, error: null })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>
}));

import { ConceptsPage } from "./concepts.js";

describe("ConceptsPage", () => {
  it("renders concept graph summary and concept list", () => {
    const html = renderToStaticMarkup(<ConceptsPage projectId="project-1" />);

    expect(html).toContain("Concepts");
    expect(html).toContain("Checkout");
    expect(html).toContain("workflow");
    expect(html).toContain("Build concepts");
  });
});

function conceptGraphFixture(): ConceptGraphLatestResponse {
  return {
    version: {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      projectGraphVersionId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "concept-graph-v1",
      summary: "Concept graph with one concept.",
      coverage: {
        conceptCounts: { workflow: 1 },
        membershipCounts: { primary: 1 },
        relationshipCounts: {},
        rejectedConceptCount: 0,
        rejectedMembershipCount: 0,
        graphNodeCoverageCount: 1,
        lowConfidenceConceptCount: 0
      },
      diagnostics: [],
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z"
    },
    conceptCounts: { workflow: 1 },
    membershipCounts: { primary: 1 },
    relationshipCounts: {},
    diagnostics: [],
    concepts: [{
      id: "00000000-0000-4000-8000-000000000004",
      projectId: "00000000-0000-4000-8000-000000000002",
      conceptVersionId: "00000000-0000-4000-8000-000000000001",
      conceptKey: "workflow:checkout",
      conceptType: "workflow",
      name: "Checkout",
      summary: "Handles checkout.",
      confidence: 0.9,
      provenance: "ai",
      evidenceSummary: "Supported by checkout.ts.",
      status: "active",
      metadata: {},
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z"
    }]
  };
}
```

- [ ] **Step 2: Run UI test to verify it fails**

Run:

```bash
pnpm --filter web test -- concepts.test.tsx
```

Expected: FAIL with missing module `./concepts.js`.

- [ ] **Step 3: Implement concepts page**

Create `apps/web/src/routes/concepts.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";

import {
  buildConceptGraph,
  conceptDetailQuery,
  conceptGraphQuery,
  queryKeys
} from "../api/queries.js";

export function ConceptsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const concepts = useQuery(conceptGraphQuery(projectId));
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const effectiveConceptId = selectedConceptId ?? concepts.data?.concepts[0]?.id ?? null;
  const detail = useQuery(conceptDetailQuery(projectId, effectiveConceptId));
  const buildMutation = useMutation({
    mutationFn: () =>
      buildConceptGraph(projectId, {
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.1,
        maxGraphNodes: 150,
        maxGraphEdges: 300
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.conceptGraph(projectId) })
  });
  const conceptCounts = useMemo(() => countEntries(concepts.data?.conceptCounts ?? {}), [concepts.data]);

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-auto p-4 lg:overflow-hidden">
      <div className="mb-4 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Concepts</h1>
          <p className="truncate text-sm text-slate-600">AI-consolidated project concepts for project {projectId}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="button-primary"
            disabled={buildMutation.isPending}
            onClick={() => buildMutation.mutate()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Build concepts
          </button>
          <Link to="/projects/$projectId/graph" params={{ projectId }} className="button-secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Project graph
          </Link>
        </div>
      </div>

      {concepts.error ? (
        <section className="panel-section text-sm text-slate-600">
          <h2 className="section-heading">No concept graph</h2>
          <p className="mt-2">Build concepts after a project graph is available.</p>
        </section>
      ) : concepts.isLoading ? (
        <p className="panel-section text-sm text-slate-500">Loading concepts...</p>
      ) : concepts.data ? (
        <div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="panel-section min-h-0 overflow-auto">
            <h2 className="section-heading">Current concept graph</h2>
            <p className="mt-2 text-sm text-slate-600">{concepts.data.version.summary}</p>
            <div className="mt-3 grid gap-1 text-xs">
              <StatusLine label="Status" value={concepts.data.version.status} />
              <StatusLine label="Provider" value={concepts.data.version.provider} />
              <StatusLine label="Model" value={concepts.data.version.model} />
              <StatusLine label="Graph version" value={concepts.data.version.projectGraphVersionId} />
            </div>
            <CountList title="Concepts" counts={conceptCounts} />
            <Diagnostics diagnostics={concepts.data.diagnostics} />
          </aside>

          <section className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="panel-section min-h-0 overflow-auto">
              <h2 className="section-heading">Concept list</h2>
              <ul className="mt-3 grid gap-2">
                {concepts.data.concepts.map((concept) => (
                  <li key={concept.id}>
                    <button
                      type="button"
                      aria-pressed={concept.id === effectiveConceptId}
                      className={concept.id === effectiveConceptId ? "w-full rounded border border-slate-900 bg-slate-900 p-2 text-left text-sm text-white" : "w-full rounded border border-slate-200 p-2 text-left text-sm text-slate-700 hover:bg-slate-50"}
                      onClick={() => setSelectedConceptId(concept.id)}
                    >
                      <span className="block truncate font-medium">{concept.name}</span>
                      <span className="block truncate text-xs opacity-80">{concept.conceptType} / {formatConfidence(concept.confidence)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel-section min-h-0 overflow-auto">
              <h2 className="section-heading">Concept detail</h2>
              {detail.data ? (
                <div className="mt-3 grid gap-3 text-sm">
                  <div>
                    <h3 className="font-medium text-slate-900">{detail.data.concept.name}</h3>
                    <p className="mt-1 text-slate-600">{detail.data.concept.summary}</p>
                  </div>
                  <StatusLine label="Evidence" value={detail.data.concept.evidenceSummary || "none"} />
                  <CountList title="Memberships" counts={countEntries(countBy(detail.data.memberships, (item) => item.role))} />
                  <CountList title="Outgoing" counts={countEntries(detail.data.outgoingRelationships)} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Select a concept.</p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <p className="panel-section text-sm text-slate-500">Concept graph is unavailable.</p>
      )}
    </main>
  );
}
```

Add helper functions to the same file:

```tsx
function CountList({ title, counts }: { title: string; counts: Array<[string, number]> }) {
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {counts.length > 0 ? (
        <div className="mt-2 grid gap-1 text-xs">
          {counts.map(([key, value]) => <StatusLine key={key} label={key} value={String(value)} />)}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">None</p>
      )}
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Array<{ code: string; level: string; message: string }> }) {
  if (diagnostics.length === 0) return <p className="mt-3 text-sm text-slate-500">No concept warnings</p>;
  return (
    <ul className="mt-3 grid gap-2">
      {diagnostics.map((diagnostic) => (
        <li key={`${diagnostic.level}-${diagnostic.code}`} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <span className="block truncate font-medium">{diagnostic.code}</span>
          <span className="block">{diagnostic.message}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="truncate text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function countEntries(value: Record<string, unknown>): Array<[string, number]> {
  return Object.entries(value)
    .map(([key, count]) => [key, typeof count === "number" ? count : 0] as [string, number])
    .sort(([left], [right]) => left.localeCompare(right));
}

function countBy<T>(items: T[], readKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = readKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function formatConfidence(value: number) {
  return value.toFixed(2);
}
```

- [ ] **Step 4: Add app route**

In `apps/web/src/app.tsx`, import the page:

```ts
import { ConceptsPage } from "./routes/concepts.js";
```

Add the route:

```tsx
const conceptsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "concepts",
  component: function ConceptsRoute() {
    const { projectId } = conceptsRoute.useParams();
    return <ConceptsPage projectId={projectId} />;
  },
});
```

Add `conceptsRoute` to the project route children list.

- [ ] **Step 5: Add project graph link**

In `apps/web/src/routes/project-graph.tsx`, add a link next to `Back to project`:

```tsx
<Link
  to="/projects/$projectId/concepts"
  params={{ projectId }}
  className="button-secondary"
>
  Concepts
</Link>
```

- [ ] **Step 6: Run web tests and typecheck**

Run:

```bash
pnpm --filter web test -- concepts.test.tsx queries.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit web UI**

Run:

```bash
git add apps/web/src/routes/concepts.tsx apps/web/src/routes/concepts.test.tsx apps/web/src/app.tsx apps/web/src/routes/project-graph.tsx
git commit -m "feat: add concept graph inspection UI"
```

---

### Task 8: Full Verification

**Files:**
- No code changes expected unless verification exposes defects.

- [ ] **Step 1: Run package-focused tests**

Run:

```bash
pnpm --filter @specops/contracts test -- concepts.test.ts
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/ai-prefill test -- concepts.test.ts
pnpm --filter api test -- concept-graph-service.test.ts routes.test.ts
pnpm --filter web test -- concepts.test.tsx queries.test.ts
```

Expected: all commands PASS.

- [ ] **Step 2: Run full validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands PASS.

- [ ] **Step 3: Confirm no markdown/spec writes are introduced**

Run:

```bash
rg -n "writeFile|updateSpec|sourceSpecAnnotations|specEntities|specopsPath" apps/api/src/services/concept-graph-service.ts
```

Expected: no matches for markdown writes, spec entity writes, source/spec annotation writes, or specops path mutation. Imports from graph and concept tables are acceptable.

- [ ] **Step 4: Commit verification fixes if needed**

If verification required fixes, inspect the changed files and commit only the verification fix files:

```bash
git status --short
git commit -m "fix: stabilize concept graph implementation"
```

If no fixes were needed, do not create an empty commit.
