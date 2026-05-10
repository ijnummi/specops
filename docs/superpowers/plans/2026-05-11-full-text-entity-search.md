# Full-Text Entity Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace project entity substring filtering with PostgreSQL-backed full-text entity search that returns ranked results, snippets, and filterable metadata.

**Architecture:** Keep `GET /api/projects/:projectId/search` as the public route, but change its response from raw `SpecEntityDto[]` to focused search result DTOs. Add a PostgreSQL expression GIN index over weighted entity fields and implement query construction in a small API search service. The project detail UI keeps the existing sidebar search box, uses server results for non-empty queries, and shows an expanded search-results panel when no entity is selected.

**Tech Stack:** TypeScript, Fastify, Zod, Drizzle ORM, PostgreSQL full-text search, React, TanStack Query, TanStack Router, Vitest.

---

## File Structure

- Modify `packages/contracts/src/entities.ts`: add search query/result Zod schemas and exported types.
- Modify `packages/contracts/src/entities.test.ts`: cover query defaults, limit bounds, filters, and result shape.
- Modify `packages/db/migrations/0000_initial.sql`: add idempotent expression GIN index for entity full-text search.
- Create `apps/api/src/services/entity-search-service.ts`: isolate PostgreSQL full-text query construction and result mapping.
- Modify `apps/api/src/routes/search.ts`: validate query params with shared contract schema and delegate to the service.
- Modify `apps/api/src/__tests__/routes.test.ts`: replace current substring search assertion with full-text ranking, filters, snippets, project isolation, and validation tests.
- Modify `apps/web/src/api/queries.ts`: type search query helpers around the new DTO and include filters/limit in cache keys.
- Create `apps/web/src/components/entity-search-results.tsx`: render compact and expanded search result lists.
- Create `apps/web/src/components/entity-search-results.test.tsx`: cover rendering and navigation links.
- Create `apps/web/src/lib/use-debounced-value.ts`: shared client hook for delayed search input updates.
- Modify `apps/web/src/routes/project-detail.tsx`: use debounced server search for active queries and render sidebar/main search results.
- Modify `apps/web/src/routes/project-detail.test.tsx`: cover search query wiring and main-panel behavior.

---

### Task 1: Contracts for Entity Search

**Files:**
- Modify: `packages/contracts/src/entities.ts`
- Modify: `packages/contracts/src/entities.test.ts`

- [ ] **Step 1: Add failing contract tests**

Add these imports in `packages/contracts/src/entities.test.ts`:

```ts
import {
  createEntityRequestSchema,
  entitySearchQuerySchema,
  entitySearchResultSchema,
  updateEntityMarkdownRequestSchema
} from "./entities.js";
```

Append these tests:

```ts
describe("entitySearchQuerySchema", () => {
  it("requires non-empty q and defaults limit to 25", () => {
    expect(entitySearchQuerySchema.parse({ q: "customer" })).toEqual({
      q: "customer",
      limit: 25
    });

    expect(() => entitySearchQuerySchema.parse({ q: "   " })).toThrow();
  });

  it("accepts optional type, status, and bounded limit filters", () => {
    expect(
      entitySearchQuerySchema.parse({
        q: "customer",
        type: "domain_entity",
        status: "draft",
        limit: "50"
      })
    ).toEqual({
      q: "customer",
      type: "domain_entity",
      status: "draft",
      limit: 50
    });

    expect(() => entitySearchQuerySchema.parse({ q: "customer", limit: "51" })).toThrow();
    expect(() => entitySearchQuerySchema.parse({ q: "customer", limit: "0" })).toThrow();
  });
});

describe("entitySearchResultSchema", () => {
  it("parses a ranked entity search result", () => {
    expect(
      entitySearchResultSchema.parse({
        entityId: "domain.customer",
        title: "Customer",
        type: "domain_entity",
        status: "draft",
        filePath: "domain/domain.customer.md",
        rank: 0.92,
        snippet: "Customer profile requirements",
        matchedFields: ["title", "bodyText"]
      })
    ).toEqual({
      entityId: "domain.customer",
      title: "Customer",
      type: "domain_entity",
      status: "draft",
      filePath: "domain/domain.customer.md",
      rank: 0.92,
      snippet: "Customer profile requirements",
      matchedFields: ["title", "bodyText"]
    });
  });
});
```

