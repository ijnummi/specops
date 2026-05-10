import type {
  EntityImpactResponseDto,
  ImpactDepth,
  ImpactDirection,
  ImpactSourceEvidenceDto
} from "@specops/contracts";

export type ImpactEntityInput = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
};

export type ImpactLinkInput = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type BuildEntityImpactInput = {
  rootEntityId: string;
  depth: ImpactDepth;
  direction: ImpactDirection;
  includeSource: boolean;
  entities: ImpactEntityInput[];
  links: ImpactLinkInput[];
  sourceEvidence: ImpactSourceEvidenceDto[];
  limits?: ImpactLimits;
};

type ImpactLimits = {
  maxSpecNodes: number;
  maxSpecEdges: number;
  maxSourceEvidence: number;
};

const defaultLimits: ImpactLimits = {
  maxSpecNodes: 150,
  maxSpecEdges: 400,
  maxSourceEvidence: 300
};

type Direction = "upstream" | "downstream";

export function buildEntityImpact(input: BuildEntityImpactInput): EntityImpactResponseDto {
  const limits = input.limits ?? defaultLimits;
  const entityById = new Map(input.entities.map((entity) => [entity.entityId, entity]));
  const rootEntity = entityById.get(input.rootEntityId);

  if (!rootEntity) {
    throw new Error(`Root entity not found: ${input.rootEntityId}`);
  }

  const directions: Direction[] =
    input.direction === "both" ? ["upstream", "downstream"] : [input.direction];
  const includedEntityIds = new Set<string>([input.rootEntityId]);
  const includedLinkKeys = new Set<string>();
  const upstreamPaths: EntityImpactResponseDto["upstreamPaths"] = [];
  const downstreamPaths: EntityImpactResponseDto["downstreamPaths"] = [];
  let truncatedReason: string | null = null;

  for (const direction of directions) {
    const paths = traverseDirection({
      direction,
      rootEntityId: input.rootEntityId,
      depth: input.depth,
      links: input.links,
      entityById,
      limits,
      includedEntityIds,
      includedLinkKeys
    });

    if (paths.truncatedReason && !truncatedReason) {
      truncatedReason = paths.truncatedReason;
    }

    if (direction === "upstream") {
      upstreamPaths.push(...paths.paths);
    } else {
      downstreamPaths.push(...paths.paths);
    }
  }

  const sortedEntities = [...includedEntityIds]
    .map((entityId) => entityById.get(entityId))
    .filter((entity): entity is ImpactEntityInput => Boolean(entity))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));

  let sourceEvidence = input.includeSource
    ? input.sourceEvidence
        .filter((evidence) => includedEntityIds.has(evidence.entityId))
        .sort(compareSourceEvidence)
    : [];

  if (sourceEvidence.length > limits.maxSourceEvidence) {
    sourceEvidence = sourceEvidence.slice(0, limits.maxSourceEvidence);
    truncatedReason ??= "source_evidence_limit";
  }

  const specNodes = sortedEntities.map((entity) => ({
    id: specNodeId(entity.entityId),
    kind: "spec" as const,
    label: entity.title,
    ...entity
  }));

  const sourceNodes = sourceEvidence.map((evidence) => ({
    id: sourceNodeId(evidence),
    kind: "source" as const,
    label: evidence.symbolName,
    entityId: evidence.entityId,
    filePath: evidence.filePath,
    symbolName: evidence.symbolName,
    symbolKind: evidence.symbolKind,
    symbolLine: evidence.symbolLine,
    annotationLine: evidence.annotationLine
  }));

  const specEdges = input.links
    .filter((link) => includedLinkKeys.has(linkKey(link)))
    .sort(compareLinks)
    .map((link) => ({
      id: `spec-link:${link.id}`,
      from: specNodeId(link.fromEntityId),
      to: specNodeId(link.toEntityId),
      kind: "spec_link" as const,
      label: link.linkType,
      fromEntityId: link.fromEntityId,
      toEntityId: link.toEntityId,
      linkType: link.linkType,
      source: link.source
    }));

  const sourceEdges = sourceEvidence.map((evidence) => ({
    id: `source-evidence:${evidence.filePath}:${evidence.symbolName}:${evidence.entityId}`,
    from: specNodeId(evidence.entityId),
    to: sourceNodeId(evidence),
    kind: "source_evidence" as const,
    label: "@specops",
    entityId: evidence.entityId,
    filePath: evidence.filePath,
    symbolName: evidence.symbolName
  }));

  return {
    rootEntity,
    nodes: [...specNodes, ...sourceNodes],
    edges: [...specEdges, ...sourceEdges],
    upstreamPaths,
    downstreamPaths,
    sourceEvidence,
    truncated: {
      isTruncated: Boolean(truncatedReason),
      reason: truncatedReason,
      nodeCount: specNodes.length + sourceNodes.length,
      edgeCount: specEdges.length + sourceEdges.length,
      sourceEvidenceCount: sourceEvidence.length
    }
  };
}

