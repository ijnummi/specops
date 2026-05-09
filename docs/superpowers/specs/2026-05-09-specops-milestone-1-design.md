# SpecOps Workbench Milestone 1 Design

Date: 2026-05-09

## Scope

Build Milestone 1 of SpecOps Workbench as a full vertical slice in the current directory. The result should let a developer create a project, initialize a `specops/` folder, create and edit markdown spec entities, index them into PostgreSQL, search entities, and navigate outgoing links, backlinks, and validation messages.

Milestone 1 implements the markdown-native spec graph. It does not implement AI features, GitHub integration, authentication, multi-user collaboration, embeddings, semantic search, PR creation, advanced TypeScript AST analysis, or visual graph rendering.

## Architecture

The project will be a pnpm TypeScript monorepo in the current directory. It will contain:

- `apps/web`
- `apps/api`
- `apps/worker`
- `packages/contracts`
- `packages/db`
- `packages/domain`
- `packages/markdown`
- `packages/graph`
- `packages/repo-scanner`
- `packages/taskgen`
- `packages/ai-prefill`
- `packages/config`
- `packages/testing`
- root Docker Compose, TypeScript, workspace, and README files

Milestone 1 will implement the core packages deeply: `domain`, `contracts`, `db`, `markdown`, `graph`, and `testing`. `repo-scanner`, `taskgen`, and `ai-prefill` will exist as future-facing package stubs so the repository structure matches the product brief without pulling later milestones into the first build.

The backend will be a Fastify API written in TypeScript. It will use Drizzle ORM with PostgreSQL. PostgreSQL stores derived cache data and workflow state, while markdown files under each project's configured `specops/` path remain canonical.

The worker app will be present but minimal. In Milestone 1, indexing will run synchronously through the API to keep the first vertical slice simple to operate and debug. A later milestone can move indexing into the worker without changing the core markdown and database boundaries.

The frontend will be a React app using TypeScript, TanStack Router, TanStack Query, Tailwind CSS, and CodeMirror 6. It will provide the actual Milestone 1 workflow rather than a marketing page.

## Data Model

PostgreSQL will include the initial tables from the brief:

- `projects`
- `index_runs`
- `spec_files`
- `spec_entities`
- `spec_links`
- `validation_messages`
- `source_files`
- `ai_proposals`

The `projects` table stores local project registry records, including `repo_path` and `specops_path`. The markdown files are still canonical; a project record is the app's local pointer to those files.

The `spec_entities` table stores indexed entities derived from markdown frontmatter and body content. Its `entity_id` is the stable markdown frontmatter ID, such as `uc.import-existing-project`.

The `spec_links` table stores derived graph edges. Entity and link types are strings to preserve the flexible graph model required by the brief.

The `validation_messages` table stores parser, indexer, and graph validation results from index runs.

The `source_files` and `ai_proposals` tables are included as schema foundations for future milestones, but Milestone 1 will not implement repository scanning or AI proposal workflows.

## Markdown Model

All canonical spec entities are markdown files with YAML frontmatter. Required fields are:

- `id`
- `type`
- `title`
- `status`

The markdown package will:

- discover `.md` files under a configured `specops/` path
- parse YAML frontmatter
- preserve unknown frontmatter fields in parsed data
- preserve body markdown
- validate required fields
- detect malformed frontmatter
- extract typed links from frontmatter
- report validation messages without crashing a whole index run because one file is invalid

The UI edits full markdown documents directly. Structured creation from templates will generate deterministic frontmatter and body markdown, but subsequent editing is markdown-native.

## Indexing Flow

Indexing is idempotent and rebuildable from markdown:

1. Start an `index_runs` record.
2. Discover markdown files under the project's `specops/` path.
3. Parse each markdown file independently.
4. Upsert `spec_files` records.
5. Upsert valid `spec_entities` records.
6. Replace derived links for the indexed project.
7. Remove deleted file, entity, and link records no longer present on disk.
8. Store validation messages for missing required fields, duplicate IDs, malformed frontmatter, broken links, unsupported statuses, duplicate titles, orphan entities, and empty bodies.
9. Mark the index run finished with entity, link, error, and warning counts.