- [ ] **Step 2: Run contract tests to verify failure**

Run: `pnpm --filter @specops/contracts test -- entities.test.ts`

Expected: FAIL with missing exports for `entitySearchQuerySchema` and `entitySearchResultSchema`.

- [ ] **Step 3: Add schemas and types**

In `packages/contracts/src/entities.ts`, after `specEntitySchema`, add:

```ts
export const entitySearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});

export const entitySearchResultSchema = z.object({
  entityId: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  filePath: z.string(),
  rank: z.number(),
  snippet: z.string(),
  matchedFields: z.array(z.enum(["entityId", "title", "type", "status", "bodyText"]))
});
```

At the bottom of the file, add:

```ts
export type EntitySearchQuery = z.infer<typeof entitySearchQuerySchema>;
export type EntitySearchResultDto = z.infer<typeof entitySearchResultSchema>;
```

- [ ] **Step 4: Run contract tests**

Run: `pnpm --filter @specops/contracts test -- entities.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/entities.ts packages/contracts/src/entities.test.ts
git commit -m "feat: add entity search contracts"
```

---

### Task 2: Database Full-Text Index

**Files:**
- Modify: `packages/db/migrations/0000_initial.sql`

- [ ] **Step 1: Add expression GIN index migration**

Add this after the existing `spec_entities_project_status_idx` index in `packages/db/migrations/0000_initial.sql`:

```sql
CREATE INDEX IF NOT EXISTS spec_entities_search_vector_idx ON spec_entities USING gin (
  (
    setweight(to_tsvector('simple', coalesce(entity_id, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(status, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_text, '')), 'C')
  )
);
```

- [ ] **Step 2: Apply migration to local database**

Run: `pnpm db:migrate`

Expected: command completes without SQL errors. If PostgreSQL is not running locally, start it with `docker compose up -d postgres` and rerun.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/0000_initial.sql
git commit -m "feat: index entity full-text search"
```

---

### Task 3: API Search Service

**Files:**
- Create: `apps/api/src/services/entity-search-service.ts`
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing API tests**

In `apps/api/src/__tests__/routes.test.ts`, replace the existing test named `creates an entity markdown file, indexes it, and returns searchable entities` with:

```ts
  it("creates an entity markdown file, indexes it, and returns ranked search results", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const createEntityResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/entities`,
      payload: {
        entityId: "domain.customer",
        type: "domain_entity",
        title: "Customer",
        status: "draft"
      }
    });

    expect(createEntityResponse.statusCode).toBe(201);

    const searchResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer`
    });
    const searchBody = searchResponse.json() as Array<{
      entityId: string;
      title: string;
      rank: number;
      snippet: string;
      matchedFields: string[];
    }>;

    expect(searchResponse.statusCode).toBe(200);
    expect(searchBody).toHaveLength(1);
    expect(searchBody[0]).toMatchObject({
      entityId: "domain.customer",
      title: "Customer",
      type: "domain_entity",
      status: "draft",
      filePath: "domain/domain.customer.md"
    });
    expect(searchBody[0].rank).toBeGreaterThan(0);
    expect(searchBody[0].snippet).toContain("Customer");
    expect(searchBody[0].matchedFields).toContain("title");
  });
