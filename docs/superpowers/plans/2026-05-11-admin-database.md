# Admin Database Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only admin Database tab that lists known SpecOps database tables and lets users inspect schema, one row as JSON, and capped table data.

**Architecture:** Add an allowlisted admin database service and Fastify route under `/api/admin/database`, then add web query helpers and a `/admin/database` route. The UI keeps `table`, `mode`, and `rowId` in TanStack Router search state and renders a two-column admin workbench.

**Tech Stack:** Fastify, Drizzle ORM, PostgreSQL, Zod, TanStack Router, TanStack Query, React, Tailwind CSS, Vitest.

---

## File Structure

- Create `apps/api/src/services/admin-database-service.ts`: table allowlist, schema metadata, row counts, row-by-id lookup, row neighbor lookup, capped rows.
- Create `apps/api/src/routes/admin-database.ts`: Fastify routes and query validation for admin database reads.
- Modify `apps/api/src/server.ts`: register admin database routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: add database-backed route coverage.
- Modify `apps/web/src/api/queries.ts`: add admin database DTOs, query keys, and query helpers.
- Create `apps/web/src/routes/admin-database.tsx`: admin Database page UI and helper formatting.
- Create `apps/web/src/routes/admin-database.test.tsx`: route component tests with mocked queries.
- Modify `apps/web/src/app.tsx`: add `/admin/database` route with search validation.
- Modify `apps/web/src/routes/root.tsx`: add Admin navigation entry.

## Task 1: API Admin Database Service

**Files:**
- Create: `apps/api/src/services/admin-database-service.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing API route tests**

Add tests inside `describeWithDb("database-backed routes", () => { ... })` in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("lists known admin database tables without exposing unknown tables", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({ method: "GET", url: "/api/admin/database/tables" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "projects",
          label: "projects",
          rowCount: expect.any(Number),
          supportsRowId: true
        }),
        expect.objectContaining({
          name: "spec_entities",
          label: "spec_entities",
          rowCount: expect.any(Number),
          supportsRowId: true
        })
      ])
    );
    expect(response.json()).not.toContainEqual(expect.objectContaining({ name: "pg_catalog" }));
    expect(response.json()).toContainEqual(
      expect.objectContaining({ name: "projects", rowCount: expect.any(Number) })
    );
    await pool.query("delete from projects where id = $1", [project.id]);
  });

  it("returns schema metadata for a known admin database table", async () => {
    app = buildServer(testDatabaseUrl!);

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/database/tables/projects/schema"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      table: "projects",
      primaryKey: "id",
      columns: expect.arrayContaining([
        { name: "id", dataType: "uuid", notNull: true },
        { name: "name", dataType: "text", notNull: true },
        { name: "description", dataType: "text", notNull: false }
      ])
    });
  });

  it("reads an admin database row by id and navigates neighbors", async () => {
    app = buildServer(testDatabaseUrl!);
    const first = await createProjectViaApi({ name: "Admin A", slug: "admin-a" });
    const second = await createProjectViaApi({ name: "Admin B", slug: "admin-b" });

    const rowResponse = await app.inject({
      method: "GET",
      url: `/api/admin/database/tables/projects/row?id=${first.id}`
    });
    const nextResponse = await app.inject({
      method: "GET",
      url: `/api/admin/database/tables/projects/row-neighbor?id=${first.id}&direction=next`
    });
    const prevResponse = await app.inject({
      method: "GET",
      url: `/api/admin/database/tables/projects/row-neighbor?id=${second.id}&direction=prev`
    });

    expect(rowResponse.statusCode).toBe(200);
    expect(rowResponse.json()).toMatchObject({ table: "projects", row: { id: first.id } });
    expect(nextResponse.statusCode).toBe(200);
    expect(nextResponse.json().row).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(prevResponse.statusCode).toBe(200);
    expect(prevResponse.json().row).toEqual(expect.objectContaining({ id: expect.any(String) }));
  });

  it("returns capped admin database rows and rejects unknown tables", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi({ name: "Admin Rows", slug: "admin-rows" });

    const rowsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/database/tables/projects/rows?limit=1"
    });
    const unknownResponse = await app.inject({
      method: "GET",
      url: "/api/admin/database/tables/not_allowed/rows"
    });

    expect(rowsResponse.statusCode).toBe(200);
    expect(rowsResponse.json()).toMatchObject({
      table: "projects",
      rows: [expect.objectContaining({ id: expect.any(String) })],
      limit: 1
    });
    expect(unknownResponse.statusCode).toBe(404);
    expect(unknownResponse.json().error.message).toBe("Unknown admin database table");
    await pool.query("delete from projects where id = $1", [project.id]);
  });
```

