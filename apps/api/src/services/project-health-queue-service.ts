import type {
  HealthQueueDiagnosticDto,
  HealthQueueEvidenceDto,
  HealthQueueItemDto,
  HealthQueueKindDto,
  HealthQueueSeverityDto,
  HealthQueueSummaryDto,
  IndexRunStatus,
  ProjectHealthQueueResponseDto,
} from "@specops/contracts";
import { healthQueueResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  indexRuns,
  projectConceptMemberships,
  projectConceptVersions,
  projectConcepts,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  projects,
  sourceSpecAnnotations,
  specEntities,
  specLinks,
} from "@specops/db";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import { createSpecReadinessService } from "./spec-readiness-service.js";

type ProjectRow = typeof projects.$inferSelect;
type IndexRunRow = typeof indexRuns.$inferSelect;
type ProjectGraphVersionRow = typeof projectGraphVersions.$inferSelect;
type ProjectGraphNodeRow = typeof projectGraphNodes.$inferSelect;
type ProjectGraphEdgeRow = typeof projectGraphEdges.$inferSelect;
type ProjectConceptVersionRow = typeof projectConceptVersions.$inferSelect;
type ProjectConceptRow = typeof projectConcepts.$inferSelect;
type ProjectConceptMembershipRow = typeof projectConceptMemberships.$inferSelect;
type SpecEntityRow = typeof specEntities.$inferSelect;

type UsefulSourceNodeInput = Pick<ProjectGraphNodeRow, "nodeType" | "path" | "metadataJson">;

const eligibleSpecTypes = new Set(["use_case", "interface", "ui_view", "data_model", "domain_entity"]);
const severityRank: Record<HealthQueueSeverityDto, number> = {
  blocker: 0,
  review: 1,
  context: 2,
};
const familyRank: Record<HealthQueueItemDto["family"], number> = {
  spec: 0,
  source: 1,
  concept: 2,
};
const lowConfidenceThreshold = 0.6;

