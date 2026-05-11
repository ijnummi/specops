import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  ProjectReadinessDto,
  ProjectReadinessQueueItemDto,
  SpecReadinessStatus
} from "@specops/contracts";

import { projectReadinessQuery } from "../api/queries.js";

type QueueGroup = {
  status: Exclude<SpecReadinessStatus, "ready">;
  title: string;
};

const queueGroups: QueueGroup[] = [
  { status: "blocked", title: "Blocked" },
  { status: "needs_review", title: "Needs Review" },
  { status: "needs_context", title: "Needs Context" }
];

export function ReadinessPage({ projectId }: { projectId: string }) {
  const readiness = useQuery(projectReadinessQuery(projectId));

  if (readiness.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading readiness...</div>;
  }

  if (readiness.error) {
    return <div className="p-4 text-sm text-red-700">{readiness.error.message}</div>;
  }

  if (!readiness.data) {
    return <div className="p-4 text-sm text-slate-600">Readiness is unavailable.</div>;
  }

  return <ReadinessContent projectId={projectId} readiness={readiness.data} />;
}

function ReadinessContent({
  projectId,
  readiness
}: {
  projectId: string;
  readiness: ProjectReadinessDto;
}) {
  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header>
        <h1 className="text-base font-semibold text-slate-950">Spec Readiness</h1>
      </header>

      <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Summary</h2>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-4">
          <Metric label="Ready" value={readiness.summary.ready} />
          <Metric label="Blocked" value={readiness.summary.blocked} tone="danger" />
          <Metric label="Needs Review" value={readiness.summary.needsReview} tone="warning" />
          <Metric label="Needs Context" value={readiness.summary.needsContext} />
        </div>
      </section>

      <section className="grid gap-3">
        {queueGroups.map((group) => (
          <QueueGroupSection
            key={group.status}
            projectId={projectId}
            title={group.title}
            items={readiness.queue.filter((item) => item.readiness === group.status)}
          />
        ))}
      </section>
    </div>
  );
}

function QueueGroupSection({
  projectId,
  title,
  items
}: {
  projectId: string;
  title: string;
  items: ProjectReadinessQueueItemDto[];
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No specs in this group.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {items.map((item) => (
            <li key={item.entityId} className="py-3 first:pt-0 last:pb-0">
              <Link
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: item.entityId }}
                search={{ q: undefined }}
                className="block min-w-0 underline-offset-2 hover:text-slate-950 hover:underline"
              >
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {item.entityId} / {item.type} / {item.status}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-slate-500">
                    {item.failedCheckCount} failed checks
                  </div>
                </div>
                {item.topChecks[0] ? (
                  <div className="mt-2 text-sm text-slate-700">
                    <span className="font-medium">{item.topChecks[0].label}: </span>
                    <span>{item.topChecks[0].detail}</span>
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-950";

  return (
    <div className="min-w-0 border-l border-slate-200 pl-3 first:border-l-0 first:pl-0">
      <div className={`truncate text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="truncate text-xs text-slate-500">{label}</div>
    </div>
  );
}
