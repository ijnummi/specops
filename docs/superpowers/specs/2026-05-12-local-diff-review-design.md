# Local Diff Review Design

Date: 2026-05-12

## Purpose

Local Diff Review adds a project-level workflow for reviewing local Git changes against the indexed SpecOps graph.

The feature answers:

- which specs are affected by this local diff,
- whether changed source files have linked specs,
- whether changed specs have related implementation tasks,
- which validation, readiness, and test-update signals need human review.

This is the local-first version of PR/diff-to-spec review. It deliberately starts without GitHub so the core review model can become solid before remote pull request support is added.

## Scope

Included in v1:

- create a review from working tree changes versus `HEAD`,
- create a review from staged changes,
- create a review from a local ref range,
- classify changed files as specs, source, tests, or other,
- map changed spec files to indexed spec entities,
- map changed source files to specs through existing source annotations,
- find related `agent_task` entities for affected specs,
- include validation and readiness findings for affected specs,
- store review results in PostgreSQL,
- list review runs for a project,
- show review detail in the web UI,
- let the user mark a review as accepted, needing follow-up, or superseded.

Excluded from v1:

- GitHub pull request reads,
- GitHub write support,
- AI correctness judgment,
- executing validation commands from the UI,
- persisting full diff hunks,
- automatic spec edits,
- automatic commits,
- multi-user review assignment.

## Product Behavior

The primary workflow is:

1. User opens a project.
2. User opens `Diff Reviews`.
3. User chooses a local diff source: working tree, staged changes, or ref range.
4. User creates a review.
5. API captures the requested local Git diff, classifies changed files, maps affected specs, finds related tasks, and stores deterministic findings.
6. User opens the review detail page.
7. User inspects changed files, affected specs, related tasks, findings, and suggested validation commands.
8. User marks the review `accepted`, `needs_followup`, or `superseded`.

SpecOps should never mutate canonical markdown during this workflow. It only stores review metadata and deterministic summaries in PostgreSQL.

## Diff Sources

V1 supports three local Git inputs:

- `working_tree`: compare the current working tree against `HEAD`, including tracked and untracked files.
- `staged`: review staged changes only.
- `ref_range`: compare `baseRef..headRef`.

For `ref_range`, both refs are user-provided strings and resolved by Git. The stored review should include resolved base and head commits when available.

If Git cannot provide the requested diff, the review should still be created when possible with an empty changed-file set and a `git_comparison_unavailable` finding. Unexpected Git failures that prevent safe interpretation should return an API error.

## Status Model

Review statuses:

- `ready_for_review`: review summary is available.
- `accepted`: human review accepted the diff.
- `needs_followup`: human review found issues requiring more work.
- `superseded`: review was replaced or no longer matters.

New reviews are created directly as `ready_for_review`. Only `ready_for_review` reviews can move to `accepted` or `needs_followup`. Any non-terminal review can move to `superseded`.

## Data Model

Add a table:

```text
diff_reviews
```

Fields:

- `id`
- `project_id`
- `status`
- `review_type`
- `base_ref`
- `head_ref`
- `base_commit`
- `head_commit`
- `changed_files_json`
- `review_summary_json`
- `created_at`
- `updated_at`

`review_type` values:

- `working_tree`
- `staged`
- `ref_range`

`changed_files_json` uses the existing grouped file shape:

```ts
type ReviewChangedFiles = {
  specs: string[];
  source: string[];
  tests: string[];
  other: string[];
};
```

`review_summary_json` stores a stable page-ready summary:

```ts
type DiffReviewSummary = {
  changedFiles: ReviewChangedFiles;
  affectedSpecs: Array<{
    entityId: string;
    title: string;
    type: string;
    filePath: string;
    reason: "changed_spec" | "linked_source";
  }>;
  relatedTasks: Array<{
    entityId: string;
    title: string;
    status: string;
    filePath: string;
    reason: "generated_from" | "uses" | "changed_task";
  }>;
  findings: DiffReviewFinding[];
  suggestedValidationCommands: string[];
};
```

## API Design

Add routes:

```text
POST  /api/projects/:projectId/diff-reviews
GET   /api/projects/:projectId/diff-reviews
GET   /api/projects/:projectId/diff-reviews/:reviewId
PATCH /api/projects/:projectId/diff-reviews/:reviewId
```

`POST /diff-reviews` creates a review.

Request:

```ts
type CreateDiffReviewRequest =
  | { reviewType: "working_tree" }
  | { reviewType: "staged" }
  | { reviewType: "ref_range"; baseRef: string; headRef: string };
```

Behavior:

- load the project,
- resolve the requested Git diff,
- classify changed files,
- build the review summary,
- store a `ready_for_review` row,
- return the review detail.

`GET /diff-reviews` lists reviews newest first.

`GET /diff-reviews/:reviewId` returns full detail.

`PATCH /diff-reviews/:reviewId` updates review status.

Request:

```ts
type UpdateDiffReviewStatusRequest = {
  status: "accepted" | "needs_followup" | "superseded";
};
```

## Backend Design

Add:

```text
apps/api/src/services/diff-review-service.ts
```

Responsibilities:

- validate project and review input,
- read local Git diff file paths,
- classify changed files,
- create and list reviews,
- update review status,
- build deterministic review summaries.

Extract shared review summary behavior from the existing agent run service into a focused module, for example:

```text
apps/api/src/services/review-summary-service.ts
```

Shared responsibilities:

- classify project-relative paths,
- collect affected specs from changed spec files,
- collect affected specs from changed source links,
- collect related agent tasks,
- load validation messages,
- load readiness summaries,
- create findings,
- read suggested validation commands.

