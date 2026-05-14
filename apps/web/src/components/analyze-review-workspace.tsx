import { useEffect, useMemo, useState } from "react";
import { Check, FilePlus2, Link2, Save, Trash2 } from "lucide-react";
import type {
  AnalyzeReviewAssemblyDto,
  AnalyzeReviewAttachInputRequest,
  AnalyzeReviewAcceptFailure,
  AnalyzeReviewClaimDto,
  AnalyzeReviewCreateAssemblyRequest,
  AnalyzeReviewCreateClaimRequest,
  AnalyzeReviewInputDto,
  AnalyzeReviewListResponse,
  AnalyzeReviewUpdateAssemblyRequest,
  AnalyzeReviewUpdateClaimRequest
} from "@specops/contracts";

import {
  groupAnalyzeReviewInputs,
  sortAnalyzeReviewAssemblies
} from "./analyze-review-model.js";

export type AnalyzeReviewWorkspaceProps = {
  projectId: string;
  runId: string;
  review: AnalyzeReviewListResponse;
  onCreateAssembly: (input: AnalyzeReviewCreateAssemblyRequest) => void;
  onPatchAssembly: (assemblyId: string, input: AnalyzeReviewUpdateAssemblyRequest) => void;
  onAttachInput: (assemblyId: string, input: AnalyzeReviewAttachInputRequest) => void;
  onRemoveInput: (assemblyId: string, proposalId: string) => void;
  onCreateClaim: (assemblyId: string, input: AnalyzeReviewCreateClaimRequest) => void;
  onPatchClaim: (
    assemblyId: string,
    claimId: string,
    input: AnalyzeReviewUpdateClaimRequest
  ) => void;
  onAcceptAssemblies: (assemblyIds: string[]) => void;
  mutationPending: boolean;
  acceptFailures?: AnalyzeReviewAcceptFailure[];
  focusProposalIds?: string[] | null;
  focusLabel?: string | null;
};

type AssemblyFormState = {
  entityId: string;
  entityType: AnalyzeReviewAssemblyDto["entityType"];
  filePath: string;
  summary: string;
  title: string;
};

type AssemblyFormDraft = {
  assemblyId: string | null;
  dirty: boolean;
  value: AssemblyFormState;
};