export function createProjectHealthQueueService(db: Db) {
  return {
    async getProjectHealthQueue(projectId: string): Promise<ProjectHealthQueueResponseDto> {
      await assertProjectExists(db, projectId);

      const [
        latestIndexRun,
        latestGraphVersion,
        newestGraphVersion,
        latestConceptVersion,
        newestConceptVersion,
        specs,
        links,
        annotations,
        readiness,
      ] = await Promise.all([
        loadLatestIndexRun(db, projectId),
        loadLatestGraphVersion(db, projectId),
        loadNewestGraphVersion(db, projectId),
        loadLatestConceptVersion(db, projectId),
        loadNewestConceptVersion(db, projectId),
        db.select().from(specEntities).where(eq(specEntities.projectId, projectId)).orderBy(asc(specEntities.entityId)),
        db.select().from(specLinks).where(eq(specLinks.projectId, projectId)),
        db
          .select()
          .from(sourceSpecAnnotations)
          .where(
            and(
              eq(sourceSpecAnnotations.projectId, projectId),
              eq(sourceSpecAnnotations.status, "active"),
            ),
          ),
        createSpecReadinessService(db).getProjectReadiness(projectId),
      ]);

      const diagnostics = buildDiagnostics({
        latestIndexRun,
        latestGraphVersion,
        latestConceptVersion,
        newestGraphVersion,
        newestConceptVersion,
      });
      const graphNodes = latestGraphVersion
        ? await db
          .select()
          .from(projectGraphNodes)
          .where(
            and(
              eq(projectGraphNodes.projectId, projectId),
              eq(projectGraphNodes.graphVersionId, latestGraphVersion.id),
            ),
          )
          .orderBy(asc(projectGraphNodes.nodeType), asc(projectGraphNodes.label), asc(projectGraphNodes.id))
        : [];
      const graphEdges = latestGraphVersion
        ? await db
          .select()
          .from(projectGraphEdges)
          .where(
            and(
              eq(projectGraphEdges.projectId, projectId),
              eq(projectGraphEdges.graphVersionId, latestGraphVersion.id),
            ),
          )
          .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
        : [];
      const conceptGraphEdges = latestConceptVersion
        ? latestGraphVersion?.id === latestConceptVersion.projectGraphVersionId
          ? graphEdges
          : await db
            .select()
            .from(projectGraphEdges)
            .where(
              and(
                eq(projectGraphEdges.projectId, projectId),
                eq(projectGraphEdges.graphVersionId, latestConceptVersion.projectGraphVersionId),
              ),
            )
            .orderBy(asc(projectGraphEdges.edgeType), asc(projectGraphEdges.id))
        : [];
      const concepts = latestConceptVersion
        ? await db
          .select()
          .from(projectConcepts)
          .where(
            and(
              eq(projectConcepts.projectId, projectId),
              eq(projectConcepts.conceptVersionId, latestConceptVersion.id),
              eq(projectConcepts.status, "active"),
            ),
          )
          .orderBy(asc(projectConcepts.conceptType), asc(projectConcepts.name), asc(projectConcepts.id))
        : [];
      const memberships = latestConceptVersion
        ? await db
          .select()
          .from(projectConceptMemberships)
          .where(
            and(
              eq(projectConceptMemberships.projectId, projectId),
              eq(projectConceptMemberships.conceptVersionId, latestConceptVersion.id),
            ),
          )
          .orderBy(asc(projectConceptMemberships.conceptId), asc(projectConceptMemberships.id))
        : [];

      const items = [
        ...buildSpecReadinessItems(readiness.queue),
        ...buildMissingSourceSpecItems(specs, annotations),
        ...buildOrphanedSpecItems(specs, links, annotations),
        ...buildSourceItems(graphNodes, graphEdges),
        ...buildConceptItems(concepts, memberships, conceptGraphEdges),
      ].sort(compareHealthQueueItems);

      return healthQueueResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        sourceState: {
          latestIndexRunId: latestIndexRun?.id ?? null,
          latestIndexRunStatus: latestIndexRun ? normalizeIndexRunStatus(latestIndexRun.status) : null,
          latestProjectGraphVersionId: latestGraphVersion?.id ?? null,
          latestProjectGraphStatus: latestGraphVersion?.status ?? null,
          latestConceptGraphVersionId: latestConceptVersion?.id ?? null,
          latestConceptGraphStatus: latestConceptVersion?.status ?? null,
          hasProjectGraph: latestGraphVersion !== undefined,
          hasConceptGraph: latestConceptVersion !== undefined,
        },
        summary: buildHealthQueueSummary(items),
        diagnostics,
        items,
      });
    },
  };
}

export function healthQueueItemId(kind: HealthQueueKindDto, target: string): string {
  return `${kind}:${target}`;
}

export function buildHealthQueueSummary(items: HealthQueueItemDto[]): HealthQueueSummaryDto {
  const summary: HealthQueueSummaryDto = {
    total: items.length,
    byFamily: { spec: 0, source: 0, concept: 0 },
    bySeverity: { blocker: 0, review: 0, context: 0 },
    byKind: {},
  };

  for (const item of items) {
    summary.byFamily[item.family] += 1;
    summary.bySeverity[item.severity] += 1;
    summary.byKind[item.kind] = (summary.byKind[item.kind] ?? 0) + 1;
  }

  return summary;
}

export function compareHealthQueueItems(left: HealthQueueItemDto, right: HealthQueueItemDto): number {
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    familyRank[left.family] - familyRank[right.family] ||
    left.kind.localeCompare(right.kind) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

export function isUsefulSourceNode(input: UsefulSourceNodeInput): boolean {
  if (input.nodeType !== "file" && input.nodeType !== "symbol") {
    return false;
  }
  if (!input.path) {
    return false;
  }

  const normalizedPath = input.path.replace(/\\/g, "/");
  const baseName = normalizedPath.split("/").at(-1) ?? normalizedPath;
  const metadata = readRecord(input.metadataJson);
  const classification = typeof metadata.classification === "string" ? metadata.classification : null;

  if (
    classification === "test" ||
    classification === "config" ||
    classification === "unknown" ||
    classification === "generated"
  ) {
    return false;
  }
  if (metadata.generated === true || isGeneratedPath(normalizedPath)) {
    return false;
  }
  if (/(^|[/.])(test|spec)\.[cm]?[jt]sx?$/.test(baseName) || normalizedPath.includes("/__tests__/")) {
    return false;
  }
  if (isConfigPath(normalizedPath)) {
    return false;
  }

  return true;
}

async function assertProjectExists(db: Pick<Db, "select">, projectId: string): Promise<ProjectRow> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  if (!project) {
    throw new NotFoundError("Project not found", { projectId });
  }

  return project;
}

