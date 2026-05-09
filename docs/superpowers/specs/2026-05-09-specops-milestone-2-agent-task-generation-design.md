# SpecOps Workbench Milestone 2 Agent Task Generation Design

Date: 2026-05-09

## Scope

Milestone 2 adds deterministic agent task generation to SpecOps Workbench. A user can select an indexed spec entity, generate an editable task preview, optionally adjust the markdown, then save it as a canonical `agent_task` markdown file under `specops/agent-tasks/`.

The generated task includes the selected source entity, a one-hop typed graph neighborhood, linked `source_file` entities when they already exist in the spec graph, default validation commands from project configuration with hardcoded fallbacks, and traceability links in frontmatter.

Milestone 2 does not run AI, infer source files from freeform markdown text, support deeper graph traversal, overwrite existing task files, or add target-agent-specific prompt variants.

## Product Behavior

The user starts from an entity detail view and chooses to generate an agent task. The UI suggests a deterministic task ID derived from the source entity, such as `task.uc-generate-agent-task`, and allows the user to edit the ID, title, target agent, and generated markdown before saving.

The first generation step is preview-only. No canonical markdown file is written until the user confirms save. This preserves the markdown source-of-truth model and prevents generated content from silently becoming project truth.

Saved tasks are normal spec entities. After save and re-index, they appear in entity lists, search, outgoing links, backlinks, and validation panels like any other markdown spec.

## Architecture

The core generator belongs in `packages/taskgen`. It should be a pure TypeScript package that accepts plain data and returns generated markdown plus structured metadata. It must not depend on Fastify, Drizzle, the filesystem, or React.

The package should receive:

- source entity
- context entities
- graph links
- task ID
- title
- target agent
- validation commands

It should return:

- generated markdown
- task ID
- title
- suggested relative file path
- source spec IDs
- context spec IDs
- warnings for incomplete source material

The API owns orchestration. It loads the project and selected entity, queries outgoing links and backlinks, loads one-hop context entities, groups and prioritizes context by type, reads validation command defaults, calls `@specops/taskgen`, validates edited markdown before save, writes to `specops/agent-tasks/`, rejects duplicate files, and re-indexes after a successful write.

The web app owns interaction. It provides the generate action, target-agent and task metadata controls, an editable markdown preview, copy and save actions, and clear handling for duplicate-file or validation errors.

## Context Collection

Task generation uses a one-hop typed graph neighborhood:

- the selected source entity
- entities linked from the source entity
- entities linking back to the source entity
- linked `source_file` entities when present

The context should be grouped by type, with common groups ordered for readability:

- use cases
- domain entities
- data models
- interfaces
- UI views
- ADRs
- source files
- other entity types

Generation remains deterministic. The generator may extract and include relevant markdown sections from source specs, but it must not rewrite or summarize with AI. Missing useful sections should produce explicit editable guidance lines in the preview.

## Validation Commands

The generator should read project-configured validation commands from `specops/project.yaml` when available. The field is `agent_task_defaults.validation_commands`, represented as a YAML list of shell command strings:

```yaml
agent_task_defaults:
  validation_commands:
    - pnpm typecheck
    - pnpm test
```

When project validation commands are absent, the fallback commands are:

```bash
pnpm typecheck
pnpm test
```

Milestone 2 should not infer commands from `package.json` scripts. That belongs with repository scanning or later project-health work.

## API

Add preview and save endpoints under the existing project route shape:

- `POST /api/projects/:projectId/agent-tasks/preview`
- `POST /api/projects/:projectId/agent-tasks`

Preview input includes:

- source entity ID
- target agent
- optional task ID override
- optional title override

Preview output includes:

- generated markdown
- task ID
- title
- suggested relative file path
- source spec IDs
- context spec IDs
- warnings

Save input includes:

- markdown
- task ID
- suggested relative file path

Save output should return the saved `agent_task` entity after re-indexing when possible.

