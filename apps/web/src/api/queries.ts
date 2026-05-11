import { queryOptions } from "@tanstack/react-query";
import type {
  AcceptProposalsRequest,
  AcceptProposalsResponse,
  AgentRunDetail as AgentRunDetailDto,
  AgentRunSummary as AgentRunSummaryDto,
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  AiPrefillGenerateRequest,
  AiPrefillGenerateResponse,
  ChangeImpactPreviewQuery,
  ChangeImpactPreviewResponseDto,
  CreateEntityRequest,
  CreateProjectRequest,
  EntitySearchQuery,
  EntitySearchResultDto,
  EntityImpactQuery,
  EntityImpactResponseDto,
  EntityReadinessDto,
  IndexRunDto,
  ProposalDetailDto,
  ProposalListQuery,
  ProposalPatchRequest,
  ProposalSummaryDto,
  ProjectDto,
  ProjectHealthDto,
  ProjectOverviewDto,
  ProjectReadinessDto,
  SaveAgentTaskRequest,
  SaveAgentTaskResponse,
  SpecEntityDto,
  SpecLinkDto,
  SourceFileListQuery,
  SourceFileSummaryDto,
  SourceSpecLinkDto,
  StartAgentRunRequest,
  UpdateAgentRunStatusRequest,
  ValidationMessageDto
} from "@specops/contracts";

import { apiGet, apiSend } from "./client.js";

export type ProjectSummaryDto = ProjectDto & {
  entityCount: number;
  linkCount: number;
  validationErrorCount: number;
  validationWarningCount: number;
  lastIndexedAt: string | null;
};

export type AdminDatabaseTableDto = {
  name: string;
  label: string;
  rowCount: number;
  supportsRowId: boolean;
};

export type AdminDatabaseColumnDto = {
  name: string;
  dataType: string;
  notNull: boolean;
};

export type AdminDatabaseSchemaDto = {
  table: string;
  primaryKey: string | null;
  columns: AdminDatabaseColumnDto[];
};

export type AdminDatabaseRowDto = {
  table: string;
  row: Record<string, unknown> | null;
};

export type AdminDatabaseRowsDto = {
  table: string;
  rows: Array<Record<string, unknown>>;
  limit: number;
};

export const queryKeys = {
  adminDatabaseTables: ["admin", "database", "tables"] as const,
  adminDatabaseSchema: (table: string) => ["admin", "database", table, "schema"] as const,
  adminDatabaseRow: (table: string, rowId: string) =>
    ["admin", "database", table, "row", rowId] as const,
  adminDatabaseRowNeighbor: (table: string, rowId: string, direction: "prev" | "next") =>
    ["admin", "database", table, "row-neighbor", rowId, direction] as const,
  adminDatabaseRows: (table: string, limit: number) =>
    ["admin", "database", table, "rows", limit] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  projectHealth: (projectId: string) => ["projects", projectId, "health"] as const,
  projectOverview: (projectId: string) => ["projects", projectId, "overview"] as const,
  projectReadiness: (projectId: string) => ["projects", projectId, "readiness"] as const,
  proposalsRoot: (projectId: string) => ["projects", projectId, "proposals"] as const,
  proposals: (projectId: string, input: ProposalListQuery = {}) =>
    ["projects", projectId, "proposals", input] as const,
  proposal: (projectId: string, proposalId: string) =>
    ["projects", projectId, "proposals", proposalId] as const,
  agentRunsRoot: (projectId: string) => ["projects", projectId, "agent-runs"] as const,
  agentRuns: (projectId: string) => ["projects", projectId, "agent-runs", "list"] as const,
  agentRun: (projectId: string, runId: string) =>
    ["projects", projectId, "agent-runs", runId] as const,
  sourceFiles: (projectId: string, input: SourceFileListQuery) =>
    ["projects", projectId, "source-files", input] as const,
  entities: (projectId: string) => ["projects", projectId, "entities"] as const,
  entity: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId] as const,
  entityReadiness: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "readiness"] as const,
  outgoingLinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "outgoing-links"] as const,
  backlinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "backlinks"] as const,
  sourceLinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "source-links"] as const,
  entityImpact: (projectId: string, entityId: string, input: EntityImpactQuery) =>
    ["projects", projectId, "entities", entityId, "impact", input] as const,
  changeImpactPreview: (
    projectId: string,
    entityId: string,
    input: ChangeImpactPreviewQuery
  ) => ["projects", projectId, "entities", entityId, "change-impact-preview", input] as const,
  agentTaskPreview: (projectId: string, input: AgentTaskPreviewRequest) =>
    ["projects", projectId, "agent-tasks", "preview", input] as const,
  validation: (projectId: string) => ["projects", projectId, "validation-messages"] as const,
  indexRuns: (projectId: string) => ["projects", projectId, "index-runs"] as const,
  search: (projectId: string, input: EntitySearchQuery) =>
    ["projects", projectId, "search", input] as const
};

