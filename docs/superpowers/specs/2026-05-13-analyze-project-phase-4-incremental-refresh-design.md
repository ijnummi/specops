# Analyze Project Phase 4 Incremental Refresh Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 4 as Incremental Refresh. Phases 1 through 3 created the first-run Analyze Project flow, the draft review workspace, and first-class source/spec annotations.

The current codebase already has several foundations for refresh:

- index runs record the Git commit they indexed
- project health detects Git drift, changed source files, changed spec files, and stale task signals
- diff reviews classify changed files and derive affected specs
- source/spec annotations connect source files and symbols to spec entities
- analyze review assemblies can render reviewed markdown and promote evidence into annotations

Phase 4 should connect those foundations into a user-facing `Refresh analysis` workflow. This phase should feel useful after the first implementation, but it should not attempt the full Phase 5 project graph or deep architectural understanding layer.

## Goals

- Add `Refresh analysis` as the secondary action after a project has been analyzed or indexed.
- Compare the latest successful indexed Git commit to current project state.
- Include committed changes since the latest index and current dirty working tree changes.
- Re-index during refresh so derived cache data is current before proposals are reviewed.
- Run AI proposal generation by default for impacted source areas.
- Show reviewable refresh proposals before writing markdown.
- Let accepted refresh proposals update markdown specs and source/spec annotations.
- Preserve stale generated annotations and links as reviewable state instead of silently deleting them.
- Avoid clobbering human-authored spec content.
- Keep the contracts open for later true partial indexing and deeper project graph analysis.

## Non-Goals

- Implementing a full dependency graph or architecture understanding layer.
- Implementing selective partial indexing as the first version.
- Letting AI overwrite arbitrary human prose.
- Adding user-selectable refresh baselines in the initial workflow.
- Replacing diff reviews or agent run reviews.
- Creating a complete durable markdown format for every refresh proposal and annotation field.

## Product Model

Phase 4 introduces a **refresh run**. A refresh run is a project-scoped maintenance workflow that detects what changed since the last successful index, updates derived project facts, creates AI-backed proposals for impacted areas, and waits for user review before applying spec changes.

`Analyze project` remains the first-run concept. `Refresh analysis` becomes the ongoing maintenance concept.

The default baseline is the latest successful index run's `gitCommit`. The refresh compares that commit to current `HEAD`, then also includes staged, unstaged, and untracked working tree changes. If Git data is unavailable, the refresh should still be able to run a full index and report that baseline comparison was unavailable.

Refresh proposals are grouped by user-facing outcome:

- new specs for newly discovered source concepts
- updates to existing specs from changed source evidence
- stale or removed source links
- changed reviewed facts or use cases
- specs that need review because supporting source changed

Each proposal must show:

- proposal type
- target entity id when known
- target spec path
- summary of the proposed change
- source evidence
- confidence
- provenance
- whether accepting it creates a spec, updates a spec, updates annotations, or marks generated relationships stale

## Workflow

### Entry Point

The project overview should show `Refresh analysis` after the project has at least one successful index run. It should be secondary to first-run onboarding and should be most prominent when project health reports changed source files, changed spec files, or index drift.

Starting a refresh creates a run and moves the user to a progress page. Only one analyze or refresh run should execute for a project at a time.

### Run Steps

The initial refresh run should use these steps:

1. `detect_changes`
   - Resolve the latest successful index run.
   - Resolve current Git status.
   - Compute changed paths from indexed commit to `HEAD`.
   - Add dirty working tree paths.
   - Classify paths into specs, source, tests, and other.
2. `index`
   - Run the existing project indexer.
   - Store the new index run id.
   - Keep full indexing for Phase 4 correctness.
3. `derive_impacts`
   - Use changed spec paths, changed source paths, and active annotations to identify impacted spec entities.
   - Preserve old changed-path information even after indexing updates source inventory.
   - Identify generated annotations that appear stale after re-indexing.
4. `generate_update_proposals`
   - Select impacted source files for AI using existing source selection constraints.
   - Run AI by default for impacted source files.
   - Create proposal records for new specs and existing spec updates.
