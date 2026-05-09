import type { SpecLinkDto } from "@specops/contracts";

type LinkPanelsProps = {
  outgoing: SpecLinkDto[];
  backlinks: SpecLinkDto[];
};

export function LinkPanels({ outgoing, backlinks }: LinkPanelsProps) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <LinkGroup title="Outgoing" links={outgoing} direction="outgoing" />
      <LinkGroup title="Backlinks" links={backlinks} direction="backlink" />
    </div>
  );
}

function LinkGroup({
  title,
  links,
  direction
}: {
  title: string;
  links: SpecLinkDto[];
  direction: "outgoing" | "backlink";
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="text-xs text-slate-500">{links.length}</span>
      </div>
      {links.length > 0 ? (
        <ul className="grid gap-2">
          {links.map((link) => (
            <li key={link.id} className="rounded border border-slate-100 bg-slate-50 p-2 text-xs">
              <div className="truncate font-medium text-slate-800">
                {direction === "outgoing" ? link.toEntityId : link.fromEntityId}
              </div>
              <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-slate-500">
                <span className="truncate">{link.linkType}</span>
                <span className="truncate">{link.source}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No links.</p>
      )}
    </section>
  );
}
