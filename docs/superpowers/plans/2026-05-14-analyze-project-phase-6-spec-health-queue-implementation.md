# Analyze Project Phase 6 Spec Health Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Spec Health triage queue that computes live maintenance findings across specs, source graph coverage, and concept graph coverage.

**Architecture:** Add a new `health-queue` contract, Fastify route, and API service that derive deterministic queue items from existing readiness, annotation, project graph, and concept graph data. Add a React route with a split queue/detail layout and navigation actions to existing spec, readiness, impact, project graph, and concept pages.

**Tech Stack:** pnpm workspace, TypeScript, Zod contracts, Fastify, Drizzle/PostgreSQL, React, TanStack Router, TanStack Query, Tailwind CSS, Vitest, happy-dom.

---

## File Structure

- Create `packages/contracts/src/health-queue.ts`
  - Owns all DTO schemas and exported types for health queue responses.
- Modify `packages/contracts/src/index.ts`
  - Re-export the new contract module.
- Create `packages/contracts/src/health-queue.test.ts`
  - Verifies discriminated unions, summary shape, diagnostics, and actions parse.
- Create `apps/api/src/services/project-health-queue-service.ts`
  - Computes live queue items and source state. Keeps pure classification helpers exported for unit tests.
- Create `apps/api/src/__tests__/project-health-queue-service.test.ts`
  - DB-backed service tests plus pure helper tests for ids, sorting, and summaries.
- Create `apps/api/src/routes/health-queue.ts`
  - Registers `GET /api/projects/:projectId/health-queue`.
- Modify `apps/api/src/server.ts`
  - Registers the new route under `/api`.
- Modify `apps/api/src/__tests__/routes.test.ts`
  - Adds route smoke coverage for success and not-found behavior.
- Modify `apps/web/src/api/queries.ts`
  - Adds the query key and query function.
- Create `apps/web/src/routes/project-health-queue.tsx`
  - Implements the split queue/detail UI.
- Create `apps/web/src/routes/project-health-queue.test.tsx`
  - Tests loading/error/empty/filter/detail/link rendering.
- Modify `apps/web/src/app.tsx`
  - Adds `/projects/$projectId/health-queue`.
- Modify `apps/web/src/components/project-overview-dashboard.tsx`
  - Links the existing health/readiness dashboard area to the new page.

## Contract Design

Use these names consistently across tasks:

- `healthQueueFamilySchema`: `spec | source | concept`
- `healthQueueSeveritySchema`: `blocker | review | context`
- `healthQueueDiagnosticSchema`
- `healthQueuePrimaryTargetSchema`
- `healthQueueEvidenceSchema`
- `healthQueueActionSchema`
- `healthQueueItemSchema`
- `healthQueueResponseSchema`
- `ProjectHealthQueueResponseDto`

Queue item kinds:

- `spec_readiness_failed`
- `spec_missing_source_evidence`
- `spec_orphaned`
- `spec_stale`
- `source_without_spec`
- `source_area_without_spec`
- `concept_without_spec`
- `concept_low_confidence`
- `concept_membership_low_confidence`

---

### Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/health-queue.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/health-queue.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `packages/contracts/src/health-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  healthQueueResponseSchema,
  healthQueueActionSchema,
  healthQueueEvidenceSchema,
  healthQueuePrimaryTargetSchema
} from "./health-queue.js";

const timestamp = "2026-05-14T12:00:00.000Z";

describe("health queue contracts", () => {
  it("parses targets, evidence, and navigation actions", () => {
    expect(
      healthQueuePrimaryTargetSchema.parse({
        kind: "spec",
        entityId: "uc.checkout",
        title: "Checkout",
        type: "use_case",
        status: "draft",
        filePath: "specs/use-cases/checkout.md"
      })
    ).toMatchObject({ kind: "spec", entityId: "uc.checkout" });

    expect(
      healthQueueEvidenceSchema.parse({
        kind: "readiness_check",
        label: "Missing source evidence",
        detail: "No active source/spec annotation supports this spec.",
        entityId: "uc.checkout",
        filePath: "specs/use-cases/checkout.md"
      })
    ).toMatchObject({ kind: "readiness_check" });

    expect(
      healthQueueActionSchema.parse({
        kind: "open_impact",
        label: "Open impact",
        entityId: "uc.checkout"
      })
    ).toMatchObject({ kind: "open_impact", entityId: "uc.checkout" });
  });

  it("parses a complete health queue response", () => {
    const parsed = healthQueueResponseSchema.parse({
      generatedAt: timestamp,
      sourceState: {
        latestIndexRunId: "00000000-0000-4000-8000-000000000001",
        latestIndexRunStatus: "completed",
        latestProjectGraphVersionId: "00000000-0000-4000-8000-000000000002",
        latestProjectGraphStatus: "ready",
        latestConceptGraphVersionId: "00000000-0000-4000-8000-000000000003",
        latestConceptGraphStatus: "ready",
        hasProjectGraph: true,
        hasConceptGraph: true
      },
      summary: {
        total: 1,
        byFamily: { spec: 1, source: 0, concept: 0 },
        bySeverity: { blocker: 0, review: 1, context: 0 },
        byKind: { spec_missing_source_evidence: 1 }
      },
      diagnostics: [],
      items: [
        {
          id: "spec_missing_source_evidence:uc.checkout",
          family: "spec",
          kind: "spec_missing_source_evidence",
          severity: "review",
          title: "Spec is missing source evidence",
          detail: "Checkout has no active source/spec annotation.",
          primaryTarget: {
            kind: "spec",
            entityId: "uc.checkout",
            title: "Checkout",
            type: "use_case",
            status: "draft",
            filePath: "specs/use-cases/checkout.md"
          },
          evidence: [
            {
              kind: "spec_entity",
              label: "Checkout",
              detail: "use_case / draft",
              entityId: "uc.checkout",
              filePath: "specs/use-cases/checkout.md"
            }
          ],
          actions: [
            { kind: "open_spec", label: "Open spec", entityId: "uc.checkout" }
          ],
          diagnostics: []
        }
      ]
    });

    expect(parsed.summary.total).toBe(1);
    expect(parsed.items[0]?.primaryTarget.kind).toBe("spec");
  });
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- health-queue.test.ts
```

Expected: FAIL because `./health-queue.js` does not exist.

- [ ] **Step 3: Add the contract module**

Create `packages/contracts/src/health-queue.ts`:

```ts
import { z } from "zod";

export const healthQueueFamilySchema = z.enum(["spec", "source", "concept"]);
export const healthQueueSeveritySchema = z.enum(["blocker", "review", "context"]);
export const healthQueueDiagnosticLevelSchema = z.enum(["info", "warning", "error"]);

export const healthQueueKindSchema = z.enum([
  "spec_readiness_failed",
  "spec_missing_source_evidence",
  "spec_orphaned",
  "spec_stale",
  "source_without_spec",
  "source_area_without_spec",
  "concept_without_spec",
  "concept_low_confidence",
  "concept_membership_low_confidence"
]);

export const healthQueueDiagnosticSchema = z.object({
  level: healthQueueDiagnosticLevelSchema,
  code: z.string().min(1),
  message: z.string().min(1)
});

export const healthQueueSourceStateSchema = z.object({
  latestIndexRunId: z.string().uuid().nullable(),
  latestIndexRunStatus: z.string().nullable(),
  latestProjectGraphVersionId: z.string().uuid().nullable(),
  latestProjectGraphStatus: z.string().nullable(),
  latestConceptGraphVersionId: z.string().uuid().nullable(),
  latestConceptGraphStatus: z.string().nullable(),
  hasProjectGraph: z.boolean(),
  hasConceptGraph: z.boolean()
});

const specTargetSchema = z.object({
  kind: z.literal("spec"),
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1)
});

const sourceTargetSchema = z.object({
  kind: z.literal("source"),
  graphNodeId: z.string().uuid().nullable(),
  nodeKey: z.string().min(1).nullable(),
  nodeType: z.string().min(1).nullable(),
  path: z.string().min(1),
  symbolName: z.string().min(1).nullable()
});

const conceptTargetSchema = z.object({
  kind: z.literal("concept"),
  conceptId: z.string().uuid(),
  conceptKey: z.string().min(1),
  conceptType: z.string().min(1),
  name: z.string().min(1)
});

export const healthQueuePrimaryTargetSchema = z.discriminatedUnion("kind", [
  specTargetSchema,
  sourceTargetSchema,
  conceptTargetSchema
]);

export const healthQueueEvidenceSchema = z.object({
  kind: z.enum([
    "spec_entity",
    "source_path",
    "graph_node",
    "concept",
    "annotation",
    "readiness_check",
    "diagnostic"
  ]),
  label: z.string().min(1),
  detail: z.string().min(1),
  entityId: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  graphNodeId: z.string().uuid().optional(),
  conceptId: z.string().uuid().optional(),
  annotationId: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1).nullable().optional()
});

