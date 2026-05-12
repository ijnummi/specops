import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Save, XCircle } from "lucide-react";
import type {
  AiSpecEntityProposalDetail,
  ProposalConflictDto,
  ProposalDetailDto,
  ProposalStatus,
  ProposalSummaryDto,
  ProposalType,
  SourceSpecEntityProposalDetail
} from "@specops/contracts";

import {
  acceptProposals,
  analyzeRunQuery,
  patchProposal,
  proposalQuery,
  proposalsQuery,
  queryKeys
} from "../api/queries.js";

type AnalyzeRunReviewPageProps = {
  projectId: string;
  runId: string;
};

type ProposalMarkdownDraft = {
  markdown: string;
  savedMarkdown: string;
};

type ProposalStatusFilter = "all" | "pending" | "accepted" | "rejected" | "obsolete";
type ProposalTypeFilter = "all" | ProposalType;

const proposalStatusFilters = [
  "all",
  "pending",
  "accepted",
  "rejected",
  "obsolete"
] satisfies ProposalStatusFilter[];
const proposalTypeFilters = [
  "all",
  "source_spec_entity",
  "ai_spec_entity"
] satisfies ProposalTypeFilter[];

class RejectSelectedError extends Error {
  constructor(
    readonly succeededProposalIds: string[],
    readonly failedProposalIds: string[]
  ) {
    super(`Failed to reject ${failedProposalIds.join(", ")}`);
    this.name = "RejectSelectedError";
  }
}

