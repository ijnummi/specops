import { Link } from "@tanstack/react-router";
import type { EntitySearchResultDto } from "@specops/contracts";

type EntitySearchResultsProps = {
  projectId: string;
  query: string;
  results: EntitySearchResultDto[];
  selectedEntityId: string | null;
  variant: "compact" | "expanded";
  onBeforeSelect?: () => boolean;
};

export function EntitySearchResults({
  projectId,
  query,
  results,
  selectedEntityId,
  variant,
  onBeforeSelect
}: EntitySearchResultsProps) {
  if (results.length === 0) {
    const emptyMessage = (
      <>
        No results for <span className="font-medium text-slate-700">{query}</span>.
      </>
    );

    if (variant === "compact") {
      return <p className="p-3 text-sm text-slate-500">{emptyMessage}</p>;
    }

    return (
      <section className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">
        {emptyMessage}
      </section>
    );
  }

  const content = (
    <div className="grid gap-1">
      {results.map((result) => (
        <Link
          key={result.entityId}
          to="/projects/$projectId/entities/$entityId"
          params={{ projectId, entityId: result.entityId }}
          search={{ q: query }}
          onClick={(event) => {
            if (
              result.entityId !== selectedEntityId &&
              onBeforeSelect &&
              !onBeforeSelect()
            ) {
              event.preventDefault();
            }
          }}
          className={
            result.entityId === selectedEntityId
              ? "entity-row border-slate-300 bg-slate-100"
              : "entity-row border-transparent hover:border-slate-200 hover:bg-slate-50"
          }
        >
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-slate-900">{result.title}</span>
            <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {result.status}
            </span>
          </span>
          <span className="truncate text-xs text-slate-500">
            {result.entityId} · {result.type}
          </span>
          {result.snippet ? (
            <span className="line-clamp-2 text-xs text-slate-600">{result.snippet}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );

  if (variant === "compact") {
    return <nav className="min-h-0 flex-1 overflow-auto p-2">{content}</nav>;
  }

  return (
    <section className="rounded border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">Search results</h2>
        <p className="text-xs text-slate-500">
          {results.length} {results.length === 1 ? "result" : "results"}
        </p>
      </header>
      <nav className="p-2">{content}</nav>
    </section>
  );
}
