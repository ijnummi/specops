import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  EntityImpactQuery,
  ImpactDepth,
  ImpactDirection,
  ImpactNodeDto
} from "@specops/contracts";
import { ArrowLeft, FileText } from "lucide-react";

import { entityImpactQuery } from "../api/queries.js";
import { ImpactBrief } from "../components/impact-brief.js";
import { ImpactGraph } from "../components/impact-graph.js";
import { ImpactTracePanel } from "../components/impact-trace-panel.js";

type ImpactPageProps = {
  projectId: string;
  entityId: string;
  depth: ImpactSearchDepth;
  direction: ImpactDirection;
  includeSource: boolean;
};

export type ImpactSearchDepth = 1 | 2 | "all";

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

export function ImpactPage({
  projectId,
  entityId,
  depth,
  direction,
  includeSource
}: ImpactPageProps) {
  const navigate = useNavigate();
  const apiDepth = impactDepthForApi(depth);
  const queryInput: EntityImpactQuery = { depth: apiDepth, direction, includeSource };
  const impact = useQuery(entityImpactQuery(projectId, entityId, queryInput));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = useMemo<ImpactNodeDto | null>(
    () => impact.data?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [impact.data?.nodes, selectedNodeId]
  );

  function updateSearch(
    next: Partial<{
      depth: ImpactSearchDepth;
      direction: ImpactDirection;
      includeSource: boolean;
    }>
  ) {
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
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-auto p-4 lg:overflow-hidden">
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
        <div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
            <ImpactGraph
              impact={impact.data}
              selectedNodeId={selectedNodeId}
              onSelectNode={(node) => setSelectedNodeId(node.id)}
            />
            <ImpactTracePanel impact={impact.data} />
          </section>
          <ImpactBrief projectId={projectId} impact={impact.data} selectedNode={selectedNode} />
        </div>
      ) : null}
    </main>
  );
}