- [ ] **Step 2: Run API tests to verify failure**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts`

Expected: FAIL because `/api/admin/database/tables` is not registered.

- [ ] **Step 3: Implement `createAdminDatabaseService`**

Create `apps/api/src/services/admin-database-service.ts` with:

```ts
import { asc, count, gt, lt, sql } from "drizzle-orm";
import type { PgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";
import type { Db } from "@specops/db";
import {
  aiProposals,
  indexRuns,
  projects,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  specFiles,
  specLinks,
  validationMessages
} from "@specops/db";
import { NotFoundError, BadRequestError } from "../lib/http-errors.js";

type AdminTableName =
  | "projects"
  | "index_runs"
  | "spec_files"
  | "spec_entities"
  | "spec_links"
  | "validation_messages"
  | "source_files"
  | "source_imports"
  | "source_exports"
  | "source_symbols"
  | "source_spec_links"
  | "ai_proposals";

type AdminTable = PgTableWithColumns<any>;

type AdminTableDefinition = {
  name: AdminTableName;
  table: AdminTable;
  idColumn: PgColumn;
};

const ADMIN_TABLES: AdminTableDefinition[] = [
  { name: "projects", table: projects, idColumn: projects.id },
  { name: "index_runs", table: indexRuns, idColumn: indexRuns.id },
  { name: "spec_files", table: specFiles, idColumn: specFiles.id },
  { name: "spec_entities", table: specEntities, idColumn: specEntities.id },
  { name: "spec_links", table: specLinks, idColumn: specLinks.id },
  { name: "validation_messages", table: validationMessages, idColumn: validationMessages.id },
  { name: "source_files", table: sourceFiles, idColumn: sourceFiles.id },
  { name: "source_imports", table: sourceImports, idColumn: sourceImports.id },
  { name: "source_exports", table: sourceExports, idColumn: sourceExports.id },
  { name: "source_symbols", table: sourceSymbols, idColumn: sourceSymbols.id },
  { name: "source_spec_links", table: sourceSpecLinks, idColumn: sourceSpecLinks.id },
  { name: "ai_proposals", table: aiProposals, idColumn: aiProposals.id }
];
```

Expose methods `listTables()`, `getSchema(tableName)`, `getRow(tableName, id)`, `getNeighbor(tableName, id, direction)`, and `listRows(tableName, limit)`. Use `getTableColumns(table)` from Drizzle to return column names, `column.getSQLType()` for data type, and `column.notNull` for nullability. Use `count()`, `.select().from(table).where(...)`, `.orderBy(asc(idColumn))`, and `.limit(...)` for reads.

- [ ] **Step 4: Run focused API route tests**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts`

Expected: PASS for existing tests plus new admin tests after Task 2 is complete.

## Task 2: API Routes and Server Registration

**Files:**
- Create: `apps/api/src/routes/admin-database.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Create route plugin**

Create `apps/api/src/routes/admin-database.ts`:

```ts
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAdminDatabaseService } from "../services/admin-database-service.js";

type RouteOptions = { db: Db };

const tableParamsSchema = z.object({ table: z.string().min(1) });
const rowQuerySchema = z.object({ id: z.string().uuid() });
const rowNeighborQuerySchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["prev", "next"])
});
const rowsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const registerAdminDatabaseRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const service = createAdminDatabaseService(db);

  app.get("/admin/database/tables", async () => service.listTables());

  app.get("/admin/database/tables/:table/schema", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    return service.getSchema(table);
  });

  app.get("/admin/database/tables/:table/row", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    const { id } = rowQuerySchema.parse(request.query);
    return service.getRow(table, id);
  });

  app.get("/admin/database/tables/:table/row-neighbor", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    const { id, direction } = rowNeighborQuerySchema.parse(request.query);
    return service.getNeighbor(table, id, direction);
  });

  app.get("/admin/database/tables/:table/rows", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    const { limit } = rowsQuerySchema.parse(request.query);
    return service.listRows(table, limit);
  });
};
```

- [ ] **Step 2: Register routes**

Modify `apps/api/src/server.ts` to import and register:

```ts
import { registerAdminDatabaseRoutes } from "./routes/admin-database.js";
```

and:

```ts
  app.register(registerAdminDatabaseRoutes, { prefix: "/api", db });
```

- [ ] **Step 3: Run focused API route tests**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts`

Expected: PASS.

