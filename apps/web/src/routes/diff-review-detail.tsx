import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  DiffReviewChangedFiles,
  DiffReviewDetailResponse,
  DiffReviewFinding,
  DiffReviewStatus,
  UpdateDiffReviewStatusRequest
} from "@specops/contracts";

import { diffReviewQuery, queryKeys, updateDiffReviewStatus } from "../api/queries.js";

export function DiffReviewDetailPage({
  projectId,
  reviewId
}: {
  projectId: string;
  reviewId: string;
}) {
  const queryClient = useQueryClient();
  const review = useQuery(diffReviewQuery(projectId, reviewId));

  const invalidateReview = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.diffReviewsRoot(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.diffReview(projectId, reviewId) })
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: (input: UpdateDiffReviewStatusRequest) =>
      updateDiffReviewStatus(projectId, reviewId, input),
    onSuccess: invalidateReview
  });

  if (review.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading diff review...</div>;
  }

  if (review.error) {
    return <div className="p-4 text-sm text-red-700">{review.error.message}</div>;
  }

  if (!review.data) {
    return <div className="p-4 text-sm text-slate-600">Diff review is unavailable.</div>;
  }

  return (
    <DiffReviewDetailContent
      projectId={projectId}
      review={review.data}
      isMutating={statusMutation.isPending}
      onUpdateStatus={(status) => statusMutation.mutate({ status })}
    />
  );
}

function DiffReviewDetailContent({
  projectId,
  review,
  isMutating,
  onUpdateStatus
}: {
  projectId: string;
  review: DiffReviewDetailResponse;
  isMutating: boolean;
  onUpdateStatus: (status: UpdateDiffReviewStatusRequest["status"]) => void;
}) {
  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/projects/$projectId/diff-reviews"
              params={{ projectId }}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              Diff Reviews
            </Link>
            <h1 className="mt-1 truncate text-base font-semibold text-slate-950">
              {formatReviewType(review.reviewType)}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{formatStatus(review.status)}</span>
              <span>
                {shortSha(review.baseCommit)}...{shortSha(review.headCommit)}
              </span>
              <span>{formatRefs(review)}</span>
            </div>
          </div>
          <DiffReviewActions
            status={review.status}
            disabled={isMutating}
            onUpdateStatus={onUpdateStatus}
          />
        </div>
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.65fr)]">
        <div className="grid gap-3">
          <ChangedFilesPanel changedFiles={review.reviewSummary.changedFiles} />
          <FindingsPanel findings={review.reviewSummary.findings} />
        </div>
        <div className="grid content-start gap-3">
          <AffectedSpecsPanel specs={review.reviewSummary.affectedSpecs} />
          <RelatedTasksPanel tasks={review.reviewSummary.relatedTasks} />
          <ValidationCommandsPanel commands={review.reviewSummary.suggestedValidationCommands} />
        </div>
      </section>
    </div>
  );
}

function DiffReviewActions({
  disabled,
  status,
  onUpdateStatus
}: {
  disabled: boolean;
  status: DiffReviewStatus;
  onUpdateStatus: (status: UpdateDiffReviewStatusRequest["status"]) => void;
}) {
  const isTerminal =
    status === "accepted" || status === "needs_followup" || status === "superseded";

  return (
    <div className="flex flex-wrap gap-2">
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

function ChangedFilesPanel({ changedFiles }: { changedFiles: DiffReviewChangedFiles }) {
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

function FindingsPanel({ findings }: { findings: DiffReviewFinding[] }) {
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
                {finding.filePath ? (
                  <span className="min-w-0 break-all font-mono">{finding.filePath}</span>
                ) : null}
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

function AffectedSpecsPanel({
  specs
}: {
  specs: DiffReviewDetailResponse["reviewSummary"]["affectedSpecs"];
}) {
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

function RelatedTasksPanel({
  tasks
}: {
  tasks: DiffReviewDetailResponse["reviewSummary"]["relatedTasks"];
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Related Tasks</h2>
      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No related tasks.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {tasks.map((task) => (
            <li key={`${task.entityId}:${task.reason}`} className="min-w-0 text-sm">
              <div className="truncate font-medium text-slate-900">{task.title}</div>
              <div className="truncate text-xs text-slate-500">
                {task.entityId} / {task.status} / {formatStatus(task.reason)}
              </div>
              <div className="truncate font-mono text-xs text-slate-500">{task.filePath}</div>
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
            <li
              key={command}
              className="min-w-0 break-all rounded bg-slate-950 px-2 py-1 font-mono text-xs text-white"
            >
              {command}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatReviewType(reviewType: DiffReviewDetailResponse["reviewType"]) {
  return reviewType.replaceAll("_", " ");
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatRefs(review: DiffReviewDetailResponse) {
  if (!review.baseRef && !review.headRef) {
    return "local changes";
  }

  return `${review.baseRef ?? "unknown"}...${review.headRef ?? "unknown"}`;
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 7) : "unknown";
}