export const healthQueueActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open_spec"),
    label: z.string().min(1),
    entityId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("open_readiness"),
    label: z.string().min(1),
    entityId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("open_impact"),
    label: z.string().min(1),
    entityId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("open_project_graph"),
    label: z.string().min(1),
    q: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal("open_graph_node"),
    label: z.string().min(1),
    graphNodeId: z.string().uuid()
  }),
  z.object({
    kind: z.literal("open_concept"),
    label: z.string().min(1),
    conceptId: z.string().uuid()
  }),
  z.object({
    kind: z.literal("open_analyze_run"),
    label: z.string().min(1)
  })
]);

export const healthQueueItemSchema = z.object({
  id: z.string().min(1),
  family: healthQueueFamilySchema,
  kind: healthQueueKindSchema,
  severity: healthQueueSeveritySchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  primaryTarget: healthQueuePrimaryTargetSchema,
  evidence: z.array(healthQueueEvidenceSchema),
  actions: z.array(healthQueueActionSchema).min(1),
  diagnostics: z.array(healthQueueDiagnosticSchema)
});

export const healthQueueSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  byFamily: z.record(healthQueueFamilySchema, z.number().int().nonnegative()),
  bySeverity: z.record(healthQueueSeveritySchema, z.number().int().nonnegative()),
  byKind: z.record(healthQueueKindSchema, z.number().int().nonnegative())
});

export const healthQueueResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  sourceState: healthQueueSourceStateSchema,
  summary: healthQueueSummarySchema,
  diagnostics: z.array(healthQueueDiagnosticSchema),
  items: z.array(healthQueueItemSchema)
});

export type HealthQueueFamily = z.infer<typeof healthQueueFamilySchema>;
export type HealthQueueSeverity = z.infer<typeof healthQueueSeveritySchema>;
export type HealthQueueKind = z.infer<typeof healthQueueKindSchema>;
export type HealthQueueDiagnostic = z.infer<typeof healthQueueDiagnosticSchema>;
export type HealthQueueSourceStateDto = z.infer<typeof healthQueueSourceStateSchema>;
export type HealthQueuePrimaryTargetDto = z.infer<typeof healthQueuePrimaryTargetSchema>;
export type HealthQueueEvidenceDto = z.infer<typeof healthQueueEvidenceSchema>;
export type HealthQueueActionDto = z.infer<typeof healthQueueActionSchema>;
export type HealthQueueItemDto = z.infer<typeof healthQueueItemSchema>;
export type HealthQueueSummaryDto = z.infer<typeof healthQueueSummarySchema>;
export type ProjectHealthQueueResponseDto = z.infer<typeof healthQueueResponseSchema>;
```

- [ ] **Step 4: Export the module**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./agent-runs.js";
export * from "./annotations.js";
export * from "./analyze-review-assemblies.js";
export * from "./analyze-runs.js";
export * from "./change-impact.js";
export * from "./concepts.js";
export * from "./diff-reviews.js";
export * from "./entities.js";
export * from "./health-queue.js";
export * from "./impact.js";
export * from "./indexing.js";
export * from "./proposals.js";
export * from "./project-graph.js";
export * from "./projects.js";
export * from "./readiness.js";
export * from "./source.js";
export * from "./system-map.js";
export * from "./validation.js";
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run:

```bash
pnpm --filter @specops/contracts test -- health-queue.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit contracts**

Run:

```bash
git add packages/contracts/src/health-queue.ts packages/contracts/src/health-queue.test.ts packages/contracts/src/index.ts
git commit -m "feat: add health queue contracts"
```

---

### Task 2: Health Queue Service

**Files:**
- Create: `apps/api/src/services/project-health-queue-service.ts`
- Test: `apps/api/src/__tests__/project-health-queue-service.test.ts`

- [ ] **Step 1: Write pure helper tests first**

Create `apps/api/src/__tests__/project-health-queue-service.test.ts` with pure tests at the top:

```ts
import { describe, expect, it } from "vitest";

import {
  buildHealthQueueSummary,
  compareHealthQueueItems,
  healthQueueItemId,
  isUsefulSourceNode
} from "../services/project-health-queue-service.js";

describe("project health queue helpers", () => {
  it("creates deterministic item ids", () => {
    expect(healthQueueItemId("spec_missing_source_evidence", "uc.checkout")).toBe(
      "spec_missing_source_evidence:uc.checkout"
    );
    expect(healthQueueItemId("source_without_spec", "file:apps/api/src/index.ts")).toBe(
      "source_without_spec:file:apps/api/src/index.ts"
    );
  });

  it("summarizes queue items by family, severity, and kind", () => {
    const summary = buildHealthQueueSummary([
      {
        id: "spec_missing_source_evidence:uc.checkout",
        family: "spec",
        kind: "spec_missing_source_evidence",
        severity: "review",
        title: "Spec is missing source evidence",
        detail: "Checkout has no active annotation.",
        primaryTarget: {
          kind: "spec",
          entityId: "uc.checkout",
          title: "Checkout",
          type: "use_case",
          status: "draft",
          filePath: "specs/checkout.md"
        },
        evidence: [],
        actions: [{ kind: "open_spec", label: "Open spec", entityId: "uc.checkout" }],
        diagnostics: []
      }
    ]);

    expect(summary.total).toBe(1);
    expect(summary.byFamily.spec).toBe(1);
    expect(summary.bySeverity.review).toBe(1);
    expect(summary.byKind.spec_missing_source_evidence).toBe(1);
  });

  it("sorts by severity, family, kind, and title", () => {
    const source = {
      id: "source_without_spec:file:a",
      family: "source" as const,
      kind: "source_without_spec" as const,
      severity: "review" as const,
      title: "Source lacks spec",
      detail: "a.ts is uncovered.",
      primaryTarget: {
        kind: "source" as const,
        graphNodeId: null,
        nodeKey: "file:a",
        nodeType: "file",
        path: "a.ts",
        symbolName: null
      },
      evidence: [],
      actions: [{ kind: "open_project_graph" as const, label: "Open graph", q: "a.ts" }],
      diagnostics: []
    };
    const spec = {
      ...source,
      id: "spec_readiness_failed:uc.checkout",
      family: "spec" as const,
      kind: "spec_readiness_failed" as const,
      severity: "blocker" as const,
      title: "Spec readiness failed",
      primaryTarget: {
        kind: "spec" as const,
        entityId: "uc.checkout",
        title: "Checkout",
        type: "use_case",
        status: "draft",
        filePath: "specs/checkout.md"
      },
      actions: [{ kind: "open_spec" as const, label: "Open spec", entityId: "uc.checkout" }]
    };

    expect([source, spec].sort(compareHealthQueueItems).map((item) => item.id)).toEqual([
      "spec_readiness_failed:uc.checkout",
      "source_without_spec:file:a"
    ]);
  });

  it("filters out test, config, external, unresolved, and unknown source nodes", () => {
    expect(isUsefulSourceNode({ nodeType: "file", path: "apps/api/src/service.ts", metadataJson: { classification: "source" } })).toBe(true);
    expect(isUsefulSourceNode({ nodeType: "file", path: "apps/api/src/service.test.ts", metadataJson: { classification: "test" } })).toBe(false);
    expect(isUsefulSourceNode({ nodeType: "external_dependency", path: null, metadataJson: {} })).toBe(false);
    expect(isUsefulSourceNode({ nodeType: "file", path: "vite.config.ts", metadataJson: { classification: "config" } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm --filter api test -- project-health-queue-service.test.ts
```

