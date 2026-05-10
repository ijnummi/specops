# Project Overview Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only dashboard on the project detail route that summarizes project health, indexed inventory, source evidence coverage, agent tasks, and attention items.

**Architecture:** Add shared overview contracts, a backend overview aggregation service exposed at `GET /api/projects/:projectId/overview`, and a focused React dashboard component rendered when no entity is selected. The API reads only indexed PostgreSQL cache tables; the UI reuses existing project detail layout and navigation patterns.

**Tech Stack:** TypeScript, Zod, Fastify, Drizzle/PostgreSQL, React, TanStack Query, TanStack Router, Vitest.

---

## File Structure

- `packages/contracts/src/projects.ts`: add `ProjectSummary`, overview item, and `ProjectOverviewDto` schemas and exported types.
- `packages/contracts/src/projects.test.ts`: cover the overview schema with a representative payload.
- `apps/api/src/services/project-overview-service.ts`: new aggregation service for project overview data.
- `apps/api/src/routes/projects.ts`: instantiate the overview service and expose `GET /projects/:projectId/overview`.
- `apps/api/src/__tests__/routes.test.ts`: add database-backed route coverage for populated and empty overview responses.
- `apps/web/src/api/queries.ts`: add `ProjectOverviewDto` import, query key, and `projectOverviewQuery`.
- `apps/web/src/components/project-overview-dashboard.tsx`: new read-only dashboard component.
- `apps/web/src/components/project-overview-dashboard.test.tsx`: component rendering and link coverage.
- `apps/web/src/routes/project-detail.tsx`: fetch overview data and render the dashboard when `entityId` is null.
- `apps/web/src/routes/project-detail.test.tsx`: update mocks and add route-level dashboard/editor rendering assertions.

---

### Task 1: Shared Overview Contract

**Files:**
- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/contracts/src/projects.test.ts`

- [ ] **Step 1: Add a failing contract test**

Add this test to `packages/contracts/src/projects.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createProjectRequestSchema, projectOverviewSchema } from "./projects.js";

describe("createProjectRequestSchema", () => {
  it("accepts kebab-case slugs", () => {
    const parsed = createProjectRequestSchema.parse({
      name: "SpecOps",
      slug: "specops-workbench",
      repoPath: "/repo",
      specopsPath: ".specops"
    });

    expect(parsed.slug).toBe("specops-workbench");
  });

  it("allows the API to default the specops path", () => {
    const parsed = createProjectRequestSchema.parse({
      name: "SpecOps",
      slug: "specops-workbench",
      repoPath: "/repo"
    });

    expect(parsed.specopsPath).toBeUndefined();
  });

  it("rejects slugs that are not kebab-case", () => {
    expect(() =>
      createProjectRequestSchema.parse({
        name: "SpecOps",
        slug: "SpecOps Workbench",
        repoPath: "/repo",
        specopsPath: ".specops"
      })
    ).toThrow();
  });
});

