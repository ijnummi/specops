import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  BuildConceptGraphRequest,
  ConceptDetailResponse,
  ConceptGraphLatestResponse,
  ProjectConceptDto,
  ProjectConceptMembershipDto,
  ProjectConceptRelationshipDto
} from "@specops/contracts";
import { ArrowLeft, RefreshCw } from "lucide-react";

import {
  buildConceptGraph,
  conceptDetailQuery,
  conceptGraphQuery,
  queryKeys
} from "../api/queries.js";

type ConceptsPageProps = {
  projectId: string;
};

const INITIAL_BUILD_REQUEST: BuildConceptGraphRequest = {
  provider: "openai",
  model: "gpt-4.1-mini",
  temperature: 0.1,
  maxGraphNodes: 150,
  maxGraphEdges: 300
};

export function ConceptsPage({ projectId }: ConceptsPageProps) {
  const queryClient = useQueryClient();
  const graph = useQuery(conceptGraphQuery(projectId));
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const selectedVisibleConcept =
    graph.data?.concepts.find((concept) => concept.id === selectedConceptId) ?? null;
  const effectiveConceptId = selectedVisibleConcept?.id ?? graph.data?.concepts[0]?.id ?? null;
  const detail = useQuery(conceptDetailQuery(projectId, effectiveConceptId));
  const conceptCounts = useMemo(() => countEntries(graph.data?.conceptCounts ?? {}), [graph.data]);
  const showHeaderBuild = graph.data ? graph.data.concepts.length > 0 : false;

  const buildMutation = useMutation({
    mutationFn: () => buildConceptGraph(projectId, INITIAL_BUILD_REQUEST),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.conceptGraph(projectId) });
    }
  });

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-auto p-4 lg:overflow-hidden">
      <div className="mb-4 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Concepts</h1>
          <p className="truncate text-sm text-slate-600">Concept graph for project {projectId}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {showHeaderBuild ? (
            <BuildConceptsButton
              isPending={buildMutation.isPending}
              onBuild={() => buildMutation.mutate()}
            />
          ) : null}
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            search={{ q: undefined }}
            className="button-secondary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to project
          </Link>
        </div>
      </div>

      {buildMutation.error ? (
        <p className="panel-section mb-3 text-sm text-red-700">{buildMutation.error.message}</p>
      ) : null}

      {graph.error ? (
        <EmptyConceptGraph
          message={graph.error.message}
          isPending={buildMutation.isPending}
          onBuild={() => buildMutation.mutate()}
        />
      ) : graph.isLoading ? (
        <p className="panel-section text-sm text-slate-500">Loading concepts...</p>
      ) : graph.data ? (
        graph.data.concepts.length === 0 ? (
          <section className="panel-section text-sm text-slate-600">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="section-heading">Current concept graph</h2>
                <p className="mt-2">{graph.data.version.summary || "No concepts were found."}</p>
              </div>
              <BuildConceptsButton
                isPending={buildMutation.isPending}
                onBuild={() => buildMutation.mutate()}
              />
            </div>
            <GraphSummary graph={graph.data} conceptCounts={conceptCounts} />
            <Diagnostics diagnostics={graph.data.diagnostics} />
            <p className="mt-3 text-slate-500">No concepts were found.</p>
          </section>
        ) : (
          <div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="panel-section min-h-0 overflow-auto">
              <h2 className="section-heading">Current concept graph</h2>
              <p className="mt-2 text-sm text-slate-600">{graph.data.version.summary}</p>
              <GraphSummary graph={graph.data} conceptCounts={conceptCounts} />
              <Diagnostics diagnostics={graph.data.diagnostics} />
            </aside>

            <section className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="panel-section min-h-0 overflow-auto">
                <h2 className="section-heading">Concept list</h2>
                <ul className="mt-3 grid gap-2">
                  {graph.data.concepts.map((concept) => (
                    <li key={concept.id}>
                      <button
                        type="button"
                        aria-pressed={concept.id === effectiveConceptId}
                        className={
                          concept.id === effectiveConceptId
                            ? "w-full rounded border border-slate-900 bg-slate-900 p-2 text-left text-sm text-white"
                            : "w-full rounded border border-slate-200 p-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        }
                        onClick={() => setSelectedConceptId(concept.id)}
                      >
                        <span className="flex min-w-0 items-center justify-between gap-3">
                          <span className="truncate font-medium">{concept.name}</span>
                          <span className="shrink-0 text-xs opacity-80">
                            {formatConfidence(concept.confidence)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-xs opacity-80">
                          {concept.conceptType}
                        </span>
                        <span className="mt-1 block text-xs opacity-80">{concept.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel-section min-h-0 overflow-auto">
                <h2 className="section-heading">Concept detail</h2>
                {detail.error ? (
                  <p className="mt-3 text-sm text-red-700">{detail.error.message}</p>
                ) : detail.isLoading ? (
                  <p className="mt-3 text-sm text-slate-500">Loading concept...</p>
                ) : detail.data ? (
                  <ConceptDetail detail={detail.data} />
                ) : (
                  <p className="mt-3 text-sm text-slate-500">Select a concept.</p>
                )}
              </div>
            </section>
          </div>
        )
      ) : (
        <EmptyConceptGraph
          message="No concept graph exists for this project."
          isPending={buildMutation.isPending}
          onBuild={() => buildMutation.mutate()}
        />
      )}
    </main>
  );
}

function BuildConceptsButton({
  isPending,
  onBuild
}: {
  isPending: boolean;
  onBuild: () => void;
}) {
  return (
    <button type="button" className="button-primary" disabled={isPending} onClick={onBuild}>
      <RefreshCw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
      {isPending ? "Building..." : "Build concepts"}
    </button>
  );
}

function EmptyConceptGraph({
  message,
  isPending,
  onBuild
}: {
  message: string;
  isPending: boolean;
  onBuild: () => void;
}) {
  return (
    <section className="panel-section text-sm text-slate-600">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-heading">Current concept graph</h2>
          <p className="mt-2">{message}</p>
        </div>
        <BuildConceptsButton isPending={isPending} onBuild={onBuild} />
      </div>
    </section>
  );
}

function GraphSummary({
  graph,
  conceptCounts
}: {
  graph: ConceptGraphLatestResponse;
  conceptCounts: Array<[string, number]>;
}) {
  return (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-1 text-xs">
        <StatusLine label="Status" value={graph.version.status} />
        <StatusLine label="Provider" value={graph.version.provider} />
        <StatusLine label="Model" value={graph.version.model} />
        <StatusLine label="Source graph" value={graph.version.projectGraphVersionId} />
      </div>
      <CountList title="Concept types" counts={conceptCounts} />
      <div className="grid gap-1 text-xs">
        <StatusLine
          label="Covered graph nodes"
          value={String(graph.version.coverage.graphNodeCoverageCount)}
        />
        <StatusLine
          label="Rejected concepts"
          value={String(graph.version.coverage.rejectedConceptCount)}
        />
        <StatusLine
          label="Rejected memberships"
          value={String(graph.version.coverage.rejectedMembershipCount)}
        />
        <StatusLine
          label="Low confidence"
          value={String(graph.version.coverage.lowConfidenceConceptCount)}
        />
      </div>
    </div>
  );
}

function ConceptDetail({ detail }: { detail: ConceptDetailResponse }) {
  const graphNodesById = useMemo(
    () => new Map(detail.graphNodes.map((node) => [node.id, node])),
    [detail.graphNodes]
  );
  const relatedConceptsById = useMemo(
    () => new Map(detail.relatedConcepts.map((concept) => [concept.id, concept])),
    [detail.relatedConcepts]
  );
  const membershipsByRole = useMemo(() => groupMembershipsByRole(detail.memberships), [detail]);

  return (
    <div className="mt-3 grid gap-3 text-sm">
      <div className="min-w-0">
        <h3 className="truncate font-medium text-slate-900">{detail.concept.name}</h3>
        <p className="truncate text-xs text-slate-500">{detail.concept.conceptKey}</p>
      </div>
      <div className="grid gap-1 text-xs">
        <StatusLine label="Type" value={detail.concept.conceptType} />
        <StatusLine label="Confidence" value={formatConfidence(detail.concept.confidence)} />
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">Evidence summary</h3>
        <p className="mt-2 text-sm text-slate-700">
          {detail.concept.evidenceSummary || "No evidence summary"}
        </p>
      </div>
      <MembershipGroups groups={membershipsByRole} graphNodesById={graphNodesById} />
      <RelationshipGroups
        title="Outgoing relationships"
        groups={detail.outgoingRelationships}
        relatedConceptsById={relatedConceptsById}
      />
    </div>
  );
}

function MembershipGroups({
  groups,
  graphNodesById
}: {
  groups: Array<[string, ProjectConceptMembershipDto[]]>;
  graphNodesById: Map<string, ConceptDetailResponse["graphNodes"][number]>;
}) {
  if (groups.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">Memberships</h3>
        <p className="mt-2 text-xs text-slate-500">None</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">Memberships</h3>
      <div className="mt-2 grid gap-3">
        {groups.map(([role, memberships]) => (
          <div key={role}>
            <h4 className="text-xs font-medium text-slate-700">{role}</h4>
            <ul className="mt-2 grid gap-2">
              {memberships.map((membership) => {
                const graphNode = graphNodesById.get(membership.graphNodeId);

                return (
                  <li
                    key={membership.id}
                    className="rounded border border-slate-200 p-2 text-xs text-slate-700"
                  >
                    <span className="block truncate font-medium">
                      {graphNode?.label ?? membership.graphNodeId}
                    </span>
                    <span className="block truncate text-slate-500">
                      {graphNode?.path ?? graphNode?.nodeKey ?? "unknown graph node"}
                    </span>
                    <span className="mt-1 block text-slate-600">{membership.rationale}</span>
                    <span className="mt-1 block text-slate-500">
                      Confidence {formatConfidence(membership.confidence)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelationshipGroups({
  title,
  groups,
  relatedConceptsById
}: {
  title: string;
  groups: Record<string, ProjectConceptRelationshipDto[]>;
  relatedConceptsById: Map<string, ProjectConceptDto>;
}) {
  const entries = Object.entries(groups).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
        <p className="mt-2 text-xs text-slate-500">None</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      <div className="mt-2 grid gap-3">
        {entries.map(([relationshipType, relationships]) => (
          <div key={relationshipType}>
            <h4 className="text-xs font-medium text-slate-700">{relationshipType}</h4>
            <ul className="mt-2 grid gap-2">
              {relationships.map((relationship) => {
                const relatedConcept = relatedConceptsById.get(relationship.toConceptId);

                return (
                  <li
                    key={relationship.id}
                    className="rounded border border-slate-200 p-2 text-xs text-slate-700"
                  >
                    <span className="block truncate font-medium">
                      {relatedConcept?.name ?? relationship.toConceptId}
                    </span>
                    <span className="block truncate text-slate-500">
                      {relatedConcept?.conceptType ?? "unknown"}
                    </span>
                    <span className="mt-1 block text-slate-600">{relationship.rationale}</span>
                    <span className="mt-1 block text-slate-500">
                      Confidence {formatConfidence(relationship.confidence)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function CountList({ title, counts }: { title: string; counts: Array<[string, number]> }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {counts.length > 0 ? (
        <div className="mt-2 grid gap-1 text-xs">
          {counts.map(([key, value]) => (
            <StatusLine key={key} label={key} value={String(value)} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">None</p>
      )}
    </div>
  );
}

function Diagnostics({
  diagnostics
}: {
  diagnostics: Array<{ code: string; level: string; message: string }>;
}) {
  if (diagnostics.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">No concept warnings</p>;
  }

  return (
    <ul className="mt-3 grid gap-2">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.level}-${diagnostic.code}`}
          className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
        >
          <span className="block truncate font-medium">{diagnostic.code}</span>
          <span className="block">{diagnostic.message}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="truncate text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function countEntries(value: Record<string, unknown>): Array<[string, number]> {
  return Object.entries(value)
    .map(([key, count]) => [key, typeof count === "number" ? count : 0] as [string, number])
    .sort(([left], [right]) => left.localeCompare(right));
}

function groupMembershipsByRole(
  memberships: ProjectConceptMembershipDto[]
): Array<[string, ProjectConceptMembershipDto[]]> {
  const groups = new Map<string, ProjectConceptMembershipDto[]>();
  for (const membership of memberships) {
    const group = groups.get(membership.role) ?? [];
    group.push(membership);
    groups.set(membership.role, group);
  }

  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function formatConfidence(value: number) {
  return value.toFixed(2);
}
