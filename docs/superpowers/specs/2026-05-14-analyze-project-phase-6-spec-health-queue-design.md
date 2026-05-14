# Analyze Project Phase 6 Spec Health Queue Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 6 as Spec Maintenance Workflow. The current application already has several maintenance signals:

- project health, git drift, changed source/spec files, and stale task checks
- spec readiness checks and a spec-focused readiness queue
- durable source/spec annotations
- change impact previews
- scanner-backed project graph versions
- AI-assisted concept graph versions

Those pieces are useful, but they are spread across separate surfaces and do not yet answer the cross-system maintenance question:

> What specs, source areas, and concepts need attention now?

This design adds a read-only Spec Health triage queue. It is a computed live view over existing data, not a new persisted review workflow.

## Goals

- Add a project-level Spec Health view focused on triage.
- Combine spec, source, and concept maintenance gaps into one queue.
- Keep the first implementation read-only and navigation-first.
- Compute findings live from current indexed data, project graph data, source/spec annotations, spec readiness, and the latest concept graph.
- Show evidence, severity, target, diagnostics, and navigation actions for each finding.
- Keep existing readiness, project health, project graph, concept graph, and impact views intact.
- Preserve a clean path to later persisted review states such as dismissed, snoozed, assigned, or resolved.

## Non-Goals

- Persisting health findings as durable review records.
- Adding dismiss, snooze, assign, resolve, or review-state lifecycle.
- Generating specs or editing markdown from the health queue.
- Creating source/spec annotations from this view.
- Running new AI calls.
- Rebuilding the project graph or concept graph.
- Replacing the existing spec readiness page.
- Treating git drift or index freshness as queue items in this slice.

## Product Model

The Spec Health view is the maintenance entry point after initial onboarding and concept graph construction. A user opens the project health queue and sees issues grouped across:

1. specs that need better validation, source evidence, links, or freshness
2. source areas that are not explained by specs
3. concepts that are weakly supported or not covered by specs

The first version is read-only. Each finding tells the user:

- what is wrong
- why SpecOps thinks it is wrong
- how severe it is
- which spec, source node, or concept is the primary target
- what evidence supports the finding
- where to navigate next

Fixing an issue means fixing the underlying project state through existing pages and workflows. For example, the user may edit a spec, add source/spec annotations, rebuild concepts, or run analysis again. The queue reflects the new state the next time it is fetched.

## UX

Use a split triage layout:

- **Left pane:** filters and issue list.
- **Right pane:** selected issue detail.

The left pane should support filters for:

- family: `spec`, `source`, `concept`
- severity: `blocker`, `review`, `context`
- kind

Each queue row should show:

- title
- family
- kind label
- severity
- short target label
- one-line detail

The detail pane should show:

- issue title and detail
- severity and family
- primary target
- evidence list
- diagnostics when relevant
- source state, such as latest index run, graph version, and concept version
- navigation actions

Navigation actions are links only. Initial actions may include:

- open spec/entity
- open readiness for a spec entity
- open change impact for a spec entity
- open project graph or graph node detail
- open concept detail
- open analyze or refresh entry points when that is already an existing project action

The empty state should say that no spec/source/concept health issues were found and should still show source state so users know which index, graph, and concept versions were inspected.

## Architecture

Add a new computed read model instead of extending the current spec readiness contract.

The main backend pieces are:

- `packages/contracts/src/health-queue.ts`
- `apps/api/src/services/project-health-queue-service.ts`
- `apps/api/src/routes/health-queue.ts`
- `apps/web/src/routes/project-health-queue.tsx`

The existing readiness service remains spec-focused. The new health queue service may call or reuse readiness helpers, but its contract should be shaped around heterogeneous targets: specs, source graph nodes, source paths, concepts, and concept memberships.

The service should load:

- project metadata for project existence and path context
- latest index run for source state
- `spec_entities`, `spec_links`, validation messages, and readiness output
- active `source_spec_annotations`
- latest ready or limited `project_graph_versions`
- `project_graph_nodes` and `project_graph_edges` for source/spec coverage
- latest ready or limited `project_concept_versions`
- `project_concepts` and `project_concept_memberships`

Missing project graph or concept graph data should not fail the endpoint. The response should include diagnostics and return the issue families that can still be computed.

## API

Add:

`GET /api/projects/:projectId/health-queue`

Response shape:

- `summary`
- `items`
- `sourceState`
- `diagnostics`
- `generatedAt`

### Summary

`summary` should include counts by:

- family
- severity
- kind

It should also include `total`.

### Source State

`sourceState` should include:

- latest index run id and status when available
- latest project graph version id and status when available
- latest concept graph version id and status when available
- booleans for graph and concept availability

This keeps git drift and graph freshness visible without making them queue items.

### Queue Item

Each item should include:

- `id`: deterministic live fingerprint
- `family`: `spec`, `source`, or `concept`
- `kind`: issue kind
- `severity`: `blocker`, `review`, or `context`
- `title`
- `detail`
- `primaryTarget`
- `evidence`
- `actions`
- `diagnostics`

