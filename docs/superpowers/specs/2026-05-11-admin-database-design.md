# Admin Database Page Design

## Goal

Add a read-only admin database page for inspecting known SpecOps tables from the application database. The page should make common local debugging workflows faster without exposing arbitrary SQL or write access.

## Scope

- Add an Admin entry point in the web app and a Database tab under it.
- Show the known Drizzle-backed SpecOps tables in a left-side list.
- Show a main panel for the selected table with three modes:
  - Schema info.
  - One selected row as formatted JSON, with previous and next navigation, an id input, and a show-selected-row action.
  - Table data as a capped list.
- Keep the feature read-only.
- Limit API access to an explicit allowlist of known tables from `packages/db/src/schema.ts`.

## Non-Goals

- Arbitrary SQL execution.
- Editing, inserting, or deleting database rows.
- Browsing tables outside the SpecOps Drizzle schema.
- Full database administration features such as indexes, constraints, query plans, or permissions.

## Architecture

The API will expose admin database read endpoints under `/api/admin/database`. A small service will define the allowlisted tables, their display metadata, primary id column support, schema columns, row counts, selected-row fetches, row navigation, and capped row lists.

The web app will add a route at `/admin/database`. The page will use the existing TanStack Query client and API helper patterns. Table, mode, and selected row id will live in route search state so refreshes and links preserve the current inspection target.

## API Shape

- `GET /api/admin/database/tables`
  - Returns known table names, display labels, row counts, and whether row-by-id navigation is supported.
- `GET /api/admin/database/tables/:table/schema`
  - Returns column names, database types, nullability if available from the known schema metadata, and primary id support.
- `GET /api/admin/database/tables/:table/row?id=<id>`
  - Returns one row by id for tables that expose an `id` column.
- `GET /api/admin/database/tables/:table/row-neighbor?id=<id>&direction=prev|next`
  - Returns the previous or next row ordered by id.
- `GET /api/admin/database/tables/:table/rows?limit=50`
  - Returns a capped list of rows for the selected table.

Unknown table names return 404. Invalid row ids or unsupported row navigation return 400.

## UI Behavior

The page uses a two-column layout: a fixed-width table list on the left and a flexible main panel on the right. The main panel header shows the selected table, row count, and mode controls.

Schema mode presents a compact column list. Row JSON mode presents controls for previous, id input, show row, and next above a formatted JSON viewer. Data list mode presents rows in a dense list using stable row keys, with JSON-friendly rendering for nested values.

Loading and error states follow the existing white panel and red error panel patterns used in the workbench. Empty tables show an explicit empty state and disabled row navigation.

## Testing

API tests cover table allowlisting, table metadata, schema payloads, selected row by id, previous and next row navigation, capped row listing, and invalid table rejection.

Web tests cover table selection, mode switching, selected-row id submission, prev and next actions, schema rendering, and data-list rendering with mocked API responses.

Final verification should include `pnpm typecheck`, focused API and web tests, and browser inspection of the page against local services when practical.