Expected: FAIL because `project-health-queue-service.ts` does not exist.

- [ ] **Step 3: Implement helper exports and service skeleton**

Create `apps/api/src/services/project-health-queue-service.ts`:

```ts
import type {
  HealthQueueItemDto,
  HealthQueueKind,
  HealthQueueSeverity,
  ProjectHealthQueueResponseDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  indexRuns,
  projectConceptMemberships,
  projectConceptVersions,
  projectConcepts,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  projects,
  sourceSpecAnnotations,
  specEntities,
  specLinks
} from "@specops/db";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import { createSpecReadinessService } from "./spec-readiness-service.js";

type ProjectGraphNodeRow = typeof projectGraphNodes.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;
type SourceSpecAnnotationRow = typeof sourceSpecAnnotations.$inferSelect;
type SpecLinkRow = typeof specLinks.$inferSelect;
type ProjectConceptRow = typeof projectConcepts.$inferSelect;
type ProjectConceptMembershipRow = typeof projectConceptMemberships.$inferSelect;

const severityRank: Record<HealthQueueSeverity, number> = {
  blocker: 0,
  review: 1,
  context: 2
};

const familyRank: Record<HealthQueueItemDto["family"], number> = {
  spec: 0,
  source: 1,
  concept: 2
};

const healthQueueKinds: HealthQueueKind[] = [
  "spec_readiness_failed",
  "spec_missing_source_evidence",
  "spec_orphaned",
  "spec_stale",
  "source_without_spec",
  "source_area_without_spec",
  "concept_without_spec",
  "concept_low_confidence",
  "concept_membership_low_confidence"
];

export function createProjectHealthQueueService(db: Db) {
  return {
    async getProjectHealthQueue(projectId: string): Promise<ProjectHealthQueueResponseDto> {
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project) {
        throw new NotFoundError("Project not found", { projectId });
      }

      const [latestIndexRun] = await db
        .select()
        .from(indexRuns)
        .where(eq(indexRuns.projectId, projectId))
        .orderBy(desc(indexRuns.finishedAt), desc(indexRuns.startedAt), desc(indexRuns.id))
        .limit(1);
      const [latestGraph] = await db
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
      const [latestConceptVersion] = await db
        .select()
        .from(projectConceptVersions)
        .where(
          and(
            eq(projectConceptVersions.projectId, projectId),
            inArray(projectConceptVersions.status, ["ready", "limited"])
          )
        )
        .orderBy(desc(projectConceptVersions.createdAt), desc(projectConceptVersions.id))
        .limit(1);

      const diagnostics: ProjectHealthQueueResponseDto["diagnostics"] = [];
      if (!latestIndexRun) diagnostics.push({ level: "warning", code: "no_index_run", message: "No index run is available." });
      if (!latestGraph) diagnostics.push({ level: "warning", code: "no_project_graph", message: "No ready or limited project graph is available." });
      if (latestGraph?.status === "limited") diagnostics.push({ level: "warning", code: "limited_project_graph", message: "The latest project graph is limited." });
      if (!latestConceptVersion) diagnostics.push({ level: "warning", code: "no_concept_graph", message: "No ready or limited concept graph is available." });
      if (latestConceptVersion?.status === "limited") diagnostics.push({ level: "warning", code: "limited_concept_graph", message: "The latest concept graph is limited." });

      const readiness = await createSpecReadinessService(db).getProjectReadiness(projectId);
      const [entities, annotations, links] = await Promise.all([
        db.select().from(specEntities).where(eq(specEntities.projectId, projectId)).orderBy(asc(specEntities.entityId)),
        db
          .select()
          .from(sourceSpecAnnotations)
          .where(and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.status, "active"))),
        db.select().from(specLinks).where(eq(specLinks.projectId, projectId))
      ]);

      const graphNodes = latestGraph
        ? await db
          .select()
          .from(projectGraphNodes)
          .where(and(eq(projectGraphNodes.projectId, projectId), eq(projectGraphNodes.graphVersionId, latestGraph.id)))
        : [];
      const graphEdges = latestGraph
        ? await db
          .select()
          .from(projectGraphEdges)
          .where(and(eq(projectGraphEdges.projectId, projectId), eq(projectGraphEdges.graphVersionId, latestGraph.id)))
        : [];
      const concepts = latestConceptVersion
        ? await db
          .select()
          .from(projectConcepts)
          .where(
            and(
              eq(projectConcepts.projectId, projectId),
              eq(projectConcepts.conceptVersionId, latestConceptVersion.id),
              eq(projectConcepts.status, "active")
            )
          )
        : [];
      const conceptMemberships = latestConceptVersion
        ? await db
          .select()
          .from(projectConceptMemberships)
          .where(
            and(
              eq(projectConceptMemberships.projectId, projectId),
              eq(projectConceptMemberships.conceptVersionId, latestConceptVersion.id)
            )
          )
        : [];

      const items = [
        ...buildSpecItems(readiness.queue, entities, annotations, links),
        ...buildSourceItems(graphNodes, graphEdges),
        ...buildConceptItems(concepts, conceptMemberships, graphNodes, graphEdges)
      ].sort(compareHealthQueueItems);

      return {
        generatedAt: new Date().toISOString(),
        sourceState: {
          latestIndexRunId: latestIndexRun?.id ?? null,
          latestIndexRunStatus: latestIndexRun?.status ?? null,
          latestProjectGraphVersionId: latestGraph?.id ?? null,
          latestProjectGraphStatus: latestGraph?.status ?? null,
          latestConceptGraphVersionId: latestConceptVersion?.id ?? null,
          latestConceptGraphStatus: latestConceptVersion?.status ?? null,
          hasProjectGraph: latestGraph !== undefined,
          hasConceptGraph: latestConceptVersion !== undefined
        },
        summary: buildHealthQueueSummary(items),
        diagnostics,
        items
      };
    }
  };
}

export function healthQueueItemId(kind: HealthQueueKind, target: string): string {
  return `${kind}:${target}`;
}

export function buildHealthQueueSummary(items: HealthQueueItemDto[]): ProjectHealthQueueResponseDto["summary"] {
  const byFamily = { spec: 0, source: 0, concept: 0 };
  const bySeverity = { blocker: 0, review: 0, context: 0 };
  const byKind = Object.fromEntries(healthQueueKinds.map((kind) => [kind, 0])) as Record<HealthQueueKind, number>;

  for (const item of items) {
    byFamily[item.family] += 1;
    bySeverity[item.severity] += 1;
    byKind[item.kind] += 1;
  }

  return { total: items.length, byFamily, bySeverity, byKind };
}

export function compareHealthQueueItems(left: HealthQueueItemDto, right: HealthQueueItemDto): number {
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    familyRank[left.family] - familyRank[right.family] ||
    left.kind.localeCompare(right.kind) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

export function isUsefulSourceNode(input: {
  nodeType: string;
  path: string | null;
  metadataJson: unknown;
}): boolean {
  if (input.nodeType !== "file" && input.nodeType !== "symbol") return false;
  if (!input.path) return false;
  const metadata = readRecord(input.metadataJson);
  const classification = readString(metadata.classification);
  if (classification && ["test", "config", "unknown"].includes(classification)) return false;
  if (input.path.includes(".test.") || input.path.includes(".spec.")) return false;
  if (input.path.endsWith(".config.ts") || input.path.endsWith(".config.js")) return false;
  return true;
}

function buildSpecItems(
  readinessQueue: Awaited<ReturnType<ReturnType<typeof createSpecReadinessService>["getProjectReadiness"]>>["queue"],
  entities: SpecEntityRow[],
  annotations: SourceSpecAnnotationRow[],
  links: SpecLinkRow[]
): HealthQueueItemDto[] {
  const entitiesById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const annotationEntityIds = new Set(annotations.map((annotation) => annotation.entityId));
  const linkedEntityIds = new Set(links.flatMap((link) => [link.fromEntityId, link.toEntityId]));
  const items: HealthQueueItemDto[] = [];

  for (const item of readinessQueue) {
    const entity = entitiesById.get(item.entityId);
    if (!entity) continue;
    items.push({
      id: healthQueueItemId("spec_readiness_failed", entity.entityId),
      family: "spec",
      kind: "spec_readiness_failed",
      severity: item.highestSeverity ?? "review",
      title: `${entity.title} readiness failed`,
      detail: item.topChecks[0]?.detail ?? `${entity.title} has ${item.failedCheckCount} failed readiness checks.`,
      primaryTarget: specTarget(entity),
      evidence: item.topChecks.map((check) => ({
        kind: "readiness_check",
        label: check.label,
        detail: check.detail,
        entityId: entity.entityId,
        filePath: entity.filePath
      })),
      actions: specActions(entity.entityId),
      diagnostics: []
    });
  }

  for (const entity of entities.filter(isSourceEvidenceEligibleSpec)) {
    if (!annotationEntityIds.has(entity.entityId)) {
      items.push({
        id: healthQueueItemId("spec_missing_source_evidence", entity.entityId),
        family: "spec",
        kind: "spec_missing_source_evidence",
        severity: "review",
        title: `${entity.title} is missing source evidence`,
        detail: `${entity.entityId} has no active source/spec annotation.`,
        primaryTarget: specTarget(entity),
        evidence: [specEntityEvidence(entity)],
        actions: specActions(entity.entityId),
        diagnostics: []
      });
    }
  }

  for (const entity of entities.filter(isOrphanEligibleSpec)) {
    if (!annotationEntityIds.has(entity.entityId) && !linkedEntityIds.has(entity.entityId)) {
      items.push({
        id: healthQueueItemId("spec_orphaned", entity.entityId),
        family: "spec",
        kind: "spec_orphaned",
        severity: "review",
        title: `${entity.title} is isolated`,
        detail: `${entity.entityId} has no spec links and no active source evidence.`,
        primaryTarget: specTarget(entity),
        evidence: [specEntityEvidence(entity)],
        actions: specActions(entity.entityId),
        diagnostics: []
      });
    }
  }

  return dedupeItems(items);
}

function buildSourceItems(
  graphNodes: ProjectGraphNodeRow[],
  graphEdges: Array<typeof projectGraphEdges.$inferSelect>
): HealthQueueItemDto[] {
  const supportedNodeIds = new Set(graphEdges.filter((edge) => edge.edgeType === "supports_spec").map((edge) => edge.fromNodeId));
  const items: HealthQueueItemDto[] = [];
  const uncovered = graphNodes.filter((node) => isUsefulSourceNode(node) && !supportedNodeIds.has(node.id));
  const byModule = new Map<string, ProjectGraphNodeRow[]>();

  for (const node of uncovered) {
    const modulePath = modulePathFor(node.path ?? node.nodeKey);
    const group = byModule.get(modulePath) ?? [];
    group.push(node);
    byModule.set(modulePath, group);
  }

  for (const [modulePath, nodes] of byModule) {
    if (nodes.length >= 3) {
      items.push({
        id: healthQueueItemId("source_area_without_spec", modulePath),
        family: "source",
        kind: "source_area_without_spec",
        severity: "review",
        title: `${modulePath} has uncovered source files`,
        detail: `${nodes.length} useful source nodes in this area have no source/spec support edge.`,
        primaryTarget: {
          kind: "source",
          graphNodeId: nodes[0]?.id ?? null,
          nodeKey: nodes[0]?.nodeKey ?? null,
          nodeType: nodes[0]?.nodeType ?? null,
          path: modulePath,
          symbolName: null
        },
        evidence: nodes.slice(0, 5).map(sourceNodeEvidence),
        actions: [{ kind: "open_project_graph", label: "Open project graph", q: modulePath }],
        diagnostics: []
      });
    } else {
      for (const node of nodes) {
        items.push({
          id: healthQueueItemId("source_without_spec", node.nodeKey),
          family: "source",
          kind: "source_without_spec",
          severity: "review",
          title: `${node.label} has no spec link`,
          detail: `${node.path ?? node.nodeKey} has no source/spec support edge.`,
          primaryTarget: sourceTarget(node),
          evidence: [sourceNodeEvidence(node)],
          actions: [
            { kind: "open_graph_node", label: "Open graph node", graphNodeId: node.id },
            { kind: "open_project_graph", label: "Open project graph", q: node.path ?? node.label }
          ],
          diagnostics: []
        });
      }
    }
  }

  return items;
}

function buildConceptItems(
  concepts: ProjectConceptRow[],
  memberships: ProjectConceptMembershipRow[],
  graphNodes: ProjectGraphNodeRow[],
  graphEdges: Array<typeof projectGraphEdges.$inferSelect>
): HealthQueueItemDto[] {
  const graphNodesById = new Map(graphNodes.map((node) => [node.id, node]));
  const specBackedNodeIds = new Set(graphEdges.filter((edge) => edge.edgeType === "supports_spec").map((edge) => edge.fromNodeId));
  const membershipsByConcept = new Map<string, ProjectConceptMembershipRow[]>();
  const items: HealthQueueItemDto[] = [];

  for (const membership of memberships) {
    const group = membershipsByConcept.get(membership.conceptId) ?? [];
    group.push(membership);
    membershipsByConcept.set(membership.conceptId, group);
  }

  for (const concept of concepts) {
    const conceptMemberships = membershipsByConcept.get(concept.id) ?? [];
    const backed = conceptMemberships.some((membership) => specBackedNodeIds.has(membership.graphNodeId));

    if (conceptMemberships.length > 0 && !backed) {
      items.push({
        id: healthQueueItemId("concept_without_spec", concept.conceptKey),
        family: "concept",
        kind: "concept_without_spec",
        severity: "review",
        title: `${concept.name} has no spec coverage`,
        detail: "None of this concept's graph memberships are connected to a spec support edge.",
        primaryTarget: conceptTarget(concept),
        evidence: conceptMemberships.slice(0, 5).map((membership) => conceptMembershipEvidence(membership, graphNodesById)),
        actions: [{ kind: "open_concept", label: "Open concept", conceptId: concept.id }],
        diagnostics: []
      });
    }

    if (concept.confidence < 0.6) {
      items.push({
        id: healthQueueItemId("concept_low_confidence", concept.conceptKey),
        family: "concept",
        kind: "concept_low_confidence",
        severity: "context",
        title: `${concept.name} is low confidence`,
        detail: `Concept confidence is ${concept.confidence.toFixed(2)}.`,
        primaryTarget: conceptTarget(concept),
        evidence: [{ kind: "concept", label: concept.name, detail: concept.summary || concept.evidenceSummary || "Low-confidence concept.", conceptId: concept.id, confidence: concept.confidence }],
        actions: [{ kind: "open_concept", label: "Open concept", conceptId: concept.id }],
        diagnostics: []
      });
    }

    const lowConfidenceMemberships = conceptMemberships.filter((membership) => membership.confidence < 0.6);
    if (lowConfidenceMemberships.length > 0) {
      items.push({
        id: healthQueueItemId("concept_membership_low_confidence", concept.conceptKey),
        family: "concept",
        kind: "concept_membership_low_confidence",
        severity: "context",
        title: `${concept.name} has weak evidence memberships`,
        detail: `${lowConfidenceMemberships.length} concept memberships are below confidence 0.60.`,
        primaryTarget: conceptTarget(concept),
        evidence: lowConfidenceMemberships.slice(0, 5).map((membership) => conceptMembershipEvidence(membership, graphNodesById)),
        actions: [{ kind: "open_concept", label: "Open concept", conceptId: concept.id }],
        diagnostics: []
      });
    }
  }

  return items;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isSourceEvidenceEligibleSpec(entity: SpecEntityRow): boolean {
  return ["use_case", "interface", "ui_view", "data_model", "domain_entity"].includes(entity.type);
}

function isOrphanEligibleSpec(entity: SpecEntityRow): boolean {
  return isSourceEvidenceEligibleSpec(entity) && entity.status !== "archived";
}

function specTarget(entity: SpecEntityRow): HealthQueueItemDto["primaryTarget"] {
  return { kind: "spec", entityId: entity.entityId, title: entity.title, type: entity.type, status: entity.status, filePath: entity.filePath };
}

function specEntityEvidence(entity: SpecEntityRow): HealthQueueItemDto["evidence"][number] {
  return { kind: "spec_entity", label: entity.title, detail: `${entity.type} / ${entity.status}`, entityId: entity.entityId, filePath: entity.filePath };
}

function specActions(entityId: string): HealthQueueItemDto["actions"] {
  return [
    { kind: "open_spec", label: "Open spec", entityId },
    { kind: "open_readiness", label: "Open readiness", entityId },
    { kind: "open_impact", label: "Open impact", entityId }
  ];
}

function sourceTarget(node: ProjectGraphNodeRow): HealthQueueItemDto["primaryTarget"] {
  return { kind: "source", graphNodeId: node.id, nodeKey: node.nodeKey, nodeType: node.nodeType, path: node.path ?? node.nodeKey, symbolName: node.symbolName };
}

function sourceNodeEvidence(node: ProjectGraphNodeRow): HealthQueueItemDto["evidence"][number] {
  return { kind: "graph_node", label: node.label, detail: `${node.nodeType} / ${node.path ?? node.nodeKey}`, graphNodeId: node.id, filePath: node.path ?? undefined, confidence: node.confidence ?? null };
}

function conceptTarget(concept: ProjectConceptRow): HealthQueueItemDto["primaryTarget"] {
  return { kind: "concept", conceptId: concept.id, conceptKey: concept.conceptKey, conceptType: concept.conceptType, name: concept.name };
}

function conceptMembershipEvidence(membership: ProjectConceptMembershipRow, graphNodesById: Map<string, ProjectGraphNodeRow>): HealthQueueItemDto["evidence"][number] {
  const node = graphNodesById.get(membership.graphNodeId);
  return {
    kind: "graph_node",
    label: node?.label ?? membership.graphNodeId,
    detail: membership.rationale || `${membership.role} membership`,
    graphNodeId: membership.graphNodeId,
    filePath: node?.path ?? undefined,
    confidence: membership.confidence
  };
}

function modulePathFor(pathOrKey: string): string {
  const path = pathOrKey.replace(/^file:/, "");
  const parts = path.split("/");
  return parts.length <= 1 ? path : parts.slice(0, -1).join("/");
}

function dedupeItems(items: HealthQueueItemDto[]): HealthQueueItemDto[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
pnpm --filter api test -- project-health-queue-service.test.ts
```

