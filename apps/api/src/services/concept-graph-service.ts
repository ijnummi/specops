import {
  conceptDetailResponseSchema,
  conceptGraphLatestResponseSchema,
} from "@specops/contracts";
import type {
  BuildConceptGraphRequest,
  ConceptDetailResponse,
  ConceptGraphCoverage,
  ConceptGraphDiagnostic,
  ConceptGraphLatestResponse,
  ConceptGraphStatus,
  ProjectConceptDto,
  ProjectConceptMembershipDto,
  ProjectConceptRelationshipDto,
  ProjectConceptVersionDto,
  ProjectGraphNodeDto,
  ProjectGraphNodeType,
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  indexRuns,
  projectConceptMemberships,
  projectConceptRelationships,
  projectConceptVersions,
  projectConcepts,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  projects,
} from "@specops/db";
import {
  buildConceptGraphPromptPacket,
  createAiPrefillProvider,
  normalizeConceptGraphProviderResponse,
} from "@specops/ai-prefill";
import type {
  AiPrefillProvider,
  CreateAiPrefillProviderInput,
  NormalizedConcept,
  NormalizedConceptRelationship,
} from "@specops/ai-prefill";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { ApiConfig } from "../config.js";
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";

type AiPrefillConfig = ApiConfig["aiPrefill"];
type AiPrefillProviderFactory = (input: CreateAiPrefillProviderInput) => AiPrefillProvider;

type ConceptGraphServiceOptions = {
  config: AiPrefillConfig;
  providerFactory?: AiPrefillProviderFactory;
};

type ProjectConceptVersionRow = typeof projectConceptVersions.$inferSelect;
type ProjectConceptRow = typeof projectConcepts.$inferSelect;
type ProjectConceptMembershipRow = typeof projectConceptMemberships.$inferSelect;
type ProjectConceptRelationshipRow = typeof projectConceptRelationships.$inferSelect;
type ProjectGraphNodeRow = typeof projectGraphNodes.$inferSelect;
type ProjectGraphVersionRow = typeof projectGraphVersions.$inferSelect;
type ConceptGraphReadDb = Pick<Db, "select">;

const lowConfidenceThreshold = 0.6;

