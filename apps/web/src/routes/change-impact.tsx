import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  ChangeImpactPreviewQuery,
  ImpactDepth,
  ImpactDirection
} from "@specops/contracts";
import { ArrowLeft, FileText } from "lucide-react";

import {
  changeImpactPreviewQuery,
  previewAgentTask,
  queryKeys,
  saveAgentTask
} from "../api/queries.js";
import { AgentTaskPreview } from "../components/agent-task-preview.js";
import { ChangeImpactPreviewPanel } from "../components/change-impact-preview-panel.js";
import { ImpactGraph } from "../components/impact-graph.js";
import { ImpactTracePanel } from "../components/impact-trace-panel.js";
import type { ImpactSearchDepth } from "./impact.js";

type ChangeImpactPageProps = {
  projectId: string;
  entityId: string;
  depth: ImpactSearchDepth;
  direction: ImpactDirection;
  includeSource: boolean;
};

type PreviewTaskMutationInput = {
  projectId: string;
  entityId: string;
  taskSeed: AgentTaskPreviewRequest;
};

type SaveTaskMutationInput = {
  projectId: string;
  entityId: string;
  queryInput: ChangeImpactPreviewQuery;
  preview: AgentTaskPreviewResponse;
};

function impactDepthForApi(depth: ImpactSearchDepth): ImpactDepth {
  if (depth === 1) {
    return "1";
  }

  if (depth === 2) {
    return "2";
  }

  return depth;
}

function impactDepthForSearch(depth: ImpactDepth): ImpactSearchDepth {
  if (depth === "1") {
    return 1;
  }

  if (depth === "2") {
    return 2;
  }

  return depth;
}

