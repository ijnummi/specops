import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentTaskPreviewRequest, AgentTaskPreviewResponse } from "@specops/contracts";
import { Bot, Save } from "lucide-react";

import {
  backlinksQuery,
  entityQuery,
  entitySourceLinksQuery,
  outgoingLinksQuery,
  previewAgentTask,
  queryKeys,
  saveAgentTask,
  updateEntityMarkdown,
  validationMessagesQuery
} from "../api/queries.js";
import { AgentTaskPreview } from "./agent-task-preview.js";
import { defaultTargetAgent, suggestedTaskIdForSource } from "./agent-task-preview-state.js";
import type { EntityDraft } from "./entity-drafts.js";
import { isDraftDirty } from "./entity-drafts.js";
import { entityMarkdownForEditing } from "./entity-editor-markdown.js";
import { validateEntityMarkdownIdentity } from "./entity-markdown.js";
import { LinkPanels } from "./link-panels.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { SourceLinkTabs } from "./source-link-tabs.js";

type EntityDetailProps = {
  projectId: string;
  entityId: string;
  query?: string;
  draft: EntityDraft | null;
  onFetchedMarkdown: (markdown: string, contentHash: string) => void;
  onDraftChange: (markdown: string) => void;
  onSaveDraft: (markdown: string, contentHash: string) => void;
  onBeforeSelect?: () => boolean;
};

type PreviewTaskMutationInput = {
  projectId: string;
  input: AgentTaskPreviewRequest;
};

type SaveTaskMutationInput = {
  projectId: string;
  sourceEntityId: string;
  preview: AgentTaskPreviewResponse;
};

