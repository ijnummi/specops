# SpecOps Workbench — Codex Project Brief

This document is intended to be pasted into Codex as the starting brief for creating the project repository and first implementation milestone.

---

## 1. Project Mission

Build **SpecOps Workbench**, a local-first, markdown-native, multi-project workbench for specs-driven AI-assisted software development.

The purpose of the project is not just to build an app. The main purpose is to learn and create a reusable process for:

1. writing maintainable specs,
2. linking specs to architecture and implementation,
3. generating precise AI agent tasks,
4. using Codex / Claude Code safely and repeatably,
5. keeping project knowledge useful over time.

The final app should help a developer manage specs, use cases, domain models, data models, interfaces, UI flows, ADRs, source links, and agent tasks across multiple projects.

---

## 2. Product Definition

SpecOps Workbench is a private home-lab web app for managing specs-driven development.

Canonical specs live as markdown files under a `specops/` directory. The app indexes those markdown files into PostgreSQL, provides a fast React UI for editing and navigation, scans TypeScript repositories, and generates structured Codex / Claude Code agent tasks from linked specs.

The app should support:

- multi-project management,
- direct editing of markdown spec files,
- flexible spec entity types,
- flexible link types,
- fast navigation between related specs,
- backlinks,
- graph-like project understanding,
- versioning through Git,
- TypeScript project scanning,
- future AI prefill from existing repositories,
- future AI-generated spec/link proposals.

---

## 3. Core Architectural Decisions

These decisions are mandatory unless explicitly changed by an ADR.

### ADR-001: Markdown is the source of truth

All canonical project specs must live in markdown files under `specops/`.

The app may cache parsed/indexed data in PostgreSQL, but PostgreSQL is not the canonical source of truth.

If PostgreSQL is deleted, the project index must be rebuildable from markdown files.

### ADR-002: PostgreSQL is a derived cache and workflow store

PostgreSQL stores:

- indexed entities,
- indexed links,
- validation results,
- source file inventory,
- index runs,
- AI proposals,
- UI/workflow state,
- generated task metadata.

But the canonical spec content lives in markdown.

### ADR-003: The app edits markdown directly

The UI should directly edit spec markdown files, including YAML frontmatter and body markdown.

The app must preserve unknown frontmatter fields when making structured edits.

### ADR-004: Flexible graph model first

The graph model should support arbitrary entity types and link types as strings.

The app may provide special UI affordances for common types, but the model should not be hardcoded only to those types.

Common entity types:

- `use_case`
- `domain_entity`
- `data_model`
- `interface`
- `ui_view`
- `agent_task`
- `adr`
- `test_case`
- `source_file`
- `module`
- `external_dependency`

Common link types:

- `depends_on`
- `implements`
- `refines`
- `uses`
- `exposes`
- `tested_by`
- `documents`
- `generated_from`
- `touches`
- `related_to`

### ADR-005: AI generates proposals, not truth

Future AI features must not directly overwrite canonical specs without user review.

AI should create proposals with:

- proposed entities,
- proposed links,
- confidence,
- evidence,
- source files,
- review status.

Accepted proposals are written to canonical markdown files.

### ADR-006: Start local-first

Milestone 1 should support local filesystem projects only.

GitHub read support can come later. GitHub write support should be delayed even further.

### ADR-007: V1 repo scanner is TypeScript-focused

The first repository scanner may focus on TypeScript/Node/React projects.

The architecture should allow future scanners for other ecosystems.

---

## 4. Chosen Technology Stack

Use this stack unless there is a strong implementation reason to deviate.

### Frontend

- React
- TypeScript
- CodeMirror 6 for markdown editing
- TanStack Router
- TanStack Query
- Tailwind CSS or shadcn-style components

### Backend

- Node.js
- TypeScript
- Fastify
- Zod for validation

### Database

- PostgreSQL
- Drizzle ORM

### Worker

- Node.js worker process
- PostgreSQL-backed jobs initially
- Redis/BullMQ optional later if needed