Expected: PASS for helper tests. DB-backed tests added in later steps may be skipped if `TEST_DATABASE_URL` is not set.

- [ ] **Step 5: Add DB-backed service tests for spec issues**

Extend `apps/api/src/__tests__/project-health-queue-service.test.ts` by adding these imports at the top with the existing imports:

```ts
import { createDb, projects, specEntities, sourceSpecAnnotations } from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe as baseDescribe } from "vitest";

import { createProjectHealthQueueService } from "../services/project-health-queue-service.js";
```

Then append this DB-backed suite below the pure helper tests:

```ts

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDb = testDatabaseUrl ? baseDescribe : baseDescribe.skip;

describeWithDb("createProjectHealthQueueService", () => {
  const projectIds: string[] = [];
  let db: ReturnType<typeof createDb>;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = createDb(testDatabaseUrl!);
    pool = new pg.Pool({ connectionString: testDatabaseUrl! });
  });

  afterEach(async () => {
    for (const projectId of projectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  afterAll(async () => {
    await pool?.end();
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end();
  });

  it("reports specs missing source evidence", async () => {
    const project = await createProject("health-spec-missing-source");
    projectIds.push(project.id);
    await db.insert(specEntities).values({
      projectId: project.id,
      entityId: "uc.checkout",
      type: "use_case",
      title: "Checkout",
      status: "draft",
      filePath: "specs/use-cases/checkout.md",
      bodyMarkdown: "# Checkout",
      bodyText: "Checkout",
      contentHash: "hash"
    });

    const queue = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "spec_missing_source_evidence:uc.checkout",
          family: "spec",
          kind: "spec_missing_source_evidence"
        })
      ])
    );
  });

  it("does not report missing source evidence when an active annotation exists", async () => {
    const project = await createProject("health-spec-with-source");
    projectIds.push(project.id);
    await db.insert(specEntities).values({
      projectId: project.id,
      entityId: "uc.checkout",
      type: "use_case",
      title: "Checkout",
      status: "draft",
      filePath: "specs/use-cases/checkout.md",
      bodyMarkdown: "# Checkout",
      bodyText: "Checkout",
      contentHash: "hash"
    });
    await db.insert(sourceSpecAnnotations).values({
      projectId: project.id,
      sourceFilePath: "apps/api/src/checkout.ts",
      entityId: "uc.checkout",
      specFilePath: "specs/use-cases/checkout.md",
      relationshipType: "implements",
      provenance: "user",
      status: "active"
    });

    const queue = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(queue.items.map((item) => item.id)).not.toContain("spec_missing_source_evidence:uc.checkout");
  });

  async function createProject(slug: string) {
    const [project] = await db
      .insert(projects)
      .values({
        name: slug,
        slug,
        repoPath: `/tmp/${slug}`,
        specopsPath: `/tmp/${slug}/.specops`
      })
      .returning();

    return project!;
  }
});
```

