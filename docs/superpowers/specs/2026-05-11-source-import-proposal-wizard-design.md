# Source Import Proposal Wizard Design

Date: 2026-05-11

## Scope

Add a review-first source import wizard for local TypeScript/JavaScript projects. The wizard scans source inventory, generates deterministic spec entity proposals from exported symbols, lets the user review and edit generated markdown, and writes only accepted proposals into canonical `specops/` markdown files.

This feature is the first concrete proposal inbox workflow. It uses the existing `ai_proposals` database table as a generic proposal store, but it does not call AI. Source import proposals are deterministic scanner-derived proposals with source evidence.

The current direct `bootstrap-from-source` path remains available for admin or development use, but it should no longer be the primary project action for normal users.

## Product Behavior

The project dashboard exposes an `Import from source` action. It opens a project-level import route:

```text
/projects/$projectId/import/source
```

The first version supports one import source: the existing TypeScript/JavaScript source scanner.

The user flow is:

1. User opens `Import from source`.
2. User runs source proposal generation.
3. API scans the local repository and generates pending proposals from exported source symbols.
4. UI shows a batch review layout with proposal rows on the left and selected proposal detail on the right.
5. User reviews source evidence, edits proposed markdown, rejects unwanted proposals, and selects proposals to accept.
6. User accepts the selected proposals.
7. API validates the selected proposals, writes their markdown files with exclusive-create semantics, marks them accepted, and re-indexes the project.
8. Project dashboard, entities, validation, index runs, project health, and proposal lists refresh.

Generating proposals must not write markdown files, source annotations, or `project.yaml` bootstrap markers. Only accepting proposals writes canonical project files.

## Relationship To Existing Bootstrap

`bootstrap-from-source` currently scans source and writes generated specs directly. This remains useful for development and testing, but the normal product flow should be review-first.

The new proposal workflow reuses the scanner and candidate generation logic from `@specops/source-bootstrap`. The generation package should expose a proposal-friendly function that returns candidate metadata and markdown without assuming immediate filesystem writes or source annotation edits.

Normal project actions should link to the source import wizard. The direct bootstrap UI action moves to an admin or development-only surface so existing tests and manual setup workflows are not lost.

## Proposal Model

Use `ai_proposals` as the persisted proposal table for this milestone.

For source import proposals:

- `proposalType`: `source_spec_entity`
- `status`: `pending`, `accepted`, `edited_and_accepted`, `rejected`, or `obsolete`
- `confidence`: deterministic scanner confidence, initially `0.7`
- `payloadJson`: proposed target and markdown
- `evidenceJson`: source evidence

Payload shape:

```ts
type SourceSpecEntityProposalPayload = {
  entityId: string;
  type: "domain_entity" | "interface";
  title: string;
  status: "draft";
  filePath: string;
  markdown: string;
  sourceFiles: string[];
  symbols: Array<{
    name: string;
    kind: string;
    exported: boolean;
    file: string;
    line: number | null;
  }>;
};
```

Evidence shape:

```ts
type SourceSpecEntityProposalEvidence = {
  scanner: "typescript";
  sourceFiles: Array<{
    file: string;
    symbolName: string;
    symbolKind: string;
    exported: boolean;
    line: number | null;
  }>;
};
```

The API should treat payload and evidence as structured data, even though the database stores them as JSON.

## Generation Rules

Source import generation uses the same deterministic rules as source bootstrap:

- exported top-level symbols only,
- skip test and config files,
- skip default-only exports,
- classify service-like names as `interface`,
- classify exported interface, type alias, class, and enum symbols as `domain_entity` unless service-like,
- merge duplicate entity IDs into one proposal with combined evidence,
- render stable markdown with standard frontmatter, source evidence, and a review note.

Generation should replace or obsolete stale pending source import proposals from prior runs for the same project. It must not alter accepted or rejected historical proposals.

Regeneration behavior:

1. Generate current candidates.
2. Mark existing pending `source_spec_entity` proposals for the project as `obsolete`.
3. Insert fresh pending proposals for current candidates.

This keeps regeneration simple and avoids reconciling edits across scan runs.

## API Design

Add proposal routes under the project API:

```text
POST  /api/projects/:projectId/proposals/source-import
GET   /api/projects/:projectId/proposals?status=pending
GET   /api/projects/:projectId/proposals/:proposalId
PATCH /api/projects/:projectId/proposals/:proposalId
POST  /api/projects/:projectId/proposals/accept
```

`POST /source-import` scans the repository, generates source spec entity proposals, obsoletes prior pending scanner proposals, stores fresh pending proposals, and returns proposal summaries.

`GET /proposals` lists summaries with proposal ID, type, title, target entity ID, target file path, status, confidence, conflict state, and created time.

