import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiPrefillGenerateRequest,
  ProposalConflictDto,
  ProposalSummaryDto,
  SourceFileSummaryDto
} from "@specops/contracts";

import {
  acceptProposals,
  generateAiPrefillProposals,
  patchProposal,
  proposalQuery,
  proposalsQuery,
  queryKeys,
  sourceFilesQuery
} from "../api/queries.js";

type AiProvider = AiPrefillGenerateRequest["provider"];
type ProposalMarkdownDraft = {
  markdown: string;
  savedMarkdown: string;
};
type ProposalStatusFilter = "pending" | "accepted" | "rejected" | "obsolete";

const defaultProvider: AiProvider = "ollama";
const defaultModel = "qwen2.5-coder:7b";
const proposalStatusFilters = [
  "pending",
  "accepted",
  "rejected",
  "obsolete"
] satisfies ProposalStatusFilter[];

export function AiPrefillPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<AiProvider>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [selectedSourceFileIds, setSelectedSourceFileIds] = useState<Set<string>>(
    () => new Set()
  );
  const [statusFilter, setStatusFilter] = useState<ProposalStatusFilter>("pending");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [checkedProposalIds, setCheckedProposalIds] = useState<Set<string>>(() => new Set());
  const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, ProposalMarkdownDraft>>(
    () => ({})
  );

  const sourceFiles = useQuery(sourceFilesQuery(projectId, { limit: 100, offset: 0 }));
  const proposals = useQuery(
    proposalsQuery(projectId, { proposalType: "ai_spec_entity", status: statusFilter })
  );
  const pendingProposals = useMemo(
    () => (proposals.data ?? []).filter((proposal) => proposal.status === "pending"),
    [proposals.data]
  );
  const allProposalIds = useMemo(
    () => new Set((proposals.data ?? []).map((proposal) => proposal.id)),
    [proposals.data]
  );
  const pendingProposalIds = useMemo(
    () => new Set(pendingProposals.map((proposal) => proposal.id)),
    [pendingProposals]
  );
  const selectedDetail = useQuery({
    ...proposalQuery(projectId, selectedProposalId ?? ""),
    enabled: selectedProposalId !== null
  });
  const selectedDraft = selectedProposalId ? markdownDrafts[selectedProposalId] : undefined;
  const selectedAiDetail =
    selectedDetail.data?.proposalType === "ai_spec_entity" ? selectedDetail.data : null;
  const editorMarkdown = selectedDraft?.markdown ?? selectedAiDetail?.payload.markdown ?? "";
  const isMarkdownDirty = selectedDraft
    ? selectedDraft.markdown !== selectedDraft.savedMarkdown
    : false;
  const hasDirtyDraft = Object.values(markdownDrafts).some(
    (draft) => draft.markdown !== draft.savedMarkdown
  );
  const hasDirtyCheckedProposal = [...checkedProposalIds].some((proposalId) => {
    const draft = markdownDrafts[proposalId];
    return draft ? draft.markdown !== draft.savedMarkdown : false;
  });
  const selectedProposalIsPending = selectedAiDetail?.status === "pending";

  const generateMutation = useMutation({
    mutationFn: () =>
      generateAiPrefillProposals(projectId, {
        provider,
        model,
        sourceFileIds: [...selectedSourceFileIds],
        temperature: 0.1
      }),
    onSuccess: async () => {
      setSelectedSourceFileIds(new Set());
      setSelectedProposalId(null);
      setCheckedProposalIds(new Set());
      setMarkdownDrafts({});
      await invalidateAiPrefill();
    }
  });
  const acceptMutation = useMutation({
    mutationFn: () => acceptProposals(projectId, { proposalIds: [...checkedProposalIds] }),
    onSuccess: async () => {
      setSelectedProposalId(null);
      setCheckedProposalIds(new Set());
      setMarkdownDrafts({});
      await invalidateAiPrefill(selectedProposalId);
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
      await invalidateAiPrefill(proposalId);
    }
  });
  const saveMutation = useMutation({
    mutationFn: ({ proposalId, markdown }: { proposalId: string; markdown: string }) =>
      patchProposal(projectId, proposalId, { markdown }),
    onSuccess: async (updated) => {
      if (updated.proposalType === "ai_spec_entity") {
        setMarkdownDrafts((current) => ({
          ...current,
          [updated.id]: {
            markdown: updated.payload.markdown,
            savedMarkdown: updated.payload.markdown
          }
        }));
      }
      await invalidateAiPrefill(updated.id);
    }
  });

  const toggleSourceFile = (sourceFileId: string) => {
    setSelectedSourceFileIds((current) => {
      const next = new Set(current);
      if (next.has(sourceFileId)) {
        next.delete(sourceFileId);
      } else {
        next.add(sourceFileId);
      }
      return next;
    });
  };
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
  const invalidateAiPrefill = async (proposalId?: string | null) => {
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

  const isGenerateDisabled =
    selectedSourceFileIds.size === 0 || model.trim().length === 0 || generateMutation.isPending;
  const isAcceptDisabled =
    checkedProposalIds.size === 0 ||
    acceptMutation.isPending ||
    saveMutation.isPending ||
    hasDirtyCheckedProposal ||
    hasDirtyDraft;
  const isRejectDisabled =
    !selectedProposalIsPending ||
    rejectMutation.isPending ||
    saveMutation.isPending ||
    hasDirtyDraft;
  const isSaveDisabled =
    !selectedProposalIsPending || !isMarkdownDirty || saveMutation.isPending;
  const isReviewActionPending =
    acceptMutation.isPending || rejectMutation.isPending || saveMutation.isPending;

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

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">AI Prefill</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Select indexed source files, choose an AI provider, and generate draft spec proposals
            for review.
          </p>
        </div>
        <button
          type="button"
          className="button-primary justify-center"
          disabled={isGenerateDisabled}
          onClick={() => generateMutation.mutate()}
        >
          Generate
        </button>
      </div>

      <div className="mb-3 grid gap-3 border-y border-slate-200 bg-slate-50 px-3 py-3 md:grid-cols-[220px_minmax(260px,420px)_1fr]">
        <label className="field">
          <span>Provider</span>
          <select
            className="input h-9 py-1"
            value={provider}
            onChange={(event) => setProvider(event.currentTarget.value as AiProvider)}
          >
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <input
            className="input h-9"
            value={model}
            onChange={(event) => setModel(event.currentTarget.value)}
          />
        </label>
        <div className="flex min-w-0 items-end text-sm text-slate-600">
          <span className="truncate">
            {selectedSourceFileIds.size} selected from {(sourceFiles.data ?? []).length} loaded
            source files
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border border-slate-200 lg:grid-cols-[minmax(360px,1fr)_minmax(320px,420px)_minmax(360px,1fr)]">
        <section className="min-h-0 overflow-hidden border-b border-slate-200 lg:border-r lg:border-b-0">
          <div className="border-b border-slate-200 bg-white px-3 py-2">
            <h2 className="section-heading">Source files</h2>
          </div>
          <div className="h-full overflow-auto">
            {sourceFiles.error ? (
              <div className="p-3 text-sm text-red-700">{sourceFiles.error.message}</div>
            ) : sourceFiles.isLoading ? (
              <div className="p-3 text-sm text-slate-600">Loading source files...</div>
            ) : (sourceFiles.data ?? []).length === 0 ? (
              <div className="p-3 text-sm text-slate-600">No indexed source files found.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {(sourceFiles.data ?? []).map((sourceFile) => (
                  <SourceFileRow
                    key={sourceFile.id}
                    sourceFile={sourceFile}
                    checked={selectedSourceFileIds.has(sourceFile.id)}
                    onToggle={() => toggleSourceFile(sourceFile.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden border-b border-slate-200 lg:border-r lg:border-b-0">
          <div className="grid gap-2 border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="section-heading">{statusFilterLabel(statusFilter)} proposals</h2>
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
                Accept selected
              </button>
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
                  {statusFilterLabel(filter)}
                </button>
              ))}
            </div>
            {hasDirtyDraft ? (
              <p className="text-xs text-amber-700">
                Save edits before accepting selected proposals.
              </p>
            ) : null}
          </div>
          <div className="h-full overflow-auto">
            {proposals.error ? (
              <div className="p-3 text-sm text-red-700">{proposals.error.message}</div>
            ) : proposals.isLoading ? (
              <div className="p-3 text-sm text-slate-600">Loading proposals...</div>
            ) : (proposals.data ?? []).length === 0 ? (
              <div className="p-3 text-sm text-slate-600">
                No {statusFilterLabel(statusFilter).toLowerCase()} AI proposals.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {(proposals.data ?? []).map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    checked={proposal.status === "pending" && checkedProposalIds.has(proposal.id)}
                    selected={proposal.id === selectedProposalId}
                    selectable={proposal.status === "pending"}
                    onCheckedChange={() => toggleCheckedProposal(proposal.id)}
                    onSelect={() => setSelectedProposalId(proposal.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-white px-3 py-2">
            <h2 className="section-heading">Proposal detail</h2>
          </div>
          {selectedProposalId === null ? (
            <div className="p-4 text-sm text-slate-600">Select a proposal to review.</div>
          ) : selectedDetail.error ? (
            <div className="p-4 text-sm text-red-700">{selectedDetail.error.message}</div>
          ) : selectedDetail.isLoading ? (
            <div className="p-4 text-sm text-slate-600">Loading proposal detail...</div>
          ) : selectedAiDetail ? (
            <div className="flex h-full min-h-0 flex-col">
              <header className="border-b border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900">
                      {selectedAiDetail.title}
                    </h2>
                    <p className="truncate text-sm text-slate-600">{selectedAiDetail.filePath}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                        {selectedAiDetail.entityType}
                      </span>
                      <span className="rounded border border-slate-200 px-1.5 py-0.5 font-medium">
                        {selectedAiDetail.entityId}
                      </span>
                      <ConflictBadge conflict={selectedAiDetail.conflict} />
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
                        rejectMutation.mutate(selectedAiDetail.id);
                      }}
                    >
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
                        saveMutation.mutate({
                          proposalId: selectedAiDetail.id,
                          markdown: editorMarkdown
                        });
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </header>
              <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-h-0 border-b border-slate-200 lg:border-r lg:border-b-0">
                  <textarea
                    aria-label="Proposal markdown"
                    className="h-full min-h-[360px] w-full resize-none border-0 p-3 font-mono text-sm outline-none"
                    value={editorMarkdown}
                    disabled={!selectedProposalIsPending}
                    onInput={(event) => {
                      if (!selectedProposalIsPending) {
                        return;
                      }
                      setMarkdownDrafts((current) => ({
                        ...current,
                        [selectedAiDetail.id]: {
                          markdown: event.currentTarget.value,
                          savedMarkdown:
                            current[selectedAiDetail.id]?.savedMarkdown ??
                            selectedAiDetail.payload.markdown
                        }
                      }));
                    }}
                  />
                </div>
                <aside className="min-h-0 overflow-auto">
                  <section className="panel-section">
                    <h3 className="section-heading">AI evidence</h3>
                    <dl className="mt-2 grid gap-2 text-xs">
                      <EvidenceItem label="Provider" value={selectedAiDetail.evidence.provider} />
                      <EvidenceItem label="Model" value={selectedAiDetail.evidence.model} />
                      <EvidenceItem
                        label="Prompt version"
                        value={selectedAiDetail.evidence.promptVersion}
                      />
                    </dl>
                    <div className="mt-3 grid gap-2">
                      {selectedAiDetail.evidence.claims.map((claim) => (
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
                  </section>
                  <section className="panel-section border-t border-slate-200">
                    <h3 className="section-heading">Proposed links</h3>
                    {selectedAiDetail.payload.proposedLinks.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">No proposed links.</p>
                    ) : (
                      <div className="mt-2 grid gap-2">
                        {selectedAiDetail.payload.proposedLinks.map((link) => (
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
                </aside>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-slate-600">Proposal detail is unavailable.</div>
          )}
        </section>
      </div>

      {generateMutation.error ? (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Generate failed: {generateMutation.error.message}
        </div>
      ) : null}
      {mutationError(acceptMutation.error, "Accept selected failed")}
      {mutationError(rejectMutation.error, "Reject proposal failed")}
      {mutationError(saveMutation.error, "Save markdown failed")}
      {isReviewActionPending ? (
        <p className="mt-2 text-xs text-slate-500">Updating AI Prefill review...</p>
      ) : null}
    </main>
  );
}

function SourceFileRow({
  checked,
  onToggle,
  sourceFile
}: {
  checked: boolean;
  onToggle: () => void;
  sourceFile: SourceFileSummaryDto;
}) {
  return (
    <label className="grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-2 text-sm hover:bg-slate-50">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={onToggle}
        aria-label={`Select ${sourceFile.path}`}
      />
      <span className="grid min-w-0 gap-1">
        <span className="truncate font-medium text-slate-900">{sourceFile.path}</span>
        <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{sourceFile.kind}</span>
          <span>{sourceFile.language}</span>
          <span>{sourceFile.symbolCount} symbols</span>
        </span>
      </span>
    </label>
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
          ? "grid grid-cols-[auto_minmax(0,1fr)] gap-3 bg-slate-100 px-3 py-2 text-sm"
          : "grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-2 text-sm hover:bg-slate-50"
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
          <span className="truncate font-medium text-slate-900">{proposal.title}</span>
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

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{value}</dd>
    </div>
  );
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "n/a" : `${Math.round(confidence * 100)}%`;
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