### Monorepo/tooling

- pnpm workspace
- TypeScript project references if useful
- Docker Compose
- Vitest or similar for tests
- ESLint/Prettier if appropriate

### Deployment target

- Linux Docker host
- Docker Compose
- Home-lab use

---

## 5. Repository Structure

Create this repository structure:

```text
specops-workbench/
  apps/
    web/
    api/
    worker/

  packages/
    contracts/
    db/
    domain/
    markdown/
    graph/
    repo-scanner/
    taskgen/
    ai-prefill/
    config/
    testing/

  specops/
    project.yaml
    use-cases/
    domain/
    data-model/
    interfaces/
    ui/
    agent-tasks/
    decisions/
    templates/

  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
```

### Package responsibilities

#### `packages/domain`

Domain types and pure domain rules.

Examples:

- `Project`
- `SpecEntity`
- `SpecLink`
- `SpecFile`
- `IndexRun`
- `ValidationMessage`
- `AgentTask`

#### `packages/contracts`

Shared API contracts and Zod schemas.

This package should define request/response schemas shared by API and frontend.

#### `packages/db`

Drizzle schema, migrations, database connection helpers, repository implementations.

#### `packages/markdown`

Markdown/frontmatter parsing, serialization, validation helpers, file discovery.

This package should be heavily tested.

#### `packages/graph`

Graph traversal helpers:

- outgoing links,
- backlinks,
- linked context collection,
- broken link detection,
- orphan detection.

#### `packages/repo-scanner`

Local repository scanning.

V1 focuses on TypeScript projects.

#### `packages/taskgen`

Generate structured agent-task markdown from selected specs and linked context.

#### `packages/ai-prefill`

Future package for AI extraction and proposal generation.

Do not implement AI in Milestone 1 except stubs/interfaces if useful.

#### `packages/testing`

Test fixtures, fake projects, sample `specops/` folders, and helper utilities.

---

## 6. Canonical `specops/` File Layout

Every managed project should use a visible `specops/` folder.

Example:

```text
specops/
  project.yaml

  use-cases/
    uc.import-existing-project.md
    uc.create-spec-entity.md
    uc.edit-spec-entity.md
    uc.link-spec-entities.md
    uc.generate-agent-task.md

  domain/
    project.md
    spec-entity.md
    spec-link.md
    spec-file.md
    source-repository.md
    index-run.md
    validation-message.md
    agent-task.md

  data-model/
    project-registry.md
    indexed-entity.md
    indexed-link.md
    indexed-file.md
    index-run-record.md

  interfaces/
    project-registry-service.md
    markdown-indexer.md
    spec-entity-service.md
    graph-query-service.md
    agent-task-generator.md
    repo-scanner-service.md

  ui/
    project-dashboard.md
    entity-list-view.md
    entity-detail-view.md
    markdown-editor.md
    backlinks-panel.md
    graph-navigation.md

  agent-tasks/
    task.implement-markdown-indexer.md

  decisions/
    adr-001-markdown-is-source-of-truth.md
    adr-002-postgresql-is-derived-cache.md
    adr-003-flexible-spec-graph.md

  templates/
    use-case.template.md
    domain-entity.template.md
    interface.template.md
    data-model.template.md
    ui-view.template.md
    agent-task.template.md
    adr.template.md
```

---

## 7. Markdown Entity Format

All spec entity files are markdown files with YAML frontmatter.

### Required frontmatter

```yaml
---
id: uc.import-existing-project
type: use_case
title: Import existing project
status: draft
---
```

Required fields:

- `id`
- `type`
- `title`
- `status`

### Common optional frontmatter

```yaml
priority: high
tags:
  - repo-import
  - indexing
links:
  domain:
    - domain.project
    - domain.source-repository
  interfaces:
    - interface.repo-scanner
  ui:
    - ui.project-import-flow
source_files:
  - apps/api/src/routes/project-routes.ts
```

### Parser requirements

