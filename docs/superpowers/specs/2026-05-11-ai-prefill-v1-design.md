# AI Prefill v1 Design

Date: 2026-05-11

## Scope

AI Prefill v1 adds a review-first project workflow that generates spec entity proposals from a manually selected set of indexed source files.

The feature is separate from deterministic source import. Source import continues to generate scanner-derived proposals from exported symbols. AI Prefill uses selected source content, existing indexed specs, and an AI provider to propose new specs and links. Generation is allowed to create pending proposal rows in PostgreSQL, but it must never write canonical markdown files. Canonical files are written only when the user accepts reviewed proposals.

The first version targets these proposed spec entities:

- `use_case`
- `domain_entity`
- `interface`

AI Prefill includes typed links in generated markdown frontmatter when selected source evidence supports them. Links may target existing entities or other proposals in the same generated batch.

Out of scope for v1:

- whole-repository automatic inference,
- direct markdown writes during generation,
- editing existing specs with AI,
- autonomous task generation from AI output,
- embeddings or semantic search,
- GitHub integration,
- background jobs or long-running worker orchestration.

## Product Behavior

The project dashboard exposes an `AI Prefill` action. It opens:

```text
/projects/$projectId/ai-prefill
```

The page uses a split review inbox layout:

- left side: indexed source inventory with filters and file selection,
- middle side: generated proposal list with status, confidence, target ID, target path, and conflict markers,
- right side: selected proposal detail with editable markdown, structured AI evidence, and accept/reject actions.

The user flow is:

1. User opens `AI Prefill`.
2. UI loads indexed source inventory.
3. User manually selects source files.
4. User chooses provider settings.
5. User runs AI generation.
6. API reads bounded source excerpts after path-safety checks.
7. API asks the configured AI provider for structured proposal candidates.
8. API validates candidates, stores valid pending proposals, and returns summaries.
9. User reviews proposal markdown and evidence.
10. User edits, rejects, or selects proposals for acceptance.
11. Accepting selected proposals writes canonical markdown with exclusive-create semantics and re-indexes the project.

The first UI should prioritize control and review over automation. It should make the selected source files and evidence visible near the generated markdown so the user can judge whether a proposal is trustworthy.

## Providers

AI provider code lives behind an adapter boundary in `packages/ai-prefill`.

The initial provider order is:

1. Ollama local provider.
2. OpenAI API provider immediately after the Ollama path.

The shared adapter interface is:

```ts
type AiPrefillProvider = {
  generateSpecProposals(input: AiPrefillProviderInput): Promise<AiPrefillProviderResult>;
};
```

Provider input includes:

- project name and description,
- selected source files with bounded content,
- selected source file metadata from the scanner,
- existing entity summaries for link awareness,
- allowed entity types,
- allowed link types,
- generation constraints.

Provider output is structured JSON, not markdown-only text. The API must validate provider output before storing proposals.

### Ollama

The Ollama provider is the first usable provider.

Configuration:

- base URL, default `http://127.0.0.1:11434`,
- model name,
- low default temperature,
- request timeout,
- selected-file count and byte limits.

The API calls Ollama directly from the backend. If Ollama is unavailable, generation fails with a clear provider error and writes no proposal rows.

### OpenAI

The OpenAI provider uses the same adapter interface.

Configuration:

- API key from environment,
- model from environment or request settings,
- low default temperature,
- request timeout,
- selected-file count and byte limits.

Provider selection is explicit in the generation request. The code must not bake OpenAI-specific prompt or response parsing into the route handler.

## Prompt Packet

`packages/ai-prefill` owns prompt construction and provider response normalization.

The prompt packet is deterministic apart from the selected provider/model:

- project metadata,
- selected source file paths,
- source file content excerpts,
- source file language/kind/import/export/symbol metadata where available,
- existing spec entity summaries,
- existing link type examples,
- allowed output schema,
- instruction that all proposed claims must cite selected source file paths,
- instruction not to propose writes to existing files,
- instruction to prefer fewer high-confidence proposals over many weak proposals.

