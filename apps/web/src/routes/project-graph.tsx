import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { projectGraphNodeQuery, projectGraphQuery } from "../api/queries.js";

type ProjectGraphPageProps = {
  projectId: string;
};

export function ProjectGraphPage({ projectId }: ProjectGraphPageProps) {
  const graph = useQuery(projectGraphQuery(projectId, { limit: 50 }));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedVisibleNode = graph.data?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const effectiveNodeId = selectedVisibleNode?.id ?? graph.data?.nodes[0]?.id ?? null;
  const nodeDetail = useQuery(projectGraphNodeQuery(projectId, effectiveNodeId));
  const nodeCounts = useMemo(() => countEntries(graph.data?.nodeCounts ?? {}), [graph.data]);
  const edgeCounts = useMemo(() => countEntries(graph.data?.edgeCounts ?? {}), [graph.data]);

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-auto p-4 lg:overflow-hidden">
      <div className="mb-4 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Project graph</h1>
          <p className="truncate text-sm text-slate-600">
            Scanner-derived graph facts for project {projectId}
          </p>
        </div>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: undefined }}
          className="button-secondary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to project
        </Link>
      </div>

      {graph.error ? (
        <p className="panel-section text-sm text-red-700">{graph.error.message}</p>
      ) : graph.isLoading ? (
        <p className="panel-section text-sm text-slate-500">Loading project graph...</p>
      ) : graph.data ? (
        graph.data.nodes.length === 0 ? (
          <section className="panel-section text-sm text-slate-600">
            <h2 className="section-heading">Current graph</h2>
            <p className="mt-2">{graph.data.version.summary}</p>
            <div className="mt-3 grid gap-1 text-xs">
              <StatusLine label="Status" value={graph.data.version.status} />
              <StatusLine label="Index run" value={graph.data.version.indexRunId ?? "none"} />
            </div>
            <CountList title="Nodes" counts={nodeCounts} />
            <CountList title="Edges" counts={edgeCounts} />
            <Diagnostics diagnostics={graph.data.version.diagnostics} />
            <p className="mt-3 text-slate-500">No graph nodes were found.</p>
          </section>
        ) : (
          <div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="panel-section min-h-0 overflow-auto">
              <h2 className="section-heading">Current graph</h2>
              <p className="mt-2 text-sm text-slate-600">{graph.data.version.summary}</p>
              <div className="mt-3 grid gap-1 text-xs">
                <StatusLine label="Status" value={graph.data.version.status} />
                <StatusLine label="Index run" value={graph.data.version.indexRunId ?? "none"} />
              </div>
              <CountList title="Nodes" counts={nodeCounts} />
              <CountList title="Edges" counts={edgeCounts} />
              <Diagnostics diagnostics={graph.data.version.diagnostics} />
            </aside>

            <section className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="panel-section min-h-0 overflow-auto">
                <h2 className="section-heading">Node sample</h2>
                <ul className="mt-3 grid gap-2">
                  {graph.data.nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        aria-pressed={node.id === effectiveNodeId}
                        className={
                          node.id === effectiveNodeId
                            ? "w-full rounded border border-slate-900 bg-slate-900 p-2 text-left text-sm text-white"
                            : "w-full rounded border border-slate-200 p-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        }
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        <span className="block truncate font-medium">{node.label}</span>
                        <span className="block truncate text-xs opacity-80">{node.nodeKey}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel-section min-h-0 overflow-auto">
                <h2 className="section-heading">Node detail</h2>
                {nodeDetail.error ? (
                  <p className="mt-3 text-sm text-red-700">{nodeDetail.error.message}</p>
                ) : nodeDetail.isLoading ? (
                  <p className="mt-3 text-sm text-slate-500">Loading node...</p>
                ) : nodeDetail.data ? (
                  <div className="mt-3 grid gap-3 text-sm">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium text-slate-900">
                        {nodeDetail.data.node.label}
                      </h3>
                      <p className="truncate text-xs text-slate-500">
                        {nodeDetail.data.node.nodeKey}
                      </p>
                    </div>
                    <div className="grid gap-1 text-xs">
                      <StatusLine label="Type" value={nodeDetail.data.node.nodeType} />
                      <StatusLine label="Path" value={nodeDetail.data.node.path ?? "none"} />
                      <StatusLine
                        label="Confidence"
                        value={formatConfidence(nodeDetail.data.node.confidence)}
                      />
                    </div>
                    <EdgeGroup title="Incoming" groups={nodeDetail.data.incomingEdges} />
                    <EdgeGroup title="Outgoing" groups={nodeDetail.data.outgoingEdges} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">Select a graph node.</p>
                )}
              </div>
            </section>
          </div>
        )
      ) : (
        <p className="panel-section text-sm text-slate-500">Project graph is unavailable.</p>
      )}
    </main>
  );
}

function CountList({ title, counts }: { title: string; counts: Array<[string, number]> }) {
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {counts.length > 0 ? (
        <div className="mt-2 grid gap-1 text-xs">
          {counts.map(([key, value]) => (
            <StatusLine key={key} label={key} value={String(value)} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">None</p>
      )}
    </div>
  );
}

function Diagnostics({
  diagnostics
}: {
  diagnostics: Array<{ code: string; level: string; message: string }>;
}) {
  if (diagnostics.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">No graph warnings</p>;
  }

  return (
    <ul className="mt-3 grid gap-2">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.level}-${diagnostic.code}`}
          className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
        >
          <span className="block truncate font-medium">{diagnostic.code}</span>
          <span className="block">{diagnostic.message}</span>
        </li>
      ))}
    </ul>
  );
}

function EdgeGroup({ title, groups }: { title: string; groups: Record<string, unknown[]> }) {
  const grouped = Object.entries(groups)
    .map(([key, value]) => [key, Array.isArray(value) ? value.length : 0] as [string, number])
    .sort(([left], [right]) => left.localeCompare(right));

  return <CountList title={title} counts={grouped} />;
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="truncate text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function countEntries(value: Record<string, unknown>): Array<[string, number]> {
  return Object.entries(value)
    .map(([key, count]) => [key, typeof count === "number" ? count : 0] as [string, number])
    .sort(([left], [right]) => left.localeCompare(right));
}

function formatConfidence(value: number | null) {
  return value === null ? "unknown" : value.toFixed(2);
}
