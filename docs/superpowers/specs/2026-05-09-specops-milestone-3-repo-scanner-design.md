# SpecOps Workbench Milestone 3 Repository Scanner Design

Date: 2026-05-09

## Scope

Milestone 3 adds TypeScript-focused repository scanning to SpecOps Workbench. A user can run the existing project indexing workflow and have the workbench refresh both markdown-derived spec data and source-code facts for the same local repository.

The scanner discovers supported JavaScript and TypeScript files, stores source-file inventory, and extracts normalized module facts: imports, exports, top-level symbols, and conservative source/test/config classification.

Milestone 3 does not edit source files, generate AI summaries, create AI proposals, infer spec links from code, perform deep semantic type-checking, build call graphs, detect dead code, scan dependency vulnerabilities, or support non-JavaScript ecosystems.

## Product Behavior

The user keeps one primary refresh action: run project indexing. After the refresh completes, the project detail view shows the usual spec index information plus a compact source inventory summary.

The source inventory is inspect-only. Users can filter source files by language, kind, and text search, select a file, and inspect its symbols, imports, and exports. Source files remain canonical in the repository; PostgreSQL stores only rebuildable scan results.

Parse failures or unsupported constructs should not block the full refresh. The workbench should preserve successfully scanned files and surface per-file scan warnings through validation messages tied to the file path.

## Architecture

Repository scanning is a distinct phase inside the existing project index workflow. The backend refreshes markdown specs and then refreshes source-code facts for the same project. This keeps the user workflow simple while preserving internal boundaries for later async worker execution.

The scanner core lives in `packages/repo-scanner` as a pure TypeScript package. It walks the project repository, filters supported files, reads file metadata and content hashes, and extracts module facts. It must not depend on Fastify, Drizzle, PostgreSQL, or React.

The API owns orchestration and persistence. The existing index service calls the scanner phase after markdown indexing succeeds, while keeping scanner persistence in a separate source-scan service. Scanner results are written to `source_files` plus normalized fact tables. The scan phase should be replaceable later by a worker without changing the scanner package contract.

The web app owns inspection. It adds a compact source inventory view to the project detail workflow, using the API read endpoints for aggregate counts, file lists, and selected file details.

## Data Model

Milestone 3 keeps `source_files` as the file inventory table and adds normalized scanner fact tables.

`source_files` remains one row per discovered source file per project. It stores project ID, project-relative path, language, kind, byte size, content hash, and `last_seen_at`. The table should enforce uniqueness for `(project_id, path)` so refreshes can upsert cleanly.

`source_symbols` stores top-level declarations found in a file:

- project ID
- source file ID
- file path for convenient reads
- symbol name
- symbol kind
- exported flag
- line number when available
- metadata JSON for narrow parser details that do not deserve first-class columns yet

Common symbol kinds include function, class, interface, type alias, enum, constant, React component, and test suite.

`source_imports` stores import edges from a file to module specifiers:

- project ID
- source file ID
- file path
- raw module specifier
- import kind
- imported names when available
- whether the specifier is relative or package-based
- resolved project-relative target path when resolution is straightforward

`source_exports` stores exported names and export style:

- project ID
- source file ID
- file path
- exported name
- export kind
- source specifier for re-exports when present

Scan refresh should replace source files and source facts for the current project with the latest scanner output inside a transaction. Files not seen in the latest scan should be removed, because these tables are derived cache like the spec index.

## Scanning Behavior

Milestone 3 supports local TypeScript and JavaScript repositories. It should include `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs` files.

The scanner should exclude generated and heavy directories:

- `node_modules`
- `.git`
- `dist`
- `build`
- `coverage`
- `.next`
- `.turbo`
- generated output directories already common in the repo

It should also ignore common lock files and non-source assets.

The scanner should classify files conservatively:

- `source` for ordinary implementation files
- `test` for `*.test.*`, `*.spec.*`, `__tests__`, and common test directories
- `config` for known build, test, lint, package, and framework config files
- `entrypoint` for package or app entrypoints when cheaply detectable
- `unknown` when classification is unclear

Parsing should use the TypeScript compiler API. It should extract top-level imports, exports, and symbols without type-checking a full program.

Failed parses should not fail the entire index run. They should produce warnings tied to the file path and allow other files to be scanned.

## API

The existing project index endpoint remains the main write action. Running it refreshes markdown specs and source-code scan data in one request.

The response should include source scan counts in addition to existing entity, link, and validation counts by extending `IndexRunDto` with optional source counts. Optional fields preserve existing clients while giving the UI scan summary data.

Milestone 3 should expose source inventory read endpoints:

- list source files for a project, with optional filters for language, kind, and text search
- get one source file detail, including imports, exports, and symbols
- get aggregate source counts by kind and language for project detail summaries

The source inventory endpoints should read derived scan data only. They should not read arbitrary source files directly from disk in response to UI browsing.

## UI

The project detail view adds a source inventory area near existing index status and entity navigation.

The UI should be compact and work-focused:

- counts by file kind and language
- filter controls for language, kind, and text search
- source file list
- selected file detail with symbols, imports, and exports
- empty state when no source files have been scanned
- warning or error state when the latest scan produced parse warnings

The source inventory is inspect-only in Milestone 3. Users should not edit source files, create spec links from the source view, or accept AI proposals from the source view.

## Error Handling

The scanner should distinguish fatal project-level failures from file-level warnings.

Fatal failures include an unreadable repository path, an invalid project path, or a scanner crash before traversal can complete. These should make the source scan phase fail clearly.

File-level failures include unsupported syntax, parser errors, unreadable individual files, and best-effort resolution misses. These should produce warnings while preserving other scan results.

When markdown indexing succeeds but source scanning has warnings, the overall index request should complete with warning counts. When source scanning fatally fails after markdown indexing succeeds, canonical markdown remains unchanged and the API should return the failure without pretending source data is current.

## Testing

`@specops/repo-scanner` tests should use fixture projects and assert:

- file inclusion and exclusion
- language and kind classification
- stable content hashes
- import extraction
- export extraction
- top-level symbol extraction
- parse warning behavior

These scanner tests should be pure filesystem tests with no database.

API tests should cover integrated indexing:

- running the existing index endpoint refreshes source files and normalized facts
- deleted source files disappear on the next scan
- parse warnings are persisted as validation messages
- source inventory list endpoints filter by language, kind, and text search
- source file detail endpoints return imports, exports, and symbols

DB-backed API tests should continue using the existing `TEST_DATABASE_URL` pattern.

Web tests should cover:

- source inventory rendering
- filter state
- empty states
- loading and error states
- selected file detail display

The web test surface should stay focused so Milestone 3 does not become a broad UI rewrite.

## Acceptance Criteria

Milestone 3 is complete when:

- running project indexing refreshes both specs and TypeScript source-code facts
- supported TypeScript and JavaScript source files are persisted in `source_files`
- imports, exports, and top-level symbols are persisted in normalized tables
- deleted source files disappear from derived scan data after the next refresh
- scanner parse failures produce warnings instead of aborting the whole index
- generated and heavy directories are ignored
- the project detail UI exposes an inspect-only source inventory
- API endpoints expose source inventory lists, details, and aggregate counts
- scanner, API, and web tests cover the core workflow
