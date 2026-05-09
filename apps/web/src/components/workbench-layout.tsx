import type { ReactNode } from "react";

type WorkbenchLayoutProps = {
  title: string;
  subtitle: string;
  actions: ReactNode;
  sidebar: ReactNode;
  inspector: ReactNode;
  children: ReactNode;
};

export function WorkbenchLayout({
  title,
  subtitle,
  actions,
  sidebar,
  inspector,
  children
}: WorkbenchLayoutProps) {
  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <p className="truncate text-sm text-slate-600">{subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[310px_minmax(0,1fr)_300px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
          {sidebar}
        </aside>
        <section className="min-h-0 min-w-0 overflow-hidden">{children}</section>
        <aside className="min-h-0 overflow-auto rounded border border-slate-200 bg-white">
          {inspector}
        </aside>
      </div>
    </main>
  );
}
