import type { EntityImpactResponseDto } from "@specops/contracts";

export type ImpactSpecColumns = {
  upstreamEntityIds: string[];
  downstreamEntityIds: string[];
  otherEntityIds: string[];
};

export function impactSpecColumns(impact: EntityImpactResponseDto): ImpactSpecColumns {
  const rootEntityId = impact.rootEntity.entityId;
  const specEntityIds = new Set(
    impact.nodes
      .filter((node) => node.kind === "spec")
      .map((node) => node.entityId)
      .filter((entityId) => entityId !== rootEntityId)
  );
  const upstreamEntityIds = reachableSpecEntityIds(impact, rootEntityId, "upstream");
  const downstreamEntityIds = reachableSpecEntityIds(impact, rootEntityId, "downstream");
  const classifiedEntityIds = new Set([...upstreamEntityIds, ...downstreamEntityIds]);
  const otherEntityIds = [...specEntityIds]
    .filter((entityId) => !classifiedEntityIds.has(entityId))
    .sort((left, right) => left.localeCompare(right));

  return {
    upstreamEntityIds,
    downstreamEntityIds,
    otherEntityIds
  };
}

function reachableSpecEntityIds(
  impact: EntityImpactResponseDto,
  rootEntityId: string,
  direction: "upstream" | "downstream"
) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of impact.edges) {
    if (edge.kind !== "spec_link") {
      continue;
    }

    const from = direction === "downstream" ? edge.fromEntityId : edge.toEntityId;
    const to = direction === "downstream" ? edge.toEntityId : edge.fromEntityId;
    const next = adjacency.get(from) ?? new Set<string>();
    next.add(to);
    adjacency.set(from, next);
  }

  const visited = new Set<string>();
  const queue = [rootEntityId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextEntityIds = [...(adjacency.get(current) ?? [])].sort((left, right) =>
      left.localeCompare(right)
    );

    for (const nextEntityId of nextEntityIds) {
      if (nextEntityId === rootEntityId || visited.has(nextEntityId)) {
        continue;
      }

      visited.add(nextEntityId);
      queue.push(nextEntityId);
    }
  }

  return [...visited].sort((left, right) => left.localeCompare(right));
}