```

Append these database-backed route tests near the search test:

```ts
  it("ranks title and id matches ahead of body-only search matches", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash) values " +
        "($1, 'domain.customer', 'domain_entity', 'Customer', 'draft', 'domain/customer.md', '# Customer', 'Customer summary', 'hash-1')," +
        "($1, 'domain.billing', 'domain_entity', 'Billing', 'draft', 'domain/billing.md', '# Billing', 'This body mentions customer records many times customer customer.', 'hash-2')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer`
    });
    const body = response.json() as Array<{ entityId: string; rank: number }>;

    expect(response.statusCode).toBe(200);
    expect(body.map((row) => row.entityId)).toEqual(["domain.customer", "domain.billing"]);
    expect(body[0].rank).toBeGreaterThanOrEqual(body[1].rank);
  });

  it("filters entity search by type and status", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash) values " +
        "($1, 'domain.customer', 'domain_entity', 'Customer', 'draft', 'domain/customer.md', '# Customer', 'Customer', 'hash-1')," +
        "($1, 'uc.customer', 'use_case', 'Customer', 'ready', 'use-cases/uc.customer.md', '# Customer', 'Customer', 'hash-2')",
      [project.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer&type=use_case&status=ready`
    });
    const body = response.json() as Array<{ entityId: string }>;

    expect(response.statusCode).toBe(200);
    expect(body.map((row) => row.entityId)).toEqual(["uc.customer"]);
  });

  it("keeps entity search isolated by project and enforces limit", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    const otherProject = await createProjectViaApi();
    await pool.query(
      "insert into spec_entities (project_id, entity_id, type, title, status, file_path, body_markdown, body_text, content_hash) values " +
        "($1, 'domain.customer-one', 'domain_entity', 'Customer One', 'draft', 'domain/customer-one.md', '# Customer One', 'Customer', 'hash-1')," +
        "($1, 'domain.customer-two', 'domain_entity', 'Customer Two', 'draft', 'domain/customer-two.md', '# Customer Two', 'Customer', 'hash-2')," +
        "($2, 'domain.customer-other', 'domain_entity', 'Customer Other', 'draft', 'domain/customer-other.md', '# Customer Other', 'Customer', 'hash-3')",
      [project.id, otherProject.id]
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer&limit=1`
    });
    const body = response.json() as Array<{ entityId: string }>;

    expect(response.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].entityId).not.toBe("domain.customer-other");
  });

  it("rejects invalid entity search queries", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const emptyResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=`
    });
    const limitResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/search?q=customer&limit=51`
    });

    expect(emptyResponse.statusCode).toBe(400);
    expect(limitResponse.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run API route tests to verify failure**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts`

Expected: FAIL because `/search` still returns raw entity DTOs and does not enforce `limit`.

- [ ] **Step 3: Create entity search service**

Create `apps/api/src/services/entity-search-service.ts`:

```ts
import { sql } from "drizzle-orm";

import type { EntitySearchQuery, EntitySearchResultDto } from "@specops/contracts";
import type { Db } from "@specops/db";

type EntitySearchRow = {
  entity_id: string;
  title: string;
  type: string;
  status: string;
  file_path: string;
  rank: string | number;
  snippet: string | null;
  matched_entity_id: boolean;
  matched_title: boolean;
  matched_type: boolean;
  matched_status: boolean;
  matched_body_text: boolean;
};

export function createEntitySearchService(db: Db) {
  return {
    async searchEntities(projectId: string, query: EntitySearchQuery): Promise<EntitySearchResultDto[]> {
      const pattern = `%${escapeLike(query.q)}%`;
      const result = await db.execute<EntitySearchRow>(sql`
        with search_query as (
          select websearch_to_tsquery('simple', ${query.q}) as query
        )
        select
          entity_id,
          title,
          type,
          status,
          file_path,
          ts_rank_cd(
            setweight(to_tsvector('simple', coalesce(entity_id, '')), 'A') ||
            setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('simple', coalesce(type, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(status, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(body_text, '')), 'C'),
            search_query.query
          ) as rank,
          ts_headline(
            'simple',
            body_text,
            search_query.query,
            'StartSel=, StopSel=, MaxWords=18, MinWords=6, ShortWord=3, HighlightAll=false'
          ) as snippet,
          entity_id ilike ${pattern} escape '\\' as matched_entity_id,
          title ilike ${pattern} escape '\\' as matched_title,
          type ilike ${pattern} escape '\\' as matched_type,
          status ilike ${pattern} escape '\\' as matched_status,
          body_text ilike ${pattern} escape '\\' as matched_body_text
        from spec_entities, search_query
        where project_id = ${projectId}
          and (${query.type ?? null}::text is null or type = ${query.type ?? null})
          and (${query.status ?? null}::text is null or status = ${query.status ?? null})
          and (
            setweight(to_tsvector('simple', coalesce(entity_id, '')), 'A') ||
            setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('simple', coalesce(type, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(status, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(body_text, '')), 'C')
          ) @@ search_query.query
        order by rank desc, entity_id asc
        limit ${query.limit}
      `);

      return result.rows.map(mapSearchRow);
    }
  };
}

function mapSearchRow(row: EntitySearchRow): EntitySearchResultDto {
  return {
    entityId: row.entity_id,
    title: row.title,
    type: row.type,
    status: row.status,
    filePath: row.file_path,
    rank: Number(row.rank),
    snippet: row.snippet ?? "",
    matchedFields: matchedFields(row)
  };
}

function matchedFields(row: EntitySearchRow): EntitySearchResultDto["matchedFields"] {
  const fields: EntitySearchResultDto["matchedFields"] = [];
  if (row.matched_entity_id) fields.push("entityId");
  if (row.matched_title) fields.push("title");
  if (row.matched_type) fields.push("type");
  if (row.matched_status) fields.push("status");
  if (row.matched_body_text) fields.push("bodyText");
  return fields;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
```

- [ ] **Step 4: Update search route**

Replace `apps/api/src/routes/search.ts` with:

```ts
import { entitySearchQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectService } from "../services/project-service.js";
import { createEntitySearchService } from "../services/entity-search-service.js";

type RouteOptions = {
  db: Db;
};

const searchParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerSearchRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const entitySearchService = createEntitySearchService(db);

  app.get("/projects/:projectId/search", async (request) => {
    const { projectId } = searchParamsSchema.parse(request.params);
    const query = entitySearchQuerySchema.parse(request.query);

    await projectService.getProject(projectId);
    return entitySearchService.searchEntities(projectId, query);
  });
};
```

- [ ] **Step 5: Run API route tests**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/entity-search-service.ts apps/api/src/routes/search.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: search entities with full text"
```

---

### Task 4: Web Query Helper and Result Component

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/entity-search-results.tsx`
- Create: `apps/web/src/components/entity-search-results.test.tsx`

- [ ] **Step 1: Add failing component tests**

Create `apps/web/src/components/entity-search-results.test.tsx`:

```tsx
import type { EntitySearchResultDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className
  }: {
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

import { EntitySearchResults } from "./entity-search-results.js";

describe("EntitySearchResults", () => {
  it("renders compact ranked search results with snippets and links", () => {
    const html = renderToStaticMarkup(
      <EntitySearchResults
        projectId="project-1"
        query="customer"
        results={results}
        selectedEntityId={null}
        variant="compact"
      />
    );

    expect(html).toContain("Customer");
    expect(html).toContain("domain.customer");
    expect(html).toContain("domain_entity");
    expect(html).toContain("draft");
    expect(html).toContain("Customer profile requirements");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:domain.customer:customer");
  });

  it("renders expanded empty state", () => {
    const html = renderToStaticMarkup(
      <EntitySearchResults
        projectId="project-1"
        query="missing"
        results={[]}
        selectedEntityId={null}
        variant="expanded"
      />
    );

    expect(html).toContain("No results for");
    expect(html).toContain("missing");
  });
});

const results: EntitySearchResultDto[] = [
  {
    entityId: "domain.customer",
    title: "Customer",
    type: "domain_entity",
    status: "draft",
    filePath: "domain/domain.customer.md",
    rank: 0.91,
    snippet: "Customer profile requirements",
    matchedFields: ["title", "bodyText"]
  }
];
```

- [ ] **Step 2: Run web component test to verify failure**

Run: `pnpm --filter web test -- entity-search-results.test.tsx`

Expected: FAIL because `entity-search-results.tsx` does not exist.

- [ ] **Step 3: Update web query helper**

In `apps/web/src/api/queries.ts`, add imported types:

```ts
  EntitySearchQuery,
  EntitySearchResultDto,
```

Change the search key and helper to:

```ts
  search: (projectId: string, input: EntitySearchQuery) =>
    ["projects", projectId, "search", input] as const
```

```ts
export function searchQuery(projectId: string, input: EntitySearchQuery) {
  const search = new URLSearchParams({
    q: input.q,
    limit: String(input.limit)
  });
  if (input.type) search.set("type", input.type);
  if (input.status) search.set("status", input.status);

  return queryOptions({
    queryKey: queryKeys.search(projectId, input),
    queryFn: () =>
      apiGet<EntitySearchResultDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/search?${search.toString()}`
      )
  });
}
```

- [ ] **Step 4: Create result component**

Create `apps/web/src/components/entity-search-results.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { EntitySearchResultDto } from "@specops/contracts";

type EntitySearchResultsProps = {
  projectId: string;
  query: string;
  results: EntitySearchResultDto[];
  selectedEntityId: string | null;
  variant: "compact" | "expanded";
  onBeforeSelect?: () => boolean;
};

export function EntitySearchResults({
  projectId,
  query,
  results,
  selectedEntityId,
  variant,
  onBeforeSelect
}: EntitySearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className={variant === "compact" ? "p-3 text-sm text-slate-500" : "rounded border border-slate-200 bg-white p-4 text-sm text-slate-600"}>
        No results for <span className="font-medium text-slate-800">{query}</span>.
      </div>
    );
  }

  return (
    <div className={variant === "compact" ? "min-h-0 flex-1 overflow-auto p-2" : "rounded border border-slate-200 bg-white"}>
      {variant === "expanded" ? (
        <div className="border-b border-slate-200 p-3">
          <h2 className="text-sm font-semibold text-slate-900">Search results</h2>
          <p className="mt-1 text-xs text-slate-500">
            {results.length} result{results.length === 1 ? "" : "s"} for {query}
          </p>
        </div>
      ) : null}
      <div className="grid gap-1 p-2">
        {results.map((result) => (
          <Link
            key={result.entityId}
            to="/projects/$projectId/entities/$entityId"
            params={{ projectId, entityId: result.entityId }}
            search={{ q: query }}
            onClick={(event) => {
              if (result.entityId !== selectedEntityId && onBeforeSelect && !onBeforeSelect()) {
                event.preventDefault();
              }
            }}
            className={
              result.entityId === selectedEntityId
                ? "entity-row border-slate-300 bg-slate-100"
                : "entity-row border-transparent hover:border-slate-200 hover:bg-slate-50"
            }
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-900">{result.title}</span>
              <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                {result.status}
              </span>
            </span>
            <span className="truncate text-xs text-slate-500">
              {result.entityId} · {result.type}
            </span>
            {result.snippet ? (
              <span className="line-clamp-2 text-xs text-slate-600">{result.snippet}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run web component test**

Run: `pnpm --filter web test -- entity-search-results.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/queries.ts apps/web/src/components/entity-search-results.tsx apps/web/src/components/entity-search-results.test.tsx
git commit -m "feat: add entity search results UI"
```

---

### Task 5: Project Detail Search Wiring

**Files:**
- Create: `apps/web/src/lib/use-debounced-value.ts`
- Modify: `apps/web/src/routes/project-detail.tsx`
- Modify: `apps/web/src/routes/project-detail.test.tsx`

- [ ] **Step 1: Add failing project detail tests**

In `apps/web/src/routes/project-detail.test.tsx`, update the `mocks` object:

```ts
  searchQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
```

In the existing `vi.mock("../api/queries.js", () => ({ }))` factory block, add:

```ts
  searchQuery: vi.fn((projectId: string, input: { q: string; limit: number }) => ({
    queryKey: ["projects", projectId, "search", input],
    queryType: "search",
    enabled: input.q.length > 0
  })),
```

Add this to `queryKeys`:

```ts
    search: (projectId: string, input: { q: string; limit: number }) => [
      "projects",
      projectId,
      "search",
      input
    ],
```

Update mocked `useQuery`:

```ts
    if (options.queryType === "search") {
      mocks.searchQueryOptions.push(options);
      return {
        data: [
          {
            entityId: "domain.customer",
            title: "Customer",
            type: "domain_entity",
            status: "draft",
            filePath: "domain/domain.customer.md",
            rank: 0.9,
            snippet: "Customer profile requirements",
            matchedFields: ["title", "bodyText"]
          }
        ],
        error: null,
        isLoading: false
      };
    }
```

Mock the new component:

```ts
vi.mock("../components/entity-search-results.js", () => ({
  EntitySearchResults: ({
    query,
    variant
  }: {
    query: string;
    variant: "compact" | "expanded";
  }) => <div>Search results {variant}: {query}</div>
}));
```

Reset `mocks.searchQueryOptions = [];` in `beforeEach`.

Append tests:

```ts
  it("renders expanded search results instead of overview when query is active and no entity is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="customer" />
    );

    expect(html).toContain("Search results expanded: customer");
    expect(html).not.toContain("Project overview dashboard:");
  });

  it("keeps entity editor visible when query is active and an entity is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId="entity-1" query="customer" />
    );

    expect(html).toContain("Entity editor: entity-1");
    expect(html).not.toContain("Search results expanded:");
  });

  it("enables server search only for non-empty queries", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);
    renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="customer" />
    );

    expect(mocks.searchQueryOptions).toContainEqual(
      expect.objectContaining({ enabled: false })
    );
    expect(mocks.searchQueryOptions).toContainEqual(
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "search", { q: "customer", limit: 25 }]
      })
    );
  });
