# Full-Text Entity Search Design

## Goal

Upgrade project entity search from client-side substring filtering to PostgreSQL-backed full-text search with ranking, snippets, and basic filters.

This is the first search improvement before broader cross-index search, semantic search, or embeddings. It should make the existing project sidebar search more useful without creating a separate search product surface.

## Scope

This slice searches only indexed spec entities in `spec_entities`.

Included:

- ranked full-text search across entity ID, title, type, status, and body text,
- optional filters for entity type and status,
- stable result limits,
- snippets suitable for compact UI display,
- server-backed sidebar search in the project detail view,
- an expanded search-results view in the main project panel when no entity is selected and a query is active.

Excluded:

- source file, symbol, validation, or agent-run search,
- embeddings or semantic search,
- saved searches,
- natural-language health queries such as "missing acceptance criteria",
- search across multiple projects.

## Backend Design

Add full-text search support to `spec_entities`.

The preferred implementation is a generated or maintained `tsvector` column named `search_vector`, backed by a GIN index. If Drizzle or the local migration style makes a generated column awkward, the service may compute the weighted vector in the query and use an expression index instead. The database migration must keep the index rebuildable from existing `spec_entities` rows.

Field weighting:

- `A`: `entity_id`, `title`
- `B`: `type`, `status`
- `C`: `body_text`

The search route remains:

```text
GET /api/projects/:projectId/search
```

Query parameters:

- `q`: required non-empty search text,
- `type`: optional exact entity type filter,
- `status`: optional exact status filter,
- `limit`: optional integer, default 25, maximum 50.

The route returns ranked entity search results instead of raw `SpecEntityDto` rows. Each result includes:

- entity fields needed by the sidebar: `entityId`, `title`, `type`, `status`, `filePath`,
- `rank`,
- `snippet`,
- `matchedFields`, derived from simple field-level checks for display hints.

Project isolation remains mandatory: every query filters by `projectId` before returning results.

## Frontend Design

The project detail search box remains in the sidebar.

When the query is empty, the sidebar keeps showing the local entity list loaded by `entitiesQuery`. When the query is non-empty, the sidebar uses the server-backed search endpoint after a short debounce. Search results replace the current filtered list and preserve the existing entity selection behavior.

Each result should show:

- title,
- entity ID,
- type and status,
- compact snippet when available.

When no entity is selected and a query is active, the main project panel shows a compact search-results view with the same ranked results and more room for snippets. Selecting a result opens the existing entity detail page. When an entity is selected, the entity detail page remains the main content.

The current project overview remains the default main panel when there is no active query.

## Data Flow

1. User types in the project sidebar search input.
2. The UI debounces the query.
3. Empty query uses the already loaded entity list.
4. Non-empty query calls `GET /api/projects/:projectId/search`.
5. The API validates query parameters, builds a PostgreSQL full-text query, applies filters and limit, and returns ranked results.
6. The sidebar renders compact results.
7. The main panel renders expanded results only when no entity is selected.

## Error Handling

The API rejects empty `q` values with the existing bad-request error style.

Invalid `limit`, `type`, or `status` parameters return a validation error through the existing Zod error handler. No matches return an empty result array. Search database failures use the existing API error handling path.

The frontend should show a small inline search error near the results area and keep the rest of the project page usable.

## Testing

Contracts:

- add schemas for entity search query and result DTOs,
- verify default and maximum limit parsing,
- verify optional filter parsing.

API:

- results are project-isolated,
- title and ID matches rank ahead of body-only matches,
- type and status filters narrow results,
- snippets are returned for body matches,
- empty query is rejected,
- limit is enforced.

Frontend:

- empty query renders the normal entity list,
- non-empty query renders server results,
- selecting a result navigates to the existing entity detail route,
- no selected entity plus active query renders expanded search results,
- search errors render without replacing the whole project page.

## Acceptance Criteria

- Searching from the project sidebar uses PostgreSQL full-text search for non-empty queries.
- Results are ranked and include snippets.
- Type, status, and limit filters are supported by the API.
- Empty search keeps the existing entity list behavior.
- Existing entity detail, overview, validation, and project action flows continue to work.
- `pnpm typecheck`, `pnpm test`, and `pnpm --filter web build` pass.