export function createConceptGraphService(db: Db, options: ConceptGraphServiceOptions) {
  async function buildConceptGraph(
    projectId: string,
    input: BuildConceptGraphRequest,
  ): Promise<ConceptGraphLatestResponse> {
    const graphVersion = await getLatestProjectGraphVersion(projectId);
    const projectName = await loadProjectName(projectId);
    const graphNodes = await db
      .select()
      .from(projectGraphNodes)
      .where(
        and(
          eq(projectGraphNodes.projectId, projectId),
          eq(projectGraphNodes.graphVersionId, graphVersion.id),
        ),
      )
      .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.label), asc(projectGraphNodes.id))
      .limit(input.maxGraphNodes);
    const graphEdges = await db
      .select()
      .from(projectGraphEdges)
      .where(
        and(
          eq(projectGraphEdges.projectId, projectId),
          eq(projectGraphEdges.graphVersionId, graphVersion.id),
        ),
      )
      .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
      .limit(input.maxGraphEdges);

    if (graphNodes.length === 0) {
      return persistConceptVersion(db, {
        projectId,
        projectGraphVersionId: graphVersion.id,
        provider: input.provider,
        model: input.model,
        promptVersion: "concept-graph-v1",
        status: "limited",
        summary: "Limited concept graph: no graph nodes were available.",
        concepts: [],
        relationships: [],
        diagnostics: [
          {
            level: "warning",
            code: "limited_graph_evidence",
            message: "No graph nodes were available for concept consolidation.",
          },
        ],
        rejectedConceptCount: 0,
        rejectedMembershipCount: 0,
      });
    }

    const packet = buildConceptGraphPromptPacket({
      project: { id: projectId, name: projectName },
      graph: {
        versionId: graphVersion.id,
        summary: graphVersion.summary,
        nodes: graphNodes.map((node) => ({
          id: node.id,
          nodeKey: node.nodeKey,
          nodeType: node.nodeType,
          label: node.label,
          path: node.path,
        })),
        edges: graphEdges.map((edge) => ({
          edgeType: edge.edgeType,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
        })),
      },
      limits: { maxGraphNodes: input.maxGraphNodes, maxGraphEdges: input.maxGraphEdges },
    });

    const normalized = await generateAndNormalizeConceptGraph(input, packet, graphNodes);
    const status = normalized.concepts.length === 0 ? "limited" : "ready";

    return persistConceptVersion(db, {
      projectId,
      projectGraphVersionId: graphVersion.id,
      provider: normalized.provider,
      model: normalized.model,
      promptVersion: packet.promptVersion,
      status,
      summary:
        status === "ready"
          ? `Concept graph with ${normalized.concepts.length} concepts.`
          : "Limited concept graph: no supported concepts were produced.",
      concepts: normalized.concepts,
      relationships: normalized.relationships,
      diagnostics: normalized.diagnostics,
      rejectedConceptCount: normalized.rejectedConceptCount,
      rejectedMembershipCount: normalized.rejectedMembershipCount,
    });
  }

  async function getLatestConceptGraph(projectId: string): Promise<ConceptGraphLatestResponse> {
    const version = await getLatestConceptVersion(projectId, { includeFailed: true });
    return readConceptGraph(db, projectId, version.id);
  }

  async function getConceptDetail(
    projectId: string,
    conceptId: string,
  ): Promise<ConceptDetailResponse> {
    const version = await getLatestConceptVersion(projectId);
    const [concept] = await db
      .select()
      .from(projectConcepts)
      .where(
        and(
          eq(projectConcepts.projectId, projectId),
          eq(projectConcepts.conceptVersionId, version.id),
          eq(projectConcepts.id, conceptId),
        ),
      )
      .limit(1);

    if (!concept) {
      throw new NotFoundError("Concept not found", { projectId, conceptId });
    }

    const memberships = await db
      .select()
      .from(projectConceptMemberships)
      .where(
        and(
          eq(projectConceptMemberships.projectId, projectId),
          eq(projectConceptMemberships.conceptVersionId, version.id),
          eq(projectConceptMemberships.conceptId, conceptId),
        ),
      )
      .orderBy(asc(projectConceptMemberships.role), asc(projectConceptMemberships.id));
    const [incomingRelationships, outgoingRelationships] = await Promise.all([
      db
        .select()
        .from(projectConceptRelationships)
        .where(
          and(
            eq(projectConceptRelationships.projectId, projectId),
            eq(projectConceptRelationships.conceptVersionId, version.id),
            eq(projectConceptRelationships.toConceptId, conceptId),
          ),
        )
        .orderBy(asc(projectConceptRelationships.relationshipType), asc(projectConceptRelationships.id)),
      db
        .select()
        .from(projectConceptRelationships)
        .where(
          and(
            eq(projectConceptRelationships.projectId, projectId),
            eq(projectConceptRelationships.conceptVersionId, version.id),
            eq(projectConceptRelationships.fromConceptId, conceptId),
          ),
        )
        .orderBy(asc(projectConceptRelationships.relationshipType), asc(projectConceptRelationships.id)),
    ]);
    const graphNodeIds = uniqueStrings(memberships.map((membership) => membership.graphNodeId));
    const relatedConceptIds = uniqueStrings([
      ...incomingRelationships.map((relationship) => relationship.fromConceptId),
      ...outgoingRelationships.map((relationship) => relationship.toConceptId),
    ]);
    const graphNodes =
      graphNodeIds.length === 0
        ? []
        : await db
          .select()
          .from(projectGraphNodes)
          .where(
            and(
              eq(projectGraphNodes.projectId, projectId),
              eq(projectGraphNodes.graphVersionId, version.projectGraphVersionId),
              inArray(projectGraphNodes.id, graphNodeIds),
            ),
          )
          .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.label), asc(projectGraphNodes.id));
    const relatedConcepts =
      relatedConceptIds.length === 0
        ? []
        : await db
          .select()
          .from(projectConcepts)
          .where(
            and(
              eq(projectConcepts.projectId, projectId),
              eq(projectConcepts.conceptVersionId, version.id),
              inArray(projectConcepts.id, relatedConceptIds),
            ),
          )
          .orderBy(asc(projectConcepts.conceptType), asc(projectConcepts.name), asc(projectConcepts.id));

    return conceptDetailResponseSchema.parse({
      concept: mapConcept(concept),
      memberships: memberships.map(mapMembership),
      graphNodes: graphNodes.map(mapGraphNode),
      incomingRelationships: groupRelationships(incomingRelationships.map(mapRelationship)),
      outgoingRelationships: groupRelationships(outgoingRelationships.map(mapRelationship)),
      relatedConcepts: relatedConcepts.map(mapConcept),
    });
  }

  async function getLatestProjectGraphVersion(projectId: string): Promise<ProjectGraphVersionRow> {
    const version = await selectLatestProjectGraphVersion(db, projectId);

    if (!version) {
      throw new BadRequestError("Project graph is required before concept consolidation", { projectId });
    }

    return version;
  }

  async function getLatestConceptVersion(
    projectId: string,
    options: { includeFailed?: boolean } = {},
  ): Promise<ProjectConceptVersionRow> {
    const statuses = options.includeFailed ? ["ready", "limited", "failed"] : ["ready", "limited"];
    const [version] = await db
      .select()
      .from(projectConceptVersions)
      .where(
        and(
          eq(projectConceptVersions.projectId, projectId),
          inArray(projectConceptVersions.status, statuses),
        ),
      )
      .orderBy(desc(projectConceptVersions.createdAt), desc(projectConceptVersions.id))
      .limit(1);

    if (!version) {
      throw new NotFoundError("Concept graph not found", { projectId });
    }

    return version;
  }

  async function loadProjectName(projectId: string): Promise<string> {
    const [project] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return project?.name ?? projectId;
  }

  async function generateAndNormalizeConceptGraph(
    input: BuildConceptGraphRequest,
    packet: ReturnType<typeof buildConceptGraphPromptPacket>,
    graphNodes: ProjectGraphNodeRow[],
  ) {
    try {
      const provider = (options.providerFactory ?? createAiPrefillProvider)({
        provider: input.provider,
        ollamaBaseUrl: options.config.ollamaBaseUrl,
        openAiApiKey: options.config.openAiApiKey,
        openAiBaseUrl: options.config.openAiBaseUrl,
        timeoutMs: options.config.timeoutMs,
      });
      const providerResult = await provider.generateConceptGraph({
        packet,
        model: input.model,
        temperature: input.temperature,
      });
      const normalized = normalizeConceptGraphProviderResponse({
        text: providerResult.text,
        graphNodeIds: new Set(graphNodes.map((node) => node.id)),
        graphNodeKeys: new Map(graphNodes.map((node) => [node.nodeKey, node.id])),
      });

      return {
        provider: providerResult.provider,
        model: providerResult.model,
        ...normalized,
      };
    } catch (error) {
      throw new BadGatewayError("Concept graph provider request failed", {
        message: errorMessage(error),
      });
    }
  }

  return { buildConceptGraph, getLatestConceptGraph, getConceptDetail };
}

