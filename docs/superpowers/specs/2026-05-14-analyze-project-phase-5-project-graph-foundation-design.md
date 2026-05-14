# Analyze Project Phase 5 Project Graph Foundation Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 5 as Better AI System Understanding. The current application has already moved past the first Analyze Project milestones:

- `Analyze project` is a guided first-run workflow.
- Analyze runs initialize, index, build a shallow system map, generate source and AI proposals, and link map areas to drafts.
- Draft review assemblies let users shape generated specs before markdown is written.
- Source/spec annotations store durable source-backed relationships.
- Refresh and project health work can use index commits, changed files, and annotations.

The current system map is useful as a run-scoped onboarding artifact, but it is intentionally shallow. It groups indexed files into broad areas such as backend routes, services, frontend routes, data models, tests, config, packages, and unknown files. It does not yet provide the Phase 5 foundation for dependency-aware analysis, missing-spec detection, or concept consolidation.

This design adds a scanner-only project graph facts layer. The graph should be trustworthy, deterministic, and queryable before AI is allowed to classify or consolidate concepts on top of it.

## Goals

- Build a current project graph from indexed source, spec, and annotation facts.
- Version graph builds by index run so every graph is tied to a known indexed source state.
- Represent files, packages, modules, symbols, route-like files, data-model files, test files, and spec entities as typed nodes.
- Represent deterministic relationships as typed edges, including containment, definitions, imports, exports, test relationships, and source/spec support.
- Keep graph facts scanner-only in this slice.
- Preserve enough provenance on nodes and edges to explain how each fact was produced.
- Expose a narrow API and minimal UI for graph inspection.
- Keep system maps and draft review behavior unchanged while making later phases able to read graph facts.

## Non-Goals

- Using AI to label, summarize, merge, or classify graph concepts.
- Building the final product concept graph.
- Replacing system map snapshots.
- Building a full visual graph browser.
- Implementing missing-spec detection in this slice.
- Implementing selective partial graph rebuilds.
- Making graph facts user-editable.

## Product Model

The graph is a project-current facts layer, not another run-scoped review artifact. SpecOps should be able to answer:

- What files, symbols, specs, and relationships are known for this project?
- Which files import or depend on this file?
- Which source files support this spec?
- Which tests are connected to this source area by deterministic evidence?
- Which indexed facts are available for later missing-spec detection and AI concept grouping?

Each graph build creates a graph version tied to an index run. The current graph is the latest successful graph version for the project. Analyze runs and refresh runs can later store the graph version id they used, but they do not duplicate all graph rows.

System maps remain run-scoped summaries for onboarding review. This slice does not rebuild system maps from graph facts or store references from map areas to graph nodes.

## Architecture

Add a graph builder that runs after indexing. It consumes existing indexed tables:

- `source_files`
- `source_imports`
- `source_exports`
- `source_symbols`
- `spec_entities`
- `source_spec_annotations`

The graph builder writes:

- `project_graph_versions`
- `project_graph_nodes`
- `project_graph_edges`

The builder should be deterministic and idempotent for an index run. Re-running it for the same project and index run creates a new graph version and marks earlier graph versions for that index run as `superseded`. Current graph lookup uses the latest `ready` or `limited` graph version by `created_at`.

Graph facts should be derived in layers:

1. Create package and module boundary nodes from source paths.
2. Create source file nodes.
3. Create source symbol nodes.
4. Create route-like, data-model-like, and test classification nodes or typed file nodes.
5. Create spec entity nodes from indexed specs.
6. Create edges from package/module containment, file definitions, imports, exports, test relationships, and source/spec annotations.
7. Store coverage and diagnostics on the graph version.

The graph builder should not block existing system map, proposal, or annotation behavior. If graph building fails, the index result remains available and the graph version records failure diagnostics.

## Data Model

### `project_graph_versions`

Stores one graph build for a project and index run.

Fields:

- `id`
- `project_id`
- `index_run_id`
- `status`: `building`, `ready`, `limited`, `failed`, or `superseded`
- `summary`
- `coverage_json`
- `diagnostics_json`
- `created_at`
- `updated_at`

`coverage_json` should include node counts by type, edge counts by type, source file coverage, spec entity coverage, unresolved import count, and heuristic edge count.

`diagnostics_json` should include graph build failures, unsupported project states, unresolved imports, skipped files, and limited graph reasons.

### `project_graph_nodes`

Stores typed nodes for one graph version.

Fields:

- `id`
- `project_id`
- `graph_version_id`
- `node_key`
- `node_type`
- `label`
- `path`
- `symbol_name`
- `entity_id`
- `source_ref_json`
- `metadata_json`
- `confidence`
- `created_at`

Initial node types:

- `package`
- `module`
- `file`
- `symbol`
- `route`
- `data_model`
- `test`
- `spec_entity`
- `external_dependency`

`node_key` must be stable within a graph version. Examples:

- `package:apps/api`
- `module:apps/api/src/services`
- `file:apps/api/src/services/analyze-run-service.ts`
- `symbol:apps/api/src/services/analyze-run-service.ts#createAnalyzeRunService`
- `route:apps/web/src/routes/analyze-run-review.tsx`
- `spec:uc.analyze-project`
- `external:@tanstack/react-query`

`source_ref_json` should identify the indexed row or source path that produced the node when applicable.

### `project_graph_edges`

Stores typed relationships between nodes in one graph version.

Fields:

- `id`
- `project_id`
- `graph_version_id`
- `from_node_id`
- `to_node_id`
- `edge_type`
- `provenance`
- `source_ref_json`
- `metadata_json`
- `confidence`
- `created_at`

Initial schema edge types:

- `contains`
- `defines`
- `imports`
- `exports`
- `depends_on`
- `tests`
- `references`
- `supports_spec`

The first graph builder should write `contains`, `defines`, `imports`, `exports`, `tests`, and `supports_spec`. `depends_on` and `references` are reserved in the contract for normalized relationships that later graph-backed features will create.

Initial provenance values:

- `scanner_path`
- `scanner_import`
- `scanner_export`
- `scanner_symbol`
- `scanner_kind`
- `annotation`
- `heuristic_test`

Edges from direct indexed facts should use high confidence. Edges inferred from naming or path proximity should use lower confidence and clear provenance.

## Graph Construction

### Package And Module Nodes

The first implementation should derive package and module nodes from path boundaries rather than package-manager metadata.

Examples:

- `apps/api`
- `apps/web`
- `packages/db`
- `packages/repo-scanner`
- nested modules such as `apps/api/src/services` or `apps/web/src/routes`

Package and module nodes should be connected with `contains` edges. Files should be contained by their nearest useful module node.

### File Nodes

Every indexed source file gets exactly one `file` node. Route, data-model, and test meaning is stored as metadata on the file node instead of creating duplicate category nodes in the first implementation.

The metadata should include:

- `classification`: `route`, `data_model`, `test`, `config`, `source`, or `unknown`
- `language`
- `kind`
- `pathSegments`

This avoids duplicating too many nodes before the UI needs them.

### Symbol Nodes

Every indexed source symbol gets a `symbol` node connected to its file by a `defines` edge. Exported symbols also receive an `exports` edge from the file to the symbol.

Symbol nodes should include:

- symbol name
- symbol kind
- exported flag
- source line when available
- source file path

### Import And Dependency Edges

For each `source_imports` row:

- if `resolvedPath` points to an indexed file, create an `imports` edge from the importing file node to the imported file node
- if the import is package or otherwise unresolved, create or reuse an `external_dependency` node and connect the importing file to it

The graph should keep unresolved import facts visible rather than silently dropping them. In the first slice, `imports` edges are enough for source dependency traversal.

### Test Edges

Test file nodes should be connected to source file nodes only when deterministic evidence exists:

- resolved imports from the test file to source files
- close path/name match such as `foo.test.ts` to `foo.ts`

