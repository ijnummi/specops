import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EntityImpactQuery, ImpactDepth, ImpactDirection } from "@specops/contracts";
import { ArrowLeft, FileText } from "lucide-react";

import { entityImpactQuery } from "../api/queries.js";

type ImpactPageProps = {
  projectId: string;
  entityId: string;
  depth: ImpactDepth;
  direction: ImpactDirection;
  includeSource: boolean;
};

export function ImpactPage({
  projectId,
  entityId,
  depth,
  direction,
  includeSource
}: ImpactPageProps) {
  const navigate = useNavigate();
  const queryInput: EntityImpactQuery = { depth, direction, includeSource };
  const impact = useQuery(entityImpactQuery(projectId, entityId, queryInput));

  function updateSearch(next: Partial<EntityImpactQuery>) {
    navigate({
      to: "/projects/$projectId/impact/$entityId",
      params: { projectId, entityId },
      search: {
        depth: next.depth ?? depth,
        direction: next.direction ?? direction,
        includeSource: next.includeSource ?? includeSource
      }
    });
  }

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-3 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {impact.data?.rootEntity.title ?? entityId}
          </h1>
          <p className="truncate text-sm text-slate-600">
            Impact view / {impact.data?.rootEntity.entityId ?? entityId}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="field min-w-32">
            <span>Depth</span>
            <select
              className="input h-9 py-1"
              value={depth}
              onChange={(event) => updateSearch({ depth: event.target.value as ImpactDepth })}
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
            Open Editor
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

      {impact.isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading impact...
        </div>
      ) : impact.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {impact.error.message}
        </div>
      ) : impact.data ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 text-sm text-slate-500">
              Graph canvas
            </div>
            <div className="border-t border-slate-200 p-3 text-sm text-slate-700">
              <h2 className="section-heading">Trace Details</h2>
              <p className="mt-2">
                Upstream {impact.data.upstreamPaths.length} / Downstream{" "}
                {impact.data.downstreamPaths.length} / Source {impact.data.sourceEvidence.length}
              </p>
              <ul className="mt-2 grid gap-1 text-xs text-slate-600">
                {impact.data.sourceEvidence.map((item) => (
                  <li key={`${item.entityId}-${item.filePath}-${item.symbolName}`}>
                    {item.filePath} / {item.symbolName}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <aside className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3">
            <h2 className="section-heading">Impact Brief</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Upstream</dt>
                <dd className="font-semibold">{impact.data.upstreamPaths.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Downstream</dt>
                <dd className="font-semibold">{impact.data.downstreamPaths.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Source evidence</dt>
                <dd className="font-semibold">{impact.data.sourceEvidence.length}</dd>
              </div>
            </dl>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