describe("projectOverviewSchema", () => {
  it("parses dashboard overview data", () => {
    const parsed = projectOverviewSchema.parse({
      project: {
        id: "project-1",
        name: "SpecOps",
        slug: "specops",
        description: null,
        repoPath: "/repo",
        specopsPath: "/repo/specops",
        createdAt: "2026-05-10T10:00:00.000Z",
        updatedAt: "2026-05-10T10:01:00.000Z",
        entityCount: 3,
        linkCount: 2,
        validationErrorCount: 1,
        validationWarningCount: 1,
        lastIndexedAt: "2026-05-10T10:02:00.000Z"
      },
      latestIndexRun: {
        id: "run-1",
        projectId: "project-1",
        startedAt: "2026-05-10T10:02:00.000Z",
        finishedAt: "2026-05-10T10:03:00.000Z",
        status: "succeeded",
        entityCount: 3,
        linkCount: 2,
        errorCount: 1,
        warningCount: 1,
        gitCommit: null,
        sourceFileCount: 1,
        sourceImportCount: 2,
        sourceExportCount: 3,
        sourceSymbolCount: 4
      },
      entityCountsByType: [{ type: "domain_entity", count: 2 }],
      entityCountsByStatus: [{ status: "draft", count: 3 }],
      validationSummary: {
        errorCount: 1,
        warningCount: 1,
        samples: [
          {
            level: "error",
            code: "broken_link",
            message: "Broken link",
            entityId: "domain.customer",
            filePath: "domain/customer.md"
          }
        ]
      },
      sourceInventory: {
        fileCount: 1,
        symbolCount: 4,
        importCount: 2,
        exportCount: 3
      },
      sourceEvidence: {
        eligibleSpecCount: 2,
        withSourceEvidenceCount: 1,
        withoutSourceEvidenceCount: 1,
        missingSamples: [{ entityId: "domain.order", title: "Order", type: "domain_entity" }]
      },
      agentTasks: {
        totalCount: 1,
        recent: [
          {
            entityId: "task.domain-customer",
            title: "Update Customer",
            status: "draft",
            updatedAt: "2026-05-10T10:04:00.000Z"
          }
        ]
      },
      attentionItems: [
        {
          kind: "validation_error",
          label: "Broken link",
          entityId: "domain.customer",
          filePath: "domain/customer.md"
        }
      ]
    });

    expect(parsed.project.entityCount).toBe(3);
    expect(parsed.sourceEvidence.withoutSourceEvidenceCount).toBe(1);
    expect(parsed.attentionItems[0]?.kind).toBe("validation_error");
  });
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

```sh
pnpm --filter @specops/contracts test -- projects.test.ts
```

Expected: FAIL with an export error for `projectOverviewSchema`.

- [ ] **Step 3: Add overview schemas and types**

Replace `packages/contracts/src/projects.ts` with:

```ts
import { z } from "zod";

import { indexRunSchema } from "./indexing.js";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  repoPath: z.string(),
  specopsPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const projectSummarySchema = projectSchema.extend({
  entityCount: z.number(),
  linkCount: z.number(),
  validationErrorCount: z.number(),
  validationWarningCount: z.number(),
  lastIndexedAt: z.string().nullable()
});

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  specopsPath: z.string().optional()
});

export const updateProjectRequestSchema = createProjectRequestSchema.partial();

export const projectOverviewSchema = z.object({
  project: projectSummarySchema,
  latestIndexRun: indexRunSchema.nullable(),
  entityCountsByType: z.array(z.object({ type: z.string(), count: z.number() })),
  entityCountsByStatus: z.array(z.object({ status: z.string(), count: z.number() })),
  validationSummary: z.object({
    errorCount: z.number(),
    warningCount: z.number(),
    samples: z.array(
      z.object({
        level: z.enum(["error", "warning"]),
        code: z.string(),
        message: z.string(),
        entityId: z.string().nullable(),
        filePath: z.string().nullable()
      })
    )
  }),
  sourceInventory: z.object({
    fileCount: z.number(),
    symbolCount: z.number(),
    importCount: z.number(),
    exportCount: z.number()
  }),
  sourceEvidence: z.object({
    eligibleSpecCount: z.number(),
    withSourceEvidenceCount: z.number(),
    withoutSourceEvidenceCount: z.number(),
    missingSamples: z.array(z.object({ entityId: z.string(), title: z.string(), type: z.string() }))
  }),
  agentTasks: z.object({
    totalCount: z.number(),
    recent: z.array(
      z.object({
        entityId: z.string(),
        title: z.string(),
        status: z.string(),
        updatedAt: z.string()
      })
    )
  }),
  attentionItems: z.array(
    z.object({
      kind: z.enum(["validation_error", "validation_warning", "missing_source_evidence"]),
      label: z.string(),
      entityId: z.string().nullable(),
      filePath: z.string().nullable()
    })
  )
});

export type ProjectDto = z.infer<typeof projectSchema>;
export type ProjectSummaryDto = z.infer<typeof projectSummarySchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ProjectOverviewDto = z.infer<typeof projectOverviewSchema>;
```

- [ ] **Step 4: Run the contract test to verify it passes**

Run:

```sh
pnpm --filter @specops/contracts test -- projects.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared contract changes**

Run:

```sh
git add packages/contracts/src/projects.ts packages/contracts/src/projects.test.ts
git commit -m "feat: add project overview contract"
```

---

### Task 2: Backend Overview Endpoint

**Files:**
- Create: `apps/api/src/services/project-overview-service.ts`
- Modify: `apps/api/src/services/project-service.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing database-backed route tests**

Add this test block inside `describeWithDb("database-backed routes", () => { ... })` in `apps/api/src/__tests__/routes.test.ts`, near the other project route tests:

```ts
  it("returns a populated project overview", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await pool.query(
      "insert into index_runs (project_id, status, finished_at, entity_count, link_count, error_count, warning_count, source_file_count, source_import_count, source_export_count, source_symbol_count) values ($1, 'succeeded', now(), 4, 2, 1, 1, 1, 2, 3, 4)",
      [project.id]
    );
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash, updated_at) values " +
        "($1, 'domain.customer', 'domain_entity', 'Customer', 'draft', 'domain/customer.md', '', '', 'hash-1', now()), " +
        "($1, 'domain.order', 'domain_entity', 'Order', 'draft', 'domain/order.md', '', '', 'hash-2', now()), " +
        "($1, 'adr.storage', 'adr', 'Storage ADR', 'accepted', 'decisions/storage.md', '', '', 'hash-3', now()), " +
        "($1, 'task.customer', 'agent_task', 'Update Customer', 'draft', 'agent-tasks/customer.md', '', '', 'hash-4', now())",
      [project.id]
    );
    const sourceFileResult = await pool.query<{ id: string }>(
      "insert into source_files (project_id, path, language, kind, size_bytes, content_hash) values ($1, 'src/customer.ts', 'typescript', 'source', 100, 'source-hash') returning id",
      [project.id]
    );
    const sourceFileId = sourceFileResult.rows[0]!.id;
    await pool.query(
      "insert into source_imports (project_id, source_file_id, file_path, specifier, import_kind, imported_names, is_relative) values ($1, $2, 'src/customer.ts', './order', 'named', array['Order'], true), ($1, $2, 'src/customer.ts', './money', 'named', array['Money'], true)",
      [project.id, sourceFileId]
    );
    await pool.query(
      "insert into source_exports (project_id, source_file_id, file_path, exported_name, export_kind) values ($1, $2, 'src/customer.ts', 'Customer', 'interface'), ($1, $2, 'src/customer.ts', 'CustomerStatus', 'type'), ($1, $2, 'src/customer.ts', 'createCustomer', 'function')",
      [project.id, sourceFileId]
    );
    await pool.query(
      "insert into source_symbols (project_id, source_file_id, file_path, name, symbol_kind, is_exported) values ($1, $2, 'src/customer.ts', 'Customer', 'interface', true), ($1, $2, 'src/customer.ts', 'CustomerStatus', 'type_alias', true), ($1, $2, 'src/customer.ts', 'createCustomer', 'function', true), ($1, $2, 'src/customer.ts', 'internalCustomer', 'function', false)",
      [project.id, sourceFileId]
    );
    await pool.query(
      "insert into source_spec_links (project_id, source_file_id, file_path, entity_id, symbol_name, symbol_kind, content_hash) values ($1, $2, 'src/customer.ts', 'domain.customer', 'Customer', 'interface', 'source-hash')",
      [project.id, sourceFileId]
    );
    await pool.query(
      "insert into validation_messages (project_id, file_path, entity_id, level, code, message) values " +
        "($1, 'domain/customer.md', 'domain.customer', 'error', 'broken_link', 'Broken link'), " +
        "($1, 'domain/order.md', 'domain.order', 'warning', 'missing_source', 'Missing source')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      project: {
        id: project.id,
        entityCount: 4,
        linkCount: 0,
        validationErrorCount: 1,
        validationWarningCount: 1
      },
      latestIndexRun: {
        status: "succeeded",
        sourceFileCount: 1,
        sourceImportCount: 2,
        sourceExportCount: 3,
        sourceSymbolCount: 4
      },
      entityCountsByType: expect.arrayContaining([
        { type: "agent_task", count: 1 },
        { type: "domain_entity", count: 2 }
      ]),
      entityCountsByStatus: expect.arrayContaining([
        { status: "draft", count: 3 },
        { status: "accepted", count: 1 }
      ]),
      validationSummary: {
        errorCount: 1,
        warningCount: 1,
        samples: expect.arrayContaining([
          expect.objectContaining({ level: "error", entityId: "domain.customer" }),
          expect.objectContaining({ level: "warning", entityId: "domain.order" })
        ])
      },
      sourceInventory: {
        fileCount: 1,
        symbolCount: 4,
        importCount: 2,
        exportCount: 3
      },
      sourceEvidence: {
        eligibleSpecCount: 2,
        withSourceEvidenceCount: 1,
        withoutSourceEvidenceCount: 1,
        missingSamples: [{ entityId: "domain.order", title: "Order", type: "domain_entity" }]
      },
      agentTasks: {
        totalCount: 1,
        recent: [expect.objectContaining({ entityId: "task.customer", title: "Update Customer" })]
      },
      attentionItems: [
        expect.objectContaining({ kind: "validation_error", entityId: "domain.customer" }),
        expect.objectContaining({ kind: "validation_warning", entityId: "domain.order" }),
        expect.objectContaining({ kind: "missing_source_evidence", entityId: "domain.order" })
      ]
    });
  });

  it("returns an empty project overview before indexing", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      project: {
        id: project.id,
        entityCount: 0,
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
    });
  });

  it("returns 404 for a missing project overview", async () => {
    app = buildServer(testDatabaseUrl!);

    const response = await app.inject({
      method: "GET",
      url: "/api/projects/00000000-0000-4000-8000-000000000000/overview"
    });

    expect(response.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: FAIL with a 404 for `/overview`.

- [ ] **Step 3: Export the shared project summary type from the service**

Modify the top of `apps/api/src/services/project-service.ts` so it imports `ProjectSummaryDto` from contracts and removes the local duplicate type:

```ts
import type {
  CreateProjectRequest,
  ProjectDto,
  ProjectSummaryDto,
  UpdateProjectRequest
} from "@specops/contracts";
```

Remove this local type block:

```ts
export type ProjectSummaryDto = ProjectDto & {
  entityCount: number;
  linkCount: number;
  validationErrorCount: number;
  validationWarningCount: number;
  lastIndexedAt: string | null;
};
```

- [ ] **Step 4: Add the overview service**

Create `apps/api/src/services/project-overview-service.ts`:

```ts
import type { IndexRunDto, ProjectOverviewDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  indexRuns,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  validationMessages
} from "@specops/db";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { createProjectService } from "./project-service.js";

const sourceEvidenceEligibleTypes = [
  "domain_entity",
  "interface",
  "data_model",
  "ui_view",
  "use_case"
] as const;

const validationSampleLimit = 5;
const missingSourceEvidenceSampleLimit = 5;
const recentAgentTaskLimit = 5;
const attentionItemLimit = 10;

export function createProjectOverviewService(db: Db) {
  const projectService = createProjectService(db);

  async function getProjectOverview(projectId: string): Promise<ProjectOverviewDto> {
    const project = await projectService.getProjectSummary(projectId);

    const [
      latestIndexRunRows,
      entityCountsByType,
      entityCountsByStatus,
      errorRows,
      warningRows,
      sourceInventory,
      eligibleEntities,
      sourceEvidenceRows,
      agentTaskRows
    ] = await Promise.all([
      db
        .select()
        .from(indexRuns)
        .where(eq(indexRuns.projectId, projectId))
        .orderBy(desc(indexRuns.startedAt))
        .limit(1),
      db
        .select({ type: specEntities.type, count: count() })
        .from(specEntities)
        .where(eq(specEntities.projectId, projectId))
        .groupBy(specEntities.type)
        .orderBy(asc(specEntities.type)),
      db
        .select({ status: specEntities.status, count: count() })
        .from(specEntities)
        .where(eq(specEntities.projectId, projectId))
        .groupBy(specEntities.status)
        .orderBy(asc(specEntities.status)),
      db
        .select()
        .from(validationMessages)
        .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, "error")))
        .orderBy(asc(validationMessages.createdAt), asc(validationMessages.code), asc(validationMessages.id))
        .limit(validationSampleLimit),
      db
        .select()
        .from(validationMessages)
        .where(and(eq(validationMessages.projectId, projectId), eq(validationMessages.level, "warning")))
        .orderBy(asc(validationMessages.createdAt), asc(validationMessages.code), asc(validationMessages.id))
        .limit(validationSampleLimit),
      getSourceInventory(projectId),
      db
        .select({
          entityId: specEntities.entityId,
          title: specEntities.title,
          type: specEntities.type
        })
        .from(specEntities)
        .where(
          and(
            eq(specEntities.projectId, projectId),
            inArray(specEntities.type, [...sourceEvidenceEligibleTypes])
          )
        )
        .orderBy(asc(specEntities.entityId)),
      db
        .selectDistinct({ entityId: sourceSpecLinks.entityId })
        .from(sourceSpecLinks)
        .where(eq(sourceSpecLinks.projectId, projectId)),
      db
        .select({
          entityId: specEntities.entityId,
          title: specEntities.title,
          status: specEntities.status,
          updatedAt: specEntities.updatedAt
        })
        .from(specEntities)
        .where(and(eq(specEntities.projectId, projectId), eq(specEntities.type, "agent_task")))
        .orderBy(desc(specEntities.updatedAt), asc(specEntities.entityId))
        .limit(recentAgentTaskLimit)
    ]);

    const latestIndexRun = latestIndexRunRows[0] ? mapIndexRun(latestIndexRunRows[0]) : null;
    const errorSamples = errorRows.map(mapValidationSample);
    const warningSamples = warningRows.map(mapValidationSample);
    const sourceEvidenceEntityIds = new Set(sourceEvidenceRows.map((row) => row.entityId));
    const missingSourceEvidence = eligibleEntities.filter(
      (entity) => !sourceEvidenceEntityIds.has(entity.entityId)
    );
    const withSourceEvidenceCount = eligibleEntities.length - missingSourceEvidence.length;
    const validationAttentionItems = [...errorSamples, ...warningSamples].map((message) => ({
      kind:
        message.level === "error"
          ? ("validation_error" as const)
          : ("validation_warning" as const),
      label: message.message,
      entityId: message.entityId,
      filePath: message.filePath
    }));
    const missingSourceAttentionItems = missingSourceEvidence
      .slice(0, missingSourceEvidenceSampleLimit)
      .map((entity) => ({
        kind: "missing_source_evidence" as const,
        label: `${entity.title} has no source evidence`,
        entityId: entity.entityId,
        filePath: null
      }));
    const agentTaskTotal =
      entityCountsByType.find((row) => row.type === "agent_task")?.count === undefined
        ? 0
        : Number(entityCountsByType.find((row) => row.type === "agent_task")?.count);

    return {
      project,
      latestIndexRun,
      entityCountsByType: entityCountsByType.map((row) => ({
        type: row.type,
        count: Number(row.count)
      })),
      entityCountsByStatus: entityCountsByStatus.map((row) => ({
        status: row.status,
        count: Number(row.count)
      })),
      validationSummary: {
        errorCount: project.validationErrorCount,
        warningCount: project.validationWarningCount,
        samples: [...errorSamples, ...warningSamples]
      },
      sourceInventory,
      sourceEvidence: {
        eligibleSpecCount: eligibleEntities.length,
        withSourceEvidenceCount,
        withoutSourceEvidenceCount: missingSourceEvidence.length,
        missingSamples: missingSourceEvidence.slice(0, missingSourceEvidenceSampleLimit)
      },
      agentTasks: {
        totalCount: agentTaskTotal,
        recent: agentTaskRows.map((row) => ({
          entityId: row.entityId,
          title: row.title,
          status: row.status,
          updatedAt: row.updatedAt.toISOString()
        }))
      },
      attentionItems: [...validationAttentionItems, ...missingSourceAttentionItems].slice(
        0,
        attentionItemLimit
      )
    };
  }

  async function getSourceInventory(projectId: string): Promise<ProjectOverviewDto["sourceInventory"]> {
    const [fileCountRow, importCountRow, exportCountRow, symbolCountRow] = await Promise.all([
      db.select({ value: count() }).from(sourceFiles).where(eq(sourceFiles.projectId, projectId)),
      db.select({ value: count() }).from(sourceImports).where(eq(sourceImports.projectId, projectId)),
      db.select({ value: count() }).from(sourceExports).where(eq(sourceExports.projectId, projectId)),
      db.select({ value: count() }).from(sourceSymbols).where(eq(sourceSymbols.projectId, projectId))
    ]);

    return {
      fileCount: Number(fileCountRow[0]?.value ?? 0),
      importCount: Number(importCountRow[0]?.value ?? 0),
      exportCount: Number(exportCountRow[0]?.value ?? 0),
      symbolCount: Number(symbolCountRow[0]?.value ?? 0)
    };
  }

  return { getProjectOverview };
}

