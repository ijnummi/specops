import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, RefreshCw, Save, XCircle } from "lucide-react";
import type { ProposalConflictDto, ProposalStatus, ProposalSummaryDto } from "@specops/contracts";

import {
  acceptProposals,
  generateSourceImportProposals,
  patchProposal,
  proposalQuery,
  proposalsQuery,
  queryKeys
} from "../api/queries.js";
import { MarkdownEditor } from "../components/markdown-editor.js";

type ProposalMarkdownDraft = {
  markdown: string;
  savedMarkdown: string;
};

type ProposalStatusFilter = "pending" | "accepted" | "rejected" | "obsolete";

const proposalStatusFilters = [
  "pending",
  "accepted",
  "rejected",
  "obsolete"
] satisfies ProposalStatusFilter[];

export function SourceImportPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ProposalStatusFilter>("pending");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [checkedProposalIds, setCheckedProposalIds] = useState<Set<string>>(() => new Set());
  const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, ProposalMarkdownDraft>>(
    () => ({})
  );
  const [dirtyNavigationBlocked, setDirtyNavigationBlocked] = useState(false);

  const proposals = useQuery(proposalsQuery(projectId));
  const allProposals = useMemo(() => proposals.data ?? [], [proposals.data]);
  const visibleProposals = useMemo(
    () => allProposals.filter((proposal) => matchesStatusFilter(proposal.status, statusFilter)),
    [allProposals, statusFilter]
  );
  const allProposalIds = useMemo(
    () => new Set(allProposals.map((proposal) => proposal.id)),
    [allProposals]
  );
  const visibleProposalIds = useMemo(
    () => new Set(visibleProposals.map((proposal) => proposal.id)),
    [visibleProposals]
  );
  const pendingProposalIds = useMemo(
    () =>
      new Set(
        allProposals
          .filter((proposal) => proposal.status === "pending")
          .map((proposal) => proposal.id)
      ),
    [allProposals]
  );
  const proposalCounts = useMemo(
    () => ({
      pending: allProposals.filter((proposal) => proposal.status === "pending").length,
      accepted: allProposals.filter((proposal) =>
        matchesStatusFilter(proposal.status, "accepted")
      ).length,
      rejected: allProposals.filter((proposal) => proposal.status === "rejected").length,
      obsolete: allProposals.filter((proposal) => proposal.status === "obsolete").length
    }),
    [allProposals]
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
  const dirtyProposalIds = useMemo(
    () =>
      Object.entries(markdownDrafts)
        .filter(([_proposalId, draft]) => draft.markdown !== draft.savedMarkdown)
        .map(([proposalId]) => proposalId),
    [markdownDrafts]
  );
  const hasDirtyDraft = dirtyProposalIds.length > 0;
  const selectedProposalIsPending = selectedDetail.data?.status === "pending";

  useEffect(() => {
    if (!selectedProposalId && visibleProposals.length > 0) {
      setSelectedProposalId(visibleProposals[0]!.id);
    }
  }, [selectedProposalId, visibleProposals]);

  useEffect(() => {
    setCheckedProposalIds((current) => {
      const next = new Set([...current].filter((proposalId) => pendingProposalIds.has(proposalId)));
      return next.size === current.size ? current : next;
    });
    setMarkdownDrafts((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([proposalId]) => allProposalIds.has(proposalId))
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [allProposalIds, pendingProposalIds]);

  useEffect(() => {
    if (!hasDirtyDraft) {
      setDirtyNavigationBlocked(false);
    }
  }, [hasDirtyDraft]);

  const invalidateSourceImport = async (proposalId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) }),
      proposalId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.proposal(projectId, proposalId) })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
    ]);
  };

  const generateMutation = useMutation({
    mutationFn: () => generateSourceImportProposals(projectId),
    onSuccess: async () => {
      setSelectedProposalId(null);
      setCheckedProposalIds(new Set());
      setMarkdownDrafts({});
      await invalidateSourceImport();
    }
  });
  const acceptMutation = useMutation({
    mutationFn: () => acceptProposals(projectId, { proposalIds: [...checkedProposalIds] }),
    onSuccess: async () => {
      setSelectedProposalId(null);
      setCheckedProposalIds(new Set());
      setMarkdownDrafts({});
      await invalidateSourceImport(effectiveSelectedProposalId);
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
      await invalidateSourceImport(proposalId);
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
      await invalidateSourceImport(updated.id);
    }
  });
  const selectedCount = checkedProposalIds.size;
  const hasDirtyCheckedProposal = [...checkedProposalIds].some((proposalId) => {
    const draft = markdownDrafts[proposalId];
    return draft ? draft.markdown !== draft.savedMarkdown : false;
  });
  const dirtyActionBlockMessage = hasDirtyDraft
    ? "Save edits before accepting selected proposals. Other review actions are paused until edits are saved."
    : saveMutation.isPending
      ? "Waiting for markdown save before accepting selected proposals."
      : null;
  const isAcceptDisabled =
    selectedCount === 0 ||
    acceptMutation.isPending ||
    saveMutation.isPending ||
    hasDirtyCheckedProposal ||
    hasDirtyDraft;
  const isGenerateDisabled = generateMutation.isPending || saveMutation.isPending || hasDirtyDraft;
  const isRejectDisabled =
    rejectMutation.isPending || saveMutation.isPending || hasDirtyDraft || !selectedProposalIsPending;
  const isReviewActionPending =
    generateMutation.isPending ||
    acceptMutation.isPending ||
    rejectMutation.isPending ||
    saveMutation.isPending;

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
  const blockDirtyNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!hasDirtyDraft) {
      return;
    }

    event.preventDefault();
    setDirtyNavigationBlocked(true);
  };

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Import from source</h1>
          <p className="truncate text-sm text-slate-600">Review source-derived spec proposals.</p>
        </div>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: undefined }}
          className="button-secondary"
          onClick={blockDirtyNavigation}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to project
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-y border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{proposalCounts.pending}</span> pending
          proposals
          {selectedCount > 0 ? (
            <span className="ml-2 text-slate-500">{selectedCount} selected</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Proposal status">
          {proposalStatusFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              role="tab"
              aria-selected={statusFilter === filter}
              className={
                statusFilter === filter
                  ? "rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
                  : "rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              }
              onClick={() => {
                setStatusFilter(filter);
                setSelectedProposalId(null);
              }}
            >
              {statusFilterLabel(filter)} {proposalCounts[filter]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button-secondary"
            disabled={isGenerateDisabled}
            onClick={() => {
              if (isGenerateDisabled) {
                return;
              }
              generateMutation.mutate();
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Generate proposals
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={isAcceptDisabled}
            onClick={() => {
              if (isAcceptDisabled) {
                return;
              }
              acceptMutation.mutate();
            }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Accept selected
          </button>
        </div>
        {dirtyActionBlockMessage ? (
          <p className="basis-full text-xs text-amber-700">{dirtyActionBlockMessage}</p>
        ) : null}
        {dirtyNavigationBlocked ? (
          <p className="basis-full text-xs text-amber-700">Save edits before leaving source import.</p>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">
              {statusFilterLabel(statusFilter)} proposals
            </h2>
            <p className="text-xs text-slate-500">Select proposals for batch acceptance.</p>
          </header>
          {proposals.error ? (
            <div className="p-3 text-sm text-red-700">{proposals.error.message}</div>
          ) : proposals.isLoading ? (
            <p className="p-3 text-sm text-slate-500">Loading proposals...</p>
          ) : visibleProposals.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">
              No {statusFilterLabel(statusFilter).toLowerCase()} source import proposals.
            </p>
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
            <div className="flex h-full min-h-0 flex-col">
              <header className="border-b border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900">
                      {selectedDetail.data.title}
                    </h2>
                    <p className="truncate text-sm text-slate-600">{selectedDetail.data.filePath}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                        {selectedDetail.data.entityType}
                      </span>
                      <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                        {selectedDetail.data.entityId}
                      </span>
                      <ConflictBadge conflict={selectedDetail.data.conflict} />
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
                        rejectMutation.mutate(selectedDetail.data.id);
                      }}
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      Reject
                    </button>
                    <button
                      type="button"
                      className="button-primary"
                      disabled={!isMarkdownDirty || saveMutation.isPending || !selectedProposalIsPending}
                      onClick={() =>
                        saveMutation.mutate({
                          proposalId: selectedDetail.data.id,
                          markdown: editorMarkdown
                        })
                      }
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save markdown
                    </button>
                  </div>
                </div>
              </header>
              <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-h-0 border-b border-slate-200 lg:border-r lg:border-b-0">
                  <MarkdownEditor
                    value={editorMarkdown}
                    height="100%"
                    minHeight="0px"
                    className="h-full min-h-0"
                    editable={selectedProposalIsPending}
                    onChange={(markdown) => {
                      if (!selectedProposalIsPending) {
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
                  />
                </div>
                {selectedDetail.data.proposalType === "source_spec_entity" ? (
                  <aside className="min-h-0 overflow-auto">
                    <section className="panel-section">
                      <h3 className="section-heading">Source evidence</h3>
                      <div className="mt-2 grid gap-2">
                        {selectedDetail.data.evidence.sourceFiles.map((sourceFile) => (
                          <div
                            key={`${sourceFile.file}:${sourceFile.symbolName}:${sourceFile.line ?? ""}`}
                            className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                          >
                            <div className="truncate font-medium text-slate-900">
                              {sourceFile.file}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-600">
                              <span>{sourceFile.symbolKind}</span>
                              <span className="font-medium text-slate-800">
                                {sourceFile.symbolName}
                              </span>
                              {sourceFile.line ? <span>line {sourceFile.line}</span> : null}
                              {sourceFile.exported ? <span>exported</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </aside>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-slate-500">Proposal detail is unavailable.</div>
          )}
        </section>
      </div>
      {mutationError(generateMutation.error, "Generate proposals failed")}
      {mutationError(acceptMutation.error, "Accept selected failed")}
      {mutationError(rejectMutation.error, "Reject proposal failed")}
      {mutationError(saveMutation.error, "Save markdown failed")}
      {isReviewActionPending ? (
        <p className="mt-2 text-xs text-slate-500">Updating source import review...</p>
      ) : null}
    </main>
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
      <button type="button" className="min-w-0 text-left" onClick={onSelect}>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{proposal.title}</span>
          <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
            {formatConfidence(proposal.confidence)}
          </span>
        </span>
        <span className="block truncate text-xs text-slate-500">{proposal.filePath}</span>
        <span className="block truncate text-xs text-slate-500">
          {proposal.entityId} · {proposal.entityType}
        </span>
      </button>
    </div>
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

function formatConfidence(confidence: number | null) {
  return confidence === null ? "n/a" : `${Math.round(confidence * 100)}%`;
}

function matchesStatusFilter(status: ProposalStatus, filter: ProposalStatusFilter) {
  if (filter === "accepted") {
    return status === "accepted" || status === "edited_and_accepted";
  }

  return status === filter;
}

function statusFilterLabel(status: ProposalStatusFilter) {
  switch (status) {
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

function mutationError(error: Error | null, label: string) {
  return error ? <p className="mt-2 text-sm text-red-700">{label}: {error.message}</p> : null;
}
