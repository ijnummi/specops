import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  HealthQueueActionDto,
  HealthQueueDiagnosticDto,
  HealthQueueFamilyDto,
  HealthQueueItemDto,
  HealthQueueSeverityDto,
  ProjectHealthQueueResponseDto
} from "@specops/contracts";

import { projectHealthQueueQuery } from "../api/queries.js";

type ProjectHealthQueuePageProps = {
  projectId: string;
};

type FamilyFilter = "all" | HealthQueueFamilyDto;
type SeverityFilter = "all" | HealthQueueSeverityDto;

const familyOptions: Array<{ label: string; value: FamilyFilter }> = [
  { label: "All families", value: "all" },
  { label: "Spec", value: "spec" },
  { label: "Source", value: "source" },
  { label: "Concept", value: "concept" }
];

const severityOptions: Array<{ label: string; value: SeverityFilter }> = [
  { label: "All severities", value: "all" },
  { label: "Blocker", value: "blocker" },
  { label: "Review", value: "review" },
  { label: "Context", value: "context" }
];

export function ProjectHealthQueuePage({ projectId }: ProjectHealthQueuePageProps) {
  const queue = useQuery(projectHealthQueueQuery(projectId));

  if (queue.isLoading) {
    return <p className="panel-section text-sm text-slate-500">Loading health queue...</p>;
  }

  if (queue.error) {
    return <p className="panel-section text-sm text-red-700">{queue.error.message}</p>;
  }

  if (!queue.data) {
    return <p className="panel-section text-sm text-slate-500">Health queue is unavailable.</p>;
  }

  return <HealthQueueContent projectId={projectId} queue={queue.data} />;
}