export function AnalyzeRunReviewPage({ projectId, runId }: AnalyzeRunReviewPageProps) {
  const queryClient = useQueryClient();
  const [pendingOnly, setPendingOnly] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ProposalStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ProposalTypeFilter>("all");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [checkedProposalIds, setCheckedProposalIds] = useState<Set<string>>(() => new Set());
  const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, ProposalMarkdownDraft>>(
    () => ({})
  );

  const run = useQuery(analyzeRunQuery(projectId, runId));
  const sourceProposals = useQuery(
    proposalsQuery(projectId, { proposalType: "source_spec_entity" })
  );
  const aiProposals = useQuery(proposalsQuery(projectId, { proposalType: "ai_spec_entity" }));
  const runProposalIds = useMemo(() => new Set(run.data?.proposalIds ?? []), [run.data]);
  const allProposals = useMemo(
    () =>
      [...(sourceProposals.data ?? []), ...(aiProposals.data ?? [])].sort(
        compareProposalSummaries
      ),
    [aiProposals.data, sourceProposals.data]
  );
  const runProposals = useMemo(
    () => allProposals.filter((proposal) => runProposalIds.has(proposal.id)),
    [allProposals, runProposalIds]
  );
  const proposalsError = run.error ?? sourceProposals.error ?? aiProposals.error;
  const proposalsLoading = run.isLoading || sourceProposals.isLoading || aiProposals.isLoading;
  const visibleProposals = useMemo(
    () =>
      runProposals.filter(
        (proposal) =>
          (pendingOnly
            ? proposal.status === "pending"
            : matchesStatusFilter(proposal.status, statusFilter)) &&
          (typeFilter === "all" || proposal.proposalType === typeFilter)
      ),
    [pendingOnly, runProposals, statusFilter, typeFilter]
  );
  const allProposalIds = useMemo(
    () => new Set(runProposals.map((proposal) => proposal.id)),
    [runProposals]
  );
  const visibleProposalIds = useMemo(
    () => new Set(visibleProposals.map((proposal) => proposal.id)),
    [visibleProposals]
  );
  const visiblePendingProposalIds = useMemo(
    () =>
      new Set(
        visibleProposals
          .filter((proposal) => proposal.status === "pending")
          .map((proposal) => proposal.id)
      ),
    [visibleProposals]
  );
  const checkedVisiblePendingProposalIds = useMemo(
    () => [...checkedProposalIds].filter((proposalId) => visiblePendingProposalIds.has(proposalId)),
    [checkedProposalIds, visiblePendingProposalIds]
  );
  const proposalCounts = useMemo(
    () => ({
      all: runProposals.length,
      pending: runProposals.filter((proposal) => proposal.status === "pending").length,
      accepted: runProposals.filter((proposal) =>
        matchesStatusFilter(proposal.status, "accepted")
      ).length,
      rejected: runProposals.filter((proposal) => proposal.status === "rejected").length,
      obsolete: runProposals.filter((proposal) => proposal.status === "obsolete").length
    }),
    [runProposals]
  );
  const typeCounts = useMemo(
    () => ({
      all: runProposals.length,
      source_spec_entity: runProposals.filter(
        (proposal) => proposal.proposalType === "source_spec_entity"
      ).length,
      ai_spec_entity: runProposals.filter((proposal) => proposal.proposalType === "ai_spec_entity")
        .length
    }),
    [runProposals]
  );
  const effectiveSelectedProposalId =
    selectedProposalId && visibleProposalIds.has(selectedProposalId)
      ? selectedProposalId
      : (visibleProposals[0]?.id ?? null);
  const selectedDetail = useQuery({
    ...proposalQuery(projectId, effectiveSelectedProposalId ?? ""),
    enabled: effectiveSelectedProposalId !== null
  });
  const selectedDraft = effectiveSelectedProposalId
    ? markdownDrafts[effectiveSelectedProposalId]
    : undefined;
  const editorMarkdown =
    selectedDraft?.markdown ?? selectedDetail.data?.payload.markdown ?? "";
  const isMarkdownDirty = selectedDraft
    ? selectedDraft.markdown !== selectedDraft.savedMarkdown
    : false;
  const hasDirtyDraft = Object.values(markdownDrafts).some(
    (draft) => draft.markdown !== draft.savedMarkdown
  );
  const selectedProposalIsPending = selectedDetail.data?.status === "pending";
  const hasDirtyCheckedProposal = [...checkedProposalIds].some((proposalId) => {
    const draft = markdownDrafts[proposalId];
    return draft ? draft.markdown !== draft.savedMarkdown : false;
  });

  useEffect(() => {
    if (!selectedProposalId && visibleProposals.length > 0) {
      setSelectedProposalId(visibleProposals[0]!.id);
    }
  }, [selectedProposalId, visibleProposals]);

  useEffect(() => {
    setCheckedProposalIds((current) => {
      const next = new Set(
        [...current].filter((proposalId) => visiblePendingProposalIds.has(proposalId))
      );
      return next.size === current.size ? current : next;
    });
    setMarkdownDrafts((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([proposalId, draft]) =>
            allProposalIds.has(proposalId) || draft.markdown !== draft.savedMarkdown
        )
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [allProposalIds, visiblePendingProposalIds]);

  const invalidateAnalyzeReview = async (proposalIds: string[] = []) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReadiness(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) }),
      ...proposalIds.map((proposalId) =>
        queryClient.invalidateQueries({ queryKey: queryKeys.proposal(projectId, proposalId) })
      ),
      queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
    ]);
  };

  const clearRejectedProposals = async (proposalIds: string[]) => {
    if (proposalIds.length === 0) {
      return;
    }

    const rejectedIds = new Set(proposalIds);
    setSelectedProposalId((current) => (current && rejectedIds.has(current) ? null : current));
    setCheckedProposalIds((current) => {
      const next = new Set(current);
      for (const proposalId of rejectedIds) {
        next.delete(proposalId);
      }
      return next;
    });
    setMarkdownDrafts((current) => {
      const next = { ...current };
      for (const proposalId of rejectedIds) {
        delete next[proposalId];
      }
      return next;
    });
    await invalidateAnalyzeReview(proposalIds);
  };

  const acceptMutation = useMutation({
    mutationFn: (proposalIds: string[]) => acceptProposals(projectId, { proposalIds }),
    onSuccess: async (_accepted, proposalIds) => {
      setSelectedProposalId(null);
      setCheckedProposalIds(new Set());
      setMarkdownDrafts({});
      await invalidateAnalyzeReview(proposalIds);
    }
  });
  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => patchProposal(projectId, proposalId, { status: "rejected" }),
    onSuccess: async (_updated, proposalId) => {
      setSelectedProposalId(null);
      setCheckedProposalIds((current) => {
        const next = new Set(current);
        next.delete(proposalId);
        return next;
      });
      setMarkdownDrafts((current) => {
        const { [proposalId]: _removed, ...next } = current;
        return next;
      });
      await invalidateAnalyzeReview([proposalId]);
    }
  });
  const rejectSelectedMutation = useMutation({
    mutationFn: async (proposalIds: string[]) => {
      const results = await Promise.allSettled(
        proposalIds.map(async (proposalId) => {
          await patchProposal(projectId, proposalId, { status: "rejected" });
          return proposalId;
        })
      );
      const succeededProposalIds: string[] = [];
      const failedProposalIds: string[] = [];

      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          succeededProposalIds.push(result.value);
        } else {
          failedProposalIds.push(proposalIds[index]!);
        }
      }

      if (failedProposalIds.length > 0) {
        throw new RejectSelectedError(succeededProposalIds, failedProposalIds);
      }

      return succeededProposalIds;
    },
    onSuccess: async (succeededProposalIds) => {
      await clearRejectedProposals(succeededProposalIds);
    },
    onError: async (error) => {
      if (error instanceof RejectSelectedError) {
        await clearRejectedProposals(error.succeededProposalIds);
      }
    }
  });
  const saveMutation = useMutation({
    mutationFn: ({ proposalId, markdown }: { proposalId: string; markdown: string }) =>
      patchProposal(projectId, proposalId, { markdown }),
    onSuccess: async (updated) => {
      setMarkdownDrafts((current) => ({
        ...current,
        [updated.id]: {
          markdown: updated.payload.markdown,
          savedMarkdown: updated.payload.markdown
        }
      }));
      await invalidateAnalyzeReview([updated.id]);
    }
  });

  const isReviewMutationPending =
    acceptMutation.isPending ||
    rejectMutation.isPending ||
    rejectSelectedMutation.isPending ||
    saveMutation.isPending;
  const isAcceptDisabled =
    checkedVisiblePendingProposalIds.length === 0 ||
    isReviewMutationPending ||
    hasDirtyCheckedProposal ||
    hasDirtyDraft;
  const isRejectSelectedDisabled =
    checkedVisiblePendingProposalIds.length === 0 || isReviewMutationPending || hasDirtyDraft;
  const isRejectCurrentDisabled =
    !selectedProposalIsPending || isReviewMutationPending || hasDirtyDraft;
  const isSaveDisabled =
    !selectedProposalIsPending || !isMarkdownDirty || isReviewMutationPending;
  const isFilterDisabled = hasDirtyDraft || isReviewMutationPending;

  const toggleCheckedProposal = (proposalId: string) => {
    setCheckedProposalIds((current) => {
      const next = new Set(current);
      if (next.has(proposalId)) {
        next.delete(proposalId);
      } else {
        next.add(proposalId);
      }
      return next;
    });
  };

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Analyze review</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Review source and AI spec entity proposals generated by analyze run {runId}.
          </p>
        </div>
        {hasDirtyDraft ? (
          <button type="button" className="button-secondary" disabled>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to progress
          </button>
        ) : (
          <Link
            to="/projects/$projectId/analyze-runs/$runId"
            params={{ projectId, runId }}
            className="button-secondary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to progress
          </Link>
        )}
      </div>

      <div className="mb-3 grid gap-2 border-y border-slate-200 bg-slate-50 px-3 py-2 lg:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
          <span>
            <span className="font-medium text-slate-900">{proposalCounts.pending}</span> pending
          </span>
          <span>{checkedProposalIds.size} selected</span>
          {hasDirtyDraft ? (
            <span className="text-amber-700">Save edits before changing filters or accepting.</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button-primary"
            disabled={isAcceptDisabled}
            onClick={() => {
              if (isAcceptDisabled) {
                return;
              }
              acceptMutation.mutate(checkedVisiblePendingProposalIds);
            }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Accept selected
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={isRejectSelectedDisabled}
            onClick={() => {
              if (isRejectSelectedDisabled) {
                return;
              }
              rejectSelectedMutation.mutate(checkedVisiblePendingProposalIds);
            }}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Reject selected
          </button>
        </div>
        <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            aria-label="Show pending only"
            checked={pendingOnly}
            disabled={isFilterDisabled}
            onChange={(event) => {
              if (isFilterDisabled) {
                return;
              }
              setPendingOnly(event.currentTarget.checked);
              setSelectedProposalId(null);
            }}
          />
          Pending only
        </label>
        <div className="flex flex-wrap items-center gap-1" aria-label="Proposal status filters">
          {proposalStatusFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={statusFilter === filter}
              disabled={pendingOnly || (filter !== statusFilter && isFilterDisabled)}
              className={filterButtonClass(statusFilter === filter)}
              onClick={() => {
                if (pendingOnly || (filter !== statusFilter && isFilterDisabled)) {
                  return;
                }
                setStatusFilter(filter);
                setSelectedProposalId(null);
              }}
            >
              {statusFilterLabel(filter)} {proposalCounts[filter]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label="Proposal type filters">
          {proposalTypeFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={typeFilter === filter}
              disabled={filter !== typeFilter && isFilterDisabled}
              className={filterButtonClass(typeFilter === filter)}
              onClick={() => {
                if (filter !== typeFilter && isFilterDisabled) {
                  return;
                }
                setTypeFilter(filter);
                setSelectedProposalId(null);
              }}
            >
              {typeFilterLabel(filter)} {typeCounts[filter]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">
              {pendingOnly ? "Pending" : statusFilterLabel(statusFilter)} proposals
            </h2>
            <p className="text-xs text-slate-500">Only pending proposals can be selected.</p>
          </header>
          {proposalsError ? (
            <div className="p-3 text-sm text-red-700">{proposalsError.message}</div>
          ) : proposalsLoading ? (
            <p className="p-3 text-sm text-slate-500">Loading proposals...</p>
          ) : (run.data?.proposalIds.length ?? 0) === 0 ? (
            <p className="p-3 text-sm text-slate-500">
              This analyze run did not generate reviewable proposals.
            </p>
          ) : visibleProposals.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No matching proposals.</p>
          ) : (
            <nav className="min-h-0 overflow-auto p-2">
              <div className="grid gap-1">
                {visibleProposals.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    checked={proposal.status === "pending" && checkedProposalIds.has(proposal.id)}
                    selected={proposal.id === effectiveSelectedProposalId}
                    selectable={proposal.status === "pending"}
                    onCheckedChange={() => toggleCheckedProposal(proposal.id)}
                    onSelect={() => setSelectedProposalId(proposal.id)}
                  />
                ))}
              </div>
            </nav>
          )}
        </aside>

        <section className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          {effectiveSelectedProposalId === null ? (
            <div className="p-4 text-sm text-slate-500">Select a proposal to review.</div>
          ) : selectedDetail.error ? (
            <div className="p-4 text-sm text-red-700">{selectedDetail.error.message}</div>
          ) : selectedDetail.isLoading ? (
            <div className="p-4 text-sm text-slate-500">Loading proposal detail...</div>
          ) : selectedDetail.data ? (
            <ProposalDetailPanel
              detail={selectedDetail.data}
              editorMarkdown={editorMarkdown}
              isMarkdownDirty={isMarkdownDirty}
              isRejectDisabled={isRejectCurrentDisabled}
              isSaveDisabled={isSaveDisabled}
              selectedProposalIsPending={selectedProposalIsPending}
              onMarkdownChange={(markdown) => {
                if (!selectedProposalIsPending || !selectedDetail.data) {
                  return;
                }
                setMarkdownDrafts((current) => ({
                  ...current,
                  [selectedDetail.data.id]: {
                    markdown,
                    savedMarkdown:
                      current[selectedDetail.data.id]?.savedMarkdown ??
                      selectedDetail.data.payload.markdown
                  }
                }));
              }}
              onReject={() => rejectMutation.mutate(selectedDetail.data.id)}
              onSave={() =>
                saveMutation.mutate({
                  proposalId: selectedDetail.data.id,
                  markdown: editorMarkdown
                })
              }
            />
          ) : (
            <div className="p-4 text-sm text-slate-500">Proposal detail is unavailable.</div>
          )}
        </section>
      </div>

      {mutationError(acceptMutation.error, "Accept selected failed")}
      {mutationError(rejectMutation.error, "Reject proposal failed")}
      {mutationError(rejectSelectedMutation.error, "Reject selected failed")}
      {mutationError(saveMutation.error, "Save markdown failed")}
      {isReviewMutationPending ? (
        <p className="mt-2 text-xs text-slate-500">Updating analyze review...</p>
      ) : null}
    </main>
  );
}

function ProposalDetailPanel({
  detail,
  editorMarkdown,
  isMarkdownDirty,
  isRejectDisabled,
  isSaveDisabled,
  onMarkdownChange,
  onReject,
  onSave,
  selectedProposalIsPending
}: {
  detail: ProposalDetailDto;
  editorMarkdown: string;
  isMarkdownDirty: boolean;
  isRejectDisabled: boolean;
  isSaveDisabled: boolean;
  onMarkdownChange: (markdown: string) => void;
  onReject: () => void;
  onSave: () => void;
  selectedProposalIsPending: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{detail.title}</h2>
            <p className="truncate text-sm text-slate-600">{detail.filePath}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                {detail.proposalType}
              </span>
              <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                {detail.entityType}
              </span>
              <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                {detail.entityId}
              </span>
              <ConflictBadge conflict={detail.conflict} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className="button-secondary"
              disabled={isRejectDisabled}
              onClick={() => {
                if (isRejectDisabled) {
                  return;
                }
                onReject();
              }}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Reject
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={isSaveDisabled}
              onClick={() => {
                if (isSaveDisabled) {
                  return;
                }
                onSave();
              }}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save markdown
            </button>
          </div>
        </div>
        {isMarkdownDirty ? (
          <p className="mt-2 text-xs text-amber-700">Unsaved markdown edits.</p>
        ) : null}
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0 border-b border-slate-200 lg:border-r lg:border-b-0">
          <textarea
            aria-label="Proposal markdown"
            className="h-full min-h-[360px] w-full resize-none border-0 p-3 font-mono text-sm outline-none"
            value={editorMarkdown}
            disabled={!selectedProposalIsPending}
            onInput={(event) => onMarkdownChange(event.currentTarget.value)}
          />
        </div>
        <aside className="min-h-0 overflow-auto">
          {detail.proposalType === "source_spec_entity" ? (
            <SourceEvidence detail={detail} />
          ) : (
            <AiEvidence detail={detail} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ProposalRow({
  checked,
  onCheckedChange,
  onSelect,
  proposal,
  selectable,
  selected
}: {
  checked: boolean;
  onCheckedChange: () => void;
  onSelect: () => void;
  proposal: ProposalSummaryDto;
  selectable: boolean;
  selected: boolean;
}) {
  return (
    <div
      className={
        selected
          ? "entity-row grid-cols-[auto_minmax(0,1fr)] border-slate-300 bg-slate-100"
          : "entity-row grid-cols-[auto_minmax(0,1fr)] border-transparent hover:border-slate-200 hover:bg-slate-50"
      }
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-slate-300"
        aria-label={`Select ${proposal.title}`}
        checked={checked}
        disabled={!selectable}
        onChange={onCheckedChange}
      />
      <button
        type="button"
        className="min-w-0 text-left"
        aria-label={proposal.title}
        onClick={onSelect}
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{proposal.title}</span>
          <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
            {formatConfidence(proposal.confidence)}
          </span>
        </span>
        <span className="block truncate text-xs text-slate-500">{proposal.filePath}</span>
        <span className="block truncate text-xs text-slate-500">
          {proposal.proposalType} · {proposal.entityId}
        </span>
      </button>
    </div>
  );
}

function SourceEvidence({ detail }: { detail: SourceSpecEntityProposalDetail }) {
  return (
    <section className="panel-section">
      <h3 className="section-heading">Source evidence</h3>
      <dl className="mt-2 grid gap-2 text-xs">
        <EvidenceItem label="Scanner" value={detail.evidence.scanner} />
      </dl>
      <div className="mt-3 grid gap-2">
        {detail.evidence.sourceFiles.map((sourceFile) => (
          <div
            key={`${sourceFile.file}:${sourceFile.symbolName}:${sourceFile.line ?? ""}`}
            className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
          >
            <div className="truncate font-medium text-slate-900">{sourceFile.file}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-600">
              <span>{sourceFile.symbolKind}</span>
              <span className="font-medium text-slate-800">{sourceFile.symbolName}</span>
              {sourceFile.line ? <span>line {sourceFile.line}</span> : null}
              {sourceFile.exported ? <span>exported</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AiEvidence({ detail }: { detail: AiSpecEntityProposalDetail }) {
  return (
    <>
      <section className="panel-section">
        <h3 className="section-heading">AI evidence</h3>
        <dl className="mt-2 grid gap-2 text-xs">
          <EvidenceItem label="Provider" value={detail.evidence.provider} />
          <EvidenceItem label="Model" value={detail.evidence.model} />
          <EvidenceItem label="Prompt version" value={detail.evidence.promptVersion} />
        </dl>
        <div className="mt-3 grid gap-2">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Selected source files</h4>
          {detail.evidence.selectedSourceFiles.length === 0 ? (
            <p className="text-xs text-slate-500">No selected source files recorded.</p>
          ) : (
            detail.evidence.selectedSourceFiles.map((sourceFile) => (
              <div
                key={`${sourceFile.file}:${sourceFile.contentHash}`}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
              >
                <div className="truncate font-medium text-slate-900">{sourceFile.file}</div>
                <div className="mt-1 text-slate-600">
                  lines {sourceFile.excerptStartLine}-{sourceFile.excerptEndLine}
                </div>
                <div className="mt-1 truncate text-slate-500">{sourceFile.contentHash}</div>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="panel-section border-t border-slate-200">
        <h3 className="section-heading">Claims</h3>
        {detail.evidence.claims.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No claims recorded.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {detail.evidence.claims.map((claim) => (
              <div key={claim.text} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                <p className="font-medium text-slate-900">{claim.text}</p>
                <div className="mt-1 grid gap-1 text-slate-600">
                  {claim.sourceFiles.map((sourceFile) => (
                    <span key={sourceFile}>{sourceFile}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel-section border-t border-slate-200">
        <h3 className="section-heading">Warnings</h3>
        {detail.evidence.warnings.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No warnings.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {detail.evidence.warnings.map((warning) => (
              <li
                key={warning}
                className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
              >
                {warning}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel-section border-t border-slate-200">
        <h3 className="section-heading">Proposed links</h3>
        {detail.payload.proposedLinks.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No proposed links.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {detail.payload.proposedLinks.map((link) => (
              <div
                key={`${link.linkType}:${link.targetEntityId}`}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
              >
                <div className="font-medium text-slate-900">
                  {link.linkType} -&gt; {link.targetEntityId}
                </div>
                <p className="mt-1 text-slate-600">{link.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ConflictBadge({ conflict }: { conflict: ProposalConflictDto }) {
  if (conflict.status === "none") {
    return (
      <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">
        no conflict
      </span>
    );
  }

  const label =
    conflict.status === "file_exists"
      ? `file exists: ${conflict.filePath}`
      : conflict.status === "entity_exists"
        ? `entity exists: ${conflict.entityId}`
        : conflict.message;

  return (
    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
      {label}
    </span>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{value}</dd>
    </div>
  );
}

function filterButtonClass(selected: boolean) {
  return selected
    ? "rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
    : "rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60";
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "n/a" : `${Math.round(confidence * 100)}%`;
}

function compareProposalSummaries(left: ProposalSummaryDto, right: ProposalSummaryDto) {
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  if (createdAt !== 0) {
    return createdAt;
  }

  const type = proposalTypeRank(left.proposalType) - proposalTypeRank(right.proposalType);
  if (type !== 0) {
    return type;
  }

  return left.id.localeCompare(right.id);
}

function proposalTypeRank(proposalType: ProposalType) {
  return proposalType === "source_spec_entity" ? 0 : 1;
}

function matchesStatusFilter(status: ProposalStatus, filter: ProposalStatusFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "accepted") {
    return status === "accepted" || status === "edited_and_accepted";
  }

  return status === filter;
}

function statusFilterLabel(status: ProposalStatusFilter) {
  switch (status) {
    case "all":
      return "All";
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "obsolete":
      return "Obsolete";
  }
}

function typeFilterLabel(type: ProposalTypeFilter) {
  switch (type) {
    case "all":
      return "All";
    case "source_spec_entity":
      return "Source";
    case "ai_spec_entity":
      return "AI";
  }
}

function mutationError(error: Error | null, label: string) {
  return error ? <p className="mt-2 text-sm text-red-700">{label}: {error.message}</p> : null;
}
