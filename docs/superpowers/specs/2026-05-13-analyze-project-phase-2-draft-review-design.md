# Analyze Project Phase 2 Draft Review Design

## Context

`docs/analyze-existing-project-phased-plan.md` defines Phase 2 as the draft review experience for Analyze Project. Phase 1 already added a run-scoped analyze flow and a review route that lists source and AI proposals, shows evidence, allows markdown edits, rejects proposals, and accepts selected proposals.

Phase 2 should redesign that review experience around trust and spec-set shaping. The current proposal list is useful groundwork, but it still treats each generated proposal as a near-final markdown file. The redesigned workflow should treat scanner and AI output as draft inputs, then let the user assemble a reviewed set of final specs before files are written.

## Goals

- Make generated specs feel reviewed and intentionally assembled, not blindly dumped.
- Let users combine related draft inputs into one final spec file.
- Move normal review away from raw markdown editing and toward structured spec fields, claims, evidence, and hypotheses.
- Keep Phase 2 scoped to one analyze run.
- Require source evidence for every accepted factual claim.
- Preserve low-confidence and unknown output as visible review work, not hidden output.

## Non-Goals

- Building a long-lived project backlog for unreviewed drafts.
- Implementing incremental refresh or spec maintenance workflows.
- Replacing Phase 3 structured source/spec annotation storage.
- Renaming the existing `ai_proposals` table as part of this phase.
- Auto-accepting generated specs.
- Adding broad AI architecture understanding beyond the proposal inputs Phase 1 already creates.

## Product Model

Phase 2 introduces a run-scoped **Spec Assembly Workspace**. The analyze run still produces source-derived and AI-derived proposals. Those proposals become draft inputs. The main reviewed object is an **assembly**, representing one final spec file that may be written.

Each assembly has structured editable fields:

- spec type: `domain_entity`, `interface`, or `use_case`
- title
- entity id
- proposed file path
- short summary
- included draft input ids
- reviewed claims
- explicitly marked hypotheses
- source evidence references

Draft inputs can be grouped into an assembly, removed from an assembly, left unassigned, or discarded from the active review set. "Merge duplicates" means combining several related draft inputs into one assembly, not just collapsing identical proposed files. This supports the common case where routes, services, schemas, and AI summaries all describe pieces of the same final spec.

Accepting writes markdown specs from assemblies. Discarding an assembly or draft input removes it from the active review workflow for that run but keeps enough run history for audit and debugging.

## Trust Rules

Every non-hypothesis claim in an accepted assembly must have at least one source evidence reference.

Hypotheses may be accepted only when explicitly marked as hypotheses. Generated markdown must render them under a clearly labeled hypotheses or unknowns section. They must not appear as factual statements.

Low-confidence inputs and unknowns remain visible until the user assigns them to an assembly, marks them as hypotheses, or discards them.

## Backend Model

Add a run-scoped assembly layer rather than extending proposal rows with more review responsibilities.

### `analyze_review_assemblies`

Stores one proposed final spec file for one analyze run.

Fields:

- `id`
- `project_id`
- `analyze_run_id`
- `status`: `draft`, `accepted`, or `discarded`
- `entity_type`
- `entity_id`
- `title`
- `summary`
- `file_path`
- nullable `rendered_markdown`
- `created_at`
- `updated_at`
- `accepted_at`
- `discarded_at`

Structured fields are canonical during review. `rendered_markdown` is derived output and may be regenerated whenever assembly fields, claims, evidence, or inputs change.

### `analyze_review_assembly_inputs`

Connects draft proposal inputs to assemblies.

Fields:

- `assembly_id`
- `proposal_id`
- `role`: `primary`, `supporting`, `duplicate`, or `evidence_only`
- `created_at`

A proposal input should not be attached to multiple active assemblies unless its role is `evidence_only`.

### `analyze_review_claims`

Stores reviewed claims for an assembly.

Fields:

- `id`
- `assembly_id`
- `text`
- `kind`: `fact` or `hypothesis`
- `confidence`
- `sort_order`
- timestamps

### `analyze_review_claim_evidence`

Stores the source references backing a claim.

Fields:

- `id`
- `claim_id`
- `proposal_id`
- `source_file_path`
- optional `symbol_name`
- optional start and end line
- `provenance`: `scanner`, `ai`, or `user`
- optional confidence

This is a Phase 2 review model. Phase 3 can later promote source/spec relationships into first-class structured annotations.

## Initial Assembly Derivation

When the user opens review for an analyze run, the backend should ensure initial assemblies exist for that run. The first implementation can be conservative:

- create one assembly per proposal by default
- pre-group proposals only when entity id, title slug, or proposed file path strongly match
- copy proposal title, type, entity id, file path, confidence, and all parseable source evidence into initial assembly fields and claims
- convert unsupported, low-confidence, or ambiguous output into warnings or hypothesis claims rather than hiding it

Derivation must be idempotent. Refreshing the review page should not duplicate assemblies.

Existing proposal rows remain as raw provenance and draft input storage. They continue to provide source and AI evidence, payload data, generated markdown, and original confidence.

## API

Add assembly-focused endpoints under the analyze run.

### List Review State

`GET /api/projects/:projectId/analyze-runs/:runId/review-assemblies`

Returns:

- assemblies
- assigned inputs
- unassigned inputs
- discarded inputs, if requested or summarized
- counts by type, status, confidence, and validation state
- validation summaries for each assembly

### Create Assembly

`POST /api/projects/:projectId/analyze-runs/:runId/review-assemblies`

Creates a manual assembly or creates an assembly from selected proposal input ids.

