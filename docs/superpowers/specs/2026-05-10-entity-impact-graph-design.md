# Entity Impact Graph Design

## Purpose

Build a dedicated impact view that answers: "If I change this spec, what else should I inspect?"

The feature should help a developer understand how a selected SpecOps entity connects to related specs and annotated source evidence. It should be deterministic, based on indexed project data, and useful before editing a spec or generating follow-up work.

## Scope

Add a dedicated route:

```text
/projects/:projectId/impact/:entityId
```

The first version includes:

- An interactive graph canvas centered on the selected spec entity.
- Configurable traversal depth: one hop, two hops, and all reachable.
- Direction filtering: upstream, downstream, or both.
- Spec graph impact from indexed `spec_links`.
- Source impact from indexed `source_spec_links`.
- A persistent right-side impact brief for counts, selected-node detail, source evidence, and high-signal paths.
- A bottom trace/details panel for longer upstream paths, downstream paths, and source evidence lists when the side panel would become crowded.
- Navigation back to the entity editor and navigation from graph nodes to related specs.

Out of scope for this slice:

- AI-generated impact summaries or proposals.
- Source import dependency traversal.
- Write actions from the impact view.
- Persisted user layout state.
- Persisted impact snapshots.

## API Design

Add an endpoint:

```text
GET /api/projects/:projectId/entities/:entityId/impact?depth=1|2|all&direction=both|upstream|downstream&includeSource=true|false
```

Default query values:

- `depth=1`
- `direction=both`
- `includeSource=true`

The response should be both graph-ready and trace-ready:

- `rootEntity`: summary of the selected entity.
- `nodes`: spec nodes plus source nodes.
- `edges`: spec-link edges plus spec-to-source evidence edges.
- `upstreamPaths`: paths ending at the selected entity.
- `downstreamPaths`: paths starting at the selected entity.
- `sourceEvidence`: source annotations grouped by impacted entity, then source file and symbol.
- `truncated`: boolean metadata with a reason and counts when traversal is capped.

Implement the query in a focused API service at `apps/api/src/services/impact-service.ts`. The service reads existing indexed tables only:

- `spec_entities`
- `spec_links`
- `source_spec_links`

No schema migration is required for this feature.

## Traversal Behavior

Traversal should use deterministic breadth-first search.

For downstream traversal, follow links where the current entity is `fromEntityId`.

For upstream traversal, follow links where the current entity is `toEntityId`.

For `direction=both`, compute both directions and merge the graph output while preserving separate upstream and downstream path lists.

Depth behavior:

- `1`: direct neighbors and directly attached source evidence.
- `2`: direct neighbors plus one additional hop.
- `all`: all reachable entities up to the traversal cap.

The traversal cap is 150 spec nodes and 400 spec-link edges. Source evidence is attached only for included spec nodes and is capped at 300 source evidence links. The API returns partial results with `truncated` metadata when any cap is reached.

Cycles must not produce duplicate infinite paths. The service should track visited entity/depth/direction state and return stable ordering by entity id, link type, and source.

## UI Design

Add an `ImpactPage` route separate from the editor. The entity detail page should expose an Impact action that links to it.

The impact route layout:

- Top toolbar with entity title/id, depth selector, direction selector, source evidence toggle, back action, and open-editor action.
- Main graph canvas with the selected entity emphasized.
- Persistent right impact brief.
- Bottom trace/details panel for larger grouped lists.

Use `@xyflow/react` for the graph canvas. It fits the existing React/Vite stack and provides node selection, edge labels, pan/zoom, minimap-style navigation if needed, and controlled node/edge state without hand-rolling SVG interaction.

Graph behavior:

- Spec nodes use type/status styling.
- Source nodes use a visually distinct style.
- Edge labels show spec link type or source evidence.
- Clicking a node updates the right impact brief.
- Clicking a spec node can open that spec in the editor or re-center the impact view on that spec.
- Empty states should clearly distinguish no links, no source annotations, and filtered-out results.

The right impact brief should show:

- Upstream spec count.
- Downstream spec count.
- Source file and symbol evidence count.
- Selected node details.
- High-signal or shortest paths.
- Quick navigation actions.

The bottom trace panel should show:

- Upstream paths.
- Downstream paths.
- Source evidence grouped by impacted entity.

## Data Contracts

Add contract types for the impact response in `packages/contracts`.

Suggested DTO concepts:

- `ImpactNodeDto`
- `ImpactEdgeDto`
- `ImpactPathDto`
- `ImpactSourceEvidenceDto`
- `EntityImpactResponseDto`

Nodes should carry enough metadata for rendering without requiring immediate follow-up requests:

- `id`
- `kind`: `spec` or `source`
- `label`
- `entityId` for spec nodes when applicable
- `filePath` for source nodes when applicable
- `type`, `status`, and `title` for spec nodes
- `symbolName`, `symbolKind`, and line fields for source evidence when applicable

Edges should include:

- `id`
- `from`
- `to`
- `kind`: `spec_link` or `source_evidence`
- `label`
- original link metadata where applicable

## Testing

API and service tests should cover:

- One-hop traversal.
- Two-hop traversal.
- `all` traversal with truncation.
- Upstream, downstream, and both-direction filters.
- Cycles.
- Source evidence include and exclude behavior.
- Missing project and missing entity errors.
- Stable response ordering.

Web tests should cover:

- Impact route renders loading, error, empty, and populated states.
- Depth selector updates the query.
- Direction selector updates the query.
- Source evidence toggle updates the query.
- Graph node selection updates the right impact brief.
- Editor and re-center navigation links are present.

Manual verification should include a browser check because graph layout and canvas rendering are easy to regress visually.

## Rollout Plan

Implement as one feature slice:

1. Add contracts for impact DTOs and query parameters.
2. Add API impact service and route.
3. Add traversal tests and route tests.
4. Add web query helpers.
5. Add impact route and page shell.
6. Add graph canvas, right impact brief, and bottom trace panel components.
7. Link entity detail to the impact page.
8. Run focused tests, typecheck, and browser verification.

## Implementation Decisions

- Add `@xyflow/react` to the web app dependency list.
- Use the traversal caps defined above: 150 spec nodes, 400 spec-link edges, and 300 source evidence links.
- Treat cap changes as follow-up tuning after the feature has browser-tested behavior on real projects.
