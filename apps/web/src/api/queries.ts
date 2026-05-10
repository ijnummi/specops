import { queryOptions } from "@tanstack/react-query";
import type {
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  CreateEntityRequest,
  CreateProjectRequest,
  EntityImpactQuery,
  EntityImpactResponseDto,
  IndexRunDto,
  ProjectDto,
  SaveAgentTaskRequest,
  SaveAgentTaskResponse,
  SpecEntityDto,
  SpecLinkDto,
  SourceSpecLinkDto,
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

export const queryKeys = {
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  entities: (projectId: string) => ["projects", projectId, "entities"] as const,
  entity: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId] as const,
  outgoingLinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "outgoing-links"] as const,
  backlinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "backlinks"] as const,
  sourceLinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "source-links"] as const,
  entityImpact: (projectId: string, entityId: string, input: EntityImpactQuery) =>
    ["projects", projectId, "entities", entityId, "impact", input] as const,
  agentTaskPreview: (projectId: string, input: AgentTaskPreviewRequest) =>
    ["projects", projectId, "agent-tasks", "preview", input] as const,
  validation: (projectId: string) => ["projects", projectId, "validation-messages"] as const,
  indexRuns: (projectId: string) => ["projects", projectId, "index-runs"] as const,
  search: (projectId: string, query: string) => ["projects", projectId, "search", query] as const
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

export function searchQuery(projectId: string, query: string) {
  return queryOptions({
    queryKey: queryKeys.search(projectId, query),
    queryFn: () =>
      apiGet<SpecEntityDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(query)}`
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
