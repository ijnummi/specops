import { useMemo, useState } from "react";
import type {
  SystemMapAreaDto,
  SystemMapAreaType,
  SystemMapResponseDto
} from "@specops/contracts";

type SystemMapReviewPanelProps = {
  map: SystemMapResponseDto;
  selectedAreaId?: string | null;
  onSelectArea?: (areaId: string) => void;
};

const areaTypeLabels: Record<SystemMapAreaType, string> = {
  backend_routes: "Backend routes",
  backend_services: "Backend services",
  frontend_routes: "Frontend routes",
  frontend_components: "Frontend components",
  data_models: "Data models",
  tests: "Tests",
  config: "Configuration",
  packages: "Packages",
  unknown: "Unknown"
};

export function SystemMapReviewPanel({
  map,
  onSelectArea,
  selectedAreaId
}: SystemMapReviewPanelProps) {
  const sortedAreas = useMemo(
    () => [...map.areas].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [map.areas]
  );
  const [internalSelectedAreaId, setInternalSelectedAreaId] = useState(sortedAreas[0]?.id ?? null);
  const effectiveSelectedAreaId =
    selectedAreaId !== undefined ? selectedAreaId : internalSelectedAreaId;
  const selectedArea =
    sortedAreas.find((area) => area.id === effectiveSelectedAreaId) ?? sortedAreas[0] ?? null;

  const selectArea = (areaId: string) => {
    setInternalSelectedAreaId(areaId);
    onSelectArea?.(areaId);
  };

  return (
    <section className="grid min-h-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="section-heading">System Map</h2>
        <p className="mt-2 text-sm text-slate-600">{map.snapshot.summary}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Metric label="Files" value={map.snapshot.coverage.sourceFileCount} />
          <Metric label="Mapped" value={map.snapshot.coverage.mappedSourceFileCount} />
          <Metric label="Open" value={map.snapshot.coverage.unmappedSourceFileCount} />
        </dl>

        {map.snapshot.diagnostics.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {map.snapshot.diagnostics.map((diagnostic) => (
              <li
                key={`${diagnostic.level}-${diagnostic.code}`}
                className={
                  diagnostic.level === "warning"
                    ? "rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
                    : "rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                }
              >
                {diagnostic.message}
              </li>
            ))}
          </ul>
        ) : null}

        {sortedAreas.length > 0 ? (
          <div className="mt-3 grid gap-1">
            {sortedAreas.map((area) => {
              const selected = area.id === selectedArea?.id;

              return (
                <button
                  key={area.id}
                  type="button"
                  className={
                    selected
                      ? "rounded border border-slate-900 bg-slate-900 px-2 py-2 text-left text-sm text-white"
                      : "rounded border border-slate-200 px-2 py-2 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }
                  onClick={() => selectArea(area.id)}
                >
                  <span className="block truncate font-medium">{area.name}</span>
                  <span className={selected ? "text-slate-200" : "text-slate-500"}>
                    {formatCount(area.keyFiles.length, "file", "files")} |{" "}
                    {formatCount(area.relatedProposalIds.length, "draft", "drafts")}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </aside>

      <div className="min-w-0 rounded border border-slate-200 bg-white p-3 shadow-sm">
        {selectedArea ? <AreaDetail area={selectedArea} /> : <EmptyMapDetail />}
      </div>
    </section>
  );
}

function AreaDetail({ area }: { area: SystemMapAreaDto }) {
  return (
    <div className="grid gap-4">
      <div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-base font-semibold text-slate-950">{area.name}</h2>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {areaTypeLabels[area.areaType]}
          </span>
          {area.confidence !== null ? (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {Math.round(area.confidence * 100)}% confidence
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-600">{area.summary}</p>
      </div>

      {area.diagnostics.length > 0 ? (
        <ul className="grid gap-2">
          {area.diagnostics.map((diagnostic) => (
            <li
              key={`${diagnostic.level}-${diagnostic.code}`}
              className={
                diagnostic.level === "warning"
                  ? "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  : "rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              }
            >
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}

      <DetailList title="Key files" items={area.keyFiles} />
      <DetailList title="Key symbols" items={area.keySymbols} />

      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">Source evidence</h3>
        {area.evidence.length > 0 ? (
          <ul className="mt-2 grid gap-2">
            {area.evidence.map((item, index) => (
              <li
                key={`${item.sourceFilePath}-${item.symbolName ?? "file"}-${index}`}
                className="min-w-0 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <span className="break-all font-medium text-slate-900">
                  {item.sourceFilePath}
                </span>
                {item.symbolName ? <span> | {item.symbolName}</span> : null}
                {item.startLine ? <span> | line {item.startLine}</span> : null}
                <span> | {item.relationship}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No source evidence recorded.</p>
        )}
      </div>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item}
              className="min-w-0 max-w-full break-all rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">None recorded.</p>
      )}
    </div>
  );
}

function EmptyMapDetail() {
  return <p className="text-sm text-slate-500">No system map areas are available.</p>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-slate-50 p-2">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