`GET /proposals/:proposalId` returns full payload and evidence for the selected detail pane.

`PATCH /proposals/:proposalId` supports:

- updating edited markdown while status is `pending`,
- marking a pending proposal as `rejected`.

`POST /proposals/accept` accepts selected proposal IDs. Acceptance is all-or-nothing for the requested batch.

Accept request shape:

```ts
type AcceptProposalsRequest = {
  proposalIds: string[];
};
```

Accept response should include accepted proposal IDs and the index run produced after writing files.

## Accept Semantics

Accepting proposals writes canonical markdown. It must validate everything before writing the first file:

- every proposal ID belongs to the project,
- every selected proposal is still `pending`,
- every payload is a valid source spec entity proposal,
- every proposed markdown parses as a spec entity,
- parsed entity ID matches payload entity ID,
- parsed entity type matches payload type,
- target file path is inside `specops/`,
- target file path does not already exist,
- target entity ID does not already exist in the current index,
- no selected proposals collide with each other by entity ID or target path.

If any selected proposal fails validation, the API returns a conflict or bad request and writes nothing.

After validation, the API writes files with exclusive-create semantics, re-indexes the project, and marks proposals:

- `accepted` when accepted markdown matches the last generated markdown,
- `edited_and_accepted` when the user-edited markdown differs from the generated markdown,
- `reviewedAt` is set for accepted and rejected proposals.

If a write or index error occurs after some files were written, the service should remove files written during that accept attempt before returning the error. Proposal statuses should remain pending unless the full accept completes.

## UI Design

The source import route uses a batch review layout.

Header:

- project name,
- `Generate proposals` action,
- pending, accepted, rejected, and obsolete counts,
- status filter.

Left pane:

- proposal rows with checkbox,
- title,
- target entity ID,
- target file path,
- type,
- status,
- conflict marker when target file or entity already exists.

Right pane:

- selected proposal title and metadata,
- editable markdown,
- source evidence list,
- target file path,
- confidence,
- reject action for the selected proposal.

Footer or action bar:

- `Accept selected`,
- `Reject selected`,
- selected count,
- accept error details.

The markdown editor can reuse the existing markdown editor component. The first version does not need side-by-side diffs; a single editable markdown pane is enough.

## Error Handling

Proposal generation fails before storing new proposals when:

- project paths are invalid,
- `repoPath` is unreadable,
- scanner finds no supported source files,
- scanner finds no eligible exported symbols.

Proposal listing should still work even if conflict checks cannot read the filesystem. In that case, affected rows show an unavailable conflict state and accept performs authoritative validation.

Accept returns a clear conflict when:

- target markdown file already exists,
- target entity ID already exists,
- selected proposals collide with each other,
- a proposal was already accepted, rejected, or obsoleted,
- edited markdown no longer matches the expected entity identity.

The UI should keep the user on the review page after errors and preserve local edits already saved to the proposal record.

## Testing

Package-level tests should cover proposal-friendly generation:

- generated proposals match existing bootstrap candidate IDs, paths, and markdown,
- duplicate symbols merge evidence,
- generated payload and evidence are stable.

API DB-backed tests should cover:

- source import generation stores pending proposals and writes no markdown files,
- regeneration obsoletes prior pending source proposals and creates fresh pending proposals,
- listing proposals returns summaries with conflict state,
- detail endpoint returns editable markdown and evidence,
- patching markdown persists user edits,
- rejecting a proposal sets status and reviewed time,
- accepting selected proposals writes markdown files and re-indexes,
- accepting edited markdown marks `edited_and_accepted`,
- accept refuses file conflicts without partial writes,
- accept refuses entity ID conflicts without partial writes,
- accept refuses mixed-project or non-pending proposal IDs.

Web tests should cover:

- project action links to the source import route,
- generate action renders proposal rows,
- selecting a row renders markdown and evidence detail,
- editing markdown saves to the proposal record,
- selected batch accept calls the accept endpoint and invalidates project queries,
- conflicts render on proposal rows and in accept errors.

## Acceptance Criteria

The feature is complete when:

- normal project users can open `Import from source` instead of direct bootstrap,
- source scanner proposals are persisted as pending proposal records,
- generating proposals does not write canonical markdown or source annotations,
- users can review proposals in a batch list/detail layout,
- users can edit, reject, and accept source spec entity proposals,
- accepting proposals writes selected markdown files under `specops/` and re-indexes,
- accept is all-or-nothing for the selected batch,
- accepted proposal statuses distinguish unedited and edited acceptance,
- direct bootstrap remains available outside the primary project action surface,
- tests cover generation, API proposal lifecycle, accept safety, and the main UI flow.