function HealthQueueContent({
  projectId,
  queue
}: {
  projectId: string;
  queue: ProjectHealthQueueResponseDto;
}) {
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const filteredItems = useMemo(
    () =>
      queue.items.filter(
        (item) =>
          (familyFilter === "all" || item.family === familyFilter) &&
          (severityFilter === "all" || item.severity === severityFilter)
      ),
    [familyFilter, queue.items, severityFilter]
  );
  const selectedItem =
    filteredItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? null;

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-auto p-4 lg:overflow-hidden">
      <div className="mb-4 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-950">Health Queue</h1>
          <p className="truncate text-sm text-slate-600">
            {queue.summary.total} items generated {formatDate(queue.generatedAt)}
          </p>
        </div>
        <SourceState queue={queue} />
      </div>

      {queue.diagnostics.length > 0 ? <Diagnostics diagnostics={queue.diagnostics} /> : null}

      {queue.items.length === 0 ? (
        <section className="panel-section text-sm text-slate-600">
          <h2 className="section-heading">Queue</h2>
          <p className="mt-2">No health queue items</p>
        </section>
      ) : (
        <div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[24rem_minmax(0,1fr)]">
          <aside className="panel-section flex min-h-[28rem] flex-col overflow-hidden">
            <div className="grid shrink-0 gap-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h2 className="section-heading">Queue items</h2>
                <span className="shrink-0 text-xs text-slate-500">
                  {filteredItems.length} of {queue.items.length}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <label className="field">
                  <span>Family</span>
                  <select
                    aria-label="Family"
                    className="input h-9 py-1"
                    value={familyFilter}
                    onChange={(event) => setFamilyFilter(event.target.value as FamilyFilter)}
                  >
                    {familyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Severity</span>
                  <select
                    aria-label="Severity"
                    className="input h-9 py-1"
                    value={severityFilter}
                    onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                  >
                    {severityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No health queue items match the filters.</p>
            ) : (
              <ul className="mt-3 min-h-0 flex-1 divide-y divide-slate-200 overflow-auto">
                {filteredItems.map((item) => (
                  <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                    <QueueItemButton
                      item={item}
                      isSelected={selectedItem?.id === item.id}
                      onSelect={() => setSelectedItemId(item.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="panel-section min-h-[28rem] overflow-auto">
            <h2 className="section-heading">Item detail</h2>
            {selectedItem ? (
              <HealthQueueDetail item={selectedItem} projectId={projectId} />
            ) : (
              <p className="mt-3 text-sm text-slate-500">Select a health queue item.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function SourceState({ queue }: { queue: ProjectHealthQueueResponseDto }) {
  return (
    <dl className="grid min-w-0 shrink-0 grid-cols-3 gap-2 text-xs sm:min-w-[24rem]">
      <SourceStateValue
        label="Index"
        value={queue.sourceState.latestIndexRunStatus ?? "none"}
        detail={queue.sourceState.latestIndexRunId}
      />
      <SourceStateValue
        label="Graph"
        value={queue.sourceState.latestProjectGraphStatus ?? "none"}
        detail={queue.sourceState.hasProjectGraph ? queue.sourceState.latestProjectGraphVersionId : null}
      />
      <SourceStateValue
        label="Concepts"
        value={queue.sourceState.latestConceptGraphStatus ?? "none"}
        detail={queue.sourceState.hasConceptGraph ? queue.sourceState.latestConceptGraphVersionId : null}
      />
    </dl>
  );
}

function SourceStateValue({
  detail,
  label,
  value
}: {
  detail: string | null;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-l border-slate-200 pl-3 first:border-l-0 first:pl-0">
      <dt className="truncate text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-900">{value}</dd>
      <dd className="truncate text-slate-400">{detail ?? "not available"}</dd>
    </div>
  );
}

function QueueItemButton({
  isSelected,
  item,
  onSelect
}: {
  isSelected: boolean;
  item: HealthQueueItemDto;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={
        isSelected
          ? "w-full rounded border border-slate-900 bg-slate-900 p-2 text-left text-sm text-white"
          : "w-full rounded border border-slate-200 bg-white p-2 text-left text-sm text-slate-700 hover:bg-slate-50"
      }
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">{item.title}</span>
          <span className="mt-1 block truncate text-xs opacity-80">
            {item.family} / {item.kind}
          </span>
        </span>
        <span className="shrink-0 rounded border border-current px-1.5 py-0.5 text-xs uppercase opacity-80">
          {item.severity}
        </span>
      </span>
      <span className="mt-2 line-clamp-2 text-xs opacity-80">{item.detail}</span>
    </button>
  );
}

function HealthQueueDetail({
  item,
  projectId
}: {
  item: HealthQueueItemDto;
  projectId: string;
}) {
  return (
    <div className="mt-3 grid gap-4 text-sm">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-medium text-slate-950">{item.title}</h3>
        <p className="mt-1 text-slate-700">{item.detail}</p>
      </div>

      <div className="grid gap-1 text-xs">
        <StatusLine label="Family" value={item.family} />
        <StatusLine label="Kind" value={item.kind} />
        <StatusLine label="Severity" value={item.severity} />
        <StatusLine label="Target" value={targetLabel(item)} />
      </div>

      <DetailSection title="Evidence">
        {item.evidence.length === 0 ? (
          <p className="text-sm text-slate-500">No evidence recorded.</p>
        ) : (
          <ul className="grid gap-2">
            {item.evidence.map((evidence, index) => (
              <li key={`${evidence.kind}:${index}`} className="min-w-0 border-l border-slate-200 pl-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{evidence.label}</div>
                    <div className="mt-1 text-slate-700">{evidence.detail}</div>
                  </div>
                  <div className="shrink-0 text-xs text-slate-500">{evidence.kind}</div>
                </div>
                {typeof evidence.confidence === "number" ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Confidence {formatPercent(evidence.confidence)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      {item.diagnostics.length > 0 ? (
        <DetailSection title="Diagnostics">
          <DiagnosticList diagnostics={item.diagnostics} />
        </DetailSection>
      ) : null}

      <DetailSection title="Actions">
        <div className="flex flex-wrap gap-2">
          {item.actions.map((action, index) => (
            <HealthQueueActionLink
              key={`${action.kind}:${index}`}
              action={action}
              projectId={projectId}
            />
          ))}
        </div>
      </DetailSection>
    </div>
  );
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function HealthQueueActionLink({
  action,
  projectId
}: {
  action: HealthQueueActionDto;
  projectId: string;
}) {
  switch (action.kind) {
    case "open_spec":
      return (
        <Link
          className="button-secondary"
          to="/projects/$projectId/entities/$entityId"
          params={{ projectId, entityId: action.entityId }}
          search={{ q: undefined }}
        >
          {action.label}
        </Link>
      );
    case "open_readiness":
      return (
        <Link className="button-secondary" to="/projects/$projectId/readiness" params={{ projectId }}>
          {action.label}
        </Link>
      );
    case "open_impact":
      return (
        <Link
          className="button-secondary"
          to="/projects/$projectId/impact/$entityId"
          params={{ projectId, entityId: action.entityId }}
          search={{ depth: 1, direction: "both", includeSource: true }}
        >
          {action.label}
        </Link>
      );
    case "open_concept":
      return (
        <Link
          className="button-secondary"
          to="/projects/$projectId/concepts"
          params={{ projectId }}
          search={{ conceptId: action.conceptId }}
        >
          {action.label}
        </Link>
      );
    case "open_project_graph":
      return (
        <Link
          className="button-secondary"
          to="/projects/$projectId/graph"
          params={{ projectId }}
          search={{ nodeId: undefined, q: action.q }}
        >
          {action.label}
        </Link>
      );
    case "open_graph_node":
      return (
        <Link
          className="button-secondary"
          to="/projects/$projectId/graph"
          params={{ projectId }}
          search={{ nodeId: action.graphNodeId, q: undefined }}
        >
          {action.label}
        </Link>
      );
    case "open_analyze_run":
      return (
        <Link
          className="button-secondary"
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: undefined }}
        >
          {action.label}
        </Link>
      );
  }
}

function Diagnostics({ diagnostics }: { diagnostics: HealthQueueDiagnosticDto[] }) {
  return (
    <section className="panel-section mb-3 text-sm">
      <h2 className="section-heading">Diagnostics</h2>
      <div className="mt-2">
        <DiagnosticList diagnostics={diagnostics} />
      </div>
    </section>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: HealthQueueDiagnosticDto[] }) {
  return (
    <ul className="grid gap-2">
      {diagnostics.map((diagnostic) => (
        <li key={`${diagnostic.level}:${diagnostic.code}`} className="min-w-0 text-slate-700">
          <span className={diagnosticLevelClass(diagnostic.level)}>{diagnostic.level}</span>{" "}
          <span className="font-medium text-slate-900">{diagnostic.code}</span>
          <span>: {diagnostic.message}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <div className="truncate text-slate-500">{label}</div>
      <div className="truncate font-medium text-slate-800">{value}</div>
    </div>
  );
}

function diagnosticLevelClass(level: HealthQueueDiagnosticDto["level"]) {
  if (level === "error") {
    return "font-medium text-red-700";
  }

  if (level === "warning") {
    return "font-medium text-amber-700";
  }

  return "font-medium text-slate-600";
}

function targetLabel(item: HealthQueueItemDto) {
  const target = item.primaryTarget;

  if (target.kind === "spec") {
    return `${target.entityId} / ${target.type} / ${target.status}`;
  }

  if (target.kind === "source") {
    return [target.path, target.symbolName].filter(Boolean).join(" / ");
  }

  return `${target.conceptKey} / ${target.conceptType}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