5. `prepare_review`
   - Assemble proposals into a reviewable workspace.
   - Validate target paths, entity ids, source evidence, and update safety.

The run succeeds when review proposals are ready. Applying proposals is a separate reviewed action.

### Review And Apply

The refresh review workspace should borrow the analyze review workspace model but use refresh-specific language and proposal types.

Users can:

- accept a proposal
- discard a proposal
- edit title, entity id, file path, summary, and claim text before applying
- mark generated claims or source links as stale
- keep a stale warning without changing markdown
- merge duplicate proposals when AI produces overlapping suggestions

Accepted proposals can write markdown. They may:

- create new markdown specs
- update generated or reviewed sections in existing specs
- update grouped source links
- add reviewed facts with evidence footnotes
- mark generated claims, links, or source evidence as stale
- add or update source/spec annotations

Human-authored prose should not be overwritten blindly. Phase 4 should use bounded generated sections or conservative patching. If a target spec cannot be patched safely, the proposal should become a review item that shows the suggested markdown without writing it automatically.

## Data Model

Add refresh-run storage rather than overloading analyze runs.

### `refresh_runs`

Fields:

- `id`
- `project_id`
- `status`: `queued`, `running`, `succeeded`, `failed`
- `current_step`
- `steps_json`
- `baseline_index_run_id`
- `baseline_git_commit`
- `head_git_commit`
- `index_run_id`
- `changed_files_json`
- `impact_summary_json`
- `selection_json`
- `proposal_ids_json`
- `error_message`
- timestamps

`changed_files_json` should use the existing changed-file grouping shape where practical:

- specs
- source
- tests
- other

`impact_summary_json` should store enough denormalized review context to render the run later even if source/spec facts change again.

### `refresh_proposals`

Add a dedicated `refresh_proposals` table. Refresh proposals have different lifecycle, baseline, impact, and apply semantics from first-run AI proposals, so storing them separately keeps analyze and refresh concepts clear.

Each proposal represents one of:

- `new_spec`
- `update_spec`
- `stale_annotation`
- `stale_claim`
- `source_link_update`
- `needs_review`

Fields:

- project id
- refresh run id
- proposal type
- target entity id
- target spec file path
- title
- summary
- confidence
- provenance
- source evidence
- proposed claims or markdown patch
- related annotation ids
- status: `draft`, `accepted`, `discarded`

### Annotation Lifecycle

Refresh should use the Phase 3 annotation lifecycle:

- create new active generated annotations from accepted evidence
- mark generated annotations stale when source evidence no longer matches
- keep user annotations active unless the user explicitly changes them
- avoid replacing user annotations with scanner or AI output

Generated annotations should be deduplicated using the existing annotation uniqueness rules.

## API

Add refresh-focused contracts and routes.

### Start Refresh

`POST /api/projects/:projectId/refresh-runs`

Creates a queued refresh run and starts execution asynchronously.

The Phase 4 request body is optional. When present, it may include:

- `includeAi`: boolean, default `true`
- `selectedPaths`: string array, default all detected changed paths
- `maxAiFiles`: number, default existing AI prefill limit

The baseline is always the latest successful indexed commit in Phase 4. User-selected baselines are deferred.

### Get Refresh Run

`GET /api/projects/:projectId/refresh-runs/:runId`

Returns run status, steps, changed files, impact summary, selection diagnostics, proposal counts, and links to review.

### Get Refresh Review

`GET /api/projects/:projectId/refresh-runs/:runId/review`

Returns reviewable proposals grouped by outcome. The response should include validation state for each proposal.

### Patch Refresh Proposal

`PATCH /api/projects/:projectId/refresh-runs/:runId/proposals/:proposalId`

Allows editing reviewable fields before apply:

- title
- entity id
- file path
- summary
- claim text
- status
- stale handling choice

### Accept Refresh Proposals

`POST /api/projects/:projectId/refresh-runs/:runId/accept`

Applies selected proposals. The response should include:

- accepted proposal ids
- failures with validation messages
- markdown files written
- annotations created
- annotations marked stale
- index run id when acceptance triggered re-indexing

Accept is transactional per proposal. A failure for one proposal must be returned with validation messages and must not roll back already accepted proposals in the same request.