The markdown parser must:

- parse YAML frontmatter,
- preserve unknown frontmatter fields,
- preserve body markdown,
- detect missing required fields,
- detect duplicate IDs,
- detect malformed frontmatter,
- detect broken links,
- report validation messages,
- avoid crashing the whole index run because one file is invalid.

### Validation levels

Use three levels:

- `error`
- `warning`
- `info`

Examples:

Errors:

- missing `id`,
- missing `type`,
- duplicate `id`,
- unreadable file,
- malformed frontmatter.

Warnings:

- unknown link target,
- broken source file reference,
- duplicate title,
- unsupported status.

Info:

- entity has no incoming links,
- entity has no outgoing links,
- entity has no body content.

---

## 8. Example Spec Files

### Example use case

```markdown
---
id: uc.import-existing-project
type: use_case
title: Import existing project
status: draft
priority: high
tags:
  - repo-import
  - indexing
links:
  domain:
    - domain.project
    - domain.source-repository
    - domain.index-run
  interfaces:
    - interface.repo-scanner
  ui:
    - ui.project-import-flow
---

# Import existing project

## Goal

As a developer, I want to import an existing repository so that SpecOps can build a navigable project specification graph.

## Preconditions

- The repository is accessible locally or through a supported connector.
- The user has configured a project workspace.

## Main flow

1. User creates a project.
2. User selects a local path or GitHub repository.
3. System scans the repository.
4. System creates a source inventory.
5. System proposes initial spec entities.
6. User reviews and accepts proposals.

## Acceptance criteria

- The import can be re-run safely.
- Existing accepted specs are not overwritten.
- New proposals include evidence links.
```

### Example domain entity

```markdown
---
id: domain.spec-entity
type: domain_entity
title: Spec Entity
status: accepted
links:
  data_models:
    - data.indexed-entity
  use_cases:
    - uc.create-spec-entity
    - uc.link-spec-entities
---

# Spec Entity

A spec entity is a structured project concept represented by a markdown file.

## Responsibilities

- Has stable identity.
- Has type.
- Has human-readable markdown body.
- Can link to other entities.
- Can be indexed into the workbench cache.

## Fields

| Field | Description |
|---|---|
| id | Stable unique identifier |
| type | Entity type |
| title | Human-readable title |
| status | draft, accepted, deprecated, etc. |
| links | Typed links to other entities |
```

### Example agent task

```markdown
---
id: task.implement-markdown-indexer
type: agent_task
title: Implement markdown indexer
status: ready
target_agent: codex
linked_use_cases:
  - uc.index-spec-files
linked_domain:
  - domain.spec-entity
  - domain.spec-link
linked_interfaces:
  - interface.markdown-indexer
---

# Implement markdown indexer

## Objective

Implement a service that reads SpecOps markdown files, parses frontmatter, extracts entities and links, and writes the derived index into PostgreSQL.

## Context

Use these specs as source of truth:

- `domain.spec-entity`
- `domain.spec-link`
- `interface.markdown-indexer`

## Requirements

- Parse markdown frontmatter.
- Validate required fields.
- Extract typed links.
- Preserve unknown frontmatter fields.
- Produce clear validation errors.
- Be idempotent.

## Acceptance criteria

- Re-indexing the same files produces the same derived index.
- Invalid files are reported but do not crash the whole index run.
- Deleted markdown files remove corresponding cache records.
```

---

## 9. Database Model — Initial Tables

Use Drizzle and PostgreSQL.

Initial tables should include at least:

### `projects`

Stores registered projects.

Suggested fields:

- `id`
- `name`
- `slug`
- `description`
- `repo_path`
- `specops_path`
- `created_at`
- `updated_at`

### `index_runs`

Stores indexing history.

Suggested fields:

- `id`
- `project_id`
- `started_at`
- `finished_at`
- `status`
- `entity_count`
- `link_count`
- `error_count`
- `warning_count`
- `git_commit`

### `spec_files`

