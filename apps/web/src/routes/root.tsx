import { Link, Outlet } from "@tanstack/react-router";
import { Boxes, Database } from "lucide-react";

export function RootRoute() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-950">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Boxes className="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />
            <span className="truncate">SpecOps Workbench</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2">
            <Link
              to="/admin/database"
              search={{ table: undefined, mode: "schema", rowId: undefined }}
              className="inline-flex h-8 items-center gap-2 rounded border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              Admin
            </Link>
            <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
              Markdown source
            </span>
          </nav>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