async function loadLatestIndexRun(db: Pick<Db, "select">, projectId: string): Promise<IndexRunRow | undefined> {
  const [run] = await db
    .select()
    .from(indexRuns)
    .where(eq(indexRuns.projectId, projectId))
    .orderBy(sql`coalesce(${indexRuns.finishedAt}, ${indexRuns.startedAt}) desc nulls last`, desc(indexRuns.id))
    .limit(1);

  return run;
}

async function loadLatestGraphVersion(
  db: Pick<Db, "select">,
  projectId: string,
): Promise<ProjectGraphVersionRow | undefined> {
  const [row] = await db
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

async function loadNewestGraphVersion(
  db: Pick<Db, "select">,
  projectId: string,
): Promise<ProjectGraphVersionRow | undefined> {
  const [row] = await db
    .select()
    .from(projectGraphVersions)
    .where(eq(projectGraphVersions.projectId, projectId))
    .orderBy(desc(projectGraphVersions.createdAt), desc(projectGraphVersions.id))
    .limit(1);

  return row;
}

async function loadLatestConceptVersion(
  db: Pick<Db, "select">,
  projectId: string,
): Promise<ProjectConceptVersionRow | undefined> {
  const [version] = await db
    .select()
    .from(projectConceptVersions)
    .where(
      and(
        eq(projectConceptVersions.projectId, projectId),
        or(eq(projectConceptVersions.status, "ready"), eq(projectConceptVersions.status, "limited")),
      ),
    )
    .orderBy(desc(projectConceptVersions.createdAt), desc(projectConceptVersions.id))
    .limit(1);

  return version;
}

async function loadNewestConceptVersion(
  db: Pick<Db, "select">,
  projectId: string,
): Promise<ProjectConceptVersionRow | undefined> {
  const [version] = await db
    .select()
    .from(projectConceptVersions)
    .where(eq(projectConceptVersions.projectId, projectId))
    .orderBy(desc(projectConceptVersions.createdAt), desc(projectConceptVersions.id))
    .limit(1);

  return version;
}

function buildDiagnostics(input: {
  latestIndexRun: IndexRunRow | undefined;
  latestGraphVersion: ProjectGraphVersionRow | undefined;
  latestConceptVersion: ProjectConceptVersionRow | undefined;
  newestGraphVersion: ProjectGraphVersionRow | undefined;
  newestConceptVersion: ProjectConceptVersionRow | undefined;
}): HealthQueueDiagnosticDto[] {
  const diagnostics: HealthQueueDiagnosticDto[] = [];

  if (!input.latestIndexRun) {
    diagnostics.push({
      level: "warning",
      code: "no_index_run",
      message: "No source index run is available for this project.",
    });
  }
  if (input.newestGraphVersion?.status === "failed") {
    diagnostics.push({
      level: "warning",
      code: "failed_project_graph",
      message: "The latest project graph build failed.",
    });
  }
  if (!input.latestGraphVersion) {
    diagnostics.push({
      level: "warning",
      code: "no_project_graph",
      message: "No ready project graph is available for this project.",
    });
  } else if (input.latestGraphVersion.status === "limited") {
    diagnostics.push({
      level: "warning",
      code: "limited_project_graph",
      message: "The latest project graph is limited.",
    });
  }
  if (input.newestConceptVersion?.status === "failed") {
    diagnostics.push({
      level: "warning",
      code: "failed_concept_graph",
      message: "The latest concept graph build failed.",
    });
  }
  if (!input.latestConceptVersion) {
    diagnostics.push({
      level: "warning",
      code: "no_concept_graph",
      message: "No ready concept graph is available for this project.",
    });
  } else if (input.latestConceptVersion.status === "limited") {
    diagnostics.push({
      level: "warning",
      code: "limited_concept_graph",
      message: "The latest concept graph is limited.",
    });
  }

  return diagnostics;
}

function buildSpecReadinessItems(
  queue: Awaited<ReturnType<ReturnType<typeof createSpecReadinessService>["getProjectReadiness"]>>["queue"],
): HealthQueueItemDto[] {
  return queue.map((item) => {
    const isStale = item.topChecks.some((check) => check.id === "agent_task_stale");
    const kind = isStale ? "spec_stale" : "spec_readiness_failed";
    return {
      id: healthQueueItemId(kind, item.entityId),
      family: "spec",
      kind,
      severity: item.highestSeverity ?? "review",
      title: isStale ? `Stale spec task: ${item.title}` : `Spec readiness failed: ${item.title}`,
      detail: isStale
        ? "This spec task may be stale relative to its linked source or context specs."
        : `${item.failedCheckCount} readiness check${item.failedCheckCount === 1 ? "" : "s"} failed.`,
      primaryTarget: specTarget(item),
      evidence: item.topChecks.map((check) => ({
        kind: "readiness_check",
        label: check.label,
        detail: check.detail,
        entityId: item.entityId,
        filePath: check.filePath ?? item.filePath,
      })),
      actions: specActions(item.entityId, true),
      diagnostics: [],
    } satisfies HealthQueueItemDto;
  });
}

function buildMissingSourceSpecItems(
  specs: SpecEntityRow[],
  annotations: Array<typeof sourceSpecAnnotations.$inferSelect>,
): HealthQueueItemDto[] {
  const annotatedEntityIds = new Set(annotations.map((annotation) => annotation.entityId));

  return specs
    .filter((spec) => eligibleSpecTypes.has(spec.type))
    .filter((spec) => !annotatedEntityIds.has(spec.entityId))
    .map((spec) => ({
      id: healthQueueItemId("spec_missing_source_evidence", spec.entityId),
      family: "spec",
      kind: "spec_missing_source_evidence",
      severity: "review",
      title: `Missing source evidence: ${spec.title}`,
      detail: "This spec has no active source annotation.",
      primaryTarget: specTarget(spec),
      evidence: [specEvidence(spec)],
      actions: specActions(spec.entityId),
      diagnostics: [],
    }));
}

function buildOrphanedSpecItems(
  specs: SpecEntityRow[],
  links: Array<typeof specLinks.$inferSelect>,
  annotations: Array<typeof sourceSpecAnnotations.$inferSelect>,
): HealthQueueItemDto[] {
  const annotatedEntityIds = new Set(annotations.map((annotation) => annotation.entityId));
  const linkedEntityIds = new Set<string>();
  for (const link of links) {
    linkedEntityIds.add(link.fromEntityId);
    linkedEntityIds.add(link.toEntityId);
  }

  return specs
    .filter((spec) => eligibleSpecTypes.has(spec.type))
    .filter((spec) => spec.status !== "archived")
    .filter((spec) => !annotatedEntityIds.has(spec.entityId) && !linkedEntityIds.has(spec.entityId))
    .map((spec) => ({
      id: healthQueueItemId("spec_orphaned", spec.entityId),
      family: "spec",
      kind: "spec_orphaned",
      severity: "review",
      title: `Orphaned spec: ${spec.title}`,
      detail: "This spec has no active source annotation and no incoming or outgoing spec links.",
      primaryTarget: specTarget(spec),
      evidence: [specEvidence(spec)],
      actions: specActions(spec.entityId),
      diagnostics: [],
    }));
}

function buildSourceItems(nodes: ProjectGraphNodeRow[], edges: ProjectGraphEdgeRow[]): HealthQueueItemDto[] {
  const supportedNodeIds = new Set(
    edges.filter((edge) => edge.edgeType === "supports_spec").map((edge) => edge.fromNodeId),
  );
  const uncoveredNodes = nodes
    .filter(isUsefulSourceNode)
    .filter((node) => !supportedNodeIds.has(node.id))
    .sort(compareGraphNodes);
  const nodesByDirectory = groupBy(uncoveredNodes, (node) => directoryForPath(node.path!));
  const groupedNodeIds = new Set<string>();
  const items: HealthQueueItemDto[] = [];

  for (const [directory, directoryNodes] of [...nodesByDirectory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (directoryNodes.length < 3) {
      continue;
    }

    for (const node of directoryNodes) {
      groupedNodeIds.add(node.id);
    }

    items.push({
      id: healthQueueItemId("source_area_without_spec", directory),
      family: "source",
      kind: "source_area_without_spec",
      severity: "review",
      title: `Source area without spec coverage: ${directory}`,
      detail: `${directoryNodes.length} useful source nodes in this area have no outgoing spec support edge.`,
      primaryTarget: {
        kind: "source",
        graphNodeId: null,
        nodeKey: directory,
        nodeType: "module",
        path: directory,
        symbolName: null,
      },
      evidence: directoryNodes.slice(0, 5).map(sourceNodeEvidence),
      actions: [{ kind: "open_project_graph", label: "Open project graph", q: directory }],
      diagnostics: [],
    });
  }

  for (const node of uncoveredNodes.filter((item) => !groupedNodeIds.has(item.id))) {
    items.push({
      id: healthQueueItemId("source_without_spec", sourceTargetId(node)),
      family: "source",
      kind: "source_without_spec",
      severity: "review",
      title: `Source without spec coverage: ${sourceLabel(node)}`,
      detail: "This source graph node has no outgoing spec support edge.",
      primaryTarget: sourceTarget(node),
      evidence: [sourceNodeEvidence(node)],
      actions: [
        { kind: "open_project_graph", label: "Open project graph", q: node.path! },
        { kind: "open_graph_node", label: "Open graph node", graphNodeId: node.id },
      ],
      diagnostics: [],
    });
  }

  return items;
}

function buildConceptItems(
  concepts: ProjectConceptRow[],
  memberships: ProjectConceptMembershipRow[],
  graphEdges: ProjectGraphEdgeRow[],
): HealthQueueItemDto[] {
  const membershipsByConcept = groupBy(memberships, (membership) => membership.conceptId);
  const supportedNodeIds = new Set(
    graphEdges.filter((edge) => edge.edgeType === "supports_spec").map((edge) => edge.fromNodeId),
  );
  const items: HealthQueueItemDto[] = [];

  for (const concept of concepts) {
    const conceptMemberships = membershipsByConcept.get(concept.id) ?? [];
    const lowConfidenceMemberships = conceptMemberships.filter(
      (membership) => membership.confidence < lowConfidenceThreshold,
    );

    if (conceptMemberships.length > 0 && conceptMemberships.every((membership) => !supportedNodeIds.has(membership.graphNodeId))) {
      items.push({
        id: healthQueueItemId("concept_without_spec", concept.conceptKey),
        family: "concept",
        kind: "concept_without_spec",
        severity: "review",
        title: `Concept without spec coverage: ${concept.name}`,
        detail: "This concept has memberships, but none of its member graph nodes support a spec.",
        primaryTarget: conceptTarget(concept),
        evidence: [conceptEvidence(concept)],
        actions: [{ kind: "open_concept", label: "Open concept", conceptId: concept.id }],
        diagnostics: [],
      });
    }

    if (concept.confidence < lowConfidenceThreshold) {
      items.push({
        id: healthQueueItemId("concept_low_confidence", concept.conceptKey),
        family: "concept",
        kind: "concept_low_confidence",
        severity: "context",
        title: `Low confidence concept: ${concept.name}`,
        detail: `Concept confidence is ${formatConfidence(concept.confidence)}.`,
        primaryTarget: conceptTarget(concept),
        evidence: [{ ...conceptEvidence(concept), confidence: concept.confidence }],
        actions: [{ kind: "open_concept", label: "Open concept", conceptId: concept.id }],
        diagnostics: [],
      });
    }

    if (lowConfidenceMemberships.length > 0) {
      items.push({
        id: healthQueueItemId("concept_membership_low_confidence", concept.conceptKey),
        family: "concept",
        kind: "concept_membership_low_confidence",
        severity: "context",
        title: `Low confidence memberships: ${concept.name}`,
        detail: `${lowConfidenceMemberships.length} concept membership${lowConfidenceMemberships.length === 1 ? "" : "s"} below confidence threshold.`,
        primaryTarget: conceptTarget(concept),
        evidence: lowConfidenceMemberships.slice(0, 5).map((membership) => ({
          kind: "graph_node",
          label: `Membership ${membership.role}`,
          detail: membership.rationale || "Concept membership confidence is below threshold.",
          graphNodeId: membership.graphNodeId,
          conceptId: concept.id,
          confidence: membership.confidence,
        })),
        actions: [{ kind: "open_concept", label: "Open concept", conceptId: concept.id }],
        diagnostics: [],
      });
    }
  }

  return items;
}

function normalizeIndexRunStatus(status: string): IndexRunStatus | null {
  if (status === "completed") return "succeeded";
  if (status === "running" || status === "succeeded" || status === "failed") return status;
  return null;
}

function specTarget(spec: {
  entityId: string;
  title: string;
  type: string;
  status: string;
  filePath: string;
}): HealthQueueItemDto["primaryTarget"] {
  return {
    kind: "spec",
    entityId: spec.entityId,
    title: spec.title,
    type: spec.type,
    status: spec.status,
    filePath: spec.filePath,
  };
}

function specEvidence(spec: SpecEntityRow): HealthQueueEvidenceDto {
  return {
    kind: "spec_entity",
    label: spec.title,
    detail: spec.entityId,
    entityId: spec.entityId,
    filePath: spec.filePath,
  };
}

function specActions(entityId: string, includeReadiness = false): HealthQueueItemDto["actions"] {
  return [
    { kind: "open_spec", label: "Open spec", entityId },
    ...(includeReadiness ? [{ kind: "open_readiness" as const, label: "Open readiness", entityId }] : []),
    { kind: "open_impact", label: "Open impact", entityId },
  ];
}

function sourceTarget(node: ProjectGraphNodeRow): HealthQueueItemDto["primaryTarget"] {
  return {
    kind: "source",
    graphNodeId: node.id,
    nodeKey: node.nodeKey,
    nodeType: node.nodeType,
    path: node.path!,
    symbolName: node.symbolName,
  };
}

function sourceNodeEvidence(node: ProjectGraphNodeRow): HealthQueueEvidenceDto {
  return {
    kind: "graph_node",
    label: sourceLabel(node),
    detail: node.path!,
    graphNodeId: node.id,
    filePath: node.path!,
  };
}

function sourceTargetId(node: ProjectGraphNodeRow): string {
  return node.nodeKey;
}

function sourceLabel(node: ProjectGraphNodeRow): string {
  return node.symbolName ?? node.label;
}

function conceptTarget(concept: ProjectConceptRow): HealthQueueItemDto["primaryTarget"] {
  return {
    kind: "concept",
    conceptId: concept.id,
    conceptKey: concept.conceptKey,
    conceptType: concept.conceptType,
    name: concept.name,
  };
}

function conceptEvidence(concept: ProjectConceptRow): HealthQueueEvidenceDto {
  return {
    kind: "concept",
    label: concept.name,
    detail: concept.evidenceSummary || concept.summary || concept.conceptKey,
    conceptId: concept.id,
  };
}

function compareGraphNodes(left: ProjectGraphNodeRow, right: ProjectGraphNodeRow): number {
  return (
    left.path!.localeCompare(right.path!) ||
    left.nodeType.localeCompare(right.nodeType) ||
    (left.symbolName ?? "").localeCompare(right.symbolName ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function directoryForPath(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "." : filePath.slice(0, index);
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function isConfigPath(input: string): boolean {
  const fileName = input.split("/").at(-1) ?? input;
  return (
    /(^|\.)(config|rc)\.[cm]?[jt]s$/.test(fileName) ||
    /^(vite|vitest|playwright|postcss|tailwind|eslint|prettier|drizzle)\.config\.[cm]?[jt]s$/.test(fileName) ||
    input.endsWith("package.json") ||
    input.endsWith("tsconfig.json")
  );
}

function isGeneratedPath(input: string): boolean {
  const normalized = `/${input.toLowerCase()}`;
  return (
    normalized.includes("/generated/") ||
    normalized.includes("/__generated__/") ||
    normalized.includes(".generated.")
  );
}

function groupBy<T, K>(items: T[], keyForItem: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();

  for (const item of items) {
    const key = keyForItem(item);
    const group = result.get(key) ?? [];
    group.push(item);
    result.set(key, group);
  }

  return result;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
