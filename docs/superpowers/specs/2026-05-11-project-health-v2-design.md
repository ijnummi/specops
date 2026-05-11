# Project Health v2 Design

## Purpose

Project Health v2 adds Git-aware drift and stale generated task detection to the existing project dashboard.

The feature should answer:

- whether the indexed cache reflects the current Git commit,
- whether spec or source files have changed since the last successful index,
- whether generated agent tasks may be stale because their source or context specs changed,
- which items need attention before trusting the project graph.

This is still a local-first workflow. Git is used as local repository state, not as GitHub integration.

## Scope

The feature covers:

- capture the current Git commit during indexing when the project is inside a Git repository,
- report live Git repository health through a new endpoint,
- summarize changed tracked and untracked spec files,
- summarize changed tracked and untracked source files,
- detect whether the latest successful index is behind the current Git `HEAD`,
- detect stale agent tasks from indexed spec metadata,
- store deterministic source and context content hashes in newly generated task frontmatter,
- show Git, drift, and stale task signals in the project dashboard.

The feature does not cover:

- GitHub API access,
- branches, PRs, remotes, or issue linking,
- automatic commits,
- AI drift analysis,
- full diff parsing,
- background polling,
- automatic task regeneration,
- retroactively rewriting existing task markdown files.

## Product Behavior

The project dashboard keeps the existing overview layout and adds a Git and drift section.

The dashboard should load two independent data sources:

- `GET /api/projects/:projectId/overview` for indexed cache summaries.
- `GET /api/projects/:projectId/health` for live Git and filesystem state.

If the health endpoint fails, the dashboard should still show the existing overview and render a local error panel for Git health only. A missing Git repository is not an error. It should render as "Git unavailable" with indexed health still visible.

The Git and drift section should show:

- current `HEAD` commit, shortened for display,
- latest indexed commit, shortened for display,
- whether the index is behind `HEAD`,
- whether there are uncommitted changes,
- changed spec file count,
- changed source file count,
- stale generated task count.

Needs Attention should include new deterministic items:

- index behind current Git commit,
- changed spec files since index,
- changed source files since index,
- stale generated task,
- task with missing source entity.

Attention items should link to an entity when available. Stale task items link to the task entity.

## API Design

Add:

```text
GET /api/projects/:projectId/health
```

Response:

```ts
type ProjectHealthDto = {
  git: {
    isRepo: boolean;
    headCommit: string | null;
    indexedCommit: string | null;
    hasUncommittedChanges: boolean;
    changedSpecFiles: string[];
    changedSourceFiles: string[];
    untrackedSpecFiles: string[];
    untrackedSourceFiles: string[];
  };
  drift: {
    indexIsBehindHead: boolean;
    currentSpecFileChangeCount: number;
    currentSourceFileChangeCount: number;
  };
  staleTasks: {
    count: number;
    samples: Array<{
      entityId: string;
      title: string;
      sourceEntityId: string | null;
      reason:
        | "source_spec_changed"
        | "context_spec_changed"
        | "tracked_hash_mismatch"
        | "missing_source_entity";
    }>;
  };
  attentionItems: Array<{
    kind:
      | "index_behind_head"
      | "changed_spec_files"
      | "changed_source_files"
      | "stale_agent_task"
      | "missing_task_source";
    label: string;
    entityId: string | null;
    filePath: string | null;
  }>;
};
```

The endpoint reads the project record, latest successful index run, indexed entities, and live local Git status. It must not mutate markdown or database state.

## Git Behavior

Indexing should populate `index_runs.git_commit` with the current `HEAD` commit when possible.

Implementation rule:

- Run Git commands with `cwd` set to `project.repoPath`.
- Use non-interactive commands.
- Treat "not a Git repository" as a normal state.
- Treat unavailable Git or command failure during indexing as non-fatal and store `gitCommit: null`.
- Treat unexpected Git command failure in the health endpoint as a health endpoint error only.

Suggested commands:

```sh
git rev-parse --is-inside-work-tree
git rev-parse HEAD
git status --porcelain=v1 -z
```

Health classification should use repo-relative paths from Git status:

- spec files are files under the project `specops/` directory.
- source files are changed tracked or untracked files outside `specops/`, excluding ignored/generated directories already ignored by the scanner where practical.

The first version does not need exact "changed since indexed commit" diff lists. It can report:

- current dirty and untracked file state from `git status`,
- `indexIsBehindHead` when latest indexed commit differs from current `HEAD`.

The drift counters are current working-tree change counts, not exact file lists from the indexed commit to `HEAD`.

## Stale Task Detection

Stale task detection is deterministic and conservative.

The service reads indexed `agent_task` entities. For each task:

- `source_entity` from frontmatter is the primary source spec.
- `links.generated_from` and `links.uses` provide generated source and context specs.
- if the source entity no longer exists, the task is stale with `missing_source_entity`.
- if tracked hash metadata exists and any current linked entity hash differs, the task is stale with `tracked_hash_mismatch`.
- if no tracked hash metadata exists, fall back to timestamp comparison:
  - source spec `updatedAt > task.updatedAt` means `source_spec_changed`,
  - context spec `updatedAt > task.updatedAt` means `context_spec_changed`.

Sample output should be capped, for example at five tasks, sorted by reason severity then `entityId`.

## Strict Hash Metadata

Newly generated agent tasks should include hash metadata in frontmatter:

```yaml
tracked_spec_hashes:
  domain.project: <contentHash>
  interface.project-registry-service: <contentHash>
```

Rules:

- Include the source spec and all generated context specs.
- Use indexed `spec_entities.content_hash`.
- Preserve deterministic ordering by entity ID.
- Do not require existing task files to have this field.
- Do not rewrite existing task markdown during health checks.
- If a task has `tracked_spec_hashes`, hash mismatch takes precedence over timestamp fallback.

This makes stale task detection strict for newly generated tasks while keeping older tasks readable and compatible.

## Data Model

No new database tables are required for v1.

Use existing data:

- `index_runs.git_commit`,
- `spec_entities.content_hash`,
- `spec_entities.frontmatter_json`,
- `spec_entities.updated_at`,
- `projects.repo_path`,
- `projects.specops_path`.

Contracts should add `projectHealthSchema` and `ProjectHealthDto`.

Task generation types should allow carrying `contentHash` for task generation context so `tracked_spec_hashes` can be emitted.

## UI Design

Extend `ProjectOverviewDashboard` with a Git and Drift panel.

Panel states:

- no Git repo: explain Git health is unavailable for this project,
- loading: show local loading state without blocking overview,
- error: show health error only in the Git panel,
- ready: show compact metrics and short lists.

Suggested layout:

- Add Git and Drift beside Latest Index on wide screens.
- Keep Source Evidence, Agent Tasks, and Needs Attention below.
- Add stale task samples to the Agent Tasks panel or a dedicated Stale Tasks subsection.

The dashboard should remain dense and operational, matching the existing UI style.

## Error Handling

If the project does not exist, the health endpoint returns the existing not-found error shape.

If Git is unavailable or the project is not inside a Git repository, return a valid health response with `git.isRepo: false`.

If Git commands fail unexpectedly, return an API error for the health endpoint only. The UI should preserve the overview dashboard and show the health failure locally.

If a task references malformed `tracked_spec_hashes`, ignore the malformed value and use timestamp fallback.

## Testing

Backend tests:

- indexer stores `gitCommit` when `repoPath` is a Git repository.
- indexer succeeds with `gitCommit: null` outside Git.
- health endpoint reports no-Git projects without failing.
- health endpoint reports index behind `HEAD`.
- health endpoint reports dirty and untracked spec/source file counts.
- stale task detection flags missing source entity.
- stale task detection flags tracked hash mismatch.
- stale task detection falls back to timestamp comparison for older tasks.

Task generator tests:

- generated task frontmatter includes ordered `tracked_spec_hashes`.
- generated task remains deterministic.
- generation still works when context is empty.

Frontend tests:

- dashboard renders Git and drift metrics when health loads.
- dashboard keeps overview visible when health fails.
- no-Git state renders clearly.
- stale task samples link to task entity pages.
- new attention item labels render without overlapping compact dashboard panels.

## Acceptance Criteria

The feature is complete when:

- indexing records the current Git commit when available,
- project health can be fetched through `GET /api/projects/:projectId/health`,
- the dashboard shows current Git, drift, changed file, and stale task signals,
- generated agent tasks include deterministic `tracked_spec_hashes`,
- stale task detection uses hash comparison for new tasks and timestamp fallback for old tasks,
- existing overview behavior continues to work if health loading fails,
- focused backend, taskgen, and frontend tests cover the behavior.