## Generated Markdown

A saved task is a normal markdown spec entity:

```markdown
---
id: task.uc-generate-agent-task
type: agent_task
title: Generate Agent Task
status: ready
target_agent: codex
source_entity: uc.generate-agent-task
links:
  generated_from:
    - uc.generate-agent-task
  uses:
    - domain.project
    - domain.spec-entity
    - interface.spec-entity-service
---

# Task: Generate Agent Task

## Objective

Implement the behavior described by `uc.generate-agent-task`.

## Source Specs

- `uc.generate-agent-task` - Generate Agent Task

## Context

### Use Cases

- Include selected use cases and their relevant sections. Add details before saving if the generated context is incomplete.

### Domain Entities

- Include selected domain entities and their relevant sections. Add details before saving if the generated context is incomplete.

### Interfaces

- Include selected interfaces and their relevant sections. Add details before saving if the generated context is incomplete.

## Requirements

- Add concrete implementation requirements before saving.
- Preserve the behavior described by the source specs.

## Acceptance Criteria

- Add acceptance criteria before saving when the source spec does not provide them.

## Expected Files

- Add expected files or modules before saving when known.

## Do Not Change

- Add out-of-scope files, behaviors, or modules before saving when relevant.

## Validation Commands

```bash
pnpm typecheck
pnpm test
```
```

The `links.generated_from` field links to the source entity. The `links.uses` field links to included context specs. These links make generated tasks visible through the existing graph and backlink model after indexing.

## File Naming And Collision Handling

The default task ID is derived from the source entity ID. For example:

- `uc.generate-agent-task` becomes `task.uc-generate-agent-task`
- `interface.spec-entity-service` becomes `task.interface-spec-entity-service`

The default file path is derived from the task ID and must live under `specops/agent-tasks/`.

Saving must use exclusive create semantics. If a task file already exists, the API rejects the save and asks the user to choose a different task ID or title. Milestone 2 must not overwrite existing task markdown.

## Error Handling

Preview generation fails when:

- the project does not exist
- the source entity does not exist
- the project has not been indexed enough to load the source entity
- indexed data for the source entity is invalid or ambiguous

Preview generation may still succeed with warnings when linked context is missing or source specs lack useful sections.

Saving fails when:

- the edited markdown is invalid
- required frontmatter fields are missing
- `type` is not `agent_task`
- `source_entity` is missing
- the task ID does not match the requested save path
- the destination file already exists
- the resolved path would escape `specops/agent-tasks/`

After a successful file write, markdown is the canonical result. If re-indexing fails after the write, the API should return the indexing error without deleting the task file.

## Testing

Tests should cover three layers.

`@specops/taskgen` tests:

- deterministic markdown output
- stable task ID defaults
- context grouping and ordering
- frontmatter `generated_from` and `uses` links
- fallback validation commands
- editable guidance lines for missing source sections

API tests:

- preview loads one-hop context
- preview reports non-blocking warnings
- save rejects duplicate files
- save validates `agent_task` markdown
- save rejects path escapes
- save re-indexes and returns the saved task entity

Web tests:

- preview state and editable markdown behavior
- target-agent and task-ID control behavior
- copy and save button states
- duplicate and validation error rendering

DB-backed API tests should keep using the existing `TEST_DATABASE_URL` pattern.

## Acceptance Criteria

Milestone 2 is complete when:

- a user can generate a task preview from an indexed entity
- the preview includes the source entity and one-hop typed context
- the preview can be edited before save
- the user can choose a generic `target_agent`
- saved tasks are written under `specops/agent-tasks/`
- duplicate task files are not overwritten
- saved tasks include `generated_from` and `uses` links
- saved tasks appear as normal indexed `agent_task` entities after re-indexing
- generated validation commands come from project config or fallback to `pnpm typecheck` and `pnpm test`
- linked `source_file` entities are included when already present
- taskgen, API, and web tests cover the core workflow
