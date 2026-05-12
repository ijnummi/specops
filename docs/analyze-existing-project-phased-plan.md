# Analyze Existing Project Phased Plan

## North Star

Make first-time onboarding for an existing codebase feel like:

> Point SpecOps at the project. It reads the code, explains the system, drafts specs, and links everything back to source.

The product should hide mechanics like init, import, AI prefill, and re-index behind one guided workflow.

## Phase 1: MVP, Analyze Existing Project

Goal: replace confusing empty-state options with one strong path: **Analyze project**.

Scope:

- Detect project state:
  - no `.specops` / no specs
  - specs exist but no source index
  - source index exists but no AI drafts
- Present one primary CTA: `Analyze project`.
- Run existing primitives in sequence:
  - initialize SpecOps project if needed
  - scan/import source
  - index code
  - run AI prefill
  - produce draft spec candidates
- Generate a simple reviewable draft set:
  - domain entities
  - services/modules
  - interfaces/APIs
  - use cases
- Generate initial markdown specs from approved drafts.
- Add source-backed links in generated specs.

Success criteria:

- A user with an existing codebase and no specs never has to choose between init/import/prefill/re-index.
- One flow produces useful markdown specs.
- Every AI-created claim has at least one source reference or is marked as a hypothesis.

## Phase 2: Draft Review Experience

Goal: make AI output trustworthy before writing files.

Scope:

- Add a review screen before spec creation.
- Group findings by type:
  - Domain
  - Services
  - Interfaces
  - Use Cases
  - Data Models
  - Unknowns
- Each draft item shows:
  - name
  - short description
  - confidence
  - source evidence
  - proposed spec file path
- Allow user actions:
  - accept
  - rename
  - edit description
  - merge duplicates
  - discard
  - mark as hypothesis

Success criteria:

- User can shape the generated spec set without editing raw markdown first.
- Low-confidence AI output is visible and controlled.
- Generated specs feel reviewed, not blindly dumped.

## Phase 3: Link Annotation Model

Goal: make source-to-spec relationships first-class data, not just text in markdown.

Scope:

- Store structured annotations:
  - source file path
  - symbol/name when available
  - target spec path
  - relationship type: `implements`, `uses`, `defines`, `tests`, `references`
  - confidence
  - provenance: scanner, AI, user
- Render annotations in both directions:
  - from spec to source
  - from source inventory to spec
- Include annotations in generated markdown as readable links.

Success criteria:

- SpecOps can answer "what code supports this spec?"
- SpecOps can answer "what spec explains this code?"
- Later re-analysis can update links without rewriting entire specs.

## Phase 4: Incremental Refresh

Goal: replace manual "re-index" thinking with "keep my understanding current."

Scope:

- Add `Refresh analysis` as the secondary action after initial setup.
- Detect changed files since last analysis.
- Re-run scan/index/AI only for impacted areas where possible.
- Show proposed updates:
  - new entities
  - removed or stale links
  - changed use cases
  - specs that may need review
- Avoid overwriting user-edited specs without review.

Success criteria:

- Re-analysis feels safe.
- User can update the project map after code changes.
- Generated content does not clobber human-written specs.

## Phase 5: Better AI System Understanding

Goal: move from "summarize files" to "understand architecture."

Scope:

- Use layered extraction:
  - package/module structure
  - routes and API endpoints
  - DB schema
  - frontend routes/pages
  - tests
  - dependency graph
  - naming patterns
- Build an intermediate project graph before markdown generation.
- Use AI to classify and consolidate concepts across files.
- Identify missing specs:
  - important code with no spec
  - spec with no source link
  - behavior only described by tests

Success criteria:

- Generated specs are organized around product/system concepts, not individual files.
- Duplicate concepts are merged.
- The app can explain why it created each spec.

## Phase 6: Spec Maintenance Workflow

Goal: make SpecOps useful after initial onboarding.

Scope:

- Add a "Spec health" view:
  - stale specs
  - orphan specs
  - unlinked code
  - low-confidence generated sections
  - source changes needing review
- Add review proposals:
  - update this spec
  - add this link
  - split this spec
  - merge duplicate specs
- Track generated vs user-authored sections.

Success criteria:

- SpecOps becomes a living workbench, not a one-time importer.
- Users can maintain spec/code alignment incrementally.

## Phase 7: Advanced Onboarding

Goal: make large or unfamiliar repos feel manageable.

Scope:

- Add onboarding modes:
  - `Fast map`: broad overview, fewer specs
  - `Detailed analysis`: deeper extraction and more links
  - `Specific area`: analyze selected folders/modules
- Add progress and resumability for long runs.
- Add cost/time estimates before AI-heavy analysis.
- Add agent/task breakdown for large repos.

Success criteria:

- Small projects feel fast.
- Large projects do not feel stuck or opaque.
- Users can control analysis depth without choosing technical subsystems.

## Recommended Build Order

1. **MVP Analyze Project**: unify the entry point and orchestrate existing capabilities.
2. **Draft Review**: make generated output trustworthy.
3. **Structured Link Annotations**: create the foundation for source/spec intelligence.
4. **Incremental Refresh**: make the feature durable after first import.
5. **Deeper AI Understanding**: improve quality once the workflow is proven.

The key product decision is that `Analyze project` becomes the only first-run concept. Everything else becomes a step, status, or advanced action inside that flow.
