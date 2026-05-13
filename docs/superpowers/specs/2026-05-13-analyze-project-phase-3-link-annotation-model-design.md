# Analyze Project Phase 3 Link Annotation Model Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 3 as the Link Annotation Model. Phase 1 created the Analyze Project flow. Phase 2 added a run-scoped review workspace where users assemble generated draft inputs into accepted specs with reviewed claims and source evidence.

The current codebase already has two related but separate concepts:

- `source_spec_links`, populated from source `@specops <entityId>` comments during source scanning.
- `analyze_review_claim_evidence`, populated during Phase 2 draft review to prove reviewed claims before accepting generated specs.

Phase 3 should promote these relationships into a first-class source/spec annotation model. The old `source_spec_links` interface does not need long-term API compatibility. Existing `@specops` source comments should still be ingested, but product and API surfaces should move to the new annotation model.

## Goals

- Make source-to-spec relationships first-class structured data.
- Keep entity-level source/spec links as a foundational concept.
- Add optional claim-level precision when an annotation supports a reviewed claim.
- Promote accepted Phase 2 evidence into durable annotations.
- Render annotations in both directions: spec to source and source to spec.
- Include readable annotation links in generated markdown.
- Preserve enough annotation state for later incremental refresh and spec health workflows.

## Non-Goals

- Building the Phase 4 incremental refresh workflow.
- Creating a full dependency graph or architecture understanding layer.
- Classifying every source relationship automatically with high precision.
- Keeping legacy `source_spec_links` API compatibility if it complicates the model.
- Defining a complete markdown/source-file serialization format for every annotation field.

## Product Model

Phase 3 introduces **source/spec annotations**. An annotation is a typed relationship from a source location to a spec entity, optionally narrowed to a reviewed claim inside that entity.

Every annotation targets a spec entity. Claim-level annotation is additional precision, not a replacement for entity-level linking. This keeps entities as the base concept while allowing the app to answer more specific trust questions such as "what code supports this exact claim?"

Each annotation stores:

- source file path
- optional source file id
- optional source symbol name
- optional source symbol kind
- optional source start and end line
- target spec entity id
- target spec file path
- optional reviewed claim id
- relationship type
- confidence
- provenance
- lifecycle status
- origin metadata

Relationship type is exactly one of:

- `implements`
- `uses`
- `defines`
- `tests`
- `references`

Provenance is exactly one of:

- `scanner`
- `ai`
- `user`

The initial lifecycle statuses are:

- `active`
- `stale`

Generated annotations that no longer match source or spec state should become `stale` rather than disappearing immediately. This gives later refresh and health workflows something reviewable. User-created annotations should not be overwritten by scanner or AI output.

## Canonicality

SpecOps currently treats markdown and source files as canonical authored artifacts while PostgreSQL stores derived cache data. Phase 3 uses a hybrid model because claim-level reviewed evidence does not yet have a good durable file syntax.

- Source `@specops <entityId>` comments remain durable source-authored hints and are ingested as entity-level annotations.
- Generated markdown includes readable annotation projections so humans can inspect source support.
- Claim-level reviewed evidence and user review decisions are persisted as structured app state in PostgreSQL until a later file format exists.

This avoids forcing a premature markdown/frontmatter format while still preserving human-readable links in generated specs.

## Data Model

The implementation should replace the product role of `source_spec_links` with a richer annotation table. The implementation plan can choose whether to migrate the existing table in place or create a new `source_spec_annotations` table and move consumers to it.

The annotation table should include:

- `id`
- `project_id`
- nullable `source_file_id`
- `source_file_path`
- nullable `symbol_name`
- nullable `symbol_kind`
- nullable `start_line`
- nullable `end_line`
- nullable `annotation_line`
- nullable `source_content_hash`
- `entity_id`
- `spec_file_path`
- nullable `claim_id`
- `relationship_type`
- nullable `confidence`
- `provenance`
- `status`
- nullable `analyze_run_id`
- nullable `proposal_id`
- nullable `assembly_id`
- nullable `claim_evidence_id`
- nullable `index_run_id`
- timestamps

Indexes should support:

- project and entity lookup
- project and source file lookup
- project, relationship type, and status filtering
- origin lookups for accepted analyze runs

There should be a uniqueness constraint for duplicate active annotations. The key should include project, source file path or source file id, symbol or line target when present, entity id, optional claim id, and relationship type. The exact SQL can use nullable-safe uniqueness or a normalized dedupe key.

## Ingestion

### Source Scanner

During indexing, scanner-discovered `@specops <entityId>` comments create entity-level annotations. These annotations:

- target the referenced spec entity
- have no claim target
- use provenance `scanner`
- use confidence `1`
- use relationship type `references` unless a more specific scanner inference exists
- include source file, symbol, symbol kind, annotation line, symbol line, and content hash where available

Invalid or missing entity references should produce validation messages and should not create active annotations.

### Analyze Review Acceptance