export function projectsQuery() {
  return queryOptions({
    queryKey: queryKeys.projects,
    queryFn: () => apiGet<ProjectDto[]>("/api/projects")
  });
}

export function projectQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiGet<ProjectSummaryDto>(`/api/projects/${encodeURIComponent(projectId)}`)
  });
}

export function projectOverviewQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectOverview(projectId),
    queryFn: () =>
      apiGet<ProjectOverviewDto>(`/api/projects/${encodeURIComponent(projectId)}/overview`)
  });
}

export function projectHealthQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectHealth(projectId),
    queryFn: () => apiGet<ProjectHealthDto>(`/api/projects/${encodeURIComponent(projectId)}/health`)
  });
}

export function projectReadinessQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectReadiness(projectId),
    queryFn: () =>
      apiGet<ProjectReadinessDto>(`/api/projects/${encodeURIComponent(projectId)}/readiness`)
  });
}

export function proposalsQuery(projectId: string, input: ProposalListQuery = {}) {
  const search = new URLSearchParams();
  if (input.status) {
    search.set("status", input.status);
  }
  if (input.proposalType) {
    search.set("proposalType", input.proposalType);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";

  return queryOptions({
    queryKey: queryKeys.proposals(projectId, input),
    queryFn: () =>
      apiGet<ProposalSummaryDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/proposals${suffix}`
      )
  });
}

export function proposalQuery(projectId: string, proposalId: string) {
  return queryOptions({
    queryKey: queryKeys.proposal(projectId, proposalId),
    queryFn: () =>
      apiGet<ProposalDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(
          proposalId
        )}`
      )
  });
}

export function agentRunsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.agentRuns(projectId),
    queryFn: () =>
      apiGet<AgentRunSummaryDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/agent-runs`
      )
  });
}

export function agentRunQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.agentRun(projectId, runId),
    queryFn: () =>
      apiGet<AgentRunDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}`
      )
  });
}

export function sourceFilesQuery(projectId: string, input: SourceFileListQuery) {
  const search = new URLSearchParams();
  if (input.language) {
    search.set("language", input.language);
  }
  if (input.kind) {
    search.set("kind", input.kind);
  }
  if (input.q) {
    search.set("q", input.q);
  }
  if (input.limit !== undefined) {
    search.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    search.set("offset", String(input.offset));
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";

  return queryOptions({
    queryKey: queryKeys.sourceFiles(projectId, input),
    queryFn: () =>
      apiGet<SourceFileSummaryDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/source-files${suffix}`
      )
  });
}

export function entitiesQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.entities(projectId),
    queryFn: () => apiGet<SpecEntityDto[]>(`/api/projects/${encodeURIComponent(projectId)}/entities`)
  });
}

export function entityQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.entity(projectId, entityId),
    queryFn: () =>
      apiGet<SpecEntityDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(entityId)}`
      )
  });
}

export function entityReadinessQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.entityReadiness(projectId, entityId),
    queryFn: () =>
      apiGet<EntityReadinessDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/readiness`
      )
  });
}

export function outgoingLinksQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.outgoingLinks(projectId, entityId),
    queryFn: () =>
      apiGet<SpecLinkDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/outgoing-links`
      )
  });
}

export function backlinksQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.backlinks(projectId, entityId),
    queryFn: () =>
      apiGet<SpecLinkDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/backlinks`
      )
  });
}

export function entitySourceLinksQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.sourceLinks(projectId, entityId),
    queryFn: () =>
      apiGet<SourceSpecLinkDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/source-links`
      )
  });
}

export function entityImpactQuery(
  projectId: string,
  entityId: string,
  input: EntityImpactQuery
) {
  const search = new URLSearchParams({
    depth: input.depth,
    direction: input.direction,
    includeSource: String(input.includeSource)
  });

  return queryOptions({
    queryKey: queryKeys.entityImpact(projectId, entityId, input),
    queryFn: () =>
      apiGet<EntityImpactResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/impact?${search.toString()}`
      )
  });
}

export function changeImpactPreviewQuery(
  projectId: string,
  entityId: string,
  input: ChangeImpactPreviewQuery
) {
  const search = new URLSearchParams({
    depth: input.depth,
    direction: input.direction,
    includeSource: String(input.includeSource)
  });

  return queryOptions({
    queryKey: queryKeys.changeImpactPreview(projectId, entityId, input),
    queryFn: () =>
      apiGet<ChangeImpactPreviewResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/change-impact-preview?${search.toString()}`
      )
  });
}

