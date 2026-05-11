# Spec Readiness Review Design

Date: 2026-05-11

## Purpose

Spec Readiness Review adds deterministic readiness checks for every indexed spec entity. The feature answers: "Is this spec good enough to use as planning and task-generation input?"

The first version is read-only and rule-based. It does not use AI, embeddings, semantic scoring, or project-specific configuration. It should make weak specs visible before they produce weak implementation tasks.

## Scope

Included:

- compute readiness for every indexed spec entity,
- expose readiness status, failed checks, warnings, and suggested fixes through the API,
- show readiness on entity detail pages,
- show project-level readiness counts and a queue of specs needing attention,
- include readiness warnings in agent task preview when source or context specs are weak,
- use hardcoded default rules that can later move into `specops/project.yaml`.

Excluded:

- AI critique or rewriting,
- numeric quality scores,
- automatic markdown edits,
- configurable project rules,
- background jobs,
- cross-project readiness,
- GitHub or PR integration.

## Readiness Model

Each entity receives one status:

```ts
type SpecReadinessStatus = "ready" | "needs_context" | "needs_review" | "blocked";
```

Status severity:

- `blocked`: the spec has errors that make it unsafe or impossible to trust as planning input.
- `needs_review`: the spec is usable but has validation warnings, stale task signals, weak structure, or other issues a developer should review first.
- `needs_context`: the spec is structurally valid but lacks important planning links or evidence.
- `ready`: no blocking, review, or context checks failed.

The API should also return check results:

```ts
type SpecReadinessCheckDto = {
  id: string;
  severity: "blocker" | "review" | "context";
  label: string;
  detail: string;
  suggestedFix: string;
  relatedEntityId: string | null;
  filePath: string | null;
};
```

Overall status is derived from the highest-severity failed check:

- any `blocker` failed check -> `blocked`,
- otherwise any `review` failed check -> `needs_review`,
- otherwise any `context` failed check -> `needs_context`,
- otherwise `ready`.

This keeps the model explainable. Users should see specific failed checks rather than a vague score.

## Default Rules

Rules should be deterministic and based only on indexed cache data and local health data already available to the API.

For v1, "meaningful body" means trimmed body text of at least 80 characters after frontmatter removal. Heading checks are case-insensitive markdown heading matches such as `## Acceptance Criteria` or `# Goal`; they should not require exact body wording beyond the heading name set.

All entity types:

- required frontmatter fields are present,
- no entity-level validation errors,
- no broken outgoing links,
- markdown body has meaningful content,
- entity ID and file path are unique in the project index.

Use cases:

- body includes an acceptance criteria section,
- body includes a goal, objective, problem, or intent section,
- has at least one outgoing link to a domain entity, interface, UI view, data model, or entity with source evidence.

Domain entities and data models:

- linked to at least one use case, interface, or source evidence item,
- has at least one incoming or outgoing spec link when the project has other accepted specs.

Interfaces:

- linked to at least one use case, domain/data model, or source evidence item,
- has source evidence when source inventory exists and the project contains source-backed specs.

UI views:

- linked to at least one use case or interface,
- body includes a behavior, states, interactions, or acceptance criteria section.

Agent tasks:

- has `source_entity` frontmatter or a `generated_from` link,
- source entity still exists,
- has at least one validation command in frontmatter or body,
- not stale when project health can determine stale task state.

ADRs:

- has a meaningful body,
- has no broken links or validation errors,
- does not require source evidence by default.

Unknown custom types:

- apply only the all-entity checks,
- report `ready` when those checks pass.

## API Design

Add endpoints:

```text
GET /api/projects/:projectId/readiness
GET /api/projects/:projectId/entities/:entityId/readiness
```

Project response:

```ts
type ProjectReadinessDto = {
  summary: {
    ready: number;
    needsContext: number;
    needsReview: number;
    blocked: number;
  };
  queue: Array<{
    entityId: string;
    title: string;
    type: string;
    status: string;
    filePath: string;
    readiness: SpecReadinessStatus;
    highestSeverity: "blocker" | "review" | "context" | null;
    failedCheckCount: number;
    topChecks: SpecReadinessCheckDto[];
  }>;
};
```