### Update Assembly

`PATCH /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId`

Edits structured fields:

- title
- entity id
- entity type
- file path
- summary
- status

### Attach And Remove Inputs

`POST /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/inputs`

Attaches proposal inputs to an assembly with a role.

`DELETE /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/inputs/:proposalId`

Removes an input from an assembly.

### Claims And Evidence

`POST /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims`

Adds a fact claim or hypothesis.

`PATCH /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId`

Edits claim text, kind, confidence, and ordering.

`POST /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId/evidence`

Attaches one source evidence reference to a claim.

`DELETE /api/projects/:projectId/analyze-runs/:runId/review-assemblies/:assemblyId/claims/:claimId/evidence/:evidenceId`

Removes one source evidence reference from a claim.

### Accept Assemblies

`POST /api/projects/:projectId/analyze-runs/:runId/review-assemblies/accept`

Accepts selected assemblies. The service validates each assembly, renders markdown, writes files, marks accepted assemblies, marks every attached pending proposal as `accepted`, and triggers indexing.

The accept response returns `acceptedAssemblyIds` and per-assembly validation failures. Invalid assemblies are not written and do not block unrelated valid assemblies in the same batch.

## Validation

All assembly mutations must verify that the assembly belongs to the requested project and analyze run.

Accepted assemblies must have:

- valid `entity_id`
- valid `entity_type`
- non-empty title
- repo-safe file path under the project `.specops` directory
- valid rendered markdown
- no entity id conflict unless the implementation provides an explicit conflict resolution flow
- no file path conflict unless the implementation provides an explicit conflict resolution flow
- at least one evidence reference for every fact claim

Path-safety and filesystem integrity failures are hard failures for the affected assembly.

## UI Workflow

Keep the route run-scoped at the existing review route:

`/projects/$projectId/analyze-runs/$runId/review`

Redesign it into a three-zone assembly workspace.

### Draft Pool

The draft pool shows source and AI proposal inputs grouped by finding type:

- Domain
- Services
- Interfaces
- Use Cases
- Data Models
- Unknowns

Each input shows name, confidence, source or AI origin, evidence count, proposed path, and assignment state. Users can select one or more inputs and add them to an existing or new assembly. Low-confidence and unknown inputs stay visible until assigned, marked as hypothesis through an assembly, or discarded.

### Assembly List

The assembly list shows proposed final spec files. Each row shows type, title, path, validation state, included input count, fact count, and hypothesis count.

Sort assemblies by validation state first:

1. blockers
2. warnings
3. ready
4. accepted or discarded when visible through filters

Users can create assemblies, discard assemblies, merge selected inputs into an assembly, and accept selected ready assemblies.

### Assembly Detail

The detail panel provides structured editing:

- title
- entity id
- type
- file path
- summary
- included inputs and their roles
- reviewed claims
- evidence references for each claim
- hypothesis toggles
- generated markdown preview

Markdown editing is an advanced escape hatch. The normal review path is structured editing plus preview.

## Rendering

Markdown is generated from the assembly model. Existing proposal markdown may seed content, but assembly fields and reviewed claims are canonical.

Generated specs should include:

- standard frontmatter
- summary
- reviewed factual claims
- hypotheses or unknowns, when present
- source evidence
- proposed links where available

Rendering must be deterministic so tests can compare output directly.

## Error Handling

Expected user-facing errors should identify the affected assembly and the failed rule.

Examples:

- missing title, entity id, type, or file path
- fact claim has no evidence
- file path conflict
- entity id conflict
- invalid rendered markdown
- source evidence no longer exists
- proposal input does not belong to the run

If indexing fails after markdown files are written, the files remain written and the accept response reports the index failure clearly.

## Testing Plan

Contracts:

- assembly list, detail, input, claim, evidence, validation, and accept schemas
- discriminated unions for assembly status, claim kind, input role, and validation severity

Database:

- migrations for new assembly tables
- project and analyze-run foreign key constraints
- constraints or service-level tests that prevent the same proposal input from being attached to more than one active assembly unless every duplicate attachment uses `evidence_only`

Backend services:

- idempotent initial assembly derivation
- one proposal to one assembly default derivation
- strong-match pre-grouping by entity id, title slug, or file path
- attaching and removing inputs
- editing structured fields
- creating and editing fact claims and hypotheses
- evidence requirement for fact claims
- hypothesis rendering
- conflict handling for file path and entity id
- accepting selected assemblies
- per-assembly validation failures
- proposal status updates after accept
- index failure reporting after writes

API routes:

- list review state
- create assembly
- patch assembly
- attach input
- remove input
- add claim
- patch claim
- accept selected assemblies

Frontend:

- draft pool grouping by finding type
- unassigned, assigned, and discarded input states
- assembly creation from selected inputs
- structured field editing
- merge flow
- claim evidence blockers
- hypothesis handling
- validation-state sorting
- markdown preview
- discard flow
- accept selected flow

Manual verification:

- browser inspection of the final workspace at desktop and narrow widths
- confirm text does not overlap in dense review states
- confirm ready/blocker/warning states are visually scannable

## Success Criteria

- The user can assemble one final spec from multiple source and AI draft inputs.
- The user can shape title, type, entity id, path, summary, claims, hypotheses, and evidence before markdown is written.
- Low-confidence and unknown output is visible and controlled.
- Accepting an assembly writes deterministic markdown from reviewed structured data.
- Every accepted factual claim has source evidence.
- Hypotheses are clearly labeled in generated specs.
- The workflow remains scoped to one analyze run.
