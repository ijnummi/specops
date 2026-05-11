import { Link } from "@tanstack/react-router";

export function SourceImportPage({ projectId }: { projectId: string }) {
  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Import from source</h1>
          <p className="truncate text-sm text-slate-600">Review source-derived spec proposals.</p>
        </div>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: undefined }}
          className="button-secondary"
        >
          Back to project
        </Link>
      </div>
    </main>
  );
}