function mapIndexRun(row: typeof indexRuns.$inferSelect): IndexRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status as IndexRunDto["status"],
    entityCount: row.entityCount,
    linkCount: row.linkCount,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    gitCommit: row.gitCommit,
    sourceFileCount: row.sourceFileCount,
    sourceImportCount: row.sourceImportCount,
    sourceExportCount: row.sourceExportCount,
    sourceSymbolCount: row.sourceSymbolCount
  };
}

function mapValidationSample(row: typeof validationMessages.$inferSelect) {
  return {
    level: row.level as "error" | "warning",
    code: row.code,
    message: row.message,
    entityId: row.entityId,
    filePath: row.filePath
  };
}
```

- [ ] **Step 5: Register the overview route**

Modify `apps/api/src/routes/projects.ts`:

```ts
import { createIndexerService } from "../services/indexer-service.js";
import { createProjectOverviewService } from "../services/project-overview-service.js";
import { createProjectService } from "../services/project-service.js";
import { createSourceBootstrapService } from "../services/source-bootstrap-service.js";
import { createSpecopsInitializerService } from "../services/specops-initializer.js";
```

Inside `registerProjectRoutes`, add:

```ts
  const overviewService = createProjectOverviewService(db);
```

Add this route after `GET /projects/:projectId`:

```ts
  app.get("/projects/:projectId/overview", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return overviewService.getProjectOverview(projectId);
  });