- [ ] **Step 6: Run service tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- project-health-queue-service.test.ts
```

Expected: PASS when the test database is available. If PostgreSQL is not running, start it with `docker compose up -d postgres` and run `pnpm db:migrate` against the test database setup used by existing API tests.

- [ ] **Step 7: Add source and concept fixture tests**

Extend the DB-backed test with one source graph case and one concept graph case:

```ts
it("reports useful source graph nodes without spec support", async () => {
  const project = await createProject("health-source-gap");
  projectIds.push(project.id);
  const [graph] = await db.insert(projectGraphVersions).values({
    projectId: project.id,
    status: "ready",
    summary: "Ready graph.",
    coverageJson: { nodeCounts: { file: 1 }, edgeCounts: {}, sourceFileCount: 1, specEntityCount: 0, unresolvedImportCount: 0, heuristicEdgeCount: 0 },
    diagnosticsJson: []
  }).returning();
  await db.insert(projectGraphNodes).values({
    projectId: project.id,
    graphVersionId: graph!.id,
    nodeKey: "file:apps/api/src/checkout.ts",
    nodeType: "file",
    label: "checkout.ts",
    path: "apps/api/src/checkout.ts",
    sourceRefJson: {},
    metadataJson: { classification: "source" },
    confidence: 1
  });

  const queue = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

  expect(queue.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "source_without_spec", family: "source" })
    ])
  );
});

