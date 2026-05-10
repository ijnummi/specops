# Change Impact Preview Design

Date: 2026-05-10

## Purpose

Add a demo-oriented workflow that answers: "If I change this spec, what operational blast radius should I inspect?"

The feature builds on the existing entity impact graph, source annotation evidence, validation messages, and agent task generation. It should make SpecOps feel like a live workbench: select a spec, inspect related specs and source evidence, see relevant warnings, then generate an implementation task from that impact context.

## Scope

Add a spec-first Change Impact Preview route:

```text
/projects/:projectId/change-impact/:entityId
```

The first version includes:

- A graph-centered preview for one selected spec entity.
- Traversal controls for depth, direction, and source evidence, matching the existing impact graph behavior.
- A right-side preview panel with `Overview`, `Specs`, `Source`, `Warnings`, and `Tasks` views.
- Source-grouped impact inspection as the secondary path, derived from source annotations attached to impacted specs.
- Relevant validation messages for impacted specs and source files.
- Detection of existing related `agent_task` specs.
- A `Generate task from impact` action that opens the existing task preview flow with the selected spec and impacted context.

Out of scope for this slice:

- AI-generated change summaries.
- Persisted impact snapshots.
- Actual git diff analysis.
- A source-first route that starts from an arbitrary file or symbol.
- Write actions from the preview page other than task generation through the existing task save flow.

## Product Flow

The primary demo flow is:

1. User opens a spec entity.
2. User clicks `Preview Change Impact`.
3. App opens the Change Impact Preview page for that entity.
4. The page shows impacted specs, annotated source evidence, relevant validation warnings, and task opportunities.
5. User switches between graph, spec, source, warning, and task views without leaving the page.
6. User clicks `Generate task from impact` to open an agent task preview seeded by the selected spec and impacted context.

The feature remains spec-first. Source inspection is a secondary grouping of the same impact result, not a separate source-editing workflow.

## API Design

Add an endpoint:

```text
GET /api/projects/:projectId/entities/:entityId/change-impact-preview?depth=1|2|all&direction=both|upstream|downstream&includeSource=true|false
```

Default query values match the existing impact endpoint:

- `depth=1`
- `direction=both`
- `includeSource=true`

The endpoint composes existing indexed data into a page-ready DTO:

- `rootEntity`: selected spec summary.
- `impact`: the existing graph-ready impact response shape used by the entity impact route.
- `overview`: counts and shortest/high-signal paths.
- `impactedSpecs`: impacted entities grouped by upstream, downstream, and type.
- `sourceGroups`: source evidence grouped by file path, then symbol.
- `validationMessages`: validation messages whose `entityId` or `filePath` matches the impacted set.
- `relatedTasks`: existing `agent_task` entities linked through `generated_from` or `uses` to the root or impacted specs.
- `taskSeed`: deterministic inputs for opening the existing agent task preview flow.

Implement orchestration in a focused API service:

```text
apps/api/src/services/change-impact-preview-service.ts
```

The service should reuse `impact-service` for graph traversal instead of duplicating traversal logic. It reads only rebuildable indexed data and canonical markdown-derived rows.

## Data Behavior

Impacted specs come from the selected traversal settings.

Validation relevance:

- Include messages attached to the root entity.
- Include messages attached to impacted entity IDs.
- Include messages attached to source file paths present in source evidence.
- Keep stable ordering by severity, entity ID, file path, then message text.

Task relevance:

- Include `agent_task` entities whose frontmatter links contain `generated_from` or `uses` references to the root or impacted specs.
- Keep this detection deterministic and based on indexed spec links.
- Do not infer tasks from freeform markdown body text.

Source grouping:

- Group by source file path.
- Within each file, group by symbol name and kind.
- Preserve annotation line and symbol line metadata when available.
- Use the existing read-only source excerpt component for selected source evidence.

## UI Design

Add a `Preview Change Impact` action to the entity detail view near the existing impact and task actions.

The Change Impact Preview route layout:

- Top toolbar with spec title, type, status, depth selector, direction selector, source evidence toggle, `Open spec`, and `Generate task from impact`.
- Main graph area using the existing impact graph components.
- Persistent right panel with compact tabs: `Overview`, `Specs`, `Source`, `Warnings`, and `Tasks`.

Panel behavior:

- `Overview` shows total impacted specs, source files, source symbols, warnings, related tasks, and shortest paths.
- `Specs` groups impacted specs by upstream/downstream and entity type.
- `Source` groups source evidence by file and symbol, with selectable read-only excerpts.
- `Warnings` shows validation messages relevant to the impacted set.
- `Tasks` shows existing related tasks and the task generation action.

Interaction behavior:

- Clicking a graph node updates selected-node details in the panel.
- Clicking a spec opens the existing entity detail route or recenters the preview on that spec.
- Clicking source evidence shows the existing read-only excerpt viewer.
- Empty states distinguish no linked specs, no source evidence, no warnings, and no related tasks.

## Task Generation Integration

`Generate task from impact` should reuse the existing agent task preview flow.

The first version should pass the selected root entity as the source entity and include impacted context IDs in a new optional preview input field. The existing task preview behavior remains unchanged when that field is omitted.

The generator must remain deterministic. It should not summarize impact with AI or infer requirements from source code beyond indexed annotations and spec links.

## Error Handling

The API returns a not-found error when the project or root entity does not exist.

If graph traversal succeeds but secondary data cannot be loaded, the endpoint should return the impact result and include section-level warning fields for unavailable validation, task, or source-excerpt data. The page should keep graph and spec navigation usable even when validation messages, task links, or source excerpts fail to load.

The UI should distinguish:

- no impact data because the entity has no links;
- no source evidence because no impacted specs have annotations;
- no warnings because the impacted set is currently clean;
- failed preview load because the API request failed.

## Testing

API tests should cover:

- preview response for a one-hop impact set;
- depth and direction parameters passed through to impact traversal;
- validation messages filtered by impacted entity ID and source file path;
- related tasks detected through indexed links;
- empty source, warning, and task sections;
- missing project and missing entity errors;
- stable ordering of grouped specs, source evidence, warnings, and tasks.

Web tests should cover:

- entity detail links to the Change Impact Preview route;
- route renders loading, error, empty, and populated states;
- depth, direction, and source toggle update the query;
- panel tabs render overview, specs, source, warnings, and tasks;
- graph node selection updates the preview panel;
- `Generate task from impact` opens the task preview flow with the expected source entity.

Manual browser verification should cover desktop and narrow viewport layouts because the graph plus right panel can regress through overlap or unusable tab sizing.

## Acceptance Criteria

The feature is complete when:

- a user can open Change Impact Preview from a spec entity;
- the preview shows graph impact, grouped specs, grouped source evidence, relevant warnings, and related tasks;
- traversal controls change the preview deterministically;
- source inspection uses existing annotation-backed source evidence;
- related tasks are detected from indexed spec links;
- task generation can start from the preview page;
- empty and error states are clear;
- tests cover API composition and web route behavior;
- browser verification confirms the demo layout is usable.