Stores indexed markdown files.

Suggested fields:

- `id`
- `project_id`
- `path`
- `content_hash`
- `frontmatter_hash`
- `body_hash`
- `last_indexed_at`

### `spec_entities`

Stores parsed/indexed spec entities.

Suggested fields:

- `id`
- `project_id`
- `entity_id`
- `type`
- `title`
- `status`
- `file_path`
- `frontmatter_json`
- `body_markdown`
- `body_text`
- `content_hash`
- `created_at`
- `updated_at`

`entity_id` is the ID from markdown frontmatter, such as `uc.import-existing-project`.

### `spec_links`

Stores parsed links between entities.

Suggested fields:

- `id`
- `project_id`
- `from_entity_id`
- `to_entity_id`
- `link_type`
- `source`
- `confidence`
- `created_at`

### `validation_messages`

Stores validation results from index runs.

Suggested fields:

- `id`
- `project_id`
- `index_run_id`
- `file_path`
- `entity_id`
- `level`
- `code`
- `message`
- `created_at`

### `source_files`

For future repo scanning.

Suggested fields:

- `id`
- `project_id`
- `path`
- `language`
- `kind`
- `size_bytes`
- `content_hash`
- `last_seen_at`

### `ai_proposals`

For future AI prefill.

Suggested fields:

- `id`
- `project_id`
- `proposal_type`
- `title`
- `payload_json`
- `evidence_json`
- `confidence`
- `status`
- `created_at`
- `reviewed_at`

---

## 10. Milestone 1 — Markdown-Native Spec Graph

Milestone 1 is the first implementation target.

Do not implement AI in Milestone 1.

### Goal

A developer can create a project, initialize a `specops/` folder, create/edit markdown spec entities, index them into PostgreSQL, link them, search them, and navigate backlinks/outgoing links.

### Required features

- project creation,
- project list,
- project detail,
- configure local repo path,
- configure `specops/` path,
- initialize `specops/` folder,
- create markdown spec entity from template,
- edit markdown in CodeMirror,
- save markdown file,
- parse frontmatter,
- validate required fields,
- index entities into PostgreSQL,
- index links into PostgreSQL,
- detect deleted files,
- store validation messages,
- list entities by type,
- search entities by id/title/type/body,
- show entity detail,
- show outgoing links,
- show backlinks,
- show validation messages,
- manually trigger re-index,
- rebuild PostgreSQL index from markdown files.

### Non-goals for Milestone 1

Do not implement:

- AI features,
- GitHub integration,
- authentication,
- multi-user collaboration,
- complex visual graph rendering,
- VS Code extension,
- embeddings,
- semantic search,
- PR creation,
- advanced TypeScript AST analysis.

### Definition of done

Milestone 1 is done when:

- a new project can be created,
- a `specops/` folder can be initialized,
- markdown spec files can be created from templates,
- spec files can be edited in the UI,
- frontmatter is parsed and validated,
- entities are indexed into PostgreSQL,
- links are indexed into PostgreSQL,
- broken links are shown as warnings,
- entity detail pages show backlinks and outgoing links,
- search finds entities by title, ID, type, and body text,
- the database can be deleted and rebuilt from markdown files,
- parser/indexer tests exist,
- Docker Compose starts PostgreSQL,
- README explains how to run the project.

---

## 11. Suggested First Implementation Order

Implement in this order.

### Step 1: Repository bootstrap

Create:

- pnpm workspace,
- TypeScript config,
- `apps/web`,
- `apps/api`,
- `apps/worker`,
- shared packages,
- Docker Compose with PostgreSQL,
- basic README,
- basic lint/typecheck/test scripts.

### Step 2: Database package

Create:

- Drizzle setup,
- database schema,
- migrations,
- simple database connection helper.

### Step 3: Contracts package

Create Zod schemas for:

- projects,
- spec entities,
- spec links,
- index runs,
- validation messages.

### Step 4: Markdown package

Implement:

- find markdown files under `specops/`,
- parse frontmatter,
- parse body,
- serialize markdown while preserving fields,
- validate required fields,
- extract links,
- return validation messages.

Add tests immediately.

### Step 5: Indexer service

Implement:

- index all spec files for a project,
- upsert entities,
- upsert links,
- detect deleted files/entities,
- write validation messages,
- create index run record,
- make indexing idempotent.

### Step 6: Fastify API

Implement endpoints for:

- create/list/read/update projects,
- initialize specops folder,
- index project,
- list entities,
- read entity,
- save entity markdown,
- list backlinks,
- list outgoing links,
- list validation messages,
- search entities.

### Step 7: React UI shell

Implement:

- project dashboard,
- project detail page,
- entity list,
- entity detail page,
- CodeMirror markdown editor,
- backlinks panel,
- outgoing links panel,
- validation messages panel,
- re-index button.

### Step 8: Dogfood initial specs

Create initial `specops/` specs for SpecOps itself.

Use these to test the app.

---

## 12. Initial API Sketch

Use exact endpoint names only if they remain sensible during implementation.

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
POST   /api/projects/:projectId/init-specops
POST   /api/projects/:projectId/index

GET    /api/projects/:projectId/entities
GET    /api/projects/:projectId/entities/:entityId
PUT    /api/projects/:projectId/entities/:entityId/markdown
POST   /api/projects/:projectId/entities

GET    /api/projects/:projectId/entities/:entityId/outgoing-links
GET    /api/projects/:projectId/entities/:entityId/backlinks

GET    /api/projects/:projectId/search?q=...
GET    /api/projects/:projectId/validation-messages
GET    /api/projects/:projectId/index-runs
```

---

## 13. UI Requirements for Milestone 1

The UI does not need to be beautiful, but it should be motivating and fast.

### Project dashboard

Show:

- project name,
- repo path,
- specops path,
- entity count,
- link count,
- validation error/warning counts,
- last indexed time.

### Project detail

Show navigation sections:

- Use Cases,
- Domain,
- Data Model,
- Interfaces,
- UI,
- Agent Tasks,
- ADRs,
- All Entities,
- Validation.

### Entity detail page

Show:

- title,
- ID,
- type,
- status,
- file path,
- markdown editor,
- outgoing links,
- backlinks,
- validation messages,
- save button,
- re-index button.

### Search

Search should match:

- title,
- ID,
- type,
- markdown body text.

---

## 14. Milestone 2 — Agent Task Generation

### Goal

A developer can select a use case or other spec entity and generate a Codex/Claude-ready task markdown file with linked context.

### Features

- generate task from selected entity,
- collect linked context,
- include use cases, domain entities, data models, interfaces, UI views, and acceptance criteria,
- include relevant source files if linked,
- save generated task to `specops/agent-tasks/`,
- copy generated task to clipboard,
- mark task status,
- show generated task in the graph.

### Generated task structure

```markdown
---
id: task.implement-project-import
type: agent_task
title: Implement project import
status: ready
target_agent: codex
source_entity: uc.import-existing-project
---

# Task: Implement project import

## Objective

...

## Source specs

- `uc.import-existing-project`
- `domain.project`
- `domain.source-repository`
- `interface.repo-scanner`

## Context

...

## Requirements

...

## Acceptance criteria

...

## Expected files

...

## Do not change

...

## Validation commands

```bash
pnpm typecheck
pnpm test
```

### Key design rule

Task generation should be mostly deterministic.

AI can later help improve wording, but the linked context assembly should be deterministic and explainable.

---

## 15. Milestone 3 — TypeScript Repository Scanner

### Goal

A developer can scan a local TypeScript project and see a useful source inventory.

### Features

- read file tree,
- respect ignore rules,
- detect `package.json`,
- detect package manager,
- detect scripts,
- detect dependencies,
- detect TypeScript source files,
- detect tests,
- detect exported symbols approximately,
- detect likely API route files where practical,
- detect config files,
- store source inventory in PostgreSQL cache,
- show source inventory in UI,
- link specs to source files.