type PersistConceptVersionInput = {
  projectId: string;
  projectGraphVersionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: Extract<ConceptGraphStatus, "ready" | "limited" | "failed">;
  summary: string;
  concepts: NormalizedConcept[];
  relationships: NormalizedConceptRelationship[];
  diagnostics: ConceptGraphDiagnostic[];
  rejectedConceptCount: number;
  rejectedMembershipCount: number;
};

async function persistConceptVersion(
  db: Db,
  input: PersistConceptVersionInput,
): Promise<ConceptGraphLatestResponse> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.projectId}:concept_graph`}, 0))`,
    );
    const latestProjectGraphVersion = await selectLatestProjectGraphVersion(tx, input.projectId);
    if (latestProjectGraphVersion?.id !== input.projectGraphVersionId) {
      throw new ConflictError("Project graph changed during concept consolidation", {
        projectId: input.projectId,
        selectedProjectGraphVersionId: input.projectGraphVersionId,
        currentProjectGraphVersionId: latestProjectGraphVersion?.id ?? null,
      });
    }

    await tx
      .update(projectConceptVersions)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(projectConceptVersions.projectId, input.projectId),
          or(eq(projectConceptVersions.status, "ready"), eq(projectConceptVersions.status, "limited")),
        ),
      );

    const conceptKeys = new Set(input.concepts.map((concept) => concept.key));
    const relationships = input.relationships.filter(
      (relationship) =>
        conceptKeys.has(relationship.fromConceptKey) && conceptKeys.has(relationship.toConceptKey),
    );
    const coverage = buildCoverage({ ...input, relationships });
    const [version] = await tx
      .insert(projectConceptVersions)
      .values({
        projectId: input.projectId,
        projectGraphVersionId: input.projectGraphVersionId,
        status: input.status,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        summary: input.summary,
        coverageJson: coverage,
        diagnosticsJson: input.diagnostics,
      })
      .returning();

    if (!version) {
      throw new Error("Failed to create concept graph version");
    }

    const insertedConcepts =
      input.concepts.length === 0
        ? []
        : await tx
          .insert(projectConcepts)
          .values(
            input.concepts.map((concept) => ({
              projectId: input.projectId,
              conceptVersionId: version.id,
              conceptKey: concept.key,
              conceptType: concept.type,
              name: concept.name,
              summary: concept.summary,
              confidence: concept.confidence,
              provenance: "ai",
              evidenceSummary: concept.evidenceSummary,
              status: "active",
              metadataJson: {},
            })),
          )
          .returning();
    const conceptIdsByKey = new Map(
      insertedConcepts.map((concept) => [concept.conceptKey, concept.id]),
    );
    const membershipRows = input.concepts.flatMap((concept) => {
      const conceptId = conceptIdsByKey.get(concept.key);
      if (!conceptId) {
        return [];
      }

      return concept.memberships.map((membership) => ({
        projectId: input.projectId,
        conceptVersionId: version.id,
        conceptId,
        graphNodeId: membership.graphNodeId,
        role: membership.role,
        confidence: membership.confidence,
        rationale: membership.rationale,
      }));
    });

    if (membershipRows.length > 0) {
      await tx.insert(projectConceptMemberships).values(membershipRows);
    }

    const relationshipRows = relationships.flatMap((relationship) => {
      const fromConceptId = conceptIdsByKey.get(relationship.fromConceptKey);
      const toConceptId = conceptIdsByKey.get(relationship.toConceptKey);
      if (!fromConceptId || !toConceptId) {
        return [];
      }

      return [
        {
          projectId: input.projectId,
          conceptVersionId: version.id,
          fromConceptId,
          toConceptId,
          relationshipType: relationship.relationshipType,
          confidence: relationship.confidence,
          rationale: relationship.rationale,
        },
      ];
    });

    if (relationshipRows.length > 0) {
      await tx.insert(projectConceptRelationships).values(relationshipRows);
    }

    return readConceptGraph(tx, input.projectId, version.id);
  });
}