The package enforces prompt-size guardrails before calling the provider. If selected files exceed limits, the API returns a clear bad request and does not call the provider.

## Proposal Model

The existing `ai_proposals` table remains the persistence layer.

Contracts need to expand beyond `source_spec_entity`.

Add proposal type:

```ts
"ai_spec_entity"
```

AI proposal payload:

```ts
type AiSpecEntityProposalPayload = {
  entityId: string;
  type: "use_case" | "domain_entity" | "interface";
  title: string;
  status: "draft";
  filePath: string;
  generatedMarkdown: string;
  markdown: string;
  sourceFiles: string[];
  proposedLinks: Array<{
    linkType: string;
    targetEntityId: string;
    targetExists: boolean;
    rationale: string;
  }>;
};
```

AI proposal evidence:

```ts
type AiSpecEntityProposalEvidence = {
  provider: "ollama" | "openai";
  model: string;
  promptVersion: string;
  selectedSourceFiles: Array<{
    file: string;
    contentHash: string;
    excerptStartLine: number;
    excerptEndLine: number;
  }>;
  claims: Array<{
    text: string;
    sourceFiles: string[];
  }>;
  warnings: string[];
};
```

The proposal summary DTO exposes common fields across source-import and AI proposals:

- proposal ID,
- project ID,
- proposal type,
- status,
- title,
- entity ID,
- entity type,
- file path,
- confidence,
- conflict state,
- created/reviewed timestamps.

The detail DTO is a discriminated union by `proposalType` so source-import proposal detail and AI proposal detail remain type-safe.

## Generation API

Add AI Prefill routes:

```text
POST /api/projects/:projectId/proposals/ai-prefill
```

Request:

```ts
type AiPrefillGenerateRequest = {
  sourceFileIds: string[];
  provider: "ollama" | "openai";
  model: string;
  temperature?: number;
};
```

Response:

```ts
type AiPrefillGenerateResponse = {
  proposals: ProposalSummaryDto[];
  diagnostics: Array<{
    level: "warning" | "info";
    message: string;
  }>;
};
```

The existing proposal endpoints remain shared and add an optional `proposalType` query filter:

```text
GET   /api/projects/:projectId/proposals?status=pending&proposalType=ai_spec_entity
GET   /api/projects/:projectId/proposals/:proposalId
PATCH /api/projects/:projectId/proposals/:proposalId
POST  /api/projects/:projectId/proposals/accept
```

Listing includes all proposal types when no `proposalType` is supplied. The AI Prefill page filters to `ai_spec_entity`; the source import page filters to `source_spec_entity`.

Generation behavior:

1. Validate the project.
2. Validate selected source file IDs belong to the project.
3. Read each selected file from disk using project path-safety helpers.
4. Reject requests that exceed configured file count or byte limits.
5. Load existing entity summaries and link types from the current index.
6. Build the prompt packet.
7. Call the selected provider.
8. Validate provider JSON.
9. Convert valid candidates into `ai_spec_entity` pending proposals.
10. Mark previous pending `ai_spec_entity` proposals for the same project and selected-source signature as `obsolete`.
11. Store fresh pending proposals.

Accepted and rejected historical proposals are not changed by regeneration.

## Validation and Accept Semantics

AI proposals use the same accept safety principles as source-import proposals.

Accept must validate everything before writing the first file:

- every proposal ID belongs to the project,
- every selected proposal is still `pending`,
- every payload matches its proposal type schema,
- proposed markdown parses as a spec entity,
- parsed entity ID matches payload entity ID,
- parsed type matches payload type,
- target file path is inside `specops/`,
- target file path does not already exist,
- target entity ID does not already exist in the current index,
- selected proposals do not collide with each other by entity ID or file path,
- proposed links use string link types and non-empty target IDs.

