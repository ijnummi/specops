import { Link } from "@tanstack/react-router";
import type { SpecLinkDto } from "@specops/contracts";

type LinkPanelsProps = {
  projectId: string;
  currentEntityId?: string;
  query?: string;
  outgoing: SpecLinkDto[];
  backlinks: SpecLinkDto[];
  className?: string;
  onBeforeSelect?: () => boolean;
};

export function LinkPanels({
  projectId,
  currentEntityId,
  query = "",
  outgoing,
  backlinks,
  className,
  onBeforeSelect
}: LinkPanelsProps) {
  return (
    <div className={`grid gap-3 xl:grid-cols-2 ${className ?? ""}`} data-testid="link-panels">
      <LinkGroup
        projectId={projectId}
        currentEntityId={currentEntityId}
        query={query}
        title="Outgoing"
        links={outgoing}
        direction="outgoing"
        onBeforeSelect={onBeforeSelect}
      />
      <LinkGroup
        projectId={projectId}
        currentEntityId={currentEntityId}
        query={query}
        title="Backlinks"
        links={backlinks}
        direction="backlink"
        onBeforeSelect={onBeforeSelect}
      />
    </div>
  );
}

function LinkGroup({
  projectId,
  currentEntityId,
  query,
  title,
  links,
  direction,
  onBeforeSelect
}: {
  projectId: string;
  currentEntityId?: string;
  query: string;
  title: string;
  links: SpecLinkDto[];
  direction: "outgoing" | "backlink";
  onBeforeSelect?: () => boolean;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="text-xs text-slate-500">{links.length}</span>
      </div>
      {links.length > 0 ? (
        <ul className="grid min-h-0 gap-2 overflow-auto">
          {links.map((link) => {
            const targetEntityId = direction === "outgoing" ? link.toEntityId : link.fromEntityId;

            return (
              <li key={link.id} className="rounded border border-slate-100 bg-slate-50 p-2 text-xs">
                <Link
                  to="/projects/$projectId/entities/$entityId"
                  params={{ projectId, entityId: targetEntityId }}
                  search={{ q: query }}
                  onClick={(event) => {
                    if (
                      targetEntityId !== currentEntityId &&
                      onBeforeSelect &&
                      !onBeforeSelect()
                    ) {
                      event.preventDefault();
                    }
                  }}
                  className="block truncate font-medium text-slate-800 underline-offset-2 hover:text-slate-950 hover:underline"
                >
                  {targetEntityId}
                </Link>
                <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-slate-500">
                  <span className="truncate">{link.linkType}</span>
                  <span className="truncate">{link.source}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No links.</p>
      )}
    </section>
  );
}
