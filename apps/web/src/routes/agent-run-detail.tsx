import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  AgentRunChangedFiles,
  AgentRunDetail,
  AgentRunFinding,
  AgentRunStatus,
  UpdateAgentRunStatusRequest
} from "@specops/contracts";

import {
  agentRunQuery,
  finishAgentRun,
  queryKeys,
  updateAgentRunStatus
} from "../api/queries.js";

export function AgentRunDetailPage({
  projectId,
  runId
}: {
  projectId: string;
  runId: string;
}) {
  const queryClient = useQueryClient();
  const run = useQuery(agentRunQuery(projectId, runId));

  const invalidateRun = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.agentRunsRoot(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agentRun(projectId, runId) })
    ]);
  };

  const finishMutation = useMutation({
    mutationFn: () => finishAgentRun(projectId, runId),
    onSuccess: invalidateRun
  });
  const statusMutation = useMutation({
    mutationFn: (input: UpdateAgentRunStatusRequest) =>
      updateAgentRunStatus(projectId, runId, input),
    onSuccess: invalidateRun
  });

  if (run.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading agent run...</div>;
  }

  if (run.error) {
    return <div className="p-4 text-sm text-red-700">{run.error.message}</div>;
  }

  if (!run.data) {
    return <div className="p-4 text-sm text-slate-600">Agent run is unavailable.</div>;
  }

  return (
    <AgentRunDetailContent
      projectId={projectId}
      run={run.data}
      isMutating={finishMutation.isPending || statusMutation.isPending}
      onFinish={() => finishMutation.mutate()}
      onUpdateStatus={(status) => statusMutation.mutate({ status })}
    />
  );
}

function AgentRunDetailContent({
  projectId,
  run,
  isMutating,
  onFinish,
  onUpdateStatus
}: {
  projectId: string;
  run: AgentRunDetail;
  isMutating: boolean;
  onFinish: () => void;
  onUpdateStatus: (status: UpdateAgentRunStatusRequest["status"]) => void;
}) {
  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/projects/$projectId/agent-runs"
              params={{ projectId }}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              Agent Runs
            </Link>
            <h1 className="mt-1 truncate text-base font-semibold text-slate-950">
              {run.taskTitle}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{run.taskEntityId}</span>
              <span>{run.agent}</span>
              <span>{formatStatus(run.status)}</span>
              <span>
                {shortSha(run.startGitCommit)}...{shortSha(run.endGitCommit)}
              </span>
            </div>
          </div>
          <AgentRunActions
            status={run.status}
            disabled={isMutating}
            onFinish={onFinish}
            onUpdateStatus={onUpdateStatus}
          />
        </div>
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.65fr)]">
        <div className="grid gap-3">
          <ChangedFilesPanel changedFiles={run.reviewSummary.changedFiles} />
          <FindingsPanel findings={run.reviewSummary.findings} />
        </div>
        <div className="grid content-start gap-3">
          <TaskContextPanel taskContext={run.reviewSummary.taskContext} />
          <AffectedSpecsPanel specs={run.reviewSummary.affectedSpecs} />
          <ValidationCommandsPanel commands={run.reviewSummary.suggestedValidationCommands} />
        </div>
      </section>
    </div>
  );
}

function AgentRunActions({
  disabled,
  status,
  onFinish,
  onUpdateStatus
}: {
  disabled: boolean;
  status: AgentRunStatus;
  onFinish: () => void;
  onUpdateStatus: (status: UpdateAgentRunStatusRequest["status"]) => void;
}) {
  const isTerminal =
    status === "accepted" || status === "needs_followup" || status === "superseded";

  return (
    <div className="flex flex-wrap gap-2">
      {status === "running" ? (
        <button className="button-primary" type="button" disabled={disabled} onClick={onFinish}>
          Finish run
        </button>
      ) : null}
      {status === "ready_for_review" ? (
        <>
          <button
            className="button-primary"
            type="button"
            disabled={disabled}
            onClick={() => onUpdateStatus("accepted")}
          >
            Mark accepted
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={disabled}
            onClick={() => onUpdateStatus("needs_followup")}
          >
            Needs follow-up
          </button>
        </>
      ) : null}
      {!isTerminal ? (
        <button
          className="button-secondary"
          type="button"
          disabled={disabled}
          onClick={() => onUpdateStatus("superseded")}
        >
          Supersede
        </button>
      ) : null}
    </div>
  );
}

function ChangedFilesPanel({ changedFiles }: { changedFiles: AgentRunChangedFiles }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Changed Files</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <FileGroup title="Specs" files={changedFiles.specs} />
        <FileGroup title="Source" files={changedFiles.source} />
        <FileGroup title="Tests" files={changedFiles.tests} />
        <FileGroup title="Other" files={changedFiles.other} />
      </div>
    </section>
  );
}

function FileGroup({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {files.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No files.</p>
      ) : (
        <ul className="mt-2 grid gap-1">
          {files.map((file) => (
            <li key={file} className="truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs">
              {file}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingsPanel({ findings }: { findings: AgentRunFinding[] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Findings</h2>
      {findings.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No findings.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200">
          {findings.map((finding) => (
            <li key={finding.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{finding.severity}</span>
                <span>{formatStatus(finding.kind)}</span>
                {finding.entityId ? <span>{finding.entityId}</span> : null}
                {finding.filePath ? <span className="font-mono">{finding.filePath}</span> : null}
              </div>
              <p className="mt-1 text-sm text-slate-800">{finding.message}</p>
              <p className="mt-1 text-sm text-slate-600">{finding.suggestedFollowUp}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskContextPanel({
  taskContext
}: {
  taskContext: AgentRunDetail["reviewSummary"]["taskContext"];
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Task Context</h2>
      <dl className="mt-3 grid gap-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase text-slate-500">Source entity</dt>
          <dd className="mt-1 truncate font-mono text-xs text-slate-700">
            {taskContext.sourceEntityId ?? "No source entity."}
          </dd>
        </div>
        <EntityIdList title="Context entities" entityIds={taskContext.contextEntityIds} />
        <EntityIdList title="Missing entity ids" entityIds={taskContext.missingEntityIds} />
      </dl>
    </section>
  );
}

function EntityIdList({ title, entityIds }: { title: string; entityIds: string[] }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-slate-500">{title}</dt>
      <dd className="mt-1">
        {entityIds.length === 0 ? (
          <span className="text-sm text-slate-500">None.</span>
        ) : (
          <ul className="grid gap-1">
            {entityIds.map((entityId) => (
              <li key={entityId} className="truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs">
                {entityId}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

function AffectedSpecsPanel({ specs }: { specs: AgentRunDetail["reviewSummary"]["affectedSpecs"] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Affected Specs</h2>
      {specs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No affected specs.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {specs.map((spec) => (
            <li key={`${spec.entityId}:${spec.reason}`} className="min-w-0 text-sm">
              <div className="truncate font-medium text-slate-900">{spec.title}</div>
              <div className="truncate text-xs text-slate-500">
                {spec.entityId} / {spec.type} / {formatStatus(spec.reason)}
              </div>
              <div className="truncate font-mono text-xs text-slate-500">{spec.filePath}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ValidationCommandsPanel({ commands }: { commands: string[] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Validation Commands</h2>
      {commands.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No suggested commands.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {commands.map((command) => (
            <li key={command} className="rounded bg-slate-950 px-2 py-1 font-mono text-xs text-white">
              {command}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 7) : "unknown";
}