Accepted status:

- `accepted` when `markdown` equals `generatedMarkdown`,
- `edited_and_accepted` when user-edited markdown differs from `generatedMarkdown`.

If a write or index error occurs after files are written, the service removes files written during that accept attempt and leaves proposal statuses pending.

## UI Design

The AI Prefill page uses the split review inbox selected during brainstorming.

Header:

- project name,
- provider selector,
- model input,
- generation action,
- pending/accepted/rejected/obsolete counts,
- status filter.

Source file pane:

- search/filter controls using indexed source inventory,
- file rows with path, kind, language, size, symbol count, and checkbox,
- selected count and estimated context size,
- empty state when source inventory has not been indexed.

Proposal pane:

- proposal rows with checkbox,
- title,
- target entity ID,
- target file path,
- type,
- status,
- confidence,
- conflict marker.

Detail pane:

- selected proposal title and metadata,
- editable markdown editor,
- AI evidence section with provider/model/prompt version,
- selected source file evidence,
- claim/evidence list,
- proposed links and rationale,
- reject action.

The first version can reuse the existing markdown editor and proposal row patterns from `SourceImportPage`. It should not add a visual diff viewer yet.

## Error Handling

Generation returns a clear error and writes no new proposals when:

- selected files are empty,
- selected source file IDs do not belong to the project,
- selected file content cannot be safely read,
- selected content exceeds configured limits,
- Ollama/OpenAI provider is unavailable,
- provider output is not valid JSON,
- provider output contains no valid candidates.

If some provider candidates are invalid but others are valid, the service stores valid proposals and returns diagnostics for rejected candidates. It must not silently coerce malformed entity IDs, file paths, or markdown identity fields.

The UI should keep source selections and saved proposal edits after errors.

## Testing

Package tests for `packages/ai-prefill`:

- prompt packet includes selected source files, existing entity summaries, and allowed types,
- file count and byte guardrails reject oversized input,
- Ollama response normalization accepts valid structured output,
- OpenAI response normalization accepts valid structured output,
- invalid provider output produces diagnostics or errors without candidates,
- generated markdown is deterministic for a fixed normalized provider result.

Contract tests:

- AI proposal request schemas validate provider, model, and source file IDs,
- proposal detail schemas discriminate source-import and AI proposal payloads,
- proposal list filters support `proposalType`.

API DB-backed tests:

- AI generation stores pending `ai_spec_entity` proposals and writes no markdown files,
- generation obsoletes prior pending AI proposals for the same selected-source signature,
- listing proposals can filter by AI proposal type,
- detail endpoint returns AI evidence and editable markdown,
- patching AI proposal markdown persists user edits,
- rejecting AI proposal sets status and reviewed time,
- accepting AI proposals writes markdown and re-indexes,
- accepting edited AI markdown marks `edited_and_accepted`,
- accept rejects file and entity conflicts without partial writes,
- provider failures write no proposals.

Web tests:

- project action links to AI Prefill route,
- source file selection controls generation,
- provider/model controls are sent with the request,
- generated proposal rows render,
- selecting a proposal renders markdown, AI evidence, and proposed links,
- editing markdown saves to the proposal record,
- selected batch accept calls the accept endpoint and invalidates project queries,
- provider and validation errors render without losing local selections.

## Acceptance Criteria

The feature is complete when:

- users can open an AI Prefill page from a project,
- users can manually select indexed source files,
- users can generate AI-backed pending proposals using Ollama,
- the provider boundary also supports an OpenAI implementation,
- generation writes proposal rows but no canonical markdown,
- users can review, edit, reject, and accept AI spec entity proposals,
- accepted proposals write canonical markdown under `specops/` and re-index,
- accept is all-or-nothing for the selected batch,
- proposal statuses distinguish edited and unedited acceptance,
- errors from provider, validation, conflicts, and path safety are visible,
- focused package, contract, API, and web tests cover the workflow.
