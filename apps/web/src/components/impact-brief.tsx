import { Link } from "@tanstack/react-router";
import type { EntityImpactResponseDto, ImpactNodeDto } from "@specops/contracts";

type ImpactBriefProps = {
  projectId: string;
  impact: EntityImpactResponseDto;
  selectedNode: ImpactNodeDto | null;
};

export function ImpactBrief({ projectId, impact, selectedNode }: ImpactBriefProps) {
  return (
    <aside
      data-testid="impact-brief"
      className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3"
    >
      <h2 className="section-heading">Impact Brief</h2>
      {impact.truncated.isTruncated ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Results truncated: {impact.truncated.reason}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm lg:grid-cols-1">
        <Metric label="Upstream" value={impact.upstreamPaths.length} />
        <Metric label="Downstream" value={impact.downstreamPaths.length} />
        <Metric label="Source evidence" value={impact.sourceEvidence.length} />
      </dl>
      <section className="mt-4 border-t border-slate-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-800">Selection</h3>
        {selectedNode ? (
          <div className="mt-2 text-sm text-slate-700">
            <p className="font-medium">{selectedNode.label}</p>
            <p className="mt-1 text-xs text-slate-500">{selectedNode.kind}</p>
            {selectedNode.kind === "spec" ? (
              <Link
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: selectedNode.entityId }}
                search={{ q: undefined }}
                className="mt-3 inline-flex text-xs font-medium text-slate-800 underline"
              >
                Open spec
              </Link>
            ) : (
              <p className="mt-3 text-xs text-slate-600">{selectedNode.filePath}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Select a graph node for details.</p>
        )}
      </section>
      <section className="mt-4 border-t border-slate-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-800">Top paths</h3>
        <ul className="mt-2 grid gap-2 text-xs text-slate-600">
          {[...impact.upstreamPaths, ...impact.downstreamPaths].slice(0, 5).map((path) => (
            <li key={`${path.direction}-${path.entityIds.join(">")}`} className="rounded bg-slate-50 p-2">
              {path.entityIds.join(" -> ")}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50 p-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
