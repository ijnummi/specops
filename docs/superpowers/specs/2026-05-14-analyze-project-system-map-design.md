# Analyze Project System Map Design

## Context

`docs/analyze-existing-project-phased-plan.md` describes several numbered phases for Analyze Project, but the next increment should be based on the actual product state rather than the phase number. The current codebase already has a first-run `Analyze project` workflow, source indexing, source-derived proposals, AI prefill proposals, review assemblies, source/spec annotations, project health, diff reviews, and change impact previews.

The core product goal remains first-time onboarding for an existing codebase:

> Point SpecOps at the project. It reads the code, explains the system, drafts specs, and links everything back to source.

The current Analyze Project workflow starts that journey, but its main review artifact is still generated draft specs. For a new project, the better first result is a source-backed understanding of the system, then draft specs explained by that understanding.

This increment adds a run-scoped system map to Analyze Project. The map is a whole-project skeleton that appears alongside generated drafts during review.

## Goals

- Make Analyze Project produce a reviewable system map for first-time project understanding.
- Cover the whole project at shallow depth: backend routes and services, frontend routes and components, data models and schemas, tests, config, packages, and unknown areas.
- Build the map scanner-first from indexed source inventory.
- Use AI only to add concise labels, summaries, and concept grouping.
- Keep source evidence primary and explicit for every map area.
- Group generated draft specs under map areas when evidence supports the relationship.
- Preserve the map as a run-scoped snapshot so the user can review what the analyze run concluded.
- Keep the first implementation small enough to build before deeper project graph work.

## Non-Goals

- Building a complete dependency graph or architecture-understanding engine.
- Replacing the existing draft review and assembly model.
- Requiring users to approve the map before seeing draft specs.
- Letting AI invent source relationships or unsupported architecture claims.
- Making the system map a fully editable dashboard feature.
- Implementing refresh or maintenance workflows.
- Generating a long-form onboarding report as the primary artifact.

## Product Model

Analyze Project should still run as one guided workflow, but its result changes from "generated draft specs" to "a source-backed system map plus draft specs explained by that map."

The run produces three related artifacts:

1. **System map snapshot**
   A whole-project skeleton covering backend, frontend, data, tests, config, packages, and unknown areas.

2. **Draft specs**
   Existing source and AI proposals remain, but they are grouped under map areas so the user understands why each spec exists.

3. **Lightweight onboarding summary**
   A concise generated summary may be included as map metadata. The durable foundation is the map, not a long report.

The review experience should show the map and drafts together. Selecting a map area reveals source files, symbols, imports and exports, AI label or summary, related draft specs, and evidence. The user can then review generated specs with context instead of seeing isolated proposals.

## System Map Scope

The first system map should cover broad, stable area types:

- `backend_routes`
- `backend_services`
- `frontend_routes`
- `frontend_components`
- `data_models`
- `tests`
- `config`
- `packages`
- `unknown`

The map is intentionally shallow. It should help a new user orient themselves, not claim complete architectural understanding.

Each map area should include:

- stable id
- area type
- name
- short summary
- confidence
- source evidence
- key files
- key symbols where available
- import/export hints where useful
- related proposal ids
- diagnostics

Every map area should either have source evidence or a diagnostic explaining why evidence is limited.

## Architecture

Add a run-scoped **system map snapshot** rather than deriving the map live from current index state. This matters because Analyze Project is a first-run onboarding artifact. The user should be able to review what the run concluded even if the repository is later re-indexed.

Map construction has two layers.

### Scanner Layer

The scanner layer uses indexed source inventory after the analyze run indexes the project:

- `source_files`
- `source_imports`
- `source_exports`
- `source_symbols`

It classifies files and symbols into map areas, records source evidence, and links areas to proposals where paths or symbols overlap. The first version should use path conventions, file kind, language, imports, exports, symbols, and package boundaries. It should not require a complete dependency graph.

### AI Label Layer

The AI label layer takes scanner-built areas plus selected source metadata or snippets and adds short names, summaries, and optional concept grouping. AI output is allowed to make the map easier to read, but it must not replace scanner evidence.

If AI labeling fails or is disabled, the map still exists with deterministic names, deterministic summaries, and diagnostics.

Unsupported AI statements should be marked as hypotheses or diagnostics. They should not be presented as source-backed facts.

## Data Model

Add system-map storage tied to analyze runs.

### `system_map_snapshots`

Stores one map snapshot for an analyze run.

Fields:

- `id`
- `project_id`
- `analyze_run_id`
- `status`: `building`, `ready`, `limited`, or `failed`
- `summary`
- `coverage_json`
- `diagnostics_json`
- `created_at`
- `updated_at`

