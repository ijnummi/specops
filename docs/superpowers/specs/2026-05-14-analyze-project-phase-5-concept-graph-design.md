# Analyze Project Phase 5 Concept Graph Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 5 as Better AI System Understanding. The current application already has the first Phase 5 foundation: a scanner-only, index-run-versioned project graph that stores deterministic facts about files, symbols, imports, exports, tests, specs, and source/spec annotations.

That graph answers questions about what facts are known. It does not yet consolidate those facts into project-level system concepts. This design adds the next Phase 5 layer: a manual, AI-assisted, project-scoped concept graph built from the latest deterministic project graph.

The concept graph is durable project data. It does not write markdown specs, update specs, or create draft proposals in this phase.

## Goals

- Add a manual `Build concepts` workflow for project-scoped concept consolidation.
- Use the latest successful project graph as the only source of durable evidence.
- Let AI auto-create durable concept records without a pre-save review step.
- Keep AI-created concepts separate from deterministic project graph facts.
- Store every concept with provenance, confidence, diagnostics, graph-version lineage, and source-backed memberships.
- Reject or downgrade concepts whose evidence is weak, unsupported, or not tied to graph nodes.
- Expose a read-only concept inspection API and UI.
- Preserve a clear foundation for later missing-spec detection, architecture explanation, and concept-to-spec proposal workflows.

## Non-Goals

- Writing markdown specs from concepts.
- Updating existing specs or source/spec annotations from concepts.
- Running concept consolidation automatically after every index or graph build.
- Making concepts editable in the first UI.
- Replacing the deterministic project graph with AI-created nodes.
- Building a full visual architecture browser.
- Implementing missing-spec detection in this slice.

## Product Model

The current project graph gives SpecOps a factual map of low-level source and spec structure. The concept graph gives SpecOps a higher-level interpretation of that map.

A user starts from the project graph or analysis area and clicks `Build concepts`. SpecOps reads the latest ready or limited project graph, sends a bounded graph evidence packet to the configured AI provider, validates the response, and persists a new concept graph version.

Concepts should represent project-level ideas such as:

- workflows
- bounded areas
- subsystems
- domain concepts
- public interfaces
- data flows
- test-backed behaviors

The result should answer:

- What system concepts does this code appear to implement?
- What files, symbols, specs, tests, and annotations support each concept?
- How confident is SpecOps in each concept?
- Which claims were limited or rejected because evidence was weak?

Concepts are auto-created when the build succeeds. The first UI is inspect-only. Later phases can add discard, rename, merge, reviewed promotion, or markdown generation actions.

## Architecture

Keep two graph layers:

1. **Project graph**
   Scanner-first, deterministic facts tied to an index run.

2. **Concept graph**
   AI-assisted interpretation tied to a project graph version.

The concept graph build should not mutate the project graph. It creates a new concept graph version that references the source `project_graph_versions.id`.

The build pipeline is:

1. Load the latest `ready` or `limited` project graph.
2. Build a bounded evidence packet from graph nodes and edges.
3. Call the configured AI provider with a concept-consolidation prompt.
4. Normalize and validate provider output.
5. Reject concepts without graph-backed evidence.
6. Downgrade confidence for weak or indirect evidence.
7. Persist concept version, concepts, memberships, relationships, diagnostics, provider metadata, model metadata, and prompt metadata.
8. Expose latest concept graph and concept detail through API routes.

If there is no project graph, the build should fail with a clear error. If the graph has too little usable evidence, the build should record a `limited` or `failed` concept version with diagnostics.

## Data Model

### `project_concept_versions`

Stores one concept build for a project.

Fields:

- `id`
- `project_id`
- `project_graph_version_id`
- `status`: `building`, `ready`, `limited`, `failed`, or `superseded`
- `provider`
- `model`
- `prompt_version`
- `summary`
- `coverage_json`
- `diagnostics_json`
- `created_at`
- `updated_at`

`coverage_json` should include:

- concepts by type
- memberships by role
- relationship counts by type
- rejected concept count
- rejected membership count
- graph node coverage count
- low-confidence concept count

`diagnostics_json` should include provider errors, invalid output, unsupported evidence references, rejected concepts, limited graph coverage, and prompt-budget truncation.

When a new ready or limited concept version is created, older ready or limited concept versions for the project should be marked `superseded`. Failed versions remain as diagnostics history.

### `project_concepts`

Stores AI-created project concepts for one concept version.

Fields:

- `id`
- `project_id`
- `concept_version_id`
- `concept_key`
- `concept_type`
- `name`
- `summary`
- `confidence`
- `provenance`: initially `ai`
- `evidence_summary`
- `status`: `active`, `discarded`, or `superseded`
- `metadata_json`
- `created_at`
- `updated_at`

Initial concept types:

- `workflow`
- `subsystem`
- `domain_concept`
- `interface`
- `data_flow`
- `test_behavior`
- `cross_cutting`
- `unknown`

`concept_key` should be stable within a version and derived from normalized type and name. It does not need to be stable across versions in the first implementation.

### `project_concept_memberships`

Links concepts to deterministic project graph nodes.

Fields:

- `id`
- `project_id`
- `concept_version_id`
- `concept_id`
- `graph_node_id`
- `role`
- `confidence`
- `rationale`
- `created_at`

Initial roles:

- `primary`
- `supporting`
- `entrypoint`
- `data`
- `test`
- `spec`

A concept must have at least one membership. Memberships must reference graph nodes from the concept version's source project graph version.

### `project_concept_relationships`

Links concepts to other concepts within the same concept version.

Fields:

- `id`
- `project_id`
- `concept_version_id`
- `from_concept_id`
- `to_concept_id`
- `relationship_type`
- `confidence`
- `rationale`
- `created_at`

Initial relationship types:

- `depends_on`
- `uses`
- `implements`
- `exposes`
- `tests`
- `relates_to`

Relationships that reference unknown or rejected concepts should be dropped and reported as diagnostics.

## AI Input And Output

The concept prompt should receive graph facts, not raw repository files. The first evidence packet should include:

- graph version id and summary
- node counts and edge counts
- sampled or ranked file nodes
- symbol nodes for high-signal files
- import and export relationships
- test relationships
- spec entity nodes
- source/spec support edges
- node ids and node keys for every referenced fact

The packet must be bounded by existing AI limits. If the graph is too large, select high-signal facts first:

1. route and entrypoint-like files
2. services and exported symbols
3. data model files
4. tests
5. spec entities and source/spec annotations
6. connected dependencies for the selected nodes

Provider output should be normalized into:

- concepts
- concept memberships by graph node id or node key
- concept relationships
- diagnostics or uncertainty notes

Any concept claim that cannot be tied back to at least one graph node should be rejected. Any membership that references a missing node should be dropped.

## API

### Start Concept Build

`POST /api/projects/:projectId/concept-graphs`

Starts a manual concept graph build from the latest project graph.

Initial request body:

- `provider`
- `model`
- `temperature`
- optional `maxGraphNodes`
- optional `maxGraphEdges`

The route returns the created concept version summary. The first implementation may run synchronously if it matches existing AI prefill behavior, but the contract should allow asynchronous status polling later.

### Get Latest Concept Graph

`GET /api/projects/:projectId/concept-graphs/latest`

Returns:

- concept version
- concept counts by type
- membership counts by role
- relationship counts by type
- concept list
- diagnostics

If no concept graph exists, return a not-found response that the UI can render as an empty state with `Build concepts`.

### Get Concept Detail

`GET /api/projects/:projectId/concepts/:conceptId`

Returns:

- concept
- memberships
- related graph nodes
- incoming and outgoing concept relationships
- related concepts

The route must verify that the concept belongs to the project and that all returned graph nodes are from the concept version's source project graph.

## UI

Add a `Concepts` inspection page reachable from the project graph page and project analysis area.

The page should show:

- current concept graph status
- source project graph version
- provider and model metadata
- concept counts by type
- diagnostics
- concept list with type, name, summary, and confidence
- selected concept detail
- graph node memberships grouped by role
- concept relationships

The first version is read-only. It should not include edit, merge, rename, discard, or spec-generation controls. The data model includes lifecycle status so those actions can be added later without reshaping the storage model.

When no concept version exists, show `Build concepts` if a project graph exists. When no project graph exists, direct the user to build or refresh the project graph first.

## Error Handling

- Missing project graph: fail the build with a clear `Project graph is required before concept consolidation` error.
- Limited project graph: allow build, but include diagnostics and cap confidence when evidence is sparse.
- AI provider setup failure: return the same style of provider setup errors used by AI prefill.
- AI timeout or gateway failure: record a failed concept version with provider diagnostics.
- Invalid provider JSON: record a failed or limited concept version with normalization diagnostics.
- Concepts without memberships: reject and count in coverage.
- Memberships referencing missing graph nodes: drop and report diagnostics.
- Relationships referencing missing concepts: drop and report diagnostics.
- Prompt truncation: include diagnostics and lower confidence for concepts produced from partial evidence.

The deterministic project graph and markdown files must remain unchanged when concept consolidation fails.

## Testing

Contract tests should cover:

- concept version schemas
- concept schemas
- membership and relationship schemas
- latest concept graph response
- concept detail response

Service tests should cover:

- successful concept build from mocked provider output
- no latest project graph error
- limited graph diagnostics
- invalid provider output creating failed diagnostics
- unsupported node references being rejected
- concepts without memberships being rejected
- concept version superseding behavior
- no writes to markdown/spec entities/annotations during concept build

Route tests should cover:

- start concept build
- get latest concept graph
- get concept detail
- project isolation
- not-found empty states

Web tests should cover:

- empty state when no concept graph exists
- build action disabled or redirected when no project graph exists
- ready concept version rendering
- failed or limited diagnostics rendering
- concept detail memberships and relationships

## Success Criteria

- A user can manually build project-scoped concepts from the current project graph.
- Concepts are stored separately from deterministic graph facts.
- Every persisted concept has at least one graph-backed membership.
- The UI shows what each concept is, why it exists, how confident SpecOps is, and which graph facts support it.
- Concept consolidation never writes markdown specs in this phase.
- The resulting concept layer is usable by later missing-spec, architecture explanation, and concept-to-spec proposal workflows.