it("reports concepts without spec coverage and low confidence concepts", async () => {
  const project = await createProject("health-concept-gap");
  projectIds.push(project.id);
  const [graph] = await db.insert(projectGraphVersions).values({
    projectId: project.id,
    status: "ready",
    summary: "Ready graph.",
    coverageJson: { nodeCounts: { file: 1 }, edgeCounts: {}, sourceFileCount: 1, specEntityCount: 0, unresolvedImportCount: 0, heuristicEdgeCount: 0 },
    diagnosticsJson: []
  }).returning();
  const [node] = await db.insert(projectGraphNodes).values({
    projectId: project.id,
    graphVersionId: graph!.id,
    nodeKey: "file:apps/api/src/checkout.ts",
    nodeType: "file",
    label: "checkout.ts",
    path: "apps/api/src/checkout.ts",
    sourceRefJson: {},
    metadataJson: { classification: "source" },
    confidence: 1
  }).returning();
  const [version] = await db.insert(projectConceptVersions).values({
    projectId: project.id,
    projectGraphVersionId: graph!.id,
    status: "ready",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptVersion: "concept-graph-v1",
    summary: "Concept graph.",
    coverageJson: { conceptCounts: { workflow: 1 }, membershipCounts: { primary: 1 }, relationshipCounts: {}, rejectedConceptCount: 0, rejectedMembershipCount: 0, graphNodeCoverageCount: 1, lowConfidenceConceptCount: 1 },
    diagnosticsJson: []
  }).returning();
  const [concept] = await db.insert(projectConcepts).values({
    projectId: project.id,
    conceptVersionId: version!.id,
    conceptKey: "workflow:checkout",
    conceptType: "workflow",
    name: "Checkout",
    summary: "Checkout workflow.",
    confidence: 0.5,
    provenance: "ai",
    evidenceSummary: "Checkout route.",
    status: "active",
    metadataJson: {}
  }).returning();
  await db.insert(projectConceptMemberships).values({
    projectId: project.id,
    conceptVersionId: version!.id,
    projectGraphVersionId: graph!.id,
    conceptId: concept!.id,
    graphNodeId: node!.id,
    role: "primary",
    confidence: 0.5,
    rationale: "Weak membership."
  });

  const queue = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

  expect(queue.items.map((item) => item.kind)).toEqual(
    expect.arrayContaining([
      "concept_without_spec",
      "concept_low_confidence",
      "concept_membership_low_confidence"
    ])
  );
});
```

- [ ] **Step 8: Run service tests again**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- project-health-queue-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit service**

Run:

```bash
git add apps/api/src/services/project-health-queue-service.ts apps/api/src/__tests__/project-health-queue-service.test.ts
git commit -m "feat: compute project health queue"
```

---

### Task 3: API Route And Query Function

**Files:**
- Create: `apps/api/src/routes/health-queue.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`
- Modify: `apps/web/src/api/queries.ts`

- [ ] **Step 1: Write route tests**

Add to the database-backed `routes.test.ts` suite:

```ts
it("returns the project health queue through the API", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/health-queue`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    summary: expect.objectContaining({ total: expect.any(Number) }),
    sourceState: expect.objectContaining({
      hasProjectGraph: expect.any(Boolean),
      hasConceptGraph: expect.any(Boolean)
    }),
    items: expect.any(Array),
    diagnostics: expect.any(Array)
  });
});

it("returns 404 for a health queue on an unknown project", async () => {
  app = buildServer(testDatabaseUrl!);

  const response = await app.inject({
    method: "GET",
    url: "/api/projects/00000000-0000-4000-8000-999999999999/health-queue"
  });

  expect(response.statusCode).toBe(404);
  expect(response.json().error.message).toBe("Project not found");
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: FAIL with 404 for `/health-queue` because the route is not registered.

- [ ] **Step 3: Add the route**

Create `apps/api/src/routes/health-queue.ts`:

```ts
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectHealthQueueService } from "../services/project-health-queue-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerHealthQueueRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const healthQueueService = createProjectHealthQueueService(db);

  app.get("/projects/:projectId/health-queue", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return healthQueueService.getProjectHealthQueue(projectId);
  });
};
```

- [ ] **Step 4: Register the route in the server**

Modify `apps/api/src/server.ts` imports:

```ts
import { registerHealthQueueRoutes } from "./routes/health-queue.js";
```

Register it near project health/readiness:

```ts
  app.register(registerProjectHealthRoutes, { prefix: "/api", db });
  app.register(registerHealthQueueRoutes, { prefix: "/api", db });
  app.register(registerReadinessRoutes, { prefix: "/api", db });
```

- [ ] **Step 5: Add the web query key and function**

Modify `apps/web/src/api/queries.ts` imports from `@specops/contracts`:

```ts
  ProjectHealthQueueResponseDto,
```

Add query key:

```ts
  projectHealthQueue: (projectId: string) => ["projects", projectId, "health-queue"] as const,
```

Add query function after `projectHealthQuery`:

```ts
export function projectHealthQueueQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectHealthQueue(projectId),
    queryFn: () =>
      apiGet<ProjectHealthQueueResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/health-queue`
      )
  });
}
```

- [ ] **Step 6: Run route tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck for query integration**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit API route and query**

Run:

```bash
git add apps/api/src/routes/health-queue.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts apps/web/src/api/queries.ts
git commit -m "feat: expose project health queue API"
```

---

### Task 4: Health Queue UI Route

**Files:**
- Create: `apps/web/src/routes/project-health-queue.tsx`
- Create: `apps/web/src/routes/project-health-queue.test.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Write route tests**

Create `apps/web/src/routes/project-health-queue.test.tsx`:

```tsx
// @vitest-environment happy-dom

import type { ProjectHealthQueueResponseDto } from "@specops/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queueState: {
    data: null as ProjectHealthQueueResponseDto | null,
    error: null as Error | null,
    isLoading: false
  },
  projectHealthQueueQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "health-queue"],
    queryType: "healthQueue"
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mocks.queueState
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    to: string;
  }) => <a href={to.replace("$projectId", params?.projectId ?? "").replace("$entityId", params?.entityId ?? "")}>{children}</a>
}));

vi.mock("../api/queries.js", () => ({
  projectHealthQueueQuery: mocks.projectHealthQueueQuery
}));

import { ProjectHealthQueuePage } from "./project-health-queue.js";

