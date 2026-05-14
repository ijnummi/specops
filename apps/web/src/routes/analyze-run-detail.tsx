import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  AnalyzeRunDetailDto,
  AnalyzeRunSelectionSummary,
  AnalyzeRunStatus,
  AnalyzeRunStepDto,
  AnalyzeRunStepName,
  AnalyzeRunStepStatus
} from "@specops/contracts";

import { analyzeRunQuery } from "../api/queries.js";

type AnalyzeRunDetailPageProps = {
  projectId: string;
  runId: string;
};

export function AnalyzeRunDetailPage({ projectId, runId }: AnalyzeRunDetailPageProps) {
  const run = useQuery({
    ...analyzeRunQuery(projectId, runId),
    refetchInterval: (query) => {
      const status = (query.state.data as AnalyzeRunDetailDto | undefined)?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    }
  });

  if (run.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading analyze run...</div>;
  }

  if (run.error) {
    return <div className="p-4 text-sm text-red-700">{run.error.message}</div>;
  }

  if (!run.data) {
    return <div className="p-4 text-sm text-slate-600">Analyze run is unavailable.</div>;
  }

  return <AnalyzeRunDetailContent projectId={projectId} run={run.data} />;
}

function AnalyzeRunDetailContent({
  projectId,
  run
}: {
  projectId: string;
  run: AnalyzeRunDetailDto;
}) {
  const canReviewDrafts =
    run.status === "succeeded" || (run.status === "failed" && proposalTotal(run) > 0);

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ q: undefined }}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              Back to project
            </Link>
            <h1 className="mt-1 text-base font-semibold text-slate-950">Analyze project</h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{formatStatus(run.status)}</span>
              {run.currentStep ? <span>{stepLabel(run.currentStep)}</span> : null}
              <span>Run {run.id}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            {canReviewDrafts ? (
              <Link
                to="/projects/$projectId/analyze-runs/$runId/review"
                params={{ projectId, runId: run.id }}
                className="button-primary"
              >
                Review system map and drafts
              </Link>
            ) : null}
          </div>
        </div>
        {run.errorMessage ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {run.errorMessage}
          </p>
        ) : null}
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.55fr)]">
        <div className="grid content-start gap-3">
          <StepsPanel steps={run.steps} />
        </div>
        <div className="grid content-start gap-3">
          <DraftMetricsPanel run={run} />
          <SelectionPanel selection={run.selection} />
        </div>
      </section>
    </div>
  );
}

function StepsPanel({ steps }: { steps: AnalyzeRunStepDto[] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Progress</h2>
      <ol className="mt-3 divide-y divide-slate-200">
        {steps.map((step) => (
          <li key={step.name} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <StepStatusMark status={step.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-slate-900">{stepLabel(step.name)}</h3>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {formatStatus(step.status)}
                </span>
              </div>
              {step.message ? <p className="mt-1 text-sm text-slate-600">{step.message}</p> : null}
              {Object.keys(step.counts).length > 0 ? <StepCounts counts={step.counts} /> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepStatusMark({ status }: { status: AnalyzeRunStepStatus }) {
  if (status === "running") {
    return (
      <span
        className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin"
        aria-label="running"
      />
    );
  }

  const tone = {
    pending: "border-slate-300 text-slate-400",
    succeeded: "border-emerald-500 bg-emerald-50 text-emerald-700",
    skipped: "border-amber-400 bg-amber-50 text-amber-700",
    failed: "border-red-500 bg-red-50 text-red-700"
  }[status];

  const mark = {
    pending: "-",
    succeeded: "ok",
    skipped: "skip",
    failed: "x"
  }[status];

  return (
    <span
      className={`mt-0.5 grid h-5 min-w-5 shrink-0 place-items-center rounded-full border px-1 text-[0.625rem] font-semibold leading-none ${tone}`}
      aria-label={status}
    >
      {mark}
    </span>
  );
}

function StepCounts({ counts }: { counts: Record<string, number> }) {
  return (
    <dl className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
      {Object.entries(counts).map(([key, value]) => (
        <div key={key} className="rounded bg-slate-50 px-2 py-1">
          <dt className="inline font-medium text-slate-700">{formatCountKey(key)}</dt>{" "}
          <dd className="inline">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DraftMetricsPanel({ run }: { run: AnalyzeRunDetailDto }) {
  const selectedFileCount = run.selection?.selectedSourceFileIds.length ?? 0;

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Generated Drafts</h2>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
        <Metric label="source proposals" value={run.sourceProposalCount} />
        <Metric label="AI proposals" value={run.aiProposalCount} />
        <Metric label="selected AI source files" value={selectedFileCount} />
      </dl>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function SelectionPanel({ selection }: { selection: AnalyzeRunSelectionSummary | null }) {
  if (!selection) {
    return (
      <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="section-heading">Selection Diagnostics</h2>
        <p className="mt-3 text-sm text-slate-500">No AI source selection has been recorded.</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="section-heading">Selection Diagnostics</h2>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">Coverage</dt>
          <dd className="mt-1">
            Selected {selection.selectedSourceFileIds.length} of{" "}
            {selection.eligibleHighSignalFileCount} high-signal source files.
            {selection.skippedHighSignalFileCount > 0
              ? ` ${selection.skippedHighSignalFileCount} high-signal files were skipped.`
              : ""}
          </dd>
        </div>
      </dl>

      {selection.diagnostics.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {selection.diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.level}-${index}`}
              className={
                diagnostic.level === "warning"
                  ? "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  : "rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              }
            >
              <span className="font-medium">{formatStatus(diagnostic.level)}:</span>{" "}
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No selection diagnostics.</p>
      )}

      {selection.categories.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Selected categories</h3>
          <dl className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
            {selection.categories.map((category) => (
              <div key={category.category} className="rounded bg-slate-50 px-2 py-1">
                <dt className="inline font-medium text-slate-800">
                  {formatStatus(category.category)}
                </dt>{" "}
                <dd className="inline">{category.count}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {selection.selectedPaths.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Selected files</h3>
          <ul className="mt-2 grid gap-1">
            {selection.selectedPaths.map((path) => (
              <li key={path} className="truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs">
                {path}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({ status }: { status: AnalyzeRunStatus }) {
  const tone = {
    queued: "border-slate-200 bg-slate-50 text-slate-700",
    running: "border-blue-200 bg-blue-50 text-blue-700",
    succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-red-200 bg-red-50 text-red-700"
  }[status];

  return (
    <span className={`rounded border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {formatStatus(status)}
    </span>
  );
}

const stepLabels: Record<AnalyzeRunStepName, string> = {
  initialize: "Initialize",
  index: "Index project",
  source_proposals: "Generate source proposals",
  select_ai_sources: "Select AI sources",
  ai_prefill: "Generate AI drafts",
  build_system_map: "Build system map",
  link_map_to_drafts: "Link map to drafts"
};

function stepLabel(name: AnalyzeRunStepName) {
  return stepLabels[name];
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatCountKey(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function proposalTotal(run: AnalyzeRunDetailDto) {
  return run.sourceProposalCount + run.aiProposalCount;
}