export function ChangeImpactPage({
  projectId,
  entityId,
  depth,
  direction,
  includeSource
}: ChangeImpactPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentProjectIdRef = useRef(projectId);
  const currentEntityIdRef = useRef(entityId);
  const apiDepth = impactDepthForApi(depth);
  const queryInput: ChangeImpactPreviewQuery = { depth: apiDepth, direction, includeSource };
  const preview = useQuery(changeImpactPreviewQuery(projectId, entityId, queryInput));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [taskPreview, setTaskPreview] = useState<AgentTaskPreviewResponse | null>(null);
  const [taskPreviewOriginalMarkdown, setTaskPreviewOriginalMarkdown] = useState("");
  const [taskPreviewError, setTaskPreviewError] = useState<string | null>(null);
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
  const effectiveSelectedNodeId = useMemo(
    () =>
      preview.data?.impact.nodes.find((node) => node.id === selectedNodeId)?.id ??
      preview.data?.impact.nodes.find(
        (node) => node.id === `spec:${preview.data.rootEntity.entityId}`
      )?.id ??
      null,
    [preview.data?.impact.nodes, preview.data?.rootEntity.entityId, selectedNodeId]
  );

  currentProjectIdRef.current = projectId;
  currentEntityIdRef.current = entityId;

  const previewTaskMutation = useMutation({
    mutationFn: ({ projectId: requestedProjectId, taskSeed }: PreviewTaskMutationInput) =>
      previewAgentTask(requestedProjectId, taskSeed),
    onMutate: () => {
      setTaskPreviewError(null);
    },
    onSuccess: (generatedPreview, request) => {
      if (
        request.projectId !== currentProjectIdRef.current ||
        request.entityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskPreview(generatedPreview);
      setTaskPreviewOriginalMarkdown(generatedPreview.markdown);
      setTaskSaveError(null);
      setTaskPreviewError(null);
    },
    onError: (error, request) => {
      if (
        request.projectId !== currentProjectIdRef.current ||
        request.entityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskPreviewError(error instanceof Error ? error.message : "Failed to preview agent task");
    }
  });

  const saveTaskMutation = useMutation({
    mutationFn: ({ projectId: requestedProjectId, preview: generatedPreview }: SaveTaskMutationInput) =>
      saveAgentTask(requestedProjectId, {
        markdown: generatedPreview.markdown,
        taskId: generatedPreview.taskId,
        filePath: generatedPreview.filePath
      }),
    onSuccess: async (savedTask, request) => {
      if (
        request.projectId !== currentProjectIdRef.current ||
        request.entityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskPreview(null);
      setTaskPreviewOriginalMarkdown("");
      setTaskSaveError(null);

      const contextBacklinkInvalidations = request.preview.contextSpecIds.map((contextSpecId) =>
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
          queryKey: queryKeys.changeImpactPreview(
            request.projectId,
            request.entityId,
            request.queryInput
          )
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.outgoingLinks(request.projectId, request.entityId)
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.backlinks(request.projectId, request.entityId)
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
        request.entityId !== currentEntityIdRef.current
      ) {
        return;
      }

      setTaskSaveError(error instanceof Error ? error.message : "Failed to save agent task");
    }
  });

  function updateSearch(
    next: Partial<{
      depth: ImpactSearchDepth;
      direction: ImpactDirection;
      includeSource: boolean;
    }>
  ) {
    navigate({
      to: "/projects/$projectId/change-impact/$entityId",
      params: { projectId, entityId },
      search: {
        depth: next.depth ?? depth,
        direction: next.direction ?? direction,
        includeSource: next.includeSource ?? includeSource
      }
    });
  }

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 overflow-auto p-4 lg:overflow-hidden">
      <div className="flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {preview.data?.rootEntity.title ?? entityId}
          </h1>
          <p className="truncate text-sm text-slate-600">
            Change impact preview / {preview.data?.rootEntity.entityId ?? entityId}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="field min-w-32">
            <span>Depth</span>
            <select
              className="input h-9 py-1"
              value={apiDepth}
              onChange={(event) =>
                updateSearch({ depth: impactDepthForSearch(event.target.value as ImpactDepth) })
              }
            >
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="all">All reachable</option>
            </select>
          </label>
          <label className="field min-w-36">
            <span>Direction</span>
            <select
              className="input h-9 py-1"
              value={direction}
              onChange={(event) =>
                updateSearch({ direction: event.target.value as ImpactDirection })
              }
            >
              <option value="both">Both</option>
              <option value="upstream">Upstream</option>
              <option value="downstream">Downstream</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeSource}
              onChange={(event) => updateSearch({ includeSource: event.target.checked })}
            />
            Source evidence
          </label>
          <Link
            to="/projects/$projectId/entities/$entityId"
            params={{ projectId, entityId }}
            search={{ q: undefined }}
            className="button-secondary"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Open spec
          </Link>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            search={{ q: undefined }}
            className="button-secondary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Project
          </Link>
        </div>
      </div>

      {preview.isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading change impact preview...
        </div>
      ) : preview.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {preview.error.message}
        </div>
      ) : preview.data ? (
        <>
          <div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
              <ImpactGraph
                impact={preview.data.impact}
                selectedNodeId={effectiveSelectedNodeId}
                onSelectNode={(node) => setSelectedNodeId(node.id)}
              />
              <ImpactTracePanel impact={preview.data.impact} />
            </section>
            <ChangeImpactPreviewPanel
              preview={preview.data}
              selectedNodeId={effectiveSelectedNodeId}
              onGenerateTask={() =>
                previewTaskMutation.mutate({
                  projectId,
                  entityId,
                  taskSeed: preview.data.taskSeed
                })
              }
              isGeneratingTask={previewTaskMutation.isPending}
            />
          </div>

          {taskPreviewError ? <p className="text-sm text-red-700">{taskPreviewError}</p> : null}

          {taskPreview ? (
            <AgentTaskPreview
              preview={taskPreview}
              originalMarkdown={taskPreviewOriginalMarkdown}
              isSaving={saveTaskMutation.isPending}
              saveError={taskSaveError}
              onMarkdownChange={(markdown) => {
                setTaskSaveError(null);
                setTaskPreview((current) => (current ? { ...current, markdown } : current));
              }}
              onSave={() =>
                saveTaskMutation.mutate({
                  projectId,
                  entityId,
                  queryInput,
                  preview: taskPreview
                })
              }
              onClose={() => {
                setTaskPreview(null);
                setTaskPreviewOriginalMarkdown("");
                setTaskSaveError(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