export function AnalyzeReviewWorkspace({
  acceptFailures = [],
  mutationPending,
  onAcceptAssemblies,
  onAttachInput,
  onCreateAssembly,
  onCreateClaim,
  onPatchAssembly,
  onPatchClaim,
  onRemoveInput,
  projectId,
  review,
  runId,
  focusLabel = null,
  focusProposalIds = null
}: AnalyzeReviewWorkspaceProps) {
  const focusedProposalIds = useMemo(
    () => (focusProposalIds ? new Set(focusProposalIds) : null),
    [focusProposalIds]
  );
  const displayedUnassignedInputs = useMemo(
    () =>
      focusedProposalIds
        ? review.unassignedInputs.filter((input) => focusedProposalIds.has(input.proposalId))
        : review.unassignedInputs,
    [focusedProposalIds, review.unassignedInputs]
  );
  const displayedReviewAssemblies = useMemo(
    () =>
      focusedProposalIds
        ? review.assemblies.filter((assembly) =>
            assembly.inputs.some((input) => focusedProposalIds.has(input.proposalId))
          )
        : review.assemblies,
    [focusedProposalIds, review.assemblies]
  );
  const draftGroups = useMemo(
    () => groupAnalyzeReviewInputs(displayedUnassignedInputs),
    [displayedUnassignedInputs]
  );
  const assemblies = useMemo(
    () => sortAnalyzeReviewAssemblies(displayedReviewAssemblies),
    [displayedReviewAssemblies]
  );
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(
    () => assemblies[0]?.id ?? null
  );
  const [selectedInputIds, setSelectedInputIds] = useState<Set<string>>(() => new Set());
  const [checkedAssemblyIds, setCheckedAssemblyIds] = useState<Set<string>>(() => new Set());
  const [newClaimText, setNewClaimText] = useState("");
  const [newClaimKind, setNewClaimKind] =
    useState<AnalyzeReviewCreateClaimRequest["kind"]>("fact");
  const [claimDraftAssemblyId, setClaimDraftAssemblyId] = useState<string | null>(
    () => assemblies[0]?.id ?? null
  );
  const selectedAssembly =
    assemblies.find((assembly) => assembly.id === selectedAssemblyId) ?? assemblies[0] ?? null;
  const [formDraft, setFormDraft] = useState<AssemblyFormDraft>(() => ({
    assemblyId: selectedAssembly?.id ?? null,
    dirty: false,
    value: formStateFromAssembly(selectedAssembly)
  }));
  const formState = formDraft.value;
  const selectedAssemblyIsDraft = selectedAssembly?.status === "draft";
  const canEditSelected = selectedAssemblyIsDraft && !mutationPending;
  const focusedAssemblyCounts = useMemo(
    () => ({
      accepted: assemblies.filter((assembly) => assembly.status === "accepted").length,
      draft: assemblies.filter((assembly) => assembly.status === "draft").length
    }),
    [assemblies]
  );
  const draftPoolSubcount = focusedProposalIds
    ? `${displayedUnassignedInputs.length} related unassigned inputs`
    : `${review.counts.inputs.unassigned} unassigned inputs`;
  const assemblyListSubcount = focusedProposalIds
    ? `${focusedAssemblyCounts.draft} draft, ${focusedAssemblyCounts.accepted} accepted related`
    : `${review.counts.assemblies.draft} draft, ${review.counts.assemblies.accepted} accepted`;

  useEffect(() => {
    setSelectedAssemblyId((current) =>
      current && assemblies.some((assembly) => assembly.id === current)
        ? current
        : (assemblies[0]?.id ?? null)
    );
  }, [assemblies]);

  useEffect(() => {
    setSelectedInputIds((current) => {
      const visibleInputIds = new Set(displayedUnassignedInputs.map((input) => input.proposalId));
      const next = new Set([...current].filter((proposalId) => visibleInputIds.has(proposalId)));
      return sameSet(current, next) ? current : next;
    });
  }, [displayedUnassignedInputs]);

  useEffect(() => {
    setCheckedAssemblyIds((current) => {
      const readyAssemblyIds = new Set(
        assemblies.filter((assembly) => isReadyDraft(assembly)).map((assembly) => assembly.id)
      );
      const next = new Set<string>();
      for (const assembly of assemblies) {
        if (current.has(assembly.id) && readyAssemblyIds.has(assembly.id)) {
          next.add(assembly.id);
        }
      }
      return sameSet(current, next) ? current : next;
    });
  }, [assemblies]);

  useEffect(() => {
    setFormDraft((current) => {
      const nextAssemblyId = selectedAssembly?.id ?? null;
      const nextValue = formStateFromAssembly(selectedAssembly);
      if (current.assemblyId !== nextAssemblyId) {
        return {
          assemblyId: nextAssemblyId,
          dirty: false,
          value: nextValue
        };
      }
      if (!current.dirty) {
        return formStateEqual(current.value, nextValue)
          ? current
          : {
              ...current,
              value: nextValue
            };
      }
      if (selectedAssembly && formStateMatchesAssembly(current.value, selectedAssembly)) {
        return {
          ...current,
          dirty: false
        };
      }
      return current;
    });
  }, [selectedAssembly]);

  useEffect(() => {
    const nextAssemblyId = selectedAssembly?.id ?? null;
    if (claimDraftAssemblyId === nextAssemblyId) {
      return;
    }
    setClaimDraftAssemblyId(nextAssemblyId);
    setNewClaimText("");
    setNewClaimKind("fact");
  }, [claimDraftAssemblyId, selectedAssembly?.id]);

  const checkedReadyAssemblyIds = useMemo(
    () => assemblies.filter((assembly) => checkedAssemblyIds.has(assembly.id) && isReadyDraft(assembly)).map((assembly) => assembly.id),
    [assemblies, checkedAssemblyIds]
  );
  const selectedInputs = useMemo(
    () =>
      displayedUnassignedInputs.filter((input) => selectedInputIds.has(input.proposalId)),
    [displayedUnassignedInputs, selectedInputIds]
  );
  const selectedAssemblyInputIds = useMemo(
    () => new Set(selectedAssembly?.inputs.map((input) => input.proposalId) ?? []),
    [selectedAssembly]
  );
  const canAttachInputs =
    selectedAssembly !== null &&
    selectedAssemblyIsDraft &&
    selectedInputs.length > 0 &&
    !mutationPending;
  const canAcceptSelected = checkedReadyAssemblyIds.length > 0 && !mutationPending;

  const toggleInput = (proposalId: string) => {
    setSelectedInputIds((current) => toggleSetValue(current, proposalId));
  };

  const toggleReadyAssembly = (assembly: AnalyzeReviewAssemblyDto) => {
    if (!isReadyDraft(assembly) || mutationPending) {
      return;
    }
    setCheckedAssemblyIds((current) => toggleSetValue(current, assembly.id));
  };

  const createAssembly = () => {
    if (mutationPending) {
      return;
    }
    onCreateAssembly({
      proposalIds: [],
      title: "Untitled assembly",
      entityType: "use_case",
      entityId: "draft.untitled",
      filePath: "drafts/untitled.md",
      summary: ""
    });
  };

  const attachSelectedInputs = () => {
    if (!selectedAssembly || !canAttachInputs) {
      return;
    }
    for (const input of selectedInputs) {
      onAttachInput(selectedAssembly.id, {
        proposalId: input.proposalId,
        role: "supporting"
      });
    }
    setSelectedInputIds(new Set());
  };

  const saveAssembly = () => {
    if (!selectedAssembly || !selectedAssemblyIsDraft || mutationPending) {
      return;
    }
    onPatchAssembly(selectedAssembly.id, formState);
  };

  const discardAssembly = () => {
    if (!selectedAssembly || selectedAssembly.status !== "draft" || mutationPending) {
      return;
    }
    onPatchAssembly(selectedAssembly.id, { status: "discarded" });
  };

  const createClaim = () => {
    if (!selectedAssembly || !selectedAssemblyIsDraft || !newClaimText.trim() || mutationPending) {
      return;
    }
    onCreateClaim(selectedAssembly.id, {
      text: newClaimText.trim(),
      kind: newClaimKind,
      confidence: null
    });
    setNewClaimText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {focusLabel ? `Related draft review for ${focusLabel}` : "Analyze review"}
          </h1>
          <p className="max-w-3xl text-sm text-slate-600">
            {focusedProposalIds
              ? `Drafts linked to the selected system map area for analyze run ${runId} in project ${projectId}.`
              : `Assemble generated drafts for analyze run ${runId} in project ${projectId}.`}
          </p>
        </div>
        <button
          type="button"
          className="button-primary"
          disabled={!canAcceptSelected}
          onClick={() => {
            if (canAcceptSelected) {
              onAcceptAssemblies(checkedReadyAssemblyIds);
            }
          }}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Accept selected
        </button>
      </header>
      <AcceptFailures failures={acceptFailures} />

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[320px_340px_minmax(0,1fr)]">
        <section className="panel-section min-h-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-heading">Draft pool</h2>
              <p className="text-xs text-slate-500">{draftPoolSubcount}</p>
            </div>
            <button
              type="button"
              className="button-secondary"
              disabled={mutationPending}
              onClick={createAssembly}
            >
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              Create assembly
            </button>
          </div>
          <div className="mt-3 flex min-h-0 flex-col gap-3 overflow-auto">
            {Object.entries(draftGroups).map(([groupName, inputs]) => (
              <div key={groupName} className="border-t border-slate-200 pt-2 first:border-t-0 first:pt-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-slate-500">{groupName}</h3>
                  <span className="text-xs text-slate-500">{inputs.length}</span>
                </div>
                {inputs.length === 0 ? (
                  <p className="text-xs text-slate-400">No inputs.</p>
                ) : (
                  <div className="grid gap-1.5">
                    {inputs.map((input) => (
                      <DraftInputRow
                        key={input.proposalId}
                        input={input}
                        checked={selectedInputIds.has(input.proposalId)}
                        disabled={mutationPending || selectedAssemblyInputIds.has(input.proposalId)}
                        onToggle={() => toggleInput(input.proposalId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button-secondary mt-3 w-full justify-center"
            disabled={!canAttachInputs}
            onClick={attachSelectedInputs}
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Attach selected inputs
          </button>
        </section>

        <section className="panel-section min-h-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-heading">Assembly list</h2>
              <p className="text-xs text-slate-500">{assemblyListSubcount}</p>
            </div>
            <span className="text-xs text-slate-500">{checkedReadyAssemblyIds.length} selected</span>
          </div>
          <div className="mt-3 min-h-0 overflow-auto">
            {assemblies.length === 0 ? (
              <p className="text-sm text-slate-500">No assemblies yet.</p>
            ) : (
              <div className="grid gap-2">
                {assemblies.map((assembly) => (
                  <AssemblyRow
                    key={assembly.id}
                    assembly={assembly}
                    checked={checkedAssemblyIds.has(assembly.id)}
                    selected={selectedAssembly?.id === assembly.id}
                    onSelect={() => setSelectedAssemblyId(assembly.id)}
                    onToggle={() => toggleReadyAssembly(assembly)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel-section min-h-0 overflow-auto">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="section-heading">Assembly detail</h2>
              <p className="text-xs text-slate-500">Structured draft, evidence, and markdown preview</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="button-secondary"
                disabled={!selectedAssembly || selectedAssembly.status !== "draft" || mutationPending}
                onClick={discardAssembly}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Discard assembly
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={!selectedAssembly || !selectedAssemblyIsDraft || mutationPending}
                onClick={saveAssembly}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save detail
              </button>
            </div>
          </div>

          {selectedAssembly ? (
            <div className="mt-4 grid gap-4">
              <ValidationMessages assembly={selectedAssembly} />
              <AssemblyFields
                disabled={!canEditSelected}
                formState={formState}
                onChange={(next) =>
                  setFormDraft((current) => ({
                    ...current,
                    dirty: true,
                    value: { ...current.value, ...next }
                  }))
                }
              />
              <InputRoles
                assembly={selectedAssembly}
                disabled={!canEditSelected}
                onRemoveInput={onRemoveInput}
              />
              <ClaimsPanel
                assembly={selectedAssembly}
                disabled={!canEditSelected}
                newClaimKind={newClaimKind}
                newClaimText={newClaimText}
                onCreateClaim={createClaim}
                onNewClaimKindChange={setNewClaimKind}
                onNewClaimTextChange={setNewClaimText}
                onPatchClaim={onPatchClaim}
              />
              <MarkdownPreview assembly={selectedAssembly} formState={formState} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Select an assembly to review.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function DraftInputRow({
  checked,
  disabled,
  input,
  onToggle
}: {
  checked: boolean;
  disabled: boolean;
  input: AnalyzeReviewInputDto;
  onToggle: () => void;
}) {
  return (
    <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-slate-200 bg-white p-2 text-sm hover:bg-slate-50">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-slate-300"
        aria-label={`Select input ${input.title}`}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-900">{input.title}</span>
        <span className="block truncate text-xs text-slate-500">{input.entityId}</span>
        <span className="block truncate text-xs text-slate-500">
          {input.proposalType} · {formatConfidence(input.confidence)} · {input.evidenceCount} evidence
        </span>
      </span>
    </label>
  );
}

function AssemblyRow({
  assembly,
  checked,
  onSelect,
  onToggle,
  selected
}: {
  assembly: AnalyzeReviewAssemblyDto;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  selected: boolean;
}) {
  const ready = isReadyDraft(assembly);
  return (
    <div
      className={
        selected
          ? "grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-slate-300 bg-slate-100 p-2"
          : "grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-slate-200 bg-white p-2 hover:bg-slate-50"
      }
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-slate-300"
        aria-label={`Select assembly ${assembly.title}`}
        checked={checked}
        disabled={!ready}
        onChange={onToggle}
      />
      <button type="button" className="min-w-0 text-left" onClick={onSelect}>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">{assembly.title}</span>
          <ValidationBadge state={assembly.validation.state} />
        </span>
        <span className="block truncate text-xs text-slate-500">{assembly.filePath}</span>
        <span className="block truncate text-xs text-slate-500">
          {assembly.entityType} · {assembly.entityId} · {assembly.status}
        </span>
        {assembly.validation.messages.length > 0 ? (
          <span className="mt-1 block truncate text-xs text-red-700">
            {assembly.validation.messages.map((message) => message.code).join(", ")}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function AssemblyFields({
  disabled,
  formState,
  onChange
}: {
  disabled: boolean;
  formState: AssemblyFormState;
  onChange: (next: Partial<AssemblyFormState>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <LabeledInput
        disabled={disabled}
        label="Title"
        value={formState.title}
        onChange={(title) => onChange({ title })}
      />
      <LabeledInput
        disabled={disabled}
        label="Entity id"
        value={formState.entityId}
        onChange={(entityId) => onChange({ entityId })}
      />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Type
        <select
          className="rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
          disabled={disabled}
          value={formState.entityType}
          onChange={(event) =>
            onChange({ entityType: event.currentTarget.value as AssemblyFormState["entityType"] })
          }
        >
          <option value="domain_entity">domain_entity</option>
          <option value="interface">interface</option>
          <option value="use_case">use_case</option>
        </select>
      </label>
      <LabeledInput
        disabled={disabled}
        label="Path"
        value={formState.filePath}
        onChange={(filePath) => onChange({ filePath })}
      />
      <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2">
        Summary
        <textarea
          className="min-h-20 rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
          disabled={disabled}
          value={formState.summary}
          onInput={(event) => onChange({ summary: event.currentTarget.value })}
        />
      </label>
    </div>
  );
}

function LabeledInput({
  disabled,
  label,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <input
        className="rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
        disabled={disabled}
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function InputRoles({
  assembly,
  disabled,
  onRemoveInput
}: {
  assembly: AnalyzeReviewAssemblyDto;
  disabled: boolean;
  onRemoveInput: (assemblyId: string, proposalId: string) => void;
}) {
  return (
    <section className="border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold text-slate-900">Inputs and roles</h3>
      <div className="mt-2 grid gap-2">
        {assembly.inputs.length === 0 ? (
          <p className="text-sm text-slate-500">No inputs attached.</p>
        ) : (
          assembly.inputs.map((input) => (
            <div
              key={input.proposalId}
              className="grid gap-2 rounded border border-slate-200 bg-white p-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-900">{input.title}</div>
                <div className="truncate text-xs text-slate-500">
                  {input.role ?? "supporting"} · {input.entityId} · {input.filePath}
                </div>
              </div>
              <button
                type="button"
                className="button-secondary"
                disabled={disabled}
                onClick={() => {
                  if (!disabled) {
                    onRemoveInput(assembly.id, input.proposalId);
                  }
                }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ClaimsPanel({
  assembly,
  disabled,
  newClaimKind,
  newClaimText,
  onCreateClaim,
  onNewClaimKindChange,
  onNewClaimTextChange,
  onPatchClaim
}: {
  assembly: AnalyzeReviewAssemblyDto;
  disabled: boolean;
  newClaimKind: AnalyzeReviewCreateClaimRequest["kind"];
  newClaimText: string;
  onCreateClaim: () => void;
  onNewClaimKindChange: (kind: AnalyzeReviewCreateClaimRequest["kind"]) => void;
  onNewClaimTextChange: (text: string) => void;
  onPatchClaim: (
    assemblyId: string,
    claimId: string,
    input: AnalyzeReviewUpdateClaimRequest
  ) => void;
}) {
  return (
    <section className="border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold text-slate-900">Claims and evidence</h3>
      <div className="mt-2 grid gap-2">
        {assembly.claims.length === 0 ? (
          <p className="text-sm text-slate-500">No claims yet.</p>
        ) : (
          assembly.claims.map((claim) => (
            <ClaimRow
              key={claim.id}
              assemblyId={assembly.id}
              claim={claim}
              disabled={disabled}
              onPatchClaim={onPatchClaim}
            />
          ))
        )}
      </div>
      <div className="mt-3 grid gap-2 rounded border border-slate-200 bg-slate-50 p-2">
        <textarea
          className="min-h-16 rounded border border-slate-300 px-2 py-1.5 text-sm"
          aria-label="New claim"
          disabled={disabled}
          placeholder="Add claim"
          value={newClaimText}
          onInput={(event) => onNewClaimTextChange(event.currentTarget.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name={`new-claim-kind-${assembly.id}`}
              checked={newClaimKind === "fact"}
              disabled={disabled}
              onChange={() => onNewClaimKindChange("fact")}
            />
            fact
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name={`new-claim-kind-${assembly.id}`}
              checked={newClaimKind === "hypothesis"}
              disabled={disabled}
              onChange={() => onNewClaimKindChange("hypothesis")}
            />
            hypothesis
          </label>
          <button
            type="button"
            className="button-secondary"
            disabled={!newClaimText.trim() || disabled}
            onClick={onCreateClaim}
          >
            Add claim
          </button>
        </div>
      </div>
    </section>
  );
}

function ClaimRow({
  assemblyId,
  claim,
  disabled,
  onPatchClaim
}: {
  assemblyId: string;
  claim: AnalyzeReviewClaimDto;
  disabled: boolean;
  onPatchClaim: (
    assemblyId: string,
    claimId: string,
    input: AnalyzeReviewUpdateClaimRequest
  ) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{claim.text}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{claim.kind}</span>
            <span>{formatConfidence(claim.confidence)}</span>
            <span>{claim.evidence.length} evidence</span>
          </div>
        </div>
        <button
          type="button"
          className="button-secondary"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onPatchClaim(assemblyId, claim.id, {
                kind: claim.kind === "fact" ? "hypothesis" : "fact"
              });
            }
          }}
        >
          Mark {claim.kind === "fact" ? "hypothesis" : "fact"}
        </button>
      </div>
      {claim.evidence.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {claim.evidence.map((evidence) => (
            <div key={evidence.id} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
              <span className="font-medium text-slate-800">{evidence.sourceFilePath}</span>
              {evidence.symbolName ? <span> · {evidence.symbolName}</span> : null}
              {evidence.startLine ? <span> · line {evidence.startLine}</span> : null}
              <span> · {evidence.provenance}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ValidationMessages({ assembly }: { assembly: AnalyzeReviewAssemblyDto }) {
  if (assembly.validation.messages.length === 0) {
    return <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Ready to accept.</p>;
  }

  return (
    <div className="grid gap-2">
      {assembly.validation.messages.map((message) => (
        <div
          key={`${message.code}:${message.field ?? ""}`}
          className={
            message.severity === "blocker"
              ? "rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              : "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          }
        >
          <div className="font-semibold">{message.code}</div>
          <div>{message.message}</div>
        </div>
      ))}
    </div>
  );
}

function AcceptFailures({ failures }: { failures: AnalyzeReviewAcceptFailure[] }) {
  if (failures.length === 0) {
    return null;
  }

  return (
    <section className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <h2 className="font-semibold">Accept failures</h2>
      <div className="mt-2 grid gap-2">
        {failures.map((failure) => (
          <div key={failure.assemblyId}>
            <div className="font-medium">{failure.assemblyId}</div>
            <ul className="mt-1 grid gap-1">
              {failure.messages.map((message) => (
                <li key={`${failure.assemblyId}:${message.code}:${message.field ?? ""}`}>
                  <span className="font-semibold">{message.code}</span>: {message.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function MarkdownPreview({
  assembly,
  formState
}: {
  assembly: AnalyzeReviewAssemblyDto;
  formState: AssemblyFormState;
}) {
  return (
    <section className="border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold text-slate-900">Generated markdown preview</h3>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">
        {assembly.renderedMarkdown ?? generatedMarkdown(formState, assembly.claims)}
      </pre>
    </section>
  );
}

function ValidationBadge({ state }: { state: AnalyzeReviewAssemblyDto["validation"]["state"] }) {
  const className =
    state === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : state === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-800";
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {state}
    </span>
  );
}

function formStateFromAssembly(assembly: AnalyzeReviewAssemblyDto | null): AssemblyFormState {
  return {
    entityId: assembly?.entityId ?? "",
    entityType: assembly?.entityType ?? "use_case",
    filePath: assembly?.filePath ?? "",
    summary: assembly?.summary ?? "",
    title: assembly?.title ?? ""
  };
}

function formStateMatchesAssembly(
  formState: AssemblyFormState,
  assembly: AnalyzeReviewAssemblyDto
) {
  return formStateEqual(formState, formStateFromAssembly(assembly));
}

function formStateEqual(left: AssemblyFormState, right: AssemblyFormState) {
  return (
    left.entityId === right.entityId &&
    left.entityType === right.entityType &&
    left.filePath === right.filePath &&
    left.summary === right.summary &&
    left.title === right.title
  );
}

function isReadyDraft(assembly: AnalyzeReviewAssemblyDto) {
  return assembly.status === "draft" && assembly.validation.state === "ready";
}

function generatedMarkdown(
  formState: AssemblyFormState,
  claims: AnalyzeReviewClaimDto[]
) {
  const lines = [`# ${formState.title || "Untitled assembly"}`, "", formState.summary];
  if (claims.length > 0) {
    lines.push("", "## Claims");
    for (const claim of claims) {
      lines.push(`- ${claim.kind}: ${claim.text}`);
    }
  }
  return lines.join("\n");
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "unknown confidence" : `${Math.round(confidence * 100)}%`;
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function sameSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