```

- [ ] **Step 2: Run project detail tests to verify failure**

Run: `pnpm --filter web test -- project-detail.test.tsx`

Expected: FAIL because `ProjectDetailPage` does not call `searchQuery` or render `EntitySearchResults`.

- [ ] **Step 3: Add debounce hook**

Create `apps/web/src/lib/use-debounced-value.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}
```

- [ ] **Step 4: Wire search in project detail page**

In `apps/web/src/routes/project-detail.tsx`, add imports:

```ts
  searchQuery,
```

```ts
import { EntitySearchResults } from "../components/entity-search-results.js";
import { useDebouncedValue } from "../lib/use-debounced-value.js";
```

After `const normalizedQuery = query.trim().toLowerCase();`, add:

```ts
  const hasActiveQuery = normalizedQuery.length > 0;
  const debouncedQuery = useDebouncedValue(query.trim(), 200);
  const hasDebouncedQuery = debouncedQuery.length > 0;
  const searchInput = { q: debouncedQuery, limit: 25 };
  const searchOptions = searchQuery(projectId, searchInput);
  const searchResults = useQuery({
    queryKey: searchOptions.queryKey,
    queryFn: searchOptions.queryFn,
    enabled: hasActiveQuery
  });
```

Change the `filteredEntities` empty-query logic to:

```ts
  const filteredEntities = useMemo(() => {
    const all = entities.data ?? [];
    if (!normalizedQuery) {
      return all;
    }

    return all.filter((entity) =>
      [entity.entityId, entity.title, entity.type, entity.status, entity.bodyText, entity.filePath]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [entities.data, normalizedQuery]);
```

Keep `filteredEntities` as the fallback for empty query. Replace sidebar `EntityList` rendering with:

```tsx
          {hasActiveQuery ? (
            searchResults.error ? (
              <p className="p-3 text-sm text-red-700">{searchResults.error.message}</p>
            ) : searchResults.isLoading || !hasDebouncedQuery ? (
              <p className="p-3 text-sm text-slate-500">Searching</p>
            ) : (
              <EntitySearchResults
                projectId={projectId}
                query={query.trim()}
                results={searchResults.data ?? []}
                selectedEntityId={selectedEntityId}
                variant="compact"
                onBeforeSelect={confirmEntitySwitch}
              />
            )
          ) : (
            <EntityList
              projectId={projectId}
              entities={filteredEntities}
              selectedEntityId={selectedEntityId}
              query={query}
              onBeforeSelect={confirmEntitySwitch}
            />
          )}
```

Before the overview branch in the main panel, add this branch after the `selectedEntityId` branch:

```tsx
      ) : hasActiveQuery ? (
        searchResults.error ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {searchResults.error.message}
          </div>
        ) : searchResults.isLoading || !hasDebouncedQuery ? (
          <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Searching
          </div>
        ) : (
          <EntitySearchResults
            projectId={projectId}
            query={query.trim()}
            results={searchResults.data ?? []}
            selectedEntityId={selectedEntityId}
            variant="expanded"
            onBeforeSelect={confirmEntitySwitch}
          />
        )
```

- [ ] **Step 5: Run project detail tests**

Run: `pnpm --filter web test -- project-detail.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/use-debounced-value.ts apps/web/src/routes/project-detail.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "feat: use server entity search in project view"
```

---

### Task 6: Final Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm test`

Expected: PASS. If PostgreSQL is not running, start it with `docker compose up -d postgres`, run `pnpm db:migrate`, ensure the test database exists, and rerun.

- [ ] **Step 3: Run web build**

Run: `pnpm --filter web build`

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: only intentional files from the implementation are changed, or no changes if all task commits were made.

- [ ] **Step 5: Commit any verification-only fixes**

If verification exposed fixes, commit only those fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize entity search"
```

If no fixes were needed, do not create an empty commit.