Duplicate entity IDs are errors. The indexer will not silently choose one duplicate as authoritative. Broken links are warnings so users can draft linked specs out of order.

If PostgreSQL cache data is deleted, rerunning indexing for a registered project will rebuild files, entities, links, and validation messages from markdown. If project registry records are also deleted, the user can recreate a project record that points at the existing `specops/` folder, then re-index.

## API

The API will follow the route shape from the brief:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `POST /api/projects/:projectId/init-specops`
- `POST /api/projects/:projectId/index`
- `GET /api/projects/:projectId/entities`
- `GET /api/projects/:projectId/entities/:entityId`
- `PUT /api/projects/:projectId/entities/:entityId/markdown`
- `POST /api/projects/:projectId/entities`
- `GET /api/projects/:projectId/entities/:entityId/outgoing-links`
- `GET /api/projects/:projectId/entities/:entityId/backlinks`
- `GET /api/projects/:projectId/search?q=...`
- `GET /api/projects/:projectId/validation-messages`
- `GET /api/projects/:projectId/index-runs`

Entity creation will write a markdown file from a template, then trigger or allow indexing. Markdown save will validate that the target path stays inside the configured `specops/` directory before writing.

Search will initially use PostgreSQL matching across entity ID, title, type, and body markdown or body text. This satisfies Milestone 1 while leaving room for future full-text search improvements.

## UI

The web app will use a workbench layout. The first screen will be a project dashboard with project creation controls and existing project cards showing path, entity counts, link counts, validation counts, and last indexed time.

Project detail will include:

- navigation grouped by spec type
- searchable entity list
- entity creation action
- manual re-index action
- validation access
- main entity detail/editor area

Entity detail will include:

- title
- ID
- type
- status
- file path
- CodeMirror markdown editor
- save action
- re-index action
- outgoing links panel
- backlinks panel
- validation messages panel

The UI style will be quiet and operational: dense but readable, restrained colors, clear panels, small radius, and no landing-page hero. Graph navigation is represented by outgoing-link and backlink panels in Milestone 1.

## Filesystem Safety

All project filesystem operations will validate paths before reading or writing. API operations that create or update markdown files must ensure the final resolved path remains inside the configured `specops/` directory.

Saving markdown writes the full document the user edits. Because the editor works directly on markdown, unknown frontmatter fields are not discarded during normal edits.

Template initialization will create the required `specops/` directory layout, starter ADRs, domain specs, interface specs, use cases, and templates from the brief.

## Error Handling

Malformed frontmatter, missing required fields, unreadable files, duplicate IDs, broken links, unsupported statuses, duplicate titles, and empty bodies will be reported as validation messages.

Parser and indexer errors should be scoped to the file or operation that failed. A bad markdown file should not prevent the indexer from reporting other valid files in the same project.

API responses will use shared Zod contracts where practical, with clear error payloads for user-facing failures such as invalid project paths, invalid entity IDs, unsafe file paths, and database errors.

## Testing

Tests will focus on the parts most central to the architecture:

- `packages/markdown`: frontmatter parsing, malformed files, required field validation, link extraction, serialization behavior, and file discovery.
- `packages/graph`: outgoing links, backlinks, broken links, and orphan checks.
- API or service-level indexing tests: idempotency, deleted file detection, duplicate ID handling, and validation message persistence.

Root scripts will include:

- `pnpm typecheck`
- `pnpm test`
- `pnpm dev`

The repository will also include Docker Compose for PostgreSQL and a README that explains setup, migration, development servers, and the Milestone 1 workflow.

## Acceptance Criteria

Milestone 1 is complete when:

- a new project can be created
- a `specops/` folder can be initialized
- markdown spec files can be created from templates
- spec files can be edited in the UI
- frontmatter is parsed and validated
- entities are indexed into PostgreSQL
- links are indexed into PostgreSQL
- broken links are shown as warnings
- entity detail pages show backlinks and outgoing links
- search finds entities by title, ID, type, and body text
- database cache data can be deleted and rebuilt from markdown files
- parser and indexer tests exist
- Docker Compose starts PostgreSQL
- README explains how to run the project
