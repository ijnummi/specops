# Bootstrap Specs From Source Design

Date: 2026-05-10

## Scope

Add a one-click deterministic bootstrap flow for source-only projects. The feature creates initial canonical SpecOps markdown specs from TypeScript/JavaScript source scanner facts, then runs the normal project index so the generated specs appear immediately in the workbench.

This is a first-use project setup feature, not an ongoing proposal or synchronization system. It writes files directly because bootstrap is intended to run once before a project has curated specs.

## Product Behavior

The project detail page adds a `Bootstrap from source` action separate from `Init specops` and `Re-index`.

When clicked, the workbench performs the full workflow in one request:

1. Ensure the project paths are valid.
2. Ensure the project has not already been bootstrapped from source.
3. Ensure `specops/` has no existing non-template entity markdown files.
4. Scan source files under `repoPath`.
5. Generate deterministic `domain_entity` and `interface` specs from exported source symbols.
6. Write markdown files under `specops/domain/` and `specops/interfaces/`.
7. Run the existing project indexer.
8. Mark source bootstrap completion in `specops/project.yaml`.
9. Refresh project detail data in the UI.

After success, generated entities such as `domain.decision`, `domain.workspace`, and `interface.decision-service` appear in the entity list like any other canonical markdown-backed spec.

## One-Time Rule

Bootstrap is allowed only for an unbootstrapped project with no existing non-template entity markdown files under `specops/`.

The API refuses to bootstrap when either condition is true:

- `specops/project.yaml` contains a completed `source_bootstrap` marker.
- `specops/` contains any non-template markdown file that parses as a spec entity.

This keeps generated first-pass specs from being mixed into an already curated spec graph. It also makes the operation easy to reason about: bootstrap starts a project, while normal editing maintains it afterward.

## Bootstrap Marker

The API writes a small marker into `specops/project.yaml` after generated markdown files are written and indexing succeeds:

```yaml
source_bootstrap:
  completed_at: "2026-05-10T12:34:56.000Z"
  scanner: "typescript"
  generated_entity_count: 5
```

If indexing fails after markdown files are written, the generated markdown remains on disk for manual recovery, but the API must not write `completed_at`.

## Backend Architecture

Add a new API endpoint:

```text
POST /api/projects/:projectId/bootstrap-from-source
```

The route delegates to a bootstrap service. The service owns filesystem validation, scanner orchestration, candidate generation, file writes, marker updates, and final indexing.

The backend flow is:

1. Load the project with `createProjectService(db).getProject(projectId)`.
2. Validate `repoPath` and `specopsPath` using the existing path-safety helpers.
3. Create `specops/` when it does not exist, after confirming its parent is inside `repoPath`.
4. Read `project.yaml` when present and check for `source_bootstrap.completed_at`.
5. Discover existing markdown specs and parse them. Ignore `*.template.md`; refuse if any non-template entity exists.
6. Run `scanRepository({ repoPath })`.
7. Convert scanner facts to bootstrap candidates.
8. Write generated markdown files with exclusive create semantics so existing files are never overwritten.
9. Run `createIndexerService(db).indexProject(projectId)`.
10. Update `project.yaml` with the source bootstrap marker.
11. Return the resulting index run DTO.

The route response can reuse `IndexRunDto`, because successful bootstrap ends with an index run.

## Generation Rules

The generator is deterministic and local-only. It does not call AI and does not make behavioral claims beyond source evidence.

The generator reads scanner output and considers exported top-level symbols only.

Domain entity candidates:

- exported `interface`, `type`, `class`, or `enum`
- name does not end in a service/interface suffix
- examples: `Decision`, `Workspace`, `DecisionLink`, `ReviewReminder`

Interface candidates:

- exported symbol names ending in `Service`, `Scheduler`, `Client`, `Repository`, `Controller`, `Router`, or `Handler`
- examples: `DecisionService`, `SearchService`, `ReminderScheduler`

The generator skips non-exported symbols, test files, config files, anonymous/default-only exports, and implementation helpers that do not have an exported symbol name.

Duplicate candidate names are merged into one generated spec with combined source evidence.

## Naming And Paths

Entity IDs and paths are stable:

- `Decision` -> `domain.decision`, `domain/decision.md`
- `Workspace` -> `domain.workspace`, `domain/workspace.md`
- `DecisionService` -> `interface.decision-service`, `interfaces/decision-service.md`
- `SearchService` -> `interface.search-service`, `interfaces/search-service.md`

Names are converted from PascalCase, camelCase, snake_case, or kebab-case to lowercase kebab-case for IDs and file paths.

## Generated Markdown Shape

Generated files use standard SpecOps frontmatter:

```markdown
---
id: domain.decision
type: domain_entity
title: Decision
status: draft
links: {}
source_bootstrap:
  source_files:
    - src/domain.ts
  symbols:
    - name: Decision
      kind: interface
      exported: true
      file: src/domain.ts
---

# Decision

## Definition

Initial spec generated from exported source symbol `Decision`.

## Source Evidence

- `src/domain.ts` exports `Decision` as an interface.

## Notes

- Review and expand this spec before using it as implementation guidance.
```

Interface specs use `## Responsibility` instead of `## Definition`.

The body intentionally stays factual. It should help the user start editing without implying semantic understanding that the scanner does not have.

## UI Design

The project detail action area adds a `Bootstrap from source` button next to `Init specops` and `Re-index`.

Behavior:

- Disable the button while the bootstrap mutation is running.
- Use a literal label: `Bootstrap from source`.
- On success, invalidate project, entities, validation messages, and index runs.
- On API refusal or failure, show the returned error in the existing project detail error area.
- Do not add a preview, wizard, or file picker in v1.

The latest index run panel remains the confirmation surface. Source inventory UI can later expose scanned files and symbols, but this feature does not depend on that UI.

## Error Handling

The API refuses before writing anything when:

- `repoPath` is missing, unreadable, or invalid.
- `specopsPath` is outside `repoPath`.
- source bootstrap already completed.
- existing non-template spec entity markdown files are present.
- the source scanner finds no supported source files.
- the scanner finds no eligible exported symbols.

The API aborts and removes files written during the current bootstrap attempt when a generated file write collides or another pre-index write fails.

If indexing fails after generated markdown files are written, the API keeps the generated files for manual recovery and returns the index error. It must not mark bootstrap complete in that case.

## Testing

Package-level tests should cover deterministic candidate generation:

- domain symbols produce `domain_entity` candidates.
- service-like symbols produce `interface` candidates.
- non-exported symbols are skipped.
- duplicate candidate names merge source evidence.
- generated IDs, paths, frontmatter, and body sections are stable.

API DB-backed tests should cover:

- one-click bootstrap writes markdown files, marks `project.yaml`, runs indexing, and returns non-zero entities.
- source-only sample-style projects produce entities for `Decision`, `Workspace`, and `DecisionService`.
- existing specs cause refusal without writing files.
- an existing completed marker causes refusal.
- no source files causes refusal.
- no eligible exported symbols causes refusal.

Web tests should cover:

- the project detail page calls the bootstrap mutation.
- the button disables while pending.
- successful bootstrap invalidates project-related queries.
- API errors render in the page error area.

## Acceptance Criteria

The feature is complete when:

- a source-only TypeScript sample project can be bootstrapped with one click.
- generated markdown specs are written directly under `specops/`.
- generated specs are deterministic and based only on exported source symbols.
- bootstrap refuses to run more than once for a project.
- bootstrap refuses to run when existing non-template specs are present.
- successful bootstrap runs the normal indexer and generated entities appear immediately.
- tests cover generation, API workflow, refusal cases, and UI mutation behavior.