### Non-goal

Do not build a perfect language server in v1.

Start with pragmatic file and syntax scanning.

---

## 16. Milestone 4 — AI Prefill Proposals

### Goal

AI can inspect an existing project and propose initial specs, but the user reviews before anything becomes canonical.

### Features

- run AI extraction,
- summarize selected files/modules,
- propose use cases,
- propose domain entities,
- propose data models,
- propose interfaces,
- propose links,
- show evidence,
- accept/edit/reject proposals,
- write accepted proposals to markdown.

### Proposal model

AI proposals should include:

- proposal ID,
- proposal type,
- title,
- confidence,
- evidence,
- payload,
- status,
- created time,
- reviewed time.

Statuses:

- `pending`
- `accepted`
- `edited_and_accepted`
- `rejected`
- `obsolete`

### Important rule

AI output must never silently mutate canonical specs.

---

## 17. Milestone 5 — Versioning and Project Health

### Goal

Git remains the real versioning system, but SpecOps understands changed specs and stale task context.

### Features

- show current Git commit,
- show dirty spec files,
- track last indexed commit,
- track entity hashes,
- detect changed specs,
- detect broken links,
- detect orphaned entities,
- detect generated tasks that may be stale,
- basic project health dashboard.

### Health checks

Examples:

- broken links,
- duplicate IDs,
- missing required fields,
- generated task references changed specs,
- spec links to missing source file,
- use case without acceptance criteria,
- interface without linked use case,
- domain entity without any linked use case,
- source file without any spec link.

---

## 18. Future Ideas

These are future possibilities. Do not build them in Milestone 1 unless they are trivial foundations.

### Spec graph visualization

Interactive graph view for entities and links.

Possible modes:

- current entity neighborhood,
- use case to implementation map,
- domain model map,
- dependency graph,
- stale/invalid links highlighted.

### VS Code extension

A VS Code extension could:

- show linked specs for current file,
- create links from source code to specs,
- open SpecOps entity from code,
- generate Codex tasks from selected specs,
- show stale spec warnings.

### GitHub integration

Read support:

- repo tree,
- files,
- issues,
- pull requests.

Write support later:

- create branches,
- create PRs with generated specs,
- link PRs to specs,
- update agent task status from PR state.

### PR/spec review

Given a PR or diff, SpecOps could show:

- which specs are affected,
- which tests should be updated,
- which agent tasks are related,
- whether implementation appears to match acceptance criteria.

### Code/spec drift detection

Detect cases where:

- code changed but linked specs did not,
- spec changed but implementation task was not created,
- API interface spec no longer matches actual route/schema,
- data model spec no longer matches Drizzle/Prisma schema.

### OpenAPI generation

Generate or validate API specs from interface entities.

### Mermaid diagrams

Generate Mermaid diagrams from:

- domain models,
- workflows,
- entity links,
- data relationships.

### Embeddings and semantic search

Add optional vector search for:

- semantic spec search,
- related spec discovery,
- duplicate spec detection,
- natural-language project questions.

Keep this optional. PostgreSQL full-text search should come first.

### AI-assisted refactoring plans

Given a spec change, generate a refactoring plan with:

- affected files,
- affected tests,
- migration risks,
- task breakdown,
- validation commands.

### Agent run log capture

Track:

- generated task,
- agent used,
- prompt sent,
- files changed,
- validation commands run,
- review result.

### Prompt library

Reusable prompts for:

- implement feature,
- review implementation against spec,
- generate tests,
- refactor safely,
- update specs after code changes,
- analyze project drift.

### Import from existing documentation

Import from:

- README files,
- `/docs`,
- existing ADRs,
- GitHub issues,
- GitHub discussions,
- OpenAPI files,
- database schemas.

### Local LLM support

Future local model support could use the RTX 4090 for:

- embeddings,
- local summarization,
- private project analysis,
- offline proposal generation.