When Phase 2 assemblies are accepted, each reviewed evidence row creates an annotation for the accepted spec entity. If the evidence belongs to a reviewed claim, the annotation also targets that claim.

The annotation copies or derives:

- entity id and spec file path from the accepted assembly
- claim id from the reviewed claim when available
- source file path, symbol, and line range from evidence
- provenance from evidence provenance
- confidence from evidence confidence, falling back to claim confidence
- origin metadata from analyze run, proposal, assembly, and evidence ids

Relationship type should be selected conservatively:

- `references` by default
- `tests` for test files
- `defines` for schema, type, model, and declaration evidence
- `implements` for routes, handlers, services, components, or modules that implement a use case or interface
- `uses` only when the evidence describes dependency or usage rather than definition or implementation

The first implementation can use deterministic heuristics. It should prefer `references` over speculative precision.

### User Annotations

Phase 3 should expose API support for user-created annotations. User annotations:

- use provenance `user`
- can set relationship type explicitly
- can target a spec entity and optionally a claim
- should win over generated annotations during later refresh workflows

The first UI can be limited, but the API should not make user provenance a later retrofit.

## API

Add annotation-focused contracts and routes.

### List Annotations

`GET /api/projects/:projectId/annotations`

Filters:

- `entityId`
- `sourceFileId`
- `filePath`
- `relationshipType`
- `status`
- `provenance`

Returns annotations with enough detail for both spec-to-source and source-to-spec rendering.

### Create Annotation

`POST /api/projects/:projectId/annotations`

Creates a user annotation. The request should require:

- source file path or source file id
- entity id
- relationship type

It may include symbol, line range, claim id, confidence, and spec file path. The service should verify project ownership of all referenced records.

### Update Annotation

`PATCH /api/projects/:projectId/annotations/:annotationId`

Allows editing:

- relationship type
- confidence
- status
- claim target
- source line range

Generated annotations may be edited by creating or converting to a user annotation, rather than mutating scanner or AI provenance in place. The implementation plan should choose the simpler safe behavior.

### Delete Or Deactivate Annotation

`DELETE /api/projects/:projectId/annotations/:annotationId`

For generated annotations, deletion may mark the annotation `stale` or remove it. For user annotations, deletion removes the user assertion. The route should not silently delete annotations outside the requested project.

## UI

### Spec Detail

Replace the existing source links panel with an annotation panel grouped by relationship type:

- `implements`
- `uses`
- `defines`
- `tests`
- `references`

Each annotation row should show source file, symbol when available, line range, provenance, confidence, and stale state. Claim-backed annotations should indicate which claim they support.

### Source Inventory Detail

Add a source-to-spec annotation panel on source file detail. It should show which spec entities the file or symbols support, grouped by relationship type.

This lets users answer "what spec explains this code?" without starting from the spec entity first.

### Analyze Review Acceptance

After accepting assemblies, the review result should communicate that accepted evidence was saved as source/spec annotations. Failures to create annotations should be visible and should not be hidden behind successful markdown writes.

### Manual Editing

Manual annotation UI can be small in Phase 3:

- edit relationship type
- mark stale or remove an annotation
- add an annotation from a source file or symbol detail view

The API should support more than the first UI exposes.

## Markdown Rendering

Generated markdown should include readable annotation projections.

For claim-backed evidence, render inline evidence footnotes near the supported claim. The footnote should include source file, optional symbol, line range, and relationship type.

For entity-level annotations, render a source links section grouped by relationship type. This section should include all active entity-level annotations, including claim-backed annotations summarized at entity level.

The markdown projection is readable output, not the complete structured annotation store.

## Validation

Validation should catch bad or stale relationships without blocking normal indexing whenever possible.

Validation messages should cover:

- invalid spec entity id
- missing spec entity
- missing source file
- source content hash mismatch
- source line range outside current file
- claim target no longer exists
- duplicate active annotation
- generated annotation conflicts with a user annotation

Missing or changed generated annotations should generally become `stale`. User annotations should remain user-controlled and should not be overwritten by scanner or AI ingestion.

## Testing

Phase 3 should add focused coverage for:

- annotation contract schemas
- DB schema and migration type checks
- scanner ingestion from `@specops`
- Phase 2 accept promoting claim evidence into annotations
- project-scoped API filters
- duplicate active annotation prevention
- stale annotation validation
- spec detail annotation rendering
- source detail reverse annotation rendering
- generated markdown inline evidence footnotes
- generated markdown grouped source links section

## Success Criteria

- SpecOps can answer "what code supports this spec?" from structured annotations.
- SpecOps can answer "what spec explains this code?" from source inventory.
- Accepted Phase 2 evidence becomes durable source/spec annotations.
- Every annotation targets a spec entity, with optional claim-level precision.
- Generated markdown includes readable inline evidence footnotes and grouped source links.
- Stale annotations are preserved for later review rather than silently discarded.