## Impact Derivation

Phase 4 impact derivation should be conservative.

Changed spec files impact the indexed entities for those paths.

Changed source files impact entities linked by active source/spec annotations where `source_file_path` matches the changed path.

Changed tests impact entities linked by annotations with relationship type `tests`. If no test annotations exist, test changes should be shown as context but should not invent affected specs.

Unlinked changed source files should produce `new_spec` or `needs_review` proposals when AI finds meaningful concepts. If AI does not find a useful concept, the file should appear in review as unlinked changed source.

Deleted or renamed source files should mark generated annotations stale when the old source path no longer exists after indexing. User annotations should produce a review warning rather than being automatically marked stale.

## Markdown Apply Strategy

Markdown remains canonical authored data. Refresh apply should therefore be explicit and bounded.

For new specs, Phase 4 can reuse the analyze review renderer and acceptance path.

For existing specs, Phase 4 should prefer generated sections with recognizable headings:

- `## Reviewed Facts`
- `## Hypotheses and Unknowns`
- `## Source Links`
- `## Proposed Links`

If these sections are present and still match the expected generated structure, refresh can patch them. If they are missing or heavily modified, refresh should show the suggested replacement but require the proposal to be treated as manual review.

The implementation should not rewrite frontmatter, headings, or freeform body text unless the accepted proposal explicitly targets a generated field and validation confirms the patch is safe.

## UI

### Project Overview

Add `Refresh analysis` near the Git and drift panel. The action should be enabled when a project exists and has at least one successful index run. If no successful index exists, the UI should direct the user to `Analyze project`.

The panel should make the reason visible:

- index behind HEAD
- changed source files
- changed spec files
- stale source/spec relationships

### Refresh Run Detail

The detail page should mirror analyze run progress:

- status
- current step
- step counts
- changed files summary
- impacted specs summary
- AI source selection diagnostics
- proposal counts
- link to review when ready

### Refresh Review Workspace

The review workspace should optimize for safe apply decisions:

- left rail: grouped proposals
- center: proposed markdown/spec change
- right rail: source evidence, stale annotation details, and validation messages

Proposal groups should be:

- New specs
- Spec updates
- Stale links
- Changed facts
- Needs review

The first implementation can reuse existing analyze review components where practical, but user-facing labels should say refresh/update rather than analyze/import.

## Error Handling

Refresh should surface these conditions clearly:

- no successful baseline index exists
- Git comparison unavailable
- active analyze or refresh run already exists
- source file disappeared before AI generation
- AI provider unavailable
- proposal target path escapes `.specops`
- existing spec cannot be patched safely
- generated annotation conflicts with a user annotation

If AI fails after indexing succeeds, the run fails at `generate_update_proposals` with the indexing result retained on the run and no markdown writes performed. The user can run refresh again after fixing configuration.

## Testing

Tests should cover:

- refresh contract schemas
- route creation and active-run conflict handling
- baseline resolution from latest successful index run
- committed changes since baseline plus dirty working tree changes
- no-Git fallback behavior
- changed-file classification
- impacted spec derivation from active annotations
- unlinked changed source producing review proposals
- AI source selection limited to impacted source
- stale generated annotation detection
- user annotations not being overwritten or auto-staled
- safe markdown patching for generated sections
- unsafe markdown patch fallback to manual review
- accept creating new specs
- accept updating existing generated sections
- accept creating and staling annotations
- refresh detail and review UI rendering
- query invalidation after accept

## Success Criteria

- A user with an already analyzed project can click `Refresh analysis` after code changes.
- Refresh compares against the latest successful indexed commit and includes dirty working tree changes.
- Refresh re-indexes the project before preparing review proposals.
- AI runs automatically for impacted source areas within existing limits.
- The review workspace explains new specs, spec updates, stale links, changed facts, and review needs.
- Accepted proposals update markdown and annotations after review.
- Human-authored prose is not silently clobbered.
- Generated annotations that no longer match source/spec state become stale and reviewable.
- User annotations remain user-controlled.
- The workflow leaves room for later partial indexing and deeper project graph analysis.