Import-backed edges should use `scanner_import` provenance and high confidence. Path/name matches should use `heuristic_test` provenance and lower confidence.

### Spec Support Edges

Active `source_spec_annotations` should create `supports_spec` edges from source file or symbol nodes to spec entity nodes.

The edge should preserve:

- annotation id
- relationship type from the annotation
- source file path
- optional symbol name
- optional claim id
- annotation provenance
- annotation confidence

The graph does not replace annotations. It projects active annotation facts into a queryable graph form.

## API

### Get Current Project Graph

`GET /api/projects/:projectId/graph`

Returns:

- graph version id
- project id
- index run id
- status
- summary
- coverage
- diagnostics
- node counts by type
- edge counts by type
- bounded node sample
- bounded edge sample

Supported query params:

- `nodeType`
- `edgeType`
- `q`
- `limit`

This route should return the latest `ready` or `limited` graph version. If none exists, return a not-found response with a clear message.

### Get Graph Node

`GET /api/projects/:projectId/graph/nodes/:nodeId`

Returns:

- node details
- grouped incoming edges
- grouped outgoing edges
- bounded neighboring nodes

The route must enforce project scoping for both the node and all related edges.

## UI

Add minimal graph inspection, not a full graph browser.

Add a simple project route that shows graph counts, diagnostics, node samples, and edge samples. The project detail page links to it when a graph version exists.

The UI should show:

- current graph status and index run id
- node counts by type
- edge counts by type
- diagnostics
- a searchable or bounded sample of graph nodes
- one node detail view with incoming and outgoing relationships

This UI exists to verify and debug the graph while future features are built. It should not become the main project onboarding surface in this slice.

## Analyze And Refresh Integration

Analyze and refresh flows should not depend on the graph for correctness in this slice.

The initial integration should be narrow:

- index flow triggers graph build after source/spec indexing succeeds
- analyze run detail can resolve the graph version by `analyze_runs.index_run_id` when available
- system map construction continues using source inventory directly
- later work can read graph facts for map construction, draft generation, refresh impact, and missing-spec detection

This keeps existing product behavior stable while the graph foundation lands.

## Error Handling

- If indexing fails, graph building does not run.
- If graph building fails, store a failed graph version with diagnostics and keep the index run usable.
- If no supported source files exist, create a `limited` graph version when specs or annotations still produce useful nodes.
- If no graph facts exist at all, create a `limited` graph version with diagnostics rather than crashing the workflow.
- If imports cannot resolve, represent them as external dependency nodes or diagnostics.
- If source/spec annotations reference missing source or spec rows, omit the edge and record a diagnostic.
- Old graph versions remain readable for debugging, but current graph lookup uses the latest `ready` or `limited` graph version.

## Testing

Add focused coverage for:

- graph contract schemas
- DB schema and migration type checks
- graph version creation after indexing
- node creation from packages, modules, files, symbols, tests, data-model-like files, and spec entities
- import edges to resolved source files
- external dependency nodes for unresolved or package imports
- symbol definition and export edges
- test edges from imports and deterministic path/name matching
- source/spec annotation projection into `supports_spec` edges
- failed and limited graph version behavior
- project-scoped API filters
- latest graph retrieval
- minimal web rendering of graph counts, diagnostics, and node detail

Use existing Vitest patterns for contracts, DB-backed API services, route tests, and React component or route tests.

## Acceptance Criteria

- After a successful index, SpecOps has a current project graph version tied to that index run.
- The graph includes typed nodes for source files, symbols, package or module boundaries, spec entities, and external dependencies when present.
- The graph includes deterministic edges for containment, definitions, imports, exports, tests, and source/spec support.
- Every edge has provenance and confidence.
- Unresolved imports and limited graph states are visible through diagnostics or external dependency nodes.
- The graph does not require AI.
- System maps, draft review, annotations, and refresh behavior continue to work unchanged.
- The graph API can answer basic node and relationship questions for the current project.
- The foundation is ready for later missing-spec detection, AI concept consolidation, and graph-backed system maps.