```

- [ ] **Step 6: Run the route tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit backend overview endpoint**

Run:

```sh
git add apps/api/src/services/project-service.ts apps/api/src/services/project-overview-service.ts apps/api/src/routes/projects.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add project overview endpoint"
```

---

### Task 3: Frontend Query And Dashboard Component

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/project-overview-dashboard.tsx`
- Create: `apps/web/src/components/project-overview-dashboard.test.tsx`

- [ ] **Step 1: Add failing dashboard component tests**

Create `apps/web/src/components/project-overview-dashboard.test.tsx`:

```tsx
import type { ProjectOverviewDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, search, className }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    className?: string;
  }) => (
    <a
      className={className}
      href={`${to}:${params?.projectId ?? ""}:${params?.entityId ?? ""}:${search?.q ?? ""}`}
    >
      {children}
    </a>
  )
}));

import { ProjectOverviewDashboard } from "./project-overview-dashboard.js";

describe("ProjectOverviewDashboard", () => {
  it("renders project health, inventory, source evidence, tasks, and attention items", () => {
    const html = renderToStaticMarkup(
      <ProjectOverviewDashboard projectId="project-1" overview={overview} />
    );

    expect(html).toContain("Project Health");
    expect(html).toContain("Latest index");
    expect(html).toContain("domain_entity");
    expect(html).toContain("Source Evidence");
    expect(html).toContain("1 without evidence");
    expect(html).toContain("Update Customer");
    expect(html).toContain("Broken link");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:domain.customer:");
  });

  it("renders the no-index empty state", () => {
    const html = renderToStaticMarkup(
      <ProjectOverviewDashboard
        projectId="project-1"
        overview={{
          ...overview,
          latestIndexRun: null,
          project: { ...overview.project, lastIndexedAt: null },
          sourceInventory: { fileCount: 0, symbolCount: 0, importCount: 0, exportCount: 0 }
        }}
      />
    );

    expect(html).toContain("No index runs yet");
    expect(html).toContain("Run indexing to populate dashboard metrics.");
  });
});

const overview: ProjectOverviewDto = {
  project: {
    id: "project-1",
    name: "SpecOps",
    slug: "specops",
    description: null,
    repoPath: "/repo",
    specopsPath: "/repo/specops",
    createdAt: "2026-05-10T10:00:00.000Z",
    updatedAt: "2026-05-10T10:01:00.000Z",
    entityCount: 4,
    linkCount: 2,
    validationErrorCount: 1,
    validationWarningCount: 1,
    lastIndexedAt: "2026-05-10T10:03:00.000Z"
  },
  latestIndexRun: {
    id: "run-1",
    projectId: "project-1",
    startedAt: "2026-05-10T10:02:00.000Z",
    finishedAt: "2026-05-10T10:03:00.000Z",
    status: "succeeded",
    entityCount: 4,
    linkCount: 2,
    errorCount: 1,
    warningCount: 1,
    gitCommit: null,
    sourceFileCount: 1,
    sourceImportCount: 2,
    sourceExportCount: 3,
    sourceSymbolCount: 4
  },
  entityCountsByType: [
    { type: "agent_task", count: 1 },
    { type: "domain_entity", count: 2 }
  ],
  entityCountsByStatus: [
    { status: "accepted", count: 1 },
    { status: "draft", count: 3 }
  ],
  validationSummary: {
    errorCount: 1,
    warningCount: 1,
    samples: [
      {
        level: "error",
        code: "broken_link",
        message: "Broken link",
        entityId: "domain.customer",
        filePath: "domain/customer.md"
      }
    ]
  },
  sourceInventory: { fileCount: 1, symbolCount: 4, importCount: 2, exportCount: 3 },
  sourceEvidence: {
    eligibleSpecCount: 2,
    withSourceEvidenceCount: 1,
    withoutSourceEvidenceCount: 1,
    missingSamples: [{ entityId: "domain.order", title: "Order", type: "domain_entity" }]
  },
  agentTasks: {
    totalCount: 1,
    recent: [
      {
        entityId: "task.customer",
        title: "Update Customer",
        status: "draft",
        updatedAt: "2026-05-10T10:04:00.000Z"
      }
    ]
  },
  attentionItems: [
    {
      kind: "validation_error",
      label: "Broken link",
      entityId: "domain.customer",
      filePath: "domain/customer.md"
    }
  ]
};
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```sh
pnpm --filter web test -- project-overview-dashboard.test.tsx
```

Expected: FAIL because `project-overview-dashboard.js` does not exist.

- [ ] **Step 3: Add the frontend overview query**

Modify `apps/web/src/api/queries.ts`:

```ts
import type {
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  ChangeImpactPreviewQuery,
  ChangeImpactPreviewResponseDto,
  CreateEntityRequest,
  CreateProjectRequest,
  EntityImpactQuery,
  EntityImpactResponseDto,
  IndexRunDto,
  ProjectDto,
  ProjectOverviewDto,
  SaveAgentTaskRequest,
  SaveAgentTaskResponse,
  SpecEntityDto,
  SpecLinkDto,
  SourceSpecLinkDto,
  ValidationMessageDto
} from "@specops/contracts";
```

Add a query key:

```ts
  projectOverview: (projectId: string) => ["projects", projectId, "overview"] as const,