async function selectLatestProjectGraphVersion(
  readDb: ConceptGraphReadDb,
  projectId: string,
): Promise<ProjectGraphVersionRow | undefined> {
  const [row] = await readDb
    .select({ version: projectGraphVersions })
    .from(projectGraphVersions)
    .leftJoin(indexRuns, eq(projectGraphVersions.indexRunId, indexRuns.id))
    .where(
      and(
        eq(projectGraphVersions.projectId, projectId),
        or(eq(projectGraphVersions.status, "ready"), eq(projectGraphVersions.status, "limited")),
      ),
    )
    .orderBy(
      sql`case when ${indexRuns.id} is null then 0 else 1 end desc`,
      sql`coalesce(${indexRuns.finishedAt}, ${indexRuns.startedAt}) desc nulls last`,
      desc(projectGraphVersions.createdAt),
      desc(projectGraphVersions.id),
    )
    .limit(1);

  return row?.version;
}

async function readConceptGraph(
  readDb: ConceptGraphReadDb,
  projectId: string,
  versionId: string,
): Promise<ConceptGraphLatestResponse> {
  const [version] = await readDb
    .select()
    .from(projectConceptVersions)
    .where(
      and(eq(projectConceptVersions.projectId, projectId), eq(projectConceptVersions.id, versionId)),
    )
    .limit(1);

  if (!version) {
    throw new NotFoundError("Concept graph not found", { projectId, versionId });
  }

  const concepts = await readDb
    .select()
    .from(projectConcepts)
    .where(
      and(
        eq(projectConcepts.projectId, projectId),
        eq(projectConcepts.conceptVersionId, version.id),
      ),
    )
    .orderBy(asc(projectConcepts.conceptType), asc(projectConcepts.name), asc(projectConcepts.id));
  const coverage = readCoverage(version.coverageJson);

  return conceptGraphLatestResponseSchema.parse({
    version: mapVersion(version),
    conceptCounts: coverage.conceptCounts,
    membershipCounts: coverage.membershipCounts,
    relationshipCounts: coverage.relationshipCounts,
    concepts: concepts.map(mapConcept),
    diagnostics: readDiagnostics(version.diagnosticsJson),
  });
}

