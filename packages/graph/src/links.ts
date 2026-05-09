export interface GraphEntity {
  entityId: string;
}

export interface GraphLink {
  fromEntityId: string;
  toEntityId: string;
  linkType?: string;
  source?: string;
}

export function findOutgoingLinks<TLink extends GraphLink>(
  entityId: string,
  links: readonly TLink[],
): TLink[] {
  return links.filter((link) => link.fromEntityId === entityId);
}

export function findBacklinks<TLink extends GraphLink>(
  entityId: string,
  links: readonly TLink[],
): TLink[] {
  return links.filter((link) => link.toEntityId === entityId);
}

export function findBrokenLinks<TEntity extends GraphEntity, TLink extends GraphLink>(
  entities: readonly TEntity[],
  links: readonly TLink[],
): TLink[] {
  const entityIds = new Set(entities.map((entity) => entity.entityId));

  return links.filter((link) => !entityIds.has(link.toEntityId));
}

export function findOrphanEntities<TEntity extends GraphEntity, TLink extends GraphLink>(
  entities: readonly TEntity[],
  links: readonly TLink[],
): TEntity[] {
  const linkedEntityIds = new Set<string>();

  for (const link of links) {
    linkedEntityIds.add(link.fromEntityId);
    linkedEntityIds.add(link.toEntityId);
  }

  return entities.filter((entity) => !linkedEntityIds.has(entity.entityId));
}