export function validationMessagesQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.validation(projectId),
    queryFn: () =>
      apiGet<ValidationMessageDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/validation-messages`
      )
  });
}

export function indexRunsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.indexRuns(projectId),
    queryFn: () =>
      apiGet<IndexRunDto[]>(`/api/projects/${encodeURIComponent(projectId)}/index-runs`)
  });
}

export function searchQuery(projectId: string, input: EntitySearchQuery) {
  const search = new URLSearchParams({
    q: input.q,
    limit: String(input.limit)
  });

  if (input.type) {
    search.set("type", input.type);
  }
  if (input.status) {
    search.set("status", input.status);
  }

  return queryOptions({
    queryKey: queryKeys.search(projectId, input),
    queryFn: () =>
      apiGet<EntitySearchResultDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/search?${search.toString()}`
      )
  });
}

export function adminDatabaseTablesQuery() {
  return queryOptions({
    queryKey: queryKeys.adminDatabaseTables,
    queryFn: () => apiGet<AdminDatabaseTableDto[]>("/api/admin/database/tables")
  });
}

export function adminDatabaseSchemaQuery(table: string) {
  return queryOptions({
    queryKey: queryKeys.adminDatabaseSchema(table),
    queryFn: () =>
      apiGet<AdminDatabaseSchemaDto>(
        `/api/admin/database/tables/${encodeURIComponent(table)}/schema`
      )
  });
}

export function adminDatabaseRowQuery(table: string, rowId: string) {
  const search = new URLSearchParams({ id: rowId });

  return queryOptions({
    queryKey: queryKeys.adminDatabaseRow(table, rowId),
    queryFn: () =>
      apiGet<AdminDatabaseRowDto>(
        `/api/admin/database/tables/${encodeURIComponent(table)}/row?${search.toString()}`
      )
  });
}

export function adminDatabaseRowNeighborQuery(
  table: string,
  rowId: string,
  direction: "prev" | "next"
) {
  const search = new URLSearchParams({ id: rowId, direction });

  return queryOptions({
    queryKey: queryKeys.adminDatabaseRowNeighbor(table, rowId, direction),
    queryFn: () =>
      apiGet<AdminDatabaseRowDto>(
        `/api/admin/database/tables/${encodeURIComponent(
          table
        )}/row-neighbor?${search.toString()}`
      )
  });
}

export function adminDatabaseRowsQuery(table: string, limit = 50) {
  const search = new URLSearchParams({ limit: String(limit) });

  return queryOptions({
    queryKey: queryKeys.adminDatabaseRows(table, limit),
    queryFn: () =>
      apiGet<AdminDatabaseRowsDto>(
        `/api/admin/database/tables/${encodeURIComponent(table)}/rows?${search.toString()}`
      )
  });
}

export function createProject(input: CreateProjectRequest) {
  return apiSend<ProjectDto>("POST", "/api/projects", input);
}

export function deleteProject(projectId: string) {
  return apiSend<void>("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
}

export function initializeSpecops(projectId: string) {
  return apiSend<ProjectSummaryDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/init-specops`
  );
}

export function reindexProject(projectId: string) {
  return apiSend<IndexRunDto>("POST", `/api/projects/${encodeURIComponent(projectId)}/index`);
}

export function bootstrapFromSource(projectId: string) {
  return apiSend<IndexRunDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/bootstrap-from-source`
  );
}

export function generateSourceImportProposals(projectId: string) {
  return apiSend<ProposalSummaryDto[]>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/source-import`
  );
}

export function generateAiPrefillProposals(
  projectId: string,
  input: AiPrefillGenerateRequest
) {
  return apiSend<AiPrefillGenerateResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/ai-prefill`,
    input
  );
}

export function patchProposal(
  projectId: string,
  proposalId: string,
  input: ProposalPatchRequest
) {
  return apiSend<ProposalDetailDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`,
    input
  );
}

export function acceptProposals(projectId: string, input: AcceptProposalsRequest) {
  return apiSend<AcceptProposalsResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/accept`,
    input
  );
}

export function createEntity(projectId: string, input: CreateEntityRequest) {
  return apiSend<SpecEntityDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/entities`,
    input
  );
}

export function updateEntityMarkdown(
  projectId: string,
  entityId: string,
  markdown: string,
  baseContentHash: string
) {
  return apiSend<SpecEntityDto>(
    "PUT",
    `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
      entityId
    )}/markdown`,
    { markdown, baseContentHash }
  );
}

export function previewAgentTask(projectId: string, input: AgentTaskPreviewRequest) {
  return apiSend<AgentTaskPreviewResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-tasks/preview`,
    input
  );
}

export function saveAgentTask(projectId: string, input: SaveAgentTaskRequest) {
  return apiSend<SaveAgentTaskResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-tasks`,
    input
  );
}

export function startAgentRun(projectId: string, input: StartAgentRunRequest) {
  return apiSend<AgentRunDetailDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-runs`,
    input
  );
}

export function finishAgentRun(projectId: string, runId: string) {
  return apiSend<AgentRunDetailDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}/finish`
  );
}

export function updateAgentRunStatus(
  projectId: string,
  runId: string,
  input: UpdateAgentRunStatusRequest
) {
  return apiSend<AgentRunDetailDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}`,
    input
  );
}
