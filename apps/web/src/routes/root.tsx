import { Link, Outlet } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

export function RootRoute() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Boxes className="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />
            <span className="truncate">SpecOps Workbench</span>
          </Link>
          <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
            Markdown source
          </span>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
