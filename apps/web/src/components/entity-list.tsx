import { Link } from "@tanstack/react-router";
import type { SpecEntityDto } from "@specops/contracts";

type EntityListProps = {
  projectId: string;
  entities: SpecEntityDto[];
  selectedEntityId: string | null;
  query: string;
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

export function EntityList({ projectId, entities, selectedEntityId, query }: EntityListProps) {
  const grouped = groupEntities(entities);

  if (entities.length === 0) {
    return <p className="p-3 text-sm text-slate-500">No entities match the current view.</p>;
  }

  return (
    <nav className="max-h-[calc(100vh-360px)] overflow-auto p-2">
      {grouped.map(([type, typeEntities]) => (
        <section key={type} className="mb-3">
          <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatType(type)}
          </h2>
          <div className="grid gap-1">
            {typeEntities.map((entity) => (
              <Link
                key={entity.id}
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: entity.entityId }}
                search={{ q: query }}
                className={
                  entity.entityId === selectedEntityId
                    ? "entity-row border-slate-300 bg-slate-100"
                    : "entity-row border-transparent hover:border-slate-200 hover:bg-slate-50"
                }
              >
                <span className="truncate text-sm font-medium text-slate-900">{entity.title}</span>
                <span className="truncate text-xs text-slate-500">{entity.entityId}</span>
                <span className="truncate text-xs text-slate-500">{entity.status}</span>
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
