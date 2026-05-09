import { Link } from "@tanstack/react-router";
import type { SpecEntityDto } from "@specops/contracts";

type EntityListProps = {
  projectId: string;
  entities: SpecEntityDto[];
  selectedEntityId: string | null;
  query: string;
  onBeforeSelect?: () => boolean;
};

const typeOrder = [
  "use_case",
  "domain_entity",
  "data_model",
  "interface",
  "ui_view",
  "agent_task",
  "adr"
];

export function EntityList({
  projectId,
  entities,
  selectedEntityId,
  query,
  onBeforeSelect
}: EntityListProps) {
  const grouped = groupEntities(entities);

  if (entities.length === 0) {
    return <p className="p-3 text-sm text-slate-500">No entities match the current view.</p>;
  }

  return (
    <nav className="min-h-0 flex-1 overflow-auto p-2">
      {grouped.map(([type, typeEntities]) => (
        <section
          key={type}
          className="mb-3 border-t border-slate-200 pt-2 first:border-t-0 first:pt-0"
        >
          <div className="mb-1 flex items-center justify-between gap-2 rounded bg-slate-100 px-2 py-1.5">
            <h2 className="truncate text-xs font-semibold uppercase text-slate-600">
              {formatType(type)}
            </h2>
            <span className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-500">
              {typeEntities.length}
            </span>
          </div>
          <div className="grid gap-1">
            {typeEntities.map((entity) => (
              <Link
                key={entity.id}
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: entity.entityId }}
                search={{ q: query }}
                onClick={(event) => {
                  if (entity.entityId !== selectedEntityId && onBeforeSelect && !onBeforeSelect()) {
                    event.preventDefault();
                  }
                }}
                className={
                  entity.entityId === selectedEntityId
                    ? "entity-row border-slate-300 bg-slate-100"
                    : "entity-row border-transparent hover:border-slate-200 hover:bg-slate-50"
                }
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {entity.title}
                  </span>
                  <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    {entity.status}
                  </span>
                </span>
                <span className="truncate text-xs text-slate-500">{entity.entityId}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

function groupEntities(entities: SpecEntityDto[]) {
  const groups = new Map<string, SpecEntityDto[]>();
  for (const entity of entities) {
    const group = groups.get(entity.type) ?? [];
    group.push(entity);
    groups.set(entity.type, group);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    const aIndex = typeOrder.indexOf(a);
    const bIndex = typeOrder.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

function formatType(type: string) {
  return type.replace(/_/g, " ");
}