`coverage_json` should include counts by area type, source file coverage, supported language coverage, and skipped or unknown counts.

`diagnostics_json` should include scanner limitations, AI labeling failures, empty states, and proposal-linking warnings.

### `system_map_areas`

Stores the map areas for a snapshot.

Fields:

- `id`
- `snapshot_id`
- `area_type`
- `name`
- `summary`
- `confidence`
- `evidence_json`
- `related_proposal_ids_json`
- `diagnostics_json`
- `sort_order`
- `created_at`
- `updated_at`

`evidence_json` should contain source paths, optional source file ids, symbols, line numbers when available, relationship hints, imports or exports when useful, and provenance.

`related_proposal_ids_json` links map areas to generated source and AI proposal ids. This is a run-scoped relationship, not a durable source/spec annotation.

## Analyze Run Flow

Analyze runs gain two new steps:

1. `initialize`
2. `index`
3. `build_system_map`
4. `source_proposals`
5. `select_ai_sources`
6. `ai_prefill`
7. `link_map_to_drafts`

`build_system_map` creates the scanner-first map snapshot from indexed source inventory. It should succeed with a limited snapshot when the project has no supported source files.

`link_map_to_drafts` attaches generated proposal ids to map areas after source and AI proposals exist. The first version can match by source paths, symbols, and proposal evidence. It should not invent relationships without evidence.

The run succeeds when the map and reviewable drafts are ready. If later proposal generation fails after the map is built, the run should preserve the map and any proposals already created.

## API

Add system-map contracts and one route for the first increment.

### Get Analyze Run System Map

`GET /api/projects/:projectId/analyze-runs/:runId/system-map`

Returns:

- snapshot id and status
- analyze run id
- project id
- summary
- coverage
- diagnostics
- areas
- related proposal ids for each area

The route should only return map data for the requested project and run. If no snapshot exists for the run, return a not-found response.

Optional future routes are intentionally deferred:

- `PATCH /api/projects/:projectId/analyze-runs/:runId/system-map/areas/:areaId`
- `POST /api/projects/:projectId/analyze-runs/:runId/system-map/regenerate-labels`

The first increment should avoid making the map heavily editable. The immediate value is orientation and traceability.

## Review UI

The existing Analyze Review route should become a map-led review workspace while preserving draft review actions.

The layout should include:

- **System map navigation**
  Grouped areas such as Backend Routes, Backend Services, Frontend Routes, Data Models, Tests, Config, Packages, and Unknown.

- **Selected map area detail**
  Shows area summary, confidence, diagnostics, source files, key symbols, imports and exports, and source evidence.

- **Related drafts panel**
  Shows generated proposals connected to the selected area, with existing review and assembly controls available from there.

The page should still allow reviewing all drafts, but the default path should be map-led. A new user starts by scanning the system map, then drills into draft specs from the area that explains them.

The Analyze Run progress page should show `Build system map`. When the run succeeds, the primary action should become `Review system map and drafts`.

The Project dashboard can later gain a standalone System Map tab, but that is out of scope for this increment.

## Error Handling

Error handling should preserve the first-run onboarding experience:

- If indexing fails, the analyze run fails because there is no reliable source inventory.
- If deterministic map construction finds no supported source files, create an empty or limited snapshot with diagnostics.
- If AI labeling fails, keep the map usable with scanner-derived names and summaries.
- If proposal generation fails after the map is built, preserve the map and any proposals already created.
- If a proposal cannot be linked to a map area, show it under `unknown` or `unmapped drafts` with a diagnostic.

The map should never hide uncertainty. Limited coverage, parser warnings, skipped files, failed AI labeling, and unmapped drafts should be visible.

## Testing

Add focused tests for:

- scanner-derived area classification from indexed source files
- map snapshot persistence and run-scoped retrieval
- analyze run step order including `build_system_map`
- AI-label fallback behavior
- proposal-to-map linking by source evidence and path
- API contract parsing for system map DTOs
- review UI rendering grouped map areas and related drafts
- empty or limited project states

The implementation should use existing Vitest patterns for contracts, DB-backed API services, route tests, and React route/component tests.

## Acceptance Criteria

- A first-time user can run `Analyze project` and review a system map alongside generated drafts.
- The map covers backend, frontend, data, tests, config, packages, and unknown areas when present.
- Every map area has source evidence or a diagnostic explaining why evidence is limited.
- AI-generated labels and summaries never replace source evidence.
- Draft specs are grouped under map areas when evidence supports the relationship.
- Unmapped drafts remain visible and are labeled as unmapped rather than silently hidden.
- Analyze Project remains one guided workflow.
- Existing draft review and assembly behavior continues to work.
