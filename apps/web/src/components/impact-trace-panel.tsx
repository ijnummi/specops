import type { EntityImpactResponseDto, ImpactPathDto } from "@specops/contracts";

export function ImpactTracePanel({ impact }: { impact: EntityImpactResponseDto }) {
  return (
    <section
      data-testid="impact-trace-panel"
      className="max-h-64 shrink-0 overflow-auto border-t border-slate-200 p-3"
    >
      <h2 className="section-heading">Trace Details</h2>
      <p className="mt-2 text-sm text-slate-700">
        Upstream {impact.upstreamPaths.length} / Downstream {impact.downstreamPaths.length} /
        Source {impact.sourceEvidence.length}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <PathList title="Upstream paths" paths={impact.upstreamPaths} />
        <PathList title="Downstream paths" paths={impact.downstreamPaths} />
        <section>
          <h3 className="text-sm font-semibold text-slate-800">Source evidence</h3>
          {impact.sourceEvidence.length > 0 ? (
            <ul className="mt-2 grid gap-2 text-xs text-slate-600">
              {impact.sourceEvidence.map((item) => (
                <li
                  key={sourceEvidenceKey(item)}
                  className="rounded border border-slate-100 bg-slate-50 p-2"
                >
                  <span className="font-medium text-slate-800">{item.symbolName}</span>
                  <span className="block truncate">{item.filePath}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No source evidence.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function PathList({ title, paths }: { title: string; paths: ImpactPathDto[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {paths.length > 0 ? (
        <ul className="mt-2 grid gap-2 text-xs text-slate-600">
          {paths.map((path, index) => (
            <li
              key={pathKey(path, index)}
              className="rounded border border-slate-100 bg-slate-50 p-2"
            >
              {path.entityIds.join(" -> ")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No paths.</p>
      )}
    </section>
  );
}

function pathKey(path: ImpactPathDto, index: number) {
  return [
    path.direction,
    path.entityIds.join(">"),
    path.linkTypes.join(">"),
    index.toString()
  ].join("|");
}

function sourceEvidenceKey(item: EntityImpactResponseDto["sourceEvidence"][number]) {
  return [
    item.sourceFileId,
    item.entityId,
    item.filePath,
    item.symbolName,
    String(item.symbolLine),
    String(item.annotationLine)
  ].join("|");
}