Entity response:

```ts
type EntityReadinessDto = {
  entityId: string;
  title: string;
  type: string;
  status: string;
  filePath: string;
  readiness: SpecReadinessStatus;
  checks: SpecReadinessCheckDto[];
};
```

The project endpoint should include every entity in the summary. The queue should omit `ready` entities in v1 and sort by readiness severity, entity type, then entity ID.

## Backend Design

Add a focused service:

```text
apps/api/src/services/spec-readiness-service.ts
```

The service reads:

- indexed entities,
- indexed links,
- validation messages,
- source evidence links,
- latest project health or stale task information where available.

It must not read or mutate markdown files directly. Readiness is derived from the same cache and health data the UI already trusts. If live project health is unavailable, stale-task checks should be skipped and represented by no failed check rather than making the whole readiness response fail.

Contract schemas belong in `packages/contracts`. Domain constants can live in `packages/domain` only if they are shared outside the API and web surfaces.

Rule implementation should stay explicit. Prefer small named check functions over a generic rule engine in v1. The function boundary should still make later project-configurable rules possible.

## UI Design

Entity detail page:

- add a compact readiness panel near validation and link panels,
- show status, failed checks, and suggested fixes,
- keep task generation available,
- when readiness is not `ready`, show the same warning summary in the task preview.

Project overview:

- add readiness counts alongside health and validation summaries,
- link non-ready counts to the readiness queue.

Readiness queue:

- render a project-level list grouped by `blocked`, `needs_review`, and `needs_context`,
- each row links to the entity detail page,
- show top failed checks inline,
- include filters for status and entity type only if the list is large enough to need them.

The first version should avoid decorative scoring visuals. Specific checks and direct links are more useful than a score badge.

## Task Generation Integration

Agent task preview should request readiness for:

- the source entity,
- any explicit impacted context entity IDs,
- one-hop context specs already included by task generation.

The generated task markdown should not be blocked automatically. Instead, the preview should show a readiness warning section above the editable markdown and include plain-language guidance in the generated task when context is missing.

This keeps the workflow flexible while making weak planning inputs visible before the user saves a task.

## Error Handling

Missing project returns not found through the existing API error style.

Missing entity in the entity endpoint returns not found.

Readiness computation should tolerate partial optional data:

- no source inventory means source-evidence-specific checks are skipped unless a spec explicitly references source evidence,
- no project health means stale-task checks are skipped,
- validation query failure fails the readiness request because validation messages are core input.

The UI should render readiness loading and error states locally without replacing the full project page.

## Testing

Contracts:

- readiness status enum parses expected values,
- project and entity readiness DTOs validate,
- check severities validate and reject unknown values.

API:

- all-entity blocker checks detect validation errors and broken links,
- use cases without acceptance criteria produce `needs_context`,
- interfaces without links or source evidence produce `needs_context`,
- agent tasks with missing source entities produce `blocked`,
- stale task data produces `needs_review` when available,
- unknown custom types only receive all-entity checks,
- project queue sorting is deterministic,
- missing project and missing entity return not found.

Frontend:

- entity detail renders ready and non-ready panels,
- failed checks link to related entities or file paths when present,
- project overview shows readiness counts,
- readiness queue groups non-ready entities,
- task preview shows readiness warnings for weak source/context specs.

## Acceptance Criteria

- Every indexed entity has a deterministic readiness status.
- Entity detail pages explain failed readiness checks and suggested fixes.
- Project overview shows readiness counts.
- A project readiness queue lists non-ready specs in severity order.
- Agent task preview surfaces readiness warnings for source and context specs.
- The feature performs no canonical markdown writes.
- No AI or configurable rule engine is introduced in v1.
- `pnpm typecheck`, `pnpm test`, and `pnpm --filter web build` pass after implementation.
