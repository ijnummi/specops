import { useCallback, useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  bootstrapFromSource,
  entitiesQuery,
  indexRunsQuery,
  initializeSpecops,
  projectQuery,
  queryKeys,
  reindexProject,
  validationMessagesQuery
} from "../api/queries.js";
import {
  entityDraftKey,
  getDraft,
  isDraftDirty,
  saveDraft,
  setEntityDrafts,
  syncFetchedMarkdown,
  updateDraft,
  useEntityDrafts
} from "../components/entity-drafts.js";
import { EntityCreateForm } from "../components/entity-create-form.js";
import { EntityDetail } from "../components/entity-detail.js";
import { EntityList } from "../components/entity-list.js";
import { ProjectActions } from "../components/project-actions.js";
import { ValidationPanel } from "../components/validation-panel.js";
import { WorkbenchLayout } from "../components/workbench-layout.js";

type ProjectDetailPageProps = {
  projectId: string;
  entityId: string | null;
  query: string;
};

export function ProjectDetailPage({ projectId, entityId, query }: ProjectDetailPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const entityDrafts = useEntityDrafts();
  const project = useQuery(projectQuery(projectId));
  const [entities, validation, indexRuns] = useQueries({
    queries: [
      entitiesQuery(projectId),
      validationMessagesQuery(projectId),
      indexRunsQuery(projectId)
    ]
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredEntities = useMemo(() => {
    const all = entities.data ?? [];
    if (!normalizedQuery) {
      return all;
    }

    return all.filter((entity) =>
      [entity.entityId, entity.title, entity.type, entity.status, entity.bodyText, entity.filePath]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [entities.data, normalizedQuery]);

  const selectedEntityId = entityId ?? filteredEntities[0]?.entityId ?? null;
  const selectedDraftKey = selectedEntityId ? entityDraftKey(projectId, selectedEntityId) : null;
  const selectedDraft = selectedDraftKey ? getDraft(entityDrafts, selectedDraftKey) : null;
  const isEditorDirty = isDraftDirty(selectedDraft);
  const selectedValidation = (validation.data ?? []).filter(
    (message) => !selectedEntityId || message.entityId === selectedEntityId || message.entityId === null
  );
  const latestRun = indexRuns.data?.[0] ?? null;

  const confirmEntitySwitch = useCallback(() => {
    if (!isEditorDirty) {
      return true;
    }

    return window.confirm("Discard unsaved editor changes?");
  }, [isEditorDirty]);

  const syncSelectedFetchedMarkdown = useCallback(
    (fetchedMarkdown: string, contentHash: string) => {
      if (!selectedDraftKey) {
        return;
      }

      setEntityDrafts((drafts) =>
        syncFetchedMarkdown(drafts, selectedDraftKey, fetchedMarkdown, contentHash)
      );
    },
    [selectedDraftKey]
  );

  const updateSelectedDraft = useCallback(
    (markdown: string) => {
      if (!selectedDraftKey) {
        return;
      }

      setEntityDrafts((drafts) => updateDraft(drafts, selectedDraftKey, markdown));
    },
    [selectedDraftKey]
  );

  const saveSelectedDraft = useCallback(
    (markdown: string, contentHash: string) => {
      if (!selectedDraftKey) {
        return;
      }

      setEntityDrafts((drafts) => saveDraft(drafts, selectedDraftKey, markdown, contentHash));
    },
    [selectedDraftKey]
  );

  const invalidateProject = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
    ]);
  };

  const initializeMutation = useMutation({
    mutationFn: () => initializeSpecops(projectId),
    onSuccess: invalidateProject
  });
  const indexMutation = useMutation({
    mutationFn: () => reindexProject(projectId),
    onSuccess: invalidateProject
  });
  const bootstrapMutation = useMutation({
    mutationFn: () => bootstrapFromSource(projectId),
    onSuccess: invalidateProject
  });

  return (
    <WorkbenchLayout
      title={project.data?.name ?? "Project"}
      subtitle={project.data ? `${project.data.repoPath} / ${project.data.specopsPath}` : projectId}
      actions={
        <ProjectActions
          isInitializing={initializeMutation.isPending}
          isBootstrapping={bootstrapMutation.isPending}
          isIndexing={indexMutation.isPending}
          onInitialize={() => initializeMutation.mutate()}
          onBootstrap={() => bootstrapMutation.mutate()}
          onReindex={() => indexMutation.mutate()}
        />
      }
      sidebar={
        <>
          <div className="grid grid-cols-3 gap-2 border-b border-slate-200 p-3 text-xs">
            <Metric label="Entities" value={project.data?.entityCount ?? entities.data?.length ?? 0} />
            <Metric label="Links" value={project.data?.linkCount ?? 0} />
            <Metric
              label="Issues"
              value={
                (project.data?.validationErrorCount ?? 0) +
                (project.data?.validationWarningCount ?? 0)
              }
            />
          </div>
          <div className="border-b border-slate-200 p-3">
            <input
              className="input"
              type="search"
              value={query}
              placeholder="Search entities"
              onChange={(event) =>
                navigate({
                  to: entityId
                    ? "/projects/$projectId/entities/$entityId"
                    : "/projects/$projectId",
                  params: entityId ? { projectId, entityId } : { projectId },
                  search: { q: event.target.value }
                })
              }
            />
          </div>
          <EntityCreateForm projectId={projectId} />
          <EntityList
            projectId={projectId}
            entities={filteredEntities}
            selectedEntityId={selectedEntityId}
            query={query}
            onBeforeSelect={confirmEntitySwitch}
          />
        </>
      }
      inspector={
        <>
          <section className="panel-section">
            <h2 className="section-heading">Index Runs</h2>
            {latestRun ? (
              <div className="space-y-2 text-xs text-slate-600">
                <StatusLine label="Status" value={latestRun.status} />
                <StatusLine label="Entities" value={String(latestRun.entityCount)} />
                <StatusLine label="Links" value={String(latestRun.linkCount)} />
                <StatusLine label="Started" value={formatDate(latestRun.startedAt)} />
              </div>
            ) : (
              <p className="text-sm text-slate-500">No index runs yet.</p>
            )}
          </section>
          <ValidationPanel messages={selectedValidation} />
        </>
      }
    >
      {project.error || entities.error || validation.error || indexRuns.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {project.error?.message ??
            entities.error?.message ??
            validation.error?.message ??
            indexRuns.error?.message}
        </div>
      ) : selectedEntityId ? (
        <EntityDetail
          projectId={projectId}
          entityId={selectedEntityId}
          query={query}
          draft={selectedDraft}
          onFetchedMarkdown={syncSelectedFetchedMarkdown}
          onDraftChange={updateSelectedDraft}
          onSaveDraft={saveSelectedDraft}
          onBeforeSelect={confirmEntitySwitch}
        />
      ) : entities.isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading entities...
        </div>
      ) : (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No entity selected.
        </div>
      )}

      {initializeMutation.error ? (
        <p className="mt-3 text-sm text-red-700">{initializeMutation.error.message}</p>
      ) : null}
      {bootstrapMutation.error ? (
        <p className="mt-3 text-sm text-red-700">{bootstrapMutation.error.message}</p>
      ) : null}
      {indexMutation.error ? <p className="mt-3 text-sm text-red-700">{indexMutation.error.message}</p> : null}
    </WorkbenchLayout>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-slate-500">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