describe("ProjectHealthQueuePage", () => {
  beforeEach(() => {
    mocks.queueState = { data: null, error: null, isLoading: false };
    mocks.projectHealthQueueQuery.mockClear();
  });

  it("renders loading and error states", () => {
    mocks.queueState = { data: null, error: null, isLoading: true };
    expect(renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />)).toContain("Loading health queue");

    mocks.queueState = { data: null, error: new Error("Health failed"), isLoading: false };
    expect(renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />)).toContain("Health failed");
  });

  it("renders an empty state with source state", () => {
    mocks.queueState = { data: queueFixture([]), error: null, isLoading: false };

    const html = renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />);

    expect(html).toContain("Spec Health");
    expect(html).toContain("No health queue items");
    expect(html).toContain("Index");
    expect(html).toContain("Graph");
    expect(html).toContain("Concepts");
  });

  it("renders queue items, evidence, diagnostics, and navigation actions", () => {
    mocks.queueState = {
      data: queueFixture([
        {
          id: "spec_missing_source_evidence:uc.checkout",
          family: "spec",
          kind: "spec_missing_source_evidence",
          severity: "review",
          title: "Checkout is missing source evidence",
          detail: "uc.checkout has no active source/spec annotation.",
          primaryTarget: {
            kind: "spec",
            entityId: "uc.checkout",
            title: "Checkout",
            type: "use_case",
            status: "draft",
            filePath: "specs/checkout.md"
          },
          evidence: [
            {
              kind: "spec_entity",
              label: "Checkout",
              detail: "use_case / draft",
              entityId: "uc.checkout",
              filePath: "specs/checkout.md"
            }
          ],
          actions: [
            { kind: "open_spec", label: "Open spec", entityId: "uc.checkout" },
            { kind: "open_impact", label: "Open impact", entityId: "uc.checkout" }
          ],
          diagnostics: []
        }
      ]),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />);

    expect(html).toContain("Checkout is missing source evidence");
    expect(html).toContain("Evidence");
    expect(html).toContain("Open spec");
    expect(html).toContain("Open impact");
    expect(html).toContain("review");
  });
});

function queueFixture(items: ProjectHealthQueueResponseDto["items"]): ProjectHealthQueueResponseDto {
  return {
    generatedAt: "2026-05-14T12:00:00.000Z",
    sourceState: {
      latestIndexRunId: "00000000-0000-4000-8000-000000000001",
      latestIndexRunStatus: "completed",
      latestProjectGraphVersionId: "00000000-0000-4000-8000-000000000002",
      latestProjectGraphStatus: "ready",
      latestConceptGraphVersionId: null,
      latestConceptGraphStatus: null,
      hasProjectGraph: true,
      hasConceptGraph: false
    },
    summary: {
      total: items.length,
      byFamily: { spec: items.filter((item) => item.family === "spec").length, source: 0, concept: 0 },
      bySeverity: { blocker: 0, review: items.filter((item) => item.severity === "review").length, context: 0 },
      byKind: {
        spec_readiness_failed: 0,
        spec_missing_source_evidence: items.filter((item) => item.kind === "spec_missing_source_evidence").length,
        spec_orphaned: 0,
        spec_stale: 0,
        source_without_spec: 0,
        source_area_without_spec: 0,
        concept_without_spec: 0,
        concept_low_confidence: 0,
        concept_membership_low_confidence: 0
      }
    },
    diagnostics: [{ level: "warning", code: "no_concept_graph", message: "No concept graph is available." }],
    items
  };
}
```

- [ ] **Step 2: Run UI route test to verify it fails**

Run:

```bash
pnpm --filter web test -- project-health-queue.test.tsx
```

Expected: FAIL because `project-health-queue.tsx` does not exist.

- [ ] **Step 3: Add the UI route component**

Create `apps/web/src/routes/project-health-queue.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { HealthQueueActionDto, HealthQueueFamily, HealthQueueSeverity } from "@specops/contracts";
import { AlertTriangle, CheckCircle2, Filter, ShieldCheck } from "lucide-react";

import { projectHealthQueueQuery } from "../api/queries.js";

type ProjectHealthQueuePageProps = {
  projectId: string;
};

const families: Array<"all" | HealthQueueFamily> = ["all", "spec", "source", "concept"];
const severities: Array<"all" | HealthQueueSeverity> = ["all", "blocker", "review", "context"];

export function ProjectHealthQueuePage({ projectId }: ProjectHealthQueuePageProps) {
  const queue = useQuery(projectHealthQueueQuery(projectId));
  const [family, setFamily] = useState<(typeof families)[number]>("all");
  const [severity, setSeverity] = useState<(typeof severities)[number]>("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const items = queue.data?.items ?? [];
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (family !== "all" && item.family !== family) return false;
        if (severity !== "all" && item.severity !== severity) return false;
        return true;
      }),
    [family, items, severity]
  );
  const selectedItem =
    filteredItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? null;

  if (queue.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading health queue...</div>;
  }

  if (queue.error) {
    return <div className="p-4 text-sm text-red-700">{queue.error.message}</div>;
  }

  if (!queue.data) {
    return <div className="p-4 text-sm text-slate-600">Health queue is unavailable.</div>;
  }

  return (
    <main className="mx-auto grid h-full max-w-[1600px] grid-rows-[auto_1fr] gap-3 overflow-hidden p-4">
      <header className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-950">Spec Health</h1>
          <p className="truncate text-sm text-slate-600">
            {queue.data.summary.total} queue items / generated {formatDate(queue.data.generatedAt)}
          </p>
        </div>
        <SourceState state={queue.data.sourceState} />
      </header>

      {items.length === 0 ? (
        <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            No health queue items
          </div>
          <p className="mt-2 text-sm text-slate-600">
            No spec, source, or concept maintenance issues were found for the current source state.
          </p>
        </section>
      ) : (
        <section className="grid min-h-0 gap-3 lg:grid-cols-[360px_1fr]">
          <aside className="flex min-h-0 flex-col rounded border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Filter className="h-4 w-4" aria-hidden="true" />
                Filters
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="field">
                  <span>Family</span>
                  <select className="input h-9 py-1" value={family} onChange={(event) => setFamily(event.target.value as typeof family)}>
                    {families.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Severity</span>
                  <select className="input h-9 py-1" value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
                    {severities.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-slate-200 overflow-auto">
              {filteredItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`block w-full min-w-0 p-3 text-left hover:bg-slate-50 ${selectedItem?.id === item.id ? "bg-slate-100" : ""}`}
                    onClick={() => setSelectedItemId(item.id)}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
                      <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">{item.severity}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{item.family} / {item.kind}</div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.detail}</p>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-4 shadow-sm">
            {selectedItem ? <IssueDetail projectId={projectId} item={selectedItem} /> : <p className="text-sm text-slate-500">No items match the current filters.</p>}
          </section>
        </section>
      )}
    </main>
  );
}

function SourceState({ state }: { state: import("@specops/contracts").HealthQueueSourceStateDto }) {
  return (
    <div className="grid min-w-0 grid-cols-3 gap-2 text-xs">
      <StatePill label="Index" value={state.latestIndexRunStatus ?? "none"} />
      <StatePill label="Graph" value={state.latestProjectGraphStatus ?? "none"} />
      <StatePill label="Concepts" value={state.latestConceptGraphStatus ?? "none"} />
    </div>
  );
}

function StatePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-slate-200 bg-white px-2 py-1">
      <div className="truncate text-[11px] text-slate-500">{label}</div>
      <div className="truncate text-xs font-medium text-slate-800">{value}</div>
    </div>
  );
}