## Task 3: Web Query Helpers and Admin Page Tests

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/routes/admin-database.test.tsx`

- [ ] **Step 1: Add failing web tests**

Create `apps/web/src/routes/admin-database.test.tsx` with mocked React Query and router hooks. Include tests that render schema mode, row JSON mode, data list mode, and verify prev/next call `navigate` with row ids returned from mocked query data.

Use these expected user-visible strings:

```ts
expect(html).toContain("Database");
expect(html).toContain("projects");
expect(html).toContain("Schema");
expect(html).toContain("Row JSON");
expect(html).toContain("Data List");
expect(html).toContain("created_at");
expect(html).toContain("&quot;name&quot;: &quot;Sample&quot;");
expect(html).toContain("Sample");
```

- [ ] **Step 2: Run web test to verify failure**

Run: `pnpm --filter web test -- src/routes/admin-database.test.tsx`

Expected: FAIL because `AdminDatabasePage` and query helpers do not exist.

- [ ] **Step 3: Add DTOs and query helpers**

Modify `apps/web/src/api/queries.ts` with:

```ts
export type AdminDatabaseTableDto = {
  name: string;
  label: string;
  rowCount: number;
  supportsRowId: boolean;
};

export type AdminDatabaseColumnDto = {
  name: string;
  dataType: string;
  notNull: boolean;
};

export type AdminDatabaseSchemaDto = {
  table: string;
  primaryKey: string | null;
  columns: AdminDatabaseColumnDto[];
};

export type AdminDatabaseRowDto = {
  table: string;
  row: Record<string, unknown> | null;
};

export type AdminDatabaseRowsDto = {
  table: string;
  rows: Array<Record<string, unknown>>;
  limit: number;
};
```

Add query keys and functions:

```ts
  adminDatabaseTables: ["admin", "database", "tables"] as const,
  adminDatabaseSchema: (table: string) => ["admin", "database", table, "schema"] as const,
  adminDatabaseRow: (table: string, id: string) => ["admin", "database", table, "row", id] as const,
  adminDatabaseRows: (table: string, limit: number) =>
    ["admin", "database", table, "rows", limit] as const,
```

and exported query helpers for `/api/admin/database/...`.

## Task 4: Admin Database UI and Routes

**Files:**
- Create: `apps/web/src/routes/admin-database.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/routes/root.tsx`

- [ ] **Step 1: Implement page component**

Create `AdminDatabasePage` with props:

```ts
type AdminDatabaseMode = "schema" | "row" | "rows";

type AdminDatabasePageProps = {
  tableName?: string;
  mode: AdminDatabaseMode;
  rowId?: string;
};
```

Use `useQuery` for tables, schema, selected row, and rows. Use `useNavigate` to change search state. Render a two-column page with table buttons on the left and mode buttons plus the active panel on the right.

- [ ] **Step 2: Wire router**

Modify `apps/web/src/app.tsx` to import `AdminDatabasePage`, validate search values, and add route:

```ts
const adminDatabaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/database",
  validateSearch: (search: Record<string, unknown>) => ({
    table: typeof search.table === "string" ? search.table : undefined,
    mode: search.mode === "row" || search.mode === "rows" ? search.mode : "schema",
    rowId: typeof search.rowId === "string" ? search.rowId : undefined
  }),
  component: () => {
    const { table, mode, rowId } = adminDatabaseRoute.useSearch();
    return <AdminDatabasePage tableName={table} mode={mode} rowId={rowId} />;
  }
});
```

Add `adminDatabaseRoute` to `routeTree`.

- [ ] **Step 3: Add header navigation**

Modify `apps/web/src/routes/root.tsx` to add a small Admin link to `/admin/database` in the header.

- [ ] **Step 4: Run focused web test**

Run: `pnpm --filter web test -- src/routes/admin-database.test.tsx`

Expected: PASS.

## Task 5: Verification

**Files:**
- All files above.

- [ ] **Step 1: Run API focused tests**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts`

Expected: PASS, unless local PostgreSQL on port 5436 is unavailable; if unavailable, report that database-backed tests could not run.

- [ ] **Step 2: Run web focused tests**

Run: `pnpm --filter web test -- src/routes/admin-database.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Build web**

Run: `pnpm --filter web build`

Expected: PASS.

- [ ] **Step 5: Browser inspection**

Start local services if needed with `pnpm dev` and inspect `http://127.0.0.1:5176/admin/database` in the in-app browser. Verify the table list, schema mode, row JSON mode controls, and data list mode render without overlap.