Agent runs should continue to include task-specific findings from their own workflow. Diff reviews should use the shared affected-spec and finding helpers but omit task-context-only findings.

## Git Behavior

Git commands run with `cwd` set to `project.repoPath`.

Suggested command behavior:

- working tree:
  - tracked changes from `git diff --name-only HEAD --`
  - staged changes from `git diff --name-only --cached --`
  - untracked files from `git status --porcelain=v1 -z --untracked-files=all`
- staged:
  - `git diff --name-only --cached --`
- ref range:
  - resolve commits with `git rev-parse <ref>`
  - changed files from `git diff --name-only <baseCommit> <headCommit> --`

All returned paths are normalized to repo-relative POSIX-style paths and sorted for stable output.

If the project is not a Git repository, return a valid review detail with a `git_comparison_unavailable` finding and empty changed file lists. This keeps local project state inspectable while making the limitation explicit.

## Review Findings

Findings are evidence prompts, not correctness claims.

```ts
type DiffReviewFinding = {
  id: string;
  severity: "blocker" | "review" | "context" | "info";
  kind:
    | "source_changed_without_spec"
    | "unlinked_source_changed"
    | "possible_missing_test_change"
    | "changed_spec_has_no_task"
    | "related_task_may_be_stale"
    | "validation_warning"
    | "readiness_warning"
    | "git_comparison_unavailable";
  message: string;
  suggestedFollowUp: string;
  entityId: string | null;
  filePath: string | null;
};
```

Rules:

- `source_changed_without_spec`: source files changed, linked specs exist, but no spec files changed.
- `unlinked_source_changed`: a changed source file has no `source_spec_links` rows.
- `possible_missing_test_change`: source files changed but no test files changed.
- `changed_spec_has_no_task`: a changed spec has no related `agent_task`.
- `related_task_may_be_stale`: an affected spec is referenced by an existing task.
- `validation_warning`: an affected spec has indexed validation messages.
- `readiness_warning`: an affected spec is not ready.
- `git_comparison_unavailable`: Git cannot provide the requested diff.

Ordering should be deterministic by severity, kind, entity ID, file path, then message.

## Related Task Detection

Related tasks are indexed `agent_task` entities connected to affected specs through `spec_links`.

Include tasks when:

- task has a `generated_from` link to an affected spec,
- task has a `uses` link to an affected spec,
- the task spec file itself changed.

Do not infer related tasks from freeform markdown body text in v1.

## UI Design

Add routes:

```text
/projects/$projectId/diff-reviews
/projects/$projectId/diff-reviews/$reviewId
```

Add a project navigation link named `Diff Reviews` near `Agent Runs` and `Readiness`.

The list page includes a compact create form:

- segmented control for `Working tree`, `Staged`, and `Ref range`,
- `baseRef` and `headRef` inputs only for ref range,
- `Create review` button.

The list shows:

- review type,
- status,
- short base and head commits when available,
- changed file count,
- finding counts by severity,
- created time.

The detail page mirrors the existing agent run review page:

- header with status, diff source, commits, and review actions,
- changed files grouped as specs, source, tests, and other,
- affected specs with reason labels,
- related agent tasks,
- findings grouped by severity,
- suggested validation commands.

Actions:

- `Mark accepted`,
- `Needs follow-up`,
- `Supersede`.

The UI should stay dense and operational. It should not introduce graph visualization in this slice.

## Error Handling

If the project does not exist, return the existing not-found error shape.

If `ref_range` is missing either ref, return a bad request.

If refs cannot be resolved, return a bad request that names the invalid ref.

If Git is unavailable because the project is not a Git repository, create a review with a `git_comparison_unavailable` finding.

If Git commands fail unexpectedly, return an API error and do not create a partial review unless the failure is explicitly classified as unavailable Git.

If readiness checks fail for one affected spec, keep the review usable and add a review finding for that spec instead of failing the whole creation operation.

If a review already has a terminal status, reject status changes.

## Testing

Backend tests:

- creates a working-tree review with grouped changed files,
- creates a staged review from staged files only,
- creates a ref-range review with resolved commits,
- rejects ref-range reviews with missing or invalid refs,
- maps changed spec files to affected specs,
- maps changed source files to specs through `source_spec_links`,
- reports unlinked changed source files,
- reports source changes without spec changes,
- reports possible missing test changes,
- reports changed specs without related tasks,
- reports related tasks that may be stale,
- reports validation and readiness findings,
- handles no-Git projects with `git_comparison_unavailable`,
- enforces valid status transitions.

Frontend tests:

- diff review list renders create controls and review summaries,
- ref range inputs appear only for ref-range mode,
- creating a review navigates to review detail,
- detail renders grouped changed files, affected specs, related tasks, findings, and validation commands,
- review status actions update status and refresh list/detail queries,
- project navigation includes `Diff Reviews`.

Manual browser verification should cover desktop and narrow viewport layouts because the review detail page has several dense grouped panels.

## Acceptance Criteria

The feature is complete when:

- a user can create a local diff review from working tree, staged changes, or a ref range,
- the review stores resolved commit metadata when available,
- changed files are grouped into specs, source, tests, and other,
- affected specs are derived from changed spec files and source annotations,
- related agent tasks are listed from indexed links,
- findings identify missing spec updates, unlinked source changes, likely missing tests, changed specs without tasks, stale related tasks, validation/readiness issues, and unavailable Git comparison,
- the UI lists reviews and shows review detail,
- the user can mark a review accepted, needing follow-up, or superseded,
- tests cover service behavior, API routes, and core UI behavior.
