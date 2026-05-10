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
  maxPaths?: number;
};

type ResolvedImpactLimits = Required<ImpactLimits>;

const defaultLimits: ResolvedImpactLimits = {
  maxSpecNodes: 150,
  maxSpecEdges: 400,
  maxSourceEvidence: 300,
  maxPaths: 600
};

type Direction = "upstream" | "downstream";
type TruncationReason = "path_limit" | "source_evidence_limit" | "spec_edge_limit" | "spec_node_limit";

export function buildEntityImpact(input: BuildEntityImpactInput): EntityImpactResponseDto {
  const limits = { ...defaultLimits, ...input.limits };
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
  let truncatedReason: TruncationReason | null = null;

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

    truncatedReason = chooseTruncationReason(truncatedReason, paths.truncatedReason);

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
    truncatedReason = chooseTruncationReason(truncatedReason, "source_evidence_limit");
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
    id: `source-evidence:${sourceEvidenceIdentity(evidence)}`,
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
  limits: ResolvedImpactLimits;
  includedEntityIds: Set<string>;
  includedLinkKeys: Set<string>;
}): { paths: EntityImpactResponseDto["upstreamPaths"]; truncatedReason: TruncationReason | null } {
  const maxDepth = input.depth === "all" ? Number.POSITIVE_INFINITY : Number(input.depth);
  const queue = [
    {
      entityId: input.rootEntityId,
      pathEntityIds: [input.rootEntityId],
      linkTypes: [] as string[]
    }
  ];
  const paths: EntityImpactResponseDto["upstreamPaths"] = [];
  let truncatedReason: TruncationReason | null = null;

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

      if (paths.length >= input.limits.maxPaths) {
        truncatedReason = chooseTruncationReason(truncatedReason, "path_limit");
        continue;
      }

      const needsEntityAdmission = !input.includedEntityIds.has(nextEntityId);
      const needsLinkAdmission = !input.includedLinkKeys.has(linkKey(link));

      if (needsEntityAdmission) {
        if (input.includedEntityIds.size >= input.limits.maxSpecNodes) {
          truncatedReason = chooseTruncationReason(truncatedReason, "spec_node_limit");
          continue;
        }
      }

      if (needsLinkAdmission) {
        if (input.includedLinkKeys.size >= input.limits.maxSpecEdges) {
          truncatedReason = chooseTruncationReason(truncatedReason, "spec_edge_limit");
          continue;
        }
      }

      if (needsEntityAdmission) {
        input.includedEntityIds.add(nextEntityId);
      }

      if (needsLinkAdmission) {
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

  return { paths, truncatedReason };
}

function specNodeId(entityId: string) {
  return `spec:${entityId}`;
}

function sourceNodeId(evidence: ImpactSourceEvidenceDto) {
  return `source:${sourceEvidenceIdentity(evidence)}`;
}

function sourceEvidenceIdentity(evidence: ImpactSourceEvidenceDto) {
  return [
    evidence.filePath,
    evidence.sourceFileId,
    evidence.symbolName,
    evidence.symbolLine ?? "null",
    evidence.annotationLine ?? "null",
    evidence.entityId
  ].join(":");
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
    left.symbolName.localeCompare(right.symbolName) ||
    left.sourceFileId.localeCompare(right.sourceFileId) ||
    compareNullableNumbers(left.symbolLine, right.symbolLine) ||
    compareNullableNumbers(left.annotationLine, right.annotationLine)
  );
}

function chooseTruncationReason(
  current: TruncationReason | null,
  next: TruncationReason | null
) {
  if (!next) {
    return current;
  }
  if (!current || truncationReasonPriority[next] > truncationReasonPriority[current]) {
    return next;
  }
  return current;
}

const truncationReasonPriority: Record<TruncationReason, number> = {
  path_limit: 1,
  source_evidence_limit: 2,
  spec_edge_limit: 3,
  spec_node_limit: 4
};

function compareNullableNumbers(left: number | null, right: number | null) {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return left - right;
}
