import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiPrefillGenerateRequest, SourceFileSummaryDto } from "@specops/contracts";

import {
  generateAiPrefillProposals,
  proposalsQuery,
  queryKeys,
  sourceFilesQuery
} from "../api/queries.js";

type AiProvider = AiPrefillGenerateRequest["provider"];

const defaultProvider: AiProvider = "ollama";
const defaultModel = "qwen2.5-coder:7b";

export function AiPrefillPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<AiProvider>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [selectedSourceFileIds, setSelectedSourceFileIds] = useState<Set<string>>(
    () => new Set()
  );

  const sourceFiles = useQuery(sourceFilesQuery(projectId, { limit: 100, offset: 0 }));
  const proposals = useQuery(proposalsQuery(projectId, { proposalType: "ai_spec_entity" }));
  const pendingProposals = useMemo(
    () => (proposals.data ?? []).filter((proposal) => proposal.status === "pending"),
    [proposals.data]
  );

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
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) });
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

  const isGenerateDisabled =
    selectedSourceFileIds.size === 0 || model.trim().length === 0 || generateMutation.isPending;

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
          <div className="border-b border-slate-200 bg-white px-3 py-2">
            <h2 className="section-heading">Pending proposals</h2>
          </div>
          <div className="h-full overflow-auto">
            {proposals.error ? (
              <div className="p-3 text-sm text-red-700">{proposals.error.message}</div>
            ) : proposals.isLoading ? (
              <div className="p-3 text-sm text-slate-600">Loading proposals...</div>
            ) : pendingProposals.length === 0 ? (
              <div className="p-3 text-sm text-slate-600">No pending AI proposals.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {pendingProposals.map((proposal) => (
                  <div key={proposal.id} className="grid gap-1 px-3 py-2 text-sm">
                    <div className="truncate font-medium text-slate-900">{proposal.title}</div>
                    <div className="truncate text-xs text-slate-500">{proposal.filePath}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-white px-3 py-2">
            <h2 className="section-heading">Proposal detail</h2>
          </div>
          <div className="p-4 text-sm text-slate-600">Select a proposal to review.</div>
        </section>
      </div>

      {generateMutation.error ? (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Generate failed: {generateMutation.error.message}
        </div>
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
