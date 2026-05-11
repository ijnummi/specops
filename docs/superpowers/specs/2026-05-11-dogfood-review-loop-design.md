# Dogfood Review Loop Design

Date: 2026-05-11

## Purpose

Dogfood Review Loop v1 helps SpecOps review its own agent-assisted development work.

The feature records an agent run for an indexed `agent_task`, captures local Git state before and after the work, maps changed files back to specs, and presents deterministic review findings. The goal is not to prove that an implementation is correct. The goal is to show whether the implementation changed the expected files, whether linked specs stayed current, and what a developer should inspect before accepting the run.

This directly supports the project north star:

```text
Use case -> domain model -> data model -> interface -> agent task -> implementation -> test -> review -> updated spec
```

## Scope

Included:

- start an agent run from an indexed `agent_task`,
- store the task prompt markdown used for the run,
- capture Git commit and dirty-file state at start,
- finish a run by capturing Git state at end,
- compute changed files from local Git information,
- map changed spec files to indexed spec entities,
- map changed source files to specs through existing source links,
- include task source/context specs in the review,
- generate deterministic review findings,
- show recent runs and run detail in the web UI,
- let the user mark a reviewed run as accepted, needing follow-up, or superseded.

Excluded from v1:

- AI judgment of implementation correctness,
- GitHub, PR, issue, or remote branch integration,
- running validation commands from the UI,
- persisting full diffs,
- automatic spec edits,
- automatic commits,
- multi-user or multi-agent collaboration,
- background worker orchestration.

## Product Behavior

The primary workflow is:

1. User opens an `agent_task` entity.
2. User clicks `Start Agent Run`.
3. API creates an `agent_run` row using the task entity, task markdown, current Git commit, and current dirty-file snapshot.
4. User performs implementation work outside SpecOps.
5. User opens the run detail page and clicks `Finish run`.
6. API captures end Git state, computes changed files, builds deterministic review findings, and marks the run `ready_for_review`.
7. User reviews changed files, affected specs, findings, and suggested validation commands.
8. User marks the run `accepted`, `needs_followup`, or `superseded`.

SpecOps should never mutate canonical specs during review. It may only store run metadata and review results in PostgreSQL.

## Status Model

Run statuses:

- `running`: work is in progress and end state has not been captured.
- `ready_for_review`: end state and review findings are available.
- `accepted`: human review accepted the run.
- `needs_followup`: human review found issues requiring more work.
- `superseded`: the run was replaced by another run or no longer matters.

Only `running` runs can be finished. Only `ready_for_review` runs can be marked `accepted` or `needs_followup`. Any non-terminal run can be marked `superseded`.

## Data Model

Add a new table:

```text
agent_runs
```

Fields:

- `id`
- `project_id`
- `task_entity_id`
- `agent`
- `status`
- `prompt_markdown`
- `started_at`
- `finished_at`
- `start_git_commit`
- `end_git_commit`
- `start_dirty_files_json`
- `end_dirty_files_json`
- `changed_files_json`
- `review_summary_json`
- `created_at`
- `updated_at`

The JSON fields are intentionally broad in v1:

- dirty file snapshots store normalized Git status entries,
- changed files store grouped file paths and source classifications,
- review summary stores affected specs, related task context, findings, and suggested validation commands.

Keeping these as JSON avoids overfitting the first implementation. The review model can be normalized later if dogfooding proves the shape is stable.

## API Design

Add routes:

```text
POST  /api/projects/:projectId/agent-runs
GET   /api/projects/:projectId/agent-runs
GET   /api/projects/:projectId/agent-runs/:runId
POST  /api/projects/:projectId/agent-runs/:runId/finish
PATCH /api/projects/:projectId/agent-runs/:runId
```

`POST /agent-runs` starts a run.

Request:

```ts
type StartAgentRunRequest = {
  taskEntityId: string;
  agent: "codex" | "claude" | "manual" | string;
};
```

Behavior:

- load the project,
- load the indexed `agent_task` entity,
- reject non-task entities,
- capture current Git status through the existing Git service,
- store the task markdown as `prompt_markdown`,
- create a `running` run.

`GET /agent-runs` lists recent runs for a project, sorted by newest first.

`GET /agent-runs/:runId` returns the full run detail including review summary.

`POST /agent-runs/:runId/finish` finishes a running run.

Behavior:

- reload project and run,
- capture current Git status,
- compute changed files,
- build review summary,
- set `finished_at`,
- set `status` to `ready_for_review`.

`PATCH /agent-runs/:runId` updates review status.

Request:

```ts
type UpdateAgentRunStatusRequest = {
  status: "accepted" | "needs_followup" | "superseded";
};
```

## Backend Design

Add:

```text
apps/api/src/services/agent-run-service.ts
```

Responsibilities:

- validate task entities,
- create runs,
- finish runs,
- compute changed files,
- build deterministic review summaries,
- update statuses.

The service reads:

- `projects`,
- `spec_entities`,
- `spec_links`,
- `source_spec_links`,
- `validation_messages`,
- project readiness through the existing readiness service,
- Git status through the existing Git service.

It does not read or write canonical markdown files. It does not execute validation commands.

## Changed File Detection

The first version uses local Git only.

When both `start_git_commit` and `end_git_commit` exist and differ, include files from:

```sh
git diff --name-only <start> <end>
```

Always include files from the end dirty snapshot.

Also include files that appear newly dirty by comparing start and end dirty snapshots.

Classify changed files as:

- `spec`: under the project `specops/` directory,
- `test`: source file that matches existing scanner test-file conventions,
- `source`: non-spec source file,
- `other`: everything else.

The result should be stable and de-duplicated by normalized repo-relative path.

## Review Summary

The review summary should include:

```ts
type AgentRunReviewDto = {
  changedFiles: {
    specs: string[];
    source: string[];
    tests: string[];
    other: string[];
  };
  affectedSpecs: Array<{
    entityId: string;
    title: string;
    type: string;
    filePath: string;
    reason: "changed_spec" | "linked_source" | "task_context";
  }>;
  taskContext: {
    sourceEntityId: string | null;
    contextEntityIds: string[];
    missingEntityIds: string[];
  };
  findings: AgentRunFindingDto[];
  suggestedValidationCommands: string[];
};
```

Findings:

```ts
type AgentRunFindingDto = {
  id: string;
  severity: "blocker" | "review" | "context" | "info";
  kind:
    | "source_changed_without_spec"
    | "task_context_spec_changed"
    | "task_context_missing"
    | "unlinked_source_changed"
    | "validation_warning"
    | "readiness_warning"
    | "possible_missing_test_change"
    | "task_not_updated";
  message: string;
  suggestedFollowUp: string;
  entityId: string | null;
  filePath: string | null;
};
```

### Finding Rules

`source_changed_without_spec`

- Source files changed.
- No spec files changed.
- At least one changed source file is linked to a spec.

`task_context_spec_changed`

- A changed spec is the task source entity or one of the task context entities.

`task_context_missing`

- The task references a source or context entity that no longer exists.

`unlinked_source_changed`

- A changed source file has no `source_spec_links` rows.

`validation_warning`

- An affected spec has indexed validation messages.

`readiness_warning`

- An affected spec is not `ready`.

`possible_missing_test_change`

- Source files changed but no test files changed.

`task_not_updated`

- The run is finished but the task entity file did not change.

These findings are evidence prompts, not correctness claims. They should use conservative language and direct the user to inspect specific files or specs.

## Task Context

For the run's `agent_task`, derive context from:

- `source_entity` frontmatter,
- `links.generated_from`,
- `links.uses`,
- `tracked_spec_hashes` frontmatter when present.

Missing context entities should not fail the whole review. They should produce findings.

Suggested validation commands should reuse the same project defaults used by task generation. If those cannot be read, fall back to:

```sh
pnpm typecheck
pnpm test
```

## UI Design

Add route:

```text
/projects/$projectId/agent-runs
```

The Agent Runs list shows:

- task title and task entity ID,
- agent,
- status,
- short start and end commit,
- changed file count,
- finding count by severity,
- started and finished time.

Filters:

- status,
- agent,
- text search by task ID or title.

Add route:

```text
/projects/$projectId/agent-runs/$runId
```

The detail page shows:

- header with task, status, agent, Git state, and review actions,
- changed files grouped as specs, source, tests, and other,
- affected specs with reason labels,
- task context source/context/missing specs,
- review findings grouped by severity,
- suggested validation commands.

Actions:

- `Finish run` for running runs,
- `Mark accepted`,
- `Needs follow-up`,
- `Supersede`.

Add an entity-detail action for `agent_task` entities:

```text
Start Agent Run
```

After creating a run, navigate to the run detail page.

The UI should stay dense and operational, matching the current workbench layout. No graph visualization is needed for this slice.

## Error Handling

If the project does not exist, return the existing not-found error shape.

If the task entity does not exist or is not an `agent_task`, return a bad request with the task entity ID.

If the project is not a Git repository, allow the run and store `null` commits with empty Git-derived diff data. The review can still use dirty snapshots if available, but should include an info finding that Git commit comparison is unavailable.

If Git commands fail unexpectedly during finish, return an API error and keep the run `running`.

If readiness checks fail for one affected spec, keep the review usable and add a review finding for that spec instead of failing the whole finish operation.

If a run is already terminal, reject finish or status changes that would contradict the status model.

## Testing

Backend tests:

- starting a run from an `agent_task` stores prompt markdown and Git start state,
- starting a run from a non-task entity is rejected,
- finishing a run captures end state and marks it `ready_for_review`,
- changed source files with no changed specs produce `source_changed_without_spec`,
- unlinked changed source files produce `unlinked_source_changed`,
- missing task context produces `task_context_missing`,
- source changes without test changes produce `possible_missing_test_change`,
- affected specs with validation messages produce findings,
- no-Git projects can start and finish runs without crashing,
- invalid status transitions are rejected.

Frontend tests:

- entity detail shows `Start Agent Run` only for `agent_task` entities,
- starting a run navigates to run detail,
- runs list renders status, task, changed file counts, and finding counts,
- run detail renders grouped changed files, affected specs, findings, and validation commands,
- finishing a run updates detail state,
- review status actions update status and refresh the list/detail queries.

## Acceptance Criteria

The feature is complete when:

- a user can start a run from an indexed `agent_task`,
- the run stores task prompt markdown and start Git state,
- a user can finish the run and get a deterministic review summary,
- changed files are grouped into specs, source, tests, and other,
- changed source files are mapped to specs through existing source links,
- task source/context specs are included in the review,
- findings identify missing spec updates, missing task context, unlinked source changes, validation/readiness warnings, possible missing tests, and unchanged task specs,
- the UI lists runs and shows run detail,
- the user can mark a run accepted, needing follow-up, or superseded,
- tests cover service behavior, API routes, and core UI behavior.