export function EntityDetail({
  projectId,
  entityId,
  query = "",
  draft,
  onFetchedMarkdown,
  onDraftChange,
  onSaveDraft,
  onBeforeSelect
}: EntityDetailProps) {
  const queryClient = useQueryClient();
  const currentEntityIdRef = useRef(entityId);
  const currentProjectIdRef = useRef(projectId);
  const entity = useQuery(entityQuery(projectId, entityId));
  const sourceLinks = useQuery({
    ...entitySourceLinksQuery(projectId, entityId),
    enabled: Boolean(entityId)
  });
  const [outgoing, backlinks] = useQueries({
    queries: [outgoingLinksQuery(projectId, entityId), backlinksQuery(projectId, entityId)]
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [taskPreview, setTaskPreview] = useState<AgentTaskPreviewResponse | null>(null);
  const [taskPreviewOriginalMarkdown, setTaskPreviewOriginalMarkdown] = useState<string>("");
  const [taskTargetAgent, setTaskTargetAgent] = useState(defaultTargetAgent());
  const [taskId, setTaskId] = useState(() => suggestedTaskIdForSource(entityId));
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPreviewError, setTaskPreviewError] = useState<string | null>(null);
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);

  const documentMarkdown = useMemo(
    () => (entity.data ? entityMarkdownForEditing(entity.data) : ""),
    [entity.data]
  );
  const editorMarkdown = draft?.markdown ?? documentMarkdown;
  const isDirty = isDraftDirty(draft);
  const cannotGenerateTaskMessage = isDirty
    ? "Save entity changes before generating a task."
    : null;

  currentEntityIdRef.current = entityId;
  currentProjectIdRef.current = projectId;

  useEffect(() => {
    setSaveError(null);
    setTaskPreview(null);
    setTaskPreviewOriginalMarkdown("");
    setTaskTargetAgent(defaultTargetAgent());
    setTaskId(suggestedTaskIdForSource(entityId));
    setTaskTitle("");
    setTaskPreviewError(null);
    setTaskSaveError(null);
  }, [entityId, projectId]);

  useEffect(() => {
    if (entity.data) {
      onFetchedMarkdown(documentMarkdown, entity.data.contentHash);
    }
  }, [documentMarkdown, entity.data, onFetchedMarkdown]);

  const mutation = useMutation({
    mutationFn: (markdownToSave: string) =>
      updateEntityMarkdown(
        projectId,
        entityId,
        markdownToSave,
        draft?.baseContentHash ?? entity.data?.contentHash ?? ""
      ),
    onSuccess: async (savedEntity) => {
      const savedMarkdown = entityMarkdownForEditing(savedEntity);
      setSaveError(null);
      onSaveDraft(savedMarkdown, savedEntity.contentHash);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.entity(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.outgoingLinks(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.backlinks(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sourceLinks(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      ]);
    }
  });

  const previewTaskMutation = useMutation({
    mutationFn: ({ projectId: requestedProjectId, input }: PreviewTaskMutationInput) =>
      previewAgentTask(requestedProjectId, input),
    onMutate: () => {
      setTaskPreviewError(null);
    },
    onSuccess: (preview, request) => {
      if (
        request.projectId !== currentProjectIdRef.current ||
        request.input.sourceEntityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskPreview(preview);
      setTaskPreviewOriginalMarkdown(preview.markdown);
      setTaskId(preview.taskId);
      setTaskTitle(preview.title);
      setTaskSaveError(null);
      setTaskPreviewError(null);
    },
    onError: (error, request) => {
      if (
        request.projectId !== currentProjectIdRef.current ||
        request.input.sourceEntityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskPreviewError(error instanceof Error ? error.message : "Failed to preview agent task");
    }
  });

  const saveTaskMutation = useMutation({
    mutationFn: ({ projectId: requestedProjectId, preview }: SaveTaskMutationInput) =>
      saveAgentTask(requestedProjectId, {
        markdown: preview.markdown,
        taskId: preview.taskId,
        filePath: preview.filePath
      }),
    onSuccess: async (savedTask, request) => {
      if (
        request.projectId === currentProjectIdRef.current &&
        request.sourceEntityId === currentEntityIdRef.current
      ) {
        setTaskPreview(null);
        setTaskPreviewOriginalMarkdown("");
        setTaskSaveError(null);
      }

      const contextBacklinkInvalidations = request.preview.contextSpecIds.map(
        (contextSpecId: string) =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.backlinks(request.projectId, contextSpecId)
          })
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.entities(request.projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.validation(request.projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(request.projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(request.projectId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.outgoingLinks(request.projectId, request.sourceEntityId)
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.backlinks(request.projectId, request.sourceEntityId)
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.entity(request.projectId, savedTask.entityId)
        }),
        ...contextBacklinkInvalidations
      ]);
    },
    onError: (error, request) => {
      if (
        request.projectId !== currentProjectIdRef.current ||
        request.sourceEntityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskSaveError(error instanceof Error ? error.message : "Failed to save agent task");
    }
  });

  function handleSave() {
    const validation = validateEntityMarkdownIdentity(editorMarkdown, entityId);

    if (!validation.ok) {
      setSaveError(validation.message);
      return;
    }

    setSaveError(null);
    mutation.mutate(editorMarkdown);
  }

  if (entity.isLoading) {
    return (
      <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Loading entity...
      </div>
    );
  }

  if (entity.error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {entity.error.message}
      </div>
    );
  }

  if (!entity.data) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <section
        className="flex min-h-0 flex-[3_1_0%] flex-col overflow-hidden rounded border border-slate-200 bg-white"
        data-testid="entity-editor-panel"
      >
        <div className="flex min-w-0 shrink-0 flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950">{entity.data.title}</h2>
            <p className="truncate text-xs text-slate-500">
              {entity.data.entityId} / {entity.data.filePath}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 xl:flex-1 xl:items-end">
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
                {entity.data.type}
              </span>
              <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
                {entity.data.status}
              </span>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-2 2xl:flex-row 2xl:items-center">
              <div className="grid w-full min-w-0 gap-2 sm:grid-cols-3">
                <input
                  className="input h-9"
                  value={taskTargetAgent}
                  aria-label="Target agent"
                  onChange={(event) => setTaskTargetAgent(event.target.value)}
                />
                <input
                  className="input h-9"
                  value={taskId}
                  aria-label="Task ID"
                  onChange={(event) => setTaskId(event.target.value)}
                />
                <input
                  className="input h-9"
                  value={taskTitle}
                  placeholder={entity.data.title}
                  aria-label="Task title"
                  onChange={(event) => setTaskTitle(event.target.value)}
                />
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={previewTaskMutation.isPending || isDirty}
                  title={cannotGenerateTaskMessage ?? undefined}
                  onClick={() =>
                    previewTaskMutation.mutate({
                      projectId,
                      input: {
                        sourceEntityId: entityId,
                        targetAgent: taskTargetAgent.trim() || defaultTargetAgent(),
                        taskId: taskId.trim() || undefined,
                        title: taskTitle.trim() || undefined
                      }
                    })
                  }
                >
                  <Bot className="h-4 w-4" aria-hidden="true" />
                  Generate Task
                </button>
                <button
                  type="button"
                  className="button-primary"
                  disabled={!isDirty || mutation.isPending}
                  onClick={handleSave}
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save
                </button>
              </div>
            </div>
            {cannotGenerateTaskMessage ? (
              <p className="text-xs text-slate-500">{cannotGenerateTaskMessage}</p>
            ) : null}
          </div>
        </div>
        <SourceLinkTabs
          specTitle={entity.data.title}
          sourceLinks={sourceLinks.data ?? []}
          sourceLinksError={sourceLinks.error?.message ?? null}
          specPanel={
            <MarkdownEditor
              value={editorMarkdown}
              height="100%"
              minHeight="0px"
              className="min-h-0 flex-1"
              onChange={(value) => {
                setSaveError(null);
                onDraftChange(value);
              }}
            />
          }
        />
      </section>

      {saveError ? <p className="text-sm text-red-700">{saveError}</p> : null}
      {mutation.error ? <p className="text-sm text-red-700">{mutation.error.message}</p> : null}
      {taskPreviewError ? <p className="text-sm text-red-700">{taskPreviewError}</p> : null}

      {taskPreview ? (
        <AgentTaskPreview
          preview={taskPreview}
          originalMarkdown={taskPreviewOriginalMarkdown}
          isSaving={saveTaskMutation.isPending}
          saveError={taskSaveError}
          onMarkdownChange={(markdown) => {
            setTaskSaveError(null);
            setTaskPreview((current: AgentTaskPreviewResponse | null) =>
              current ? { ...current, markdown } : current
            );
          }}
          onSave={() =>
            saveTaskMutation.mutate({ projectId, sourceEntityId: entityId, preview: taskPreview })
          }
          onClose={() => {
            setTaskPreview(null);
            setTaskPreviewOriginalMarkdown("");
            setTaskSaveError(null);
          }}
        />
      ) : null}

      <LinkPanels
        projectId={projectId}
        currentEntityId={entityId}
        query={query}
        className="min-h-0 flex-[1_1_0%]"
        outgoing={outgoing.data ?? []}
        backlinks={backlinks.data ?? []}
        onBeforeSelect={onBeforeSelect}
      />
      <EntityValidation projectId={projectId} entityId={entityId} />
    </div>
  );
}

function EntityValidation({ projectId, entityId }: { projectId: string; entityId: string }) {
  const validation = useQuery(validationMessagesQuery(projectId));
  const messages = (validation.data ?? []).filter((message) => message.entityId === entityId);

  if (messages.length === 0) {
    return null;
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Entity Validation</h3>
      <ul className="grid gap-2">
        {messages.map((message) => (
          <li key={message.id} className="text-sm text-slate-700">
            <span className="font-medium">{message.code}</span>: {message.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