function IssueDetail({ projectId, item }: { projectId: string; item: import("@specops/contracts").HealthQueueItemDto }) {
  return (
    <div className="grid gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-slate-600" aria-hidden="true" />
          {item.title}
        </div>
        <p className="mt-2 text-sm text-slate-700">{item.detail}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded border border-slate-200 px-2 py-1">{item.family}</span>
          <span className="rounded border border-slate-200 px-2 py-1">{item.kind}</span>
          <span className="rounded border border-slate-200 px-2 py-1">{item.severity}</span>
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Evidence</h2>
        <ul className="divide-y divide-slate-200 rounded border border-slate-200">
          {item.evidence.map((evidence, index) => (
            <li key={`${evidence.kind}-${evidence.label}-${index}`} className="p-2 text-sm">
              <div className="font-medium text-slate-900">{evidence.label}</div>
              <div className="text-xs text-slate-600">{evidence.detail}</div>
            </li>
          ))}
        </ul>
      </div>
      {item.diagnostics.length > 0 ? (
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
            Diagnostics
          </h2>
          <ul className="grid gap-2">
            {item.diagnostics.map((diagnostic) => (
              <li key={diagnostic.code} className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Actions</h2>
        <div className="flex flex-wrap gap-2">
          {item.actions.map((action) => (
            <ActionLink key={`${action.kind}-${action.label}`} projectId={projectId} action={action} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionLink({ projectId, action }: { projectId: string; action: HealthQueueActionDto }) {
  const className = "inline-flex h-8 items-center rounded border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50";
  if (action.kind === "open_spec") {
    return <Link className={className} to="/projects/$projectId/entities/$entityId" params={{ projectId, entityId: action.entityId }} search={{ q: undefined }}>{action.label}</Link>;
  }
  if (action.kind === "open_readiness") {
    return <Link className={className} to="/projects/$projectId/readiness" params={{ projectId }}>{action.label}</Link>;
  }
  if (action.kind === "open_impact") {
    return <Link className={className} to="/projects/$projectId/impact/$entityId" params={{ projectId, entityId: action.entityId }} search={{ depth: 1, direction: "both", includeSource: true }}>{action.label}</Link>;
  }
  if (action.kind === "open_concept") {
    return <Link className={className} to="/projects/$projectId/concepts" params={{ projectId }}>{action.label}</Link>;
  }
  if (action.kind === "open_project_graph" || action.kind === "open_graph_node") {
    return <Link className={className} to="/projects/$projectId/graph" params={{ projectId }}>{action.label}</Link>;
  }
  return <Link className={className} to="/projects/$projectId" params={{ projectId }} search={{ q: undefined }}>{action.label}</Link>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
```

- [ ] **Step 4: Register the web route**

Modify `apps/web/src/app.tsx` imports:

```ts
import { ProjectHealthQueuePage } from "./routes/project-health-queue.js";
```

Add route after `projectRoute`:

```tsx
const projectHealthQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/health-queue",
  component: () => {
    const { projectId } = projectHealthQueueRoute.useParams();
    return <ProjectHealthQueuePage projectId={projectId} />;
  }
});
```

Add it to `routeTree`:

```ts
  projectHealthQueueRoute,
```

- [ ] **Step 5: Run UI route test**

Run:

```bash
pnpm --filter web test -- project-health-queue.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run web typecheck/build**

Run:

```bash
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 7: Commit UI route**

Run:

```bash
git add apps/web/src/routes/project-health-queue.tsx apps/web/src/routes/project-health-queue.test.tsx apps/web/src/app.tsx
git commit -m "feat: add spec health queue page"
```

---

### Task 5: Dashboard Link And Final Verification

**Files:**
- Modify: `apps/web/src/components/project-overview-dashboard.tsx`
- Create: `apps/web/src/components/project-overview-dashboard.test.tsx`

- [ ] **Step 1: Add a focused assertion for the dashboard link**

Create `apps/web/src/components/project-overview-dashboard.test.tsx`:

```tsx
// @vitest-environment happy-dom

import type {
  ProjectHealthDto,
  ProjectOverviewDto,
  ProjectReadinessDto
} from "@specops/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to
  }: {
    children: React.ReactNode;
    className?: string;
    params?: Record<string, string>;
    to: string;
  }) => (
    <a className={className} href={to.replace("$projectId", params?.projectId ?? "")}>
      {children}
    </a>
  )
}));

import { ProjectOverviewDashboard } from "./project-overview-dashboard.js";

describe("ProjectOverviewDashboard", () => {
  it("links to the spec health queue", () => {
    const html = renderToStaticMarkup(
      <ProjectOverviewDashboard
        projectId="project-1"
        overview={overviewFixture()}
        health={healthFixture()}
        readiness={readinessFixture()}
      />
    );

    expect(html).toContain("Spec Health Queue");
    expect(html).toContain("/projects/project-1/health-queue");
  });
});

function overviewFixture(): ProjectOverviewDto {
  return {
    project: {
      id: "project-1",
      name: "SpecOps",
      slug: "specops",
      description: null,
      repoPath: "/repo",
      specopsPath: "/repo/.specops",
      createdAt: "2026-05-14T12:00:00.000Z",
      updatedAt: "2026-05-14T12:00:00.000Z",
      entityCount: 1,
      linkCount: 0,
      validationErrorCount: 0,
      validationWarningCount: 0,
      lastIndexedAt: null
    },
    latestIndexRun: null,
    entityCountsByType: [],
    entityCountsByStatus: [],
    validationSummary: { errorCount: 0, warningCount: 0, samples: [] },
    sourceInventory: { fileCount: 0, symbolCount: 0, importCount: 0, exportCount: 0 },
    sourceEvidence: {
      eligibleSpecCount: 0,
      withSourceEvidenceCount: 0,
      withoutSourceEvidenceCount: 0,
      missingSamples: []
    },
    agentTasks: { totalCount: 0, recent: [] },
    attentionItems: []
  };
}

function healthFixture(): ProjectHealthDto {
  return {
    git: {
      isRepo: true,
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
  };
}

function readinessFixture(): ProjectReadinessDto {
  return {
    summary: { ready: 1, blocked: 0, needsReview: 0, needsContext: 0 },
    queue: []
  };
}
```

- [ ] **Step 2: Add the dashboard link**

Modify `ProjectOverviewDashboard` in `apps/web/src/components/project-overview-dashboard.tsx`. In the `Spec Readiness` panel, add a second link below the readiness summary:

```tsx
          <div className="mt-3 border-t border-slate-200 pt-3">
            <Link
              to="/projects/$projectId/health-queue"
              params={{ projectId }}
              className="inline-flex h-8 items-center rounded border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Spec Health Queue
            </Link>
          </div>
```

Keep the existing readiness summary content unchanged.

- [ ] **Step 3: Run focused web tests**

Run:

```bash
pnpm --filter web test -- project-overview-dashboard.test.tsx project-health-queue.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run full validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all PASS. If DB-backed API tests require `TEST_DATABASE_URL`, run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test
```

Expected: PASS with the local PostgreSQL test database available.

- [ ] **Step 5: Optional browser inspection**

Start the app with the normal repository ports:

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:5176
```

Navigate to a project dashboard and then to `/projects/<projectId>/health-queue`. Verify:

- the route loads without a blank screen
- filters do not resize the layout
- the left queue and right detail pane fit in desktop view
- empty state shows source state
- action links navigate to existing pages

- [ ] **Step 6: Commit dashboard link and verification fixes**

Run:

```bash
git add apps/web/src/components/project-overview-dashboard.tsx apps/web/src/components/project-overview-dashboard.test.tsx
git commit -m "feat: link dashboard to spec health queue"
```

---

## Self-Review Notes

- Spec coverage: The plan covers the read-only computed API, source state diagnostics, spec/source/concept issue families, deterministic ids, split queue/detail UI, navigation actions, missing graph/concept behavior, and existing page preservation.
- Scope: The plan does not add persisted review state, markdown writes, annotation writes, AI calls, graph rebuilds, or concept rebuilds.
- Risk: The service snippet intentionally starts with a conservative issue model. If implementation reveals existing readiness helpers are not reusable enough, keep the public contract unchanged and move shared eligibility logic into small pure helpers inside `project-health-queue-service.ts`.