The deterministic id should be derived from stable target information, such as issue kind plus entity id, source path, graph node key, concept key, or concept id. It is not persisted in this slice, but it should be stable enough to support future persisted review state.

### Targets

`primaryTarget` should be a discriminated union:

- spec target: entity id, title, type, status, file path
- source target: graph node id when available, node key, node type, path, symbol name
- concept target: concept id, concept key, concept type, name

### Evidence

Evidence entries should be structured and small:

- spec entity evidence
- source path or graph node evidence
- concept evidence
- annotation evidence
- readiness check evidence
- diagnostic evidence

Evidence should include labels and ids needed for rendering and navigation. It should not embed large markdown bodies or source snippets.

### Actions

Actions should be declarative navigation descriptors:

- `open_spec`
- `open_readiness`
- `open_impact`
- `open_project_graph`
- `open_graph_node`
- `open_concept`
- `open_analyze_run`

The UI maps these actions to TanStack Router links.

## Issue Taxonomy

The first implementation should include only issues that can be explained from existing durable data without AI re-analysis.

### Spec Issues

`spec_readiness_failed`

Wrap existing readiness checks for specs that are not ready. Use the readiness status and highest check severity to produce queue severity.

`spec_missing_source_evidence`

An eligible spec has no active source/spec annotation. This should reuse the same eligibility rules already used in project overview/source evidence where possible.

`spec_orphaned`

A spec entity has no meaningful incoming or outgoing spec links and no active source evidence. This should avoid flagging specs whose type or status makes isolation acceptable.

`spec_stale`

A spec-like entity appears stale relative to linked source or spec context when existing stale-task/readiness logic can support it. In the first implementation this should be limited to entity types and frontmatter patterns that the current code already evaluates, such as stale agent task checks. This slice should not invent a new general stale-spec model.

### Source Issues

`source_without_spec`

A useful source graph file or symbol node has no `supports_spec` edge and is not test, config, generated, external, unresolved, or unknown noise.

`source_area_without_spec`

A useful module or package area has several uncovered source files. Grouping should prevent the queue from emitting one row per uncovered file in large repositories.

### Concept Issues

`concept_without_spec`

An active concept has memberships, but none of its member graph nodes are connected to a spec entity or `supports_spec` edge.

`concept_low_confidence`

An active concept has confidence below the concept graph service's low-confidence threshold.

`concept_membership_low_confidence`

A concept has important low-confidence memberships. Emit one grouped item per concept instead of one row per membership.

## Severity

Use the existing readiness severity language:

- `blocker`
- `review`
- `context`

Suggested mapping:

- validation errors and broken spec links: `blocker`
- missing source evidence, stale specs, concept without spec, source area without spec: `review`
- low-confidence concept or concept membership, limited graph/concept diagnostics: `context`

The service should prefer deterministic severity over AI confidence alone. Confidence should influence severity only for concept issues that already exist in the concept graph.

## Sorting And Grouping

Sort queue items by:

1. severity: `blocker`, `review`, `context`
2. family: `spec`, `source`, `concept`
3. kind
4. target title, path, or concept name

Source issues should be grouped by module or package when possible. The detail pane can show sampled files and counts. The queue should avoid flooding the user with every uncovered file.

Concept membership issues should be grouped by concept. The detail pane can show sampled low-confidence memberships and counts.

## Diagnostics

Endpoint diagnostics should cover:

- no index run
- no project graph
- project graph status is limited
- no concept graph
- concept graph status is limited or failed
- stale source state when available from existing project health data
- issue families skipped because required data is unavailable

Missing graph or concept data should be warnings, not request failures.

## Testing

Add focused tests for:

- health queue contract schemas and discriminated unions
- summary count generation
- deterministic item id generation
- spec readiness items from existing readiness output
- missing source evidence items
- orphan spec items
- source graph nodes without spec support
- grouped source area items
- concept without spec items
- low-confidence concept and membership items
- missing graph and missing concept diagnostics
- route project scoping and not-found behavior
- React rendering for loading, error, empty, filtered list, selected detail, evidence, and navigation actions

The service tests should use existing DB-backed Vitest patterns where graph and concept rows are involved. Pure classification helpers should be tested without a database where practical.

## Acceptance Criteria

- A user can open one Spec Health page and see maintenance gaps across specs, source, and concepts.
- The queue includes spec issues, source/spec coverage gaps, and concept/spec coverage gaps.
- Every queue item has severity, family, kind, primary target, evidence, and at least one useful navigation action.
- Missing concept graph data does not prevent spec and source issues from rendering.
- Missing project graph data does not prevent spec issues from rendering.
- No queue action mutates data in this phase.
- The existing Spec Readiness page remains available and spec-focused.
- Existing project health, project graph, concept graph, and impact behavior remains intact.
- The endpoint returns deterministic item ids suitable for future persisted review state.