```

Add a query function after `projectQuery`:

```ts
export function projectOverviewQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectOverview(projectId),
    queryFn: () =>
      apiGet<ProjectOverviewDto>(`/api/projects/${encodeURIComponent(projectId)}/overview`)
  });
}
```

- [ ] **Step 4: Add the dashboard component**

Create `apps/web/src/components/project-overview-dashboard.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { ProjectOverviewDto } from "@specops/contracts";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  FileText,
  ListChecks,
  Network,
  ShieldCheck
} from "lucide-react";

type ProjectOverviewDashboardProps = {
  projectId: string;
  overview: ProjectOverviewDto;
};

export function ProjectOverviewDashboard({ projectId, overview }: ProjectOverviewDashboardProps) {
  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto">
      <section className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Project Health" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Entities" value={overview.project.entityCount} />
            <Metric label="Links" value={overview.project.linkCount} />
            <Metric label="Errors" value={overview.project.validationErrorCount} tone="danger" />
            <Metric label="Warnings" value={overview.project.validationWarningCount} tone="warning" />
          </div>
        </Panel>

        <Panel title="Latest index" icon={<Database className="h-4 w-4" aria-hidden="true" />}>
          {overview.latestIndexRun ? (
            <div className="grid gap-2 text-sm text-slate-700">
              <StatusRow label="Status" value={overview.latestIndexRun.status} />
              <StatusRow label="Finished" value={formatDate(overview.latestIndexRun.finishedAt)} />
              <StatusRow
                label="Indexed facts"
                value={`${overview.latestIndexRun.entityCount} specs, ${overview.latestIndexRun.sourceFileCount ?? 0} files`}
              />
            </div>
          ) : (
            <EmptyState title="No index runs yet" body="Run indexing to populate dashboard metrics." />
          )}
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <Panel title="Spec Inventory" icon={<FileText className="h-4 w-4" aria-hidden="true" />}>
          <GroupedCounts
            projectId={projectId}
            groups={overview.entityCountsByType.map((group) => ({
              label: group.type,
              count: group.count,
              query: group.type
            }))}
          />
          <div className="mt-3 border-t border-slate-200 pt-3">
            <GroupedCounts
              projectId={projectId}
              groups={overview.entityCountsByStatus.map((group) => ({
                label: group.status,
                count: group.count,
                query: group.status
              }))}
            />
          </div>
        </Panel>

        <Panel title="Source Inventory" icon={<FileCode2 className="h-4 w-4" aria-hidden="true" />}>
          {overview.latestIndexRun && overview.sourceInventory.fileCount === 0 ? (
            <EmptyState
              title="No source facts"
              body="Source inventory is unavailable until indexing scans source files."
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-4">
              <Metric label="Files" value={overview.sourceInventory.fileCount} />
              <Metric label="Symbols" value={overview.sourceInventory.symbolCount} />
              <Metric label="Imports" value={overview.sourceInventory.importCount} />
              <Metric label="Exports" value={overview.sourceInventory.exportCount} />
            </div>
          )}
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <Panel title="Source Evidence" icon={<Network className="h-4 w-4" aria-hidden="true" />}>
          <p className="text-sm font-medium text-slate-900">
            {overview.sourceEvidence.withSourceEvidenceCount} with evidence,{" "}
            {overview.sourceEvidence.withoutSourceEvidenceCount} without evidence
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {overview.sourceEvidence.eligibleSpecCount} eligible specs
          </p>
          <LinkedEntityList projectId={projectId} items={overview.sourceEvidence.missingSamples} />
        </Panel>

        <Panel title="Agent Tasks" icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}>
          <p className="text-sm font-medium text-slate-900">{overview.agentTasks.totalCount} saved tasks</p>
          <LinkedEntityList projectId={projectId} items={overview.agentTasks.recent} />
        </Panel>

        <Panel title="Needs Attention" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
          {overview.attentionItems.length > 0 ? (
            <ul className="space-y-2">
              {overview.attentionItems.map((item, index) => (
                <li key={`${item.kind}-${item.entityId ?? item.filePath ?? index}`}>
                  {item.entityId ? (
                    <Link
                      to="/projects/$projectId/entities/$entityId"
                      params={{ projectId, entityId: item.entityId }}
                      search={{ q: undefined }}
                      className="block rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <span className="font-medium">{attentionKindLabel(item.kind)}</span>
                      <span className="mt-0.5 block text-slate-500">{item.label}</span>
                    </Link>
                  ) : (
                    <div className="rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-700">
                      <span className="font-medium">{attentionKindLabel(item.kind)}</span>
                      <span className="mt-0.5 block text-slate-500">{item.label}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No attention items" body="No validation or source evidence signals need attention." />
          )}
        </Panel>
      </section>
    </div>
  );
}

type PanelProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
};

function Panel({ title, icon, children }: PanelProps) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="text-slate-500">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-950";

  return (
    <div className="rounded border border-slate-200 px-3 py-2">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-xs font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function GroupedCounts({
  projectId,
  groups
}: {
  projectId: string;
  groups: Array<{ label: string; count: number; query: string }>;
}) {
  if (groups.length === 0) {
    return <EmptyState title="No specs indexed" body="Run indexing to populate spec inventory." />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {groups.map((group) => (
        <Link
          key={group.label}
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: group.query }}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          <span className="font-medium">{group.label}</span>
          <span className="ml-2 text-slate-500">{group.count}</span>
        </Link>
      ))}
    </div>
  );
}

function LinkedEntityList({
  projectId,
  items
}: {
  projectId: string;
  items: Array<{ entityId: string; title: string; type?: string; status?: string }>;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        No linked items.
      </div>
    );
  }

  return (
    <ul className="mt-3 space-y-2">
      {items.map((item) => (
        <li key={item.entityId}>
          <Link
            to="/projects/$projectId/entities/$entityId"
            params={{ projectId, entityId: item.entityId }}
            search={{ q: undefined }}
            className="block rounded border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50"
          >
            <span className="font-medium text-slate-800">{item.title}</span>
            <span className="mt-0.5 block text-slate-500">{item.entityId}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-dashed border-slate-200 p-3 text-sm">
      <p className="font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{body}</p>
    </div>
  );
}

function attentionKindLabel(kind: ProjectOverviewDto["attentionItems"][number]["kind"]) {
  if (kind === "validation_error") return "Error";
  if (kind === "validation_warning") return "Warning";
  return "Missing source evidence";
}

function formatDate(value: string | null) {
  if (!value) return "Not finished";
  return new Date(value).toLocaleString();
}
```

- [ ] **Step 5: Run the dashboard component tests**

Run:

```sh
pnpm --filter web test -- project-overview-dashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit frontend query and dashboard component**

Run:

```sh
git add apps/web/src/api/queries.ts apps/web/src/components/project-overview-dashboard.tsx apps/web/src/components/project-overview-dashboard.test.tsx
git commit -m "feat: add project overview dashboard"
```

---

### Task 4: Project Detail Route Integration

**Files:**
- Modify: `apps/web/src/routes/project-detail.tsx`
- Modify: `apps/web/src/routes/project-detail.test.tsx`

- [ ] **Step 1: Add failing route integration tests**

Modify `apps/web/src/routes/project-detail.test.tsx`:

Add `projectOverviewQuery` and `queryKeys.projectOverview` to the `../api/queries.js` mock:

```ts
  projectOverviewQuery: vi.fn(),
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  },
```

Add a component mock:

```ts
vi.mock("../components/project-overview-dashboard.js", () => ({
  ProjectOverviewDashboard: ({ projectId }: { projectId: string }) => (
    <div>Overview dashboard for {projectId}</div>
  )
}));
```

Change the `useQuery` mock so the second call returns overview data:

```ts
  useQuery: vi.fn((options?: { queryKey?: readonly unknown[] }) => {
    if (options?.queryKey?.[2] === "overview") {
      return {
        data: {
          project: {
            entityCount: 0,
            linkCount: 0,
            validationErrorCount: 0,
            validationWarningCount: 0
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
        },
        error: null,
        isLoading: false
      };
    }

    return {
      data: {
        entityCount: 0,
        linkCount: 0,
        name: "SpecOps",
        repoPath: "/repo",
        specopsPath: "specops",
        validationErrorCount: 0,
        validationWarningCount: 0
      },
      error: null
    };
  }),
```

Change the entity detail mock so selected entity rendering is observable:

```ts
vi.mock("../components/entity-detail.js", () => ({
  EntityDetail: () => <div>Entity editor</div>
}));
```

Add tests:

```ts
  it("renders the overview dashboard when no entity is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Overview dashboard for project-1");
  });

  it("renders the entity editor when an entity is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId="domain.customer" query="" />
    );

    expect(html).toContain("Entity editor");
    expect(html).not.toContain("Overview dashboard for project-1");
  });
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```sh
pnpm --filter web test -- project-detail.test.tsx
```

Expected: FAIL because `ProjectDetailPage` does not render the dashboard.

- [ ] **Step 3: Render the dashboard from the project detail route**

Modify imports in `apps/web/src/routes/project-detail.tsx`:

```ts
import {
  bootstrapFromSource,
  entitiesQuery,
  indexRunsQuery,
  initializeSpecops,
  projectOverviewQuery,
  projectQuery,
  queryKeys,
  reindexProject,
  validationMessagesQuery
} from "../api/queries.js";
import { ProjectOverviewDashboard } from "../components/project-overview-dashboard.js";
```

Add the overview query after the project query:

```ts
  const overview = useQuery(projectOverviewQuery(projectId));
```

Replace the automatic first-entity selection so the dashboard can render on the base project route:

```ts
  const selectedEntityId = entityId;
```

Add overview invalidation in `invalidateProject`:

```ts
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
```

Update the main content rendering so the dashboard appears when no entity is selected:

```tsx
      {project.error || entities.error || validation.error || indexRuns.error || overview.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {project.error?.message ??
            entities.error?.message ??
            validation.error?.message ??
            indexRuns.error?.message ??
            overview.error?.message}
        </div>
      ) : selectedEntityId ? (
        <EntityDetail
          projectId={projectId}
          entityId={selectedEntityId}
          query={query}
          draft={selectedDraft}
          onFetchedMarkdown={syncSelectedFetchedMarkdown}
          onDraftChange={updateSelectedDraft}
          onSaveDraft={saveSelectedDraft}
          onBeforeSelect={confirmEntitySwitch}
        />
      ) : overview.isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading overview...
        </div>
      ) : overview.data ? (
        <ProjectOverviewDashboard projectId={projectId} overview={overview.data} />
      ) : (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Overview unavailable.
        </div>
      )}
```

- [ ] **Step 4: Run the route test**

Run:

```sh
pnpm --filter web test -- project-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the dashboard component test again**

Run:

```sh
pnpm --filter web test -- project-overview-dashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit route integration**

Run:

```sh
git add apps/web/src/routes/project-detail.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "feat: show project overview on project route"
```

---

### Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run typecheck**

Run:

```sh
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm test
```

Expected: PASS. DB-backed API tests require PostgreSQL on `localhost:5436` and a test database named `specops_test`.

- [ ] **Step 3: Build web app**

Run:

```sh
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 4: Commit verification fixes if needed**

If any verification command required code changes, commit the focused fix:

```sh
git status --short
git add packages/contracts/src/projects.ts packages/contracts/src/projects.test.ts apps/api/src/services/project-service.ts apps/api/src/services/project-overview-service.ts apps/api/src/routes/projects.ts apps/api/src/__tests__/routes.test.ts apps/web/src/api/queries.ts apps/web/src/components/project-overview-dashboard.tsx apps/web/src/components/project-overview-dashboard.test.tsx apps/web/src/routes/project-detail.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "fix: stabilize project overview dashboard"
```

Expected: no uncommitted files related to the project overview dashboard remain after this step.
