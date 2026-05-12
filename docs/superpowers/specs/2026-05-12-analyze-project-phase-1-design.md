# Analyze Project Phase 1 Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 1 as an MVP that replaces separate first-run choices with one strong path: `Analyze project`.

SpecOps already has most of the underlying primitives:

- `.specops` initialization through `init-specops`.
- Markdown and source indexing through `index`.
- Source-derived proposal generation through `proposals/source-import`.
- AI proposal generation through `proposals/ai-prefill`.
- Proposal editing, rejection, acceptance, markdown writes, and re-indexing through existing proposal endpoints.

Phase 1 should orchestrate these primitives and provide one review surface. It should not invent the deeper review, annotation, refresh, or project-graph systems planned for later phases.

## Goals

- Give first-time users one primary action: `Analyze project`.
- Run setup and proposal generation as a tracked workflow with visible progress.
- Generate an initial draft set from source-derived and AI-generated proposals.
- Use configured AI defaults and automatic source selection instead of asking users to choose files.
- Keep generated output reviewable before markdown files are written.
- Make AI coverage and evidence boundaries explicit, especially when source exceeds configured AI limits.

## Non-Goals

- Auto-accepting generated proposals.
- Implementing merge, rename, rich grouped review, or other Phase 2 draft review features.
- Adding structured source/spec annotation storage beyond existing source evidence.
- Implementing incremental refresh.
- Building a generic queue or workflow engine.
- Adding advanced onboarding modes such as fast map, detailed analysis, or selected-area analysis.

## Product Workflow

The project dashboard presents `Analyze project` as the primary first-run action. Existing manual setup actions remain available as secondary or advanced actions, but they no longer compete with the main path.

When clicked, `Analyze project` creates a persisted analyze run and navigates to an analyze progress screen. The run executes these steps:

1. Initialize `.specops` if needed.
2. Index specs and source inventory.
3. Generate source-derived proposals.
4. Select a high-signal subset of indexed source files for AI.
5. Generate AI proposals using configured provider/model defaults.
6. Mark the run complete and offer review.

The flow does not write generated specs automatically. It produces proposals. The user reviews, edits, rejects, and accepts proposals in a unified Analyze Review screen.

If the project has more useful source than the AI limits allow, Phase 1 still succeeds with a partial initial draft set. The UI and run detail must report partial coverage, for example: "AI analyzed 18 of 54 high-signal files due to configured limits." Generated claims must be backed by selected source evidence. Any unbacked generated content must be rendered as a hypothesis or diagnostic rather than stated as fact.

## Backend Model

Add an `analyze_runs` table. Each row belongs to a project and records the durable state of one analysis workflow.

Required fields:

- `id`
- `project_id`
- `status`: `queued`, `running`, `succeeded`, or `failed`
- `current_step`
- `steps_json`
- `selection_json`
- `source_proposal_count`
- `ai_proposal_count`
- `index_run_id`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`

`steps_json` stores step-level status, timestamps, counts, and errors. This avoids overbuilding a generic workflow schema for Phase 1 while preserving enough detail for progress UI and debugging.

`selection_json` stores the AI source selection result:

- selected source file ids
- selected paths
- total eligible high-signal file count
- skipped high-signal file count
- selected categories or reasons
- diagnostics

Only one `queued` or `running` analyze run may exist for a project. Starting another run while one is active returns a conflict with the active run id.

If the API restarts while a run is `queued` or `running`, the next fetch or start attempt marks the stale run as `failed` with a clear interruption message. A full external worker or durable queue is out of scope.

## API

Add analyze-run routes:

- `POST /api/projects/:projectId/analyze-runs`
  - Creates a persisted run.
  - Rejects if the project already has an active run.
  - Starts async execution inside the API process.
  - Returns the run immediately.

- `GET /api/projects/:projectId/analyze-runs/:runId`
  - Returns run status, step statuses, counts, selection summary, diagnostics, and errors.

Do not add a list endpoint in Phase 1. The dashboard and progress screen work from the run returned by `POST` and fetched by id.

The analyze service should call existing services rather than reimplementing their behavior:

- `createSpecopsInitializerService(db).initializeProjectSpecops(projectId)`
- `createIndexerService(db).indexProject(projectId)`
- `createProposalService(db).generateSourceImportProposals(projectId)`
- AI source selector
- `createAiPrefillService(db, options).generateAiPrefillProposals(projectId, input)`

The `POST` response should include enough data for the client to navigate to the progress route immediately.

## Analyze Execution Semantics

The run starts in `queued`, moves to `running`, then ends in `succeeded` or `failed`.

Step behavior:

- Initialization failure fails the run.
- Indexing failure fails the run.
- Source-derived proposal generation with no eligible symbols records an empty/skipped source proposal step and continues, unless the underlying error is path-safety or filesystem integrity related.
- Empty AI source selection skips AI proposal generation and records a diagnostic.
- AI provider setup, call, timeout, or normalization failure fails the AI step and the run, but preserves source-derived proposals generated earlier.

Completed steps should not be rolled back. Proposal services already obsolete previous pending proposals before inserting fresh ones, so a failed later step can still leave reviewable proposal output.

## AI Source Selection

Add a deterministic selector that works from indexed source facts. It should not do ad hoc raw source scanning.

Inputs:

- Indexed source file summaries or equivalent source facts.
- AI config limits: `maxFiles` and `maxTotalBytes`.
- Source metadata: path, kind, size, import count, export count, and symbol count.

The selector ranks useful files by signal:

1. Entrypoints, route handlers, API files, and controller-like files.
2. Service and module files with exported symbols.
3. Domain, model, schema, and data-shape files.
4. Frontend route, page, and substantial component files.
5. Tests and config only when needed to fill otherwise weak context.

Selection must be balanced. It should reserve room for at least these buckets when available:

- entrypoints/routes
- services/modules
- domain/models/schemas

After bucket coverage, remaining budget is filled by score until the configured file and byte limits are reached. Ties are resolved deterministically by path.

The selector returns:

- selected source file ids
- selected paths
- total eligible high-signal file count
- skipped high-signal file count
- category/reason data for selected files
- diagnostics for partial or empty coverage

The AI Prefill service remains responsible for enforcing source ownership, byte limits, content freshness, provider calls, and response normalization.

## Unified Analyze Review UI

Add a unified Analyze Review route tied to the run:

- `/projects/$projectId/analyze-runs/$runId/review`

The screen lists both `source_spec_entity` and `ai_spec_entity` proposals. Phase 1 actions are intentionally minimal:

- filter by proposal type and status
- select pending proposals
- inspect proposal detail
- edit proposal markdown
- reject proposal
- accept selected proposals

The detail panel adapts by proposal type:

- Source-derived proposals show scanner evidence, symbols, paths, and lines.
- AI proposals show provider, model, selected source files, claims, warnings, and proposed links.

Accepting selected proposals uses the existing `POST /api/projects/:projectId/proposals/accept` endpoint. Existing acceptance behavior writes markdown files, records proposal status, and triggers indexing.

After acceptance, the UI invalidates project, overview, readiness, health, proposal, entity, validation, and index-run queries. It may remain on the review screen with updated counts or provide a clear path back to the project dashboard.

## Analyze Progress UI

Add an analyze progress route:

- `/projects/$projectId/analyze-runs/$runId`

While the run is queued or running, the screen polls `GET /analyze-runs/:runId` and displays:

- current run status
- step statuses
- generated source proposal count
- generated AI proposal count
- selected AI source count
- partial coverage diagnostics

When the run succeeds, the primary action becomes `Review generated drafts`.

When the run fails, the screen shows:

- failed step
- error message
- completed proposal counts
- a route to review any proposals that were generated before failure

## Contracts

Add contract schemas and types for:

- analyze run status
- analyze run step status
- analyze run step summary
- analyze source selection summary
- analyze run detail
- active run conflict payload with the conflicting active run id

The web app should consume these contracts through the existing query/client pattern.

## Error Handling

Expected user-facing errors should be specific:

- another analyze run is already active
- `.specops` initialization failed
- indexing failed
- no supported source files were found
- no eligible source-derived proposals were found
- no files could be selected for AI
- AI provider setup failed
- AI provider timed out
- AI response produced no valid proposals

Errors from path-safety checks, source file freshness checks, and proposal acceptance conflicts should remain hard failures. The UI should surface the service error message without hiding the failed step.

## Testing Plan

Backend and contracts:

- Contract tests for analyze-run schemas.
- Migration/schema tests for `analyze_runs`.
- API route tests for start, fetch, active-run conflict, success path, and failure path.
- Service tests for orchestration order, step status persistence, partial proposal preservation, and stale active-run handling.
- Selector unit tests for ranking, bucket balance, file/byte limits, deterministic ordering, empty selection, and partial coverage diagnostics.

Frontend:

- Query tests for analyze-run endpoints.
- Project dashboard tests for the primary `Analyze project` CTA.
- Progress screen tests for queued, running, succeeded, failed, and partial coverage states.
- Review screen tests for mixed proposal types, filters, detail panels, markdown edit, reject, and accept selected behavior.

Existing proposal, AI Prefill, source import, index, and source scan tests remain the main coverage for underlying primitives.

Validation commands:

```sh
pnpm typecheck
pnpm test
pnpm --filter web build
```

## Acceptance Criteria

- A first-time user sees `Analyze project` as the primary path instead of choosing between init, import, AI prefill, and re-index.
- Starting analysis creates a persisted run and shows progress through setup, indexing, source proposal generation, AI source selection, and AI proposal generation.
- The run uses configured AI defaults and deterministic source selection.
- Large projects produce a partial draft set when AI limits are reached, with explicit coverage diagnostics.
- Generated specs are proposals until the user accepts them.
- Source-derived and AI-generated proposals can be reviewed in one screen.
- Existing proposal acceptance remains responsible for writing markdown and re-indexing.
- Every AI-created factual claim is backed by selected source evidence or surfaced as a hypothesis/diagnostic.