function traverseDirection(input: {
  direction: Direction;
  rootEntityId: string;
  depth: ImpactDepth;
  links: ImpactLinkInput[];
  entityById: Map<string, ImpactEntityInput>;
  limits: ImpactLimits;
  includedEntityIds: Set<string>;
  includedLinkKeys: Set<string>;
}): { paths: EntityImpactResponseDto["upstreamPaths"]; truncatedReason: string | null } {
  const maxDepth = input.depth === "all" ? Number.POSITIVE_INFINITY : Number(input.depth);
  const queue = [{ entityId: input.rootEntityId, pathEntityIds: [input.rootEntityId], linkTypes: [] as string[] }];
  const visited = new Set<string>([`${input.direction}:${input.rootEntityId}:0`]);
  const paths: EntityImpactResponseDto["upstreamPaths"] = [];
  let truncatedReason: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = current.pathEntityIds.length - 1;

    if (currentDepth >= maxDepth) {
      continue;
    }

    const nextLinks = input.links
      .filter((link) =>
        input.direction === "downstream"
          ? link.fromEntityId === current.entityId
          : link.toEntityId === current.entityId
      )
      .sort(compareLinks);

    for (const link of nextLinks) {
      const nextEntityId =
        input.direction === "downstream" ? link.toEntityId : link.fromEntityId;
      const nextEntity = input.entityById.get(nextEntityId);
      if (!nextEntity) {
        continue;
      }

      if (!input.includedEntityIds.has(nextEntityId)) {
        if (input.includedEntityIds.size >= input.limits.maxSpecNodes) {
          truncatedReason = "spec_node_limit";
          continue;
        }
        input.includedEntityIds.add(nextEntityId);
      }

      if (!input.includedLinkKeys.has(linkKey(link))) {
        if (input.includedLinkKeys.size >= input.limits.maxSpecEdges) {
          truncatedReason ??= "spec_edge_limit";
          continue;
        }
        input.includedLinkKeys.add(linkKey(link));
      }

      const nextPathEntityIds =
        input.direction === "downstream"
          ? [...current.pathEntityIds, nextEntityId]
          : [nextEntityId, ...current.pathEntityIds];
      const nextLinkTypes =
        input.direction === "downstream"
          ? [...current.linkTypes, link.linkType]
          : [link.linkType, ...current.linkTypes];

      paths.push({
        direction: input.direction,
        entityIds: nextPathEntityIds,
        steps: nextPathEntityIds.map((entityId) => {
          const entity = input.entityById.get(entityId)!;
          return {
            entityId: entity.entityId,
            title: entity.title,
            type: entity.type,
            status: entity.status
          };
        }),
        linkTypes: nextLinkTypes
      });

      if (!current.pathEntityIds.includes(nextEntityId)) {
        const visitKey = `${input.direction}:${nextEntityId}:${currentDepth + 1}`;
        if (!visited.has(visitKey)) {
          visited.add(visitKey);
          queue.push({
            entityId: nextEntityId,
            pathEntityIds:
              input.direction === "downstream"
                ? [...current.pathEntityIds, nextEntityId]
                : [nextEntityId, ...current.pathEntityIds],
            linkTypes: nextLinkTypes
          });
        }
      }
    }
  }

  return { paths, truncatedReason };
}

function specNodeId(entityId: string) {
  return `spec:${entityId}`;
}

function sourceNodeId(evidence: ImpactSourceEvidenceDto) {
  return `source:${evidence.filePath}:${evidence.symbolName}:${evidence.entityId}`;
}

function linkKey(link: Pick<ImpactLinkInput, "id">) {
  return link.id;
}

function compareLinks(left: ImpactLinkInput, right: ImpactLinkInput) {
  return (
    left.fromEntityId.localeCompare(right.fromEntityId) ||
    left.toEntityId.localeCompare(right.toEntityId) ||
    left.linkType.localeCompare(right.linkType) ||
    left.source.localeCompare(right.source) ||
    left.id.localeCompare(right.id)
  );
}

function compareSourceEvidence(left: ImpactSourceEvidenceDto, right: ImpactSourceEvidenceDto) {
  return (
    left.entityId.localeCompare(right.entityId) ||
    left.filePath.localeCompare(right.filePath) ||
    left.symbolName.localeCompare(right.symbolName)
  );
}
