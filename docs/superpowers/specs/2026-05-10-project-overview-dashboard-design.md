# Project Overview Dashboard Design

## Purpose

Add a read-only project overview dashboard that makes SpecOps useful immediately after opening a project. The dashboard should answer whether the project is indexed, healthy, source-backed, and worth trusting before the user drills into individual specs.

The first version is a status and orientation surface, not a work queue. It should surface attention-worthy signals with links into existing project detail, validation, impact, source evidence, and entity views, but it should not introduce new workflow states or task assignment behavior.

## Scope

The dashboard covers:

- latest index run status, timestamp, and indexed fact counts.
- entity counts grouped by type and status.
- validation error and warning totals with a short list of affected files or entities.
- source inventory totals for files, symbols, imports, and exports.
- source evidence coverage for spec entities with and without source links.
- agent task totals and recently generated task entities.
- an attention summary that prioritizes existing errors, warnings, and missing coverage signals.

The dashboard does not cover:

- AI summaries or proposal generation.
- Git diff analysis or changed-since-last-index tracking.
- editable work queues, assignment, due dates, or completion state.
- historical trend charts across many index runs.
- source editing or automatic source annotation repair.

## Product Behavior

The project detail route becomes a dashboard-first workspace. When a user opens `/projects/:projectId`, the main content shows the overview dashboard. The existing entity list, project actions, index run summary, and validation inspector remain available around it.

Selecting an entity still opens the existing entity detail editor at `/projects/:projectId/entities/:entityId`. Search behavior remains scoped to the entity list. The dashboard should include links or buttons that navigate to filtered or selected existing views rather than inventing parallel detail screens.

Dashboard sections:

- **Project Health**: latest index status, last successful index time when available, total entities, links, validation errors, and validation warnings.
- **Spec Inventory**: compact grouped counts by entity type and status. Each group links to the project route with the current entity search or filter behavior where available.
- **Source Inventory**: total source files, symbols, imports, and exports from the latest indexed source data.
- **Source Evidence Coverage**: counts of source-linkable spec entities with at least one source annotation versus those without source evidence. Agent tasks and ADRs should not be treated as missing source evidence by default.
- **Agent Tasks**: count of `agent_task` entities and a short recent list based on entity update or index order.
- **Needs Attention**: a small deterministic list, ordered errors first, then warnings, then missing source evidence. Each item links to an affected entity when possible.

Empty states should be explicit. A project with no index runs should show a prompt to run indexing. A project with no source facts should say that source inventory is unavailable until indexing scans source files.

## API Design

Add a focused read endpoint:

```text
GET /api/projects/:projectId/overview
```

The response should be a single DTO shaped for dashboard rendering:

```ts
type ProjectOverviewDto = {
  project: ProjectSummaryDto;
  latestIndexRun: IndexRunDto | null;
  entityCountsByType: Array<{ type: string; count: number }>;
  entityCountsByStatus: Array<{ status: string; count: number }>;
  validationSummary: {
    errorCount: number;
    warningCount: number;
    samples: Array<{
      level: "error" | "warning";
      code: string;
      message: string;
      entityId: string | null;
      filePath: string | null;
    }>;
  };
  sourceInventory: {
    fileCount: number;
    symbolCount: number;
    importCount: number;
    exportCount: number;
  };
  sourceEvidence: {
    eligibleSpecCount: number;
    withSourceEvidenceCount: number;
    withoutSourceEvidenceCount: number;
    missingSamples: Array<{ entityId: string; title: string; type: string }>;
  };
  agentTasks: {
    totalCount: number;
    recent: Array<{ entityId: string; title: string; status: string; updatedAt: string }>;
  };
  attentionItems: Array<{
    kind: "validation_error" | "validation_warning" | "missing_source_evidence";
    label: string;
    entityId: string | null;
    filePath: string | null;
  }>;
};
```

The overview service should live behind a small API service boundary rather than placing aggregation logic in route handlers. It may reuse existing project, index run, validation, spec entity, spec link, and source fact tables. It should not read markdown or source files from disk; all values come from indexed cache data.

The existing `GET /api/projects/:projectId` summary remains available for lightweight project metadata. The dashboard can call the new overview endpoint instead of combining many client-side queries.

## Data Behavior

Source evidence coverage is based on persisted source-to-spec annotation facts. A spec entity is considered source-evidence eligible when its type is one of:

- `domain_entity`
- `interface`
- `data_model`
- `ui_view`
- `use_case`

`agent_task`, `adr`, and unknown custom types are excluded from missing source evidence by default in v1, because the correct coverage expectations are less clear. They still appear in inventory counts.

Recent agent tasks should use `updatedAt` from indexed entities. If multiple tasks have the same timestamp, sort by `entityId` for deterministic output.

Validation samples should be limited to a small fixed number, such as five errors and five warnings. Attention items should also be capped so the dashboard stays scannable.

## UI Design

Add a `ProjectOverviewDashboard` component used by `ProjectDetailPage` when no entity is selected. The component should follow the existing quiet operational UI: bordered panels, dense metrics, small headings, and no hero treatment.

Suggested layout:

- top row: project health metrics and latest index run.
- middle row: spec inventory and source inventory.
- lower row: source evidence coverage, agent task summary, and needs attention.

Cards should be individual dashboard panels, not nested card structures. Each metric that can lead somewhere useful should be clickable through existing routes:

- validation items open the affected entity when `entityId` is present.
- missing source evidence items open the entity detail.
- recent agent tasks open the task entity.
- inventory count groups can use the existing entity search query until explicit type filters exist in the UI.

Loading, error, and no-index states should not block the sidebar. If the overview endpoint fails, the page should show an error panel in the main dashboard area while leaving the entity list and project actions usable.

## Error Handling

If the project does not exist, the endpoint returns the existing not-found error shape.

If overview aggregation fails, the API should fail the overview request clearly without affecting canonical markdown. The UI should show the error in the dashboard area only.

Missing source data is not an error. It should render as an unavailable or zero-state source inventory, depending on whether there has been an index run.

## Testing

Backend tests:

- overview endpoint returns project health, latest index run, grouped entity counts, validation samples, source inventory totals, source evidence coverage, agent task summaries, and attention items.
- missing project returns a not-found error.
- projects without index runs return a valid overview with empty counts and `latestIndexRun: null`.
- source evidence excludes agent tasks, ADRs, and unknown custom types from missing coverage by default.

Frontend tests:

- project route without an entity renders the dashboard.
- entity route still renders the existing editor.
- dashboard displays loading, error, empty, and populated states.
- validation, missing source evidence, and recent task links navigate to the expected entity routes.

## Acceptance Criteria

The feature is complete when:

- opening a project without selecting an entity shows the overview dashboard.
- selecting an entity still opens the existing entity detail editor.
- the dashboard summarizes index health, spec inventory, validation, source inventory, source evidence coverage, and agent tasks.
- dashboard data comes from a single overview API endpoint backed by indexed cache data.
- missing source evidence is treated as an attention signal only for eligible spec types.
- focused backend and frontend tests cover the overview behavior.