Keep AI provider code behind an adapter.

---

## 19. Maintainability Requirements

This project is specifically for learning maintainability through specs-driven development.

Therefore:

1. Prefer explicit architecture over clever abstractions.
2. Keep packages small and focused.
3. Write tests for pure logic early.
4. Make indexing idempotent.
5. Make the database rebuildable.
6. Make file writes safe and atomic.
7. Preserve user-authored markdown whenever possible.
8. Do not hide important behavior in AI prompts.
9. Treat AI output as reviewable proposals.
10. Keep specs updated as part of implementation.
11. Add ADRs for meaningful architecture decisions.
12. Generate agent tasks from specs, not from vague chat instructions.

---

## 20. Initial Specs to Create Before Coding

Create these files manually or generate them as initial project docs before implementing Milestone 1:

```text
specops/project.yaml
specops/decisions/adr-001-markdown-is-source-of-truth.md
specops/decisions/adr-002-postgresql-is-derived-cache.md
specops/decisions/adr-003-flexible-spec-graph.md
specops/domain/project.md
specops/domain/spec-entity.md
specops/domain/spec-link.md
specops/domain/spec-file.md
specops/domain/index-run.md
specops/domain/validation-message.md
specops/interfaces/project-registry-service.md
specops/interfaces/markdown-indexer.md
specops/interfaces/spec-entity-service.md
specops/interfaces/graph-query-service.md
specops/use-cases/uc.create-project.md
specops/use-cases/uc.initialize-specops-folder.md
specops/use-cases/uc.index-spec-files.md
specops/use-cases/uc.edit-spec-entity.md
specops/use-cases/uc.link-spec-entities.md
specops/use-cases/uc.generate-agent-task.md
```

---

## 21. Development Workflow for This Project

Use this workflow for every feature:

```text
1. Write or update use case spec.
2. Write or update domain model spec.
3. Write or update data/interface spec.
4. Write acceptance criteria.
5. Generate or write an agent task.
6. Let Codex implement only that task.
7. Run tests/typecheck.
8. Review implementation against specs.
9. Update specs if implementation reveals better model.
10. Add ADR if architecture changed.
```

Important:

- Do not let implementation drift far ahead of specs.
- Do not ask the agent to implement broad vague ideas.
- Prefer small, linked, reviewable tasks.

---

## 22. Validation Commands

Set up commands similar to these:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
docker compose up -d
```

Expected service commands may include:

```bash
pnpm --filter api dev
pnpm --filter web dev
pnpm --filter worker dev
pnpm --filter db migrate
```

---

## 23. Codex Execution Instructions

When implementing this project:

1. Start by creating the repository skeleton.
2. Add Docker Compose with PostgreSQL.
3. Add the initial `specops/` documents.
4. Implement Milestone 1 only.
5. Keep changes small and reviewable.
6. Add tests for markdown parsing and indexing.
7. Do not implement AI features yet.
8. Do not implement GitHub integration yet.
9. Do not introduce authentication yet.
10. Keep the database rebuildable from markdown files.
11. Keep markdown files human-readable and useful outside the app.

---

## 24. Expected First Result

The first useful version should allow this flow:

```text
1. Start PostgreSQL with Docker Compose.
2. Start API and web app.
3. Create a project.
4. Initialize its `specops/` folder.
5. Create a use case spec from a template.
6. Edit the spec in CodeMirror.
7. Save the markdown file.
8. Re-index the project.
9. See the entity in the UI.
10. Add links to another entity.
11. See outgoing links and backlinks.
12. Search for entities.
13. Delete PostgreSQL data.
14. Re-index from markdown and recover the graph.
```

When this works, Milestone 1 is complete.

---

## 25. Project North Star

SpecOps Workbench should make this possible:

```text
Use case → domain model → data model → interface → agent task → implementation → test → review → updated spec
```

The app should make that chain visible, navigable, and maintainable.

That traceability is the product.