function buildCoverage(input: {
  concepts: NormalizedConcept[];
  relationships: NormalizedConceptRelationship[];
  rejectedConceptCount: number;
  rejectedMembershipCount: number;
}): ConceptGraphCoverage {
  const memberships = input.concepts.flatMap((concept) => concept.memberships);

  return {
    conceptCounts: countBy(input.concepts, (concept) => concept.type),
    membershipCounts: countBy(memberships, (membership) => membership.role),
    relationshipCounts: countBy(input.relationships, (relationship) => relationship.relationshipType),
    rejectedConceptCount: input.rejectedConceptCount,
    rejectedMembershipCount: input.rejectedMembershipCount,
    graphNodeCoverageCount: uniqueStrings(memberships.map((membership) => membership.graphNodeId)).length,
    lowConfidenceConceptCount: input.concepts.filter(
      (concept) => concept.confidence < lowConfidenceThreshold,
    ).length,
  };
}

function mapVersion(row: ProjectConceptVersionRow): ProjectConceptVersionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectGraphVersionId: row.projectGraphVersionId,
    status: row.status as ProjectConceptVersionDto["status"],
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    summary: row.summary,
    coverage: readCoverage(row.coverageJson),
    diagnostics: readDiagnostics(row.diagnosticsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapConcept(row: ProjectConceptRow): ProjectConceptDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conceptVersionId: row.conceptVersionId,
    conceptKey: row.conceptKey,
    conceptType: row.conceptType as ProjectConceptDto["conceptType"],
    name: row.name,
    summary: row.summary,
    confidence: row.confidence,
    provenance: row.provenance as ProjectConceptDto["provenance"],
    evidenceSummary: row.evidenceSummary,
    status: row.status as ProjectConceptDto["status"],
    metadata: readRecord(row.metadataJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMembership(row: ProjectConceptMembershipRow): ProjectConceptMembershipDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conceptVersionId: row.conceptVersionId,
    conceptId: row.conceptId,
    graphNodeId: row.graphNodeId,
    role: row.role as ProjectConceptMembershipDto["role"],
    confidence: row.confidence,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRelationship(row: ProjectConceptRelationshipRow): ProjectConceptRelationshipDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conceptVersionId: row.conceptVersionId,
    fromConceptId: row.fromConceptId,
    toConceptId: row.toConceptId,
    relationshipType: row.relationshipType as ProjectConceptRelationshipDto["relationshipType"],
    confidence: row.confidence,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapGraphNode(row: ProjectGraphNodeRow): ProjectGraphNodeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    graphVersionId: row.graphVersionId,
    nodeKey: row.nodeKey,
    nodeType: row.nodeType as ProjectGraphNodeType,
    label: row.label,
    path: row.path,
    symbolName: row.symbolName,
    entityId: row.entityId,
    sourceRef: readRecord(row.sourceRefJson),
    metadata: readRecord(row.metadataJson),
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
  };
}

function groupRelationships(rows: ProjectConceptRelationshipDto[]) {
  return rows.reduce<Record<string, ProjectConceptRelationshipDto[]>>((groups, relationship) => {
    const key = relationship.relationshipType;
    groups[key] = [...(groups[key] ?? []), relationship];
    return groups;
  }, {});
}

function readCoverage(value: unknown): ConceptGraphCoverage {
  const record = readRecord(value);
  return {
    conceptCounts: readNumberRecord(record.conceptCounts),
    membershipCounts: readNumberRecord(record.membershipCounts),
    relationshipCounts: readNumberRecord(record.relationshipCounts),
    rejectedConceptCount: readNumber(record.rejectedConceptCount),
    rejectedMembershipCount: readNumber(record.rejectedMembershipCount),
    graphNodeCoverageCount: readNumber(record.graphNodeCoverageCount),
    lowConfidenceConceptCount: readNumber(record.lowConfidenceConceptCount),
  };
}

function readDiagnostics(value: unknown): ConceptGraphDiagnostic[] {
  return Array.isArray(value) ? (value as ConceptGraphDiagnostic[]) : [];
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readNumberRecord(value: unknown): Record<string, number> {
  const record = readRecord(value);
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .map(([key, value]) => [key, Math.max(0, Math.trunc(value))]),
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" ? Math.max(0, Math.trunc(value)) : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
