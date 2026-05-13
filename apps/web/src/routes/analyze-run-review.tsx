import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type {
  AnalyzeReviewAttachInputRequest,
  AnalyzeReviewAcceptResponse,
  AnalyzeReviewAcceptFailure,
  AnalyzeReviewCreateAssemblyRequest,
  AnalyzeReviewCreateClaimRequest,
  AnalyzeReviewUpdateAssemblyRequest,
  AnalyzeReviewUpdateClaimRequest
} from "@specops/contracts";

import {
  acceptAnalyzeReviewAssemblies,
  analyzeReviewAssembliesQuery,
  attachAnalyzeReviewInput,
  createAnalyzeReviewAssembly,
  createAnalyzeReviewClaim,
  patchAnalyzeReviewAssembly,
  patchAnalyzeReviewClaim,
  queryKeys,
  removeAnalyzeReviewInput
} from "../api/queries.js";
import { AnalyzeReviewWorkspace } from "../components/analyze-review-workspace.js";

type AnalyzeRunReviewPageProps = {
  projectId: string;
  runId: string;
};

export function AnalyzeRunReviewPage({ projectId, runId }: AnalyzeRunReviewPageProps) {
  const queryClient = useQueryClient();
  const [acceptFailures, setAcceptFailures] = useState<AnalyzeReviewAcceptFailure[]>([]);
  const [acceptResponse, setAcceptResponse] = useState<AnalyzeReviewAcceptResponse | null>(null);
  const review = useQuery(analyzeReviewAssembliesQuery(projectId, runId));

  const invalidateReviewAssemblies = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.analyzeReviewAssemblies(projectId, runId)
    });
  };

  const invalidateAcceptedData = async () => {
    await Promise.all([
      invalidateReviewAssemblies(),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReadiness(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
    ]);
  };

  const createAssemblyMutation = useMutation({
    mutationFn: (input: AnalyzeReviewCreateAssemblyRequest) =>
      createAnalyzeReviewAssembly(projectId, runId, input),
    onSuccess: invalidateReviewAssemblies
  });
  const patchAssemblyMutation = useMutation({
    mutationFn: ({
      assemblyId,
      input
    }: {
      assemblyId: string;
      input: AnalyzeReviewUpdateAssemblyRequest;
    }) => patchAnalyzeReviewAssembly(projectId, runId, assemblyId, input),
    onSuccess: invalidateReviewAssemblies
  });
  const attachInputMutation = useMutation({
    mutationFn: ({
      assemblyId,
      input
    }: {
      assemblyId: string;
      input: AnalyzeReviewAttachInputRequest;
    }) => attachAnalyzeReviewInput(projectId, runId, assemblyId, input),
    onSuccess: invalidateReviewAssemblies
  });
  const removeInputMutation = useMutation({
    mutationFn: ({ assemblyId, proposalId }: { assemblyId: string; proposalId: string }) =>
      removeAnalyzeReviewInput(projectId, runId, assemblyId, proposalId),
    onSuccess: invalidateReviewAssemblies
  });
  const createClaimMutation = useMutation({
    mutationFn: ({
      assemblyId,
      input
    }: {
      assemblyId: string;
      input: AnalyzeReviewCreateClaimRequest;
    }) => createAnalyzeReviewClaim(projectId, runId, assemblyId, input),
    onSuccess: invalidateReviewAssemblies
  });
  const patchClaimMutation = useMutation({
    mutationFn: ({
      assemblyId,
      claimId,
      input
    }: {
      assemblyId: string;
      claimId: string;
      input: AnalyzeReviewUpdateClaimRequest;
    }) => patchAnalyzeReviewClaim(projectId, runId, assemblyId, claimId, input),
    onSuccess: invalidateReviewAssemblies
  });
  const acceptMutation = useMutation({
    mutationFn: (assemblyIds: string[]) =>
      acceptAnalyzeReviewAssemblies(projectId, runId, { assemblyIds }),
    onSuccess: async (response) => {
      setAcceptFailures(response.failures);
      setAcceptResponse(response);
      await invalidateAcceptedData();
    }
  });

  const mutationPending =
    createAssemblyMutation.isPending ||
    patchAssemblyMutation.isPending ||
    attachInputMutation.isPending ||
    removeInputMutation.isPending ||
    createClaimMutation.isPending ||
    patchClaimMutation.isPending ||
    acceptMutation.isPending;

  return (
    <main className="mx-auto flex h-full max-w-[1800px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Analyze review</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Review draft assemblies generated by analyze run {runId}.
          </p>
        </div>
        <Link
          to="/projects/$projectId/analyze-runs/$runId"
          params={{ projectId, runId }}
          className="button-secondary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to progress
        </Link>
      </div>

      {review.error ? (
        <p className="panel-section text-sm text-red-700">{review.error.message}</p>
      ) : review.isLoading ? (
        <p className="panel-section text-sm text-slate-500">Loading review assemblies...</p>
      ) : review.data ? (
        <>
          <AcceptResultMessage response={acceptResponse} />
          <AnalyzeReviewWorkspace
            projectId={projectId}
            runId={runId}
            review={review.data}
            acceptFailures={acceptFailures}
            mutationPending={mutationPending}
            onAcceptAssemblies={(assemblyIds) => {
              setAcceptFailures([]);
              setAcceptResponse(null);
              acceptMutation.mutate(assemblyIds);
            }}
            onAttachInput={(assemblyId, input) =>
              attachInputMutation.mutate({ assemblyId, input })
            }
            onCreateAssembly={(input) => createAssemblyMutation.mutate(input)}
            onCreateClaim={(assemblyId, input) =>
              createClaimMutation.mutate({ assemblyId, input })
            }
            onPatchAssembly={(assemblyId, input) =>
              patchAssemblyMutation.mutate({ assemblyId, input })
            }
            onPatchClaim={(assemblyId, claimId, input) =>
              patchClaimMutation.mutate({ assemblyId, claimId, input })
            }
            onRemoveInput={(assemblyId, proposalId) =>
              removeInputMutation.mutate({ assemblyId, proposalId })
            }
          />
        </>
      ) : (
        <p className="panel-section text-sm text-slate-500">Review assemblies are unavailable.</p>
      )}

      <MutationErrors
        errors={[
          ["Create assembly failed", createAssemblyMutation.error],
          ["Update assembly failed", patchAssemblyMutation.error],
          ["Attach input failed", attachInputMutation.error],
          ["Remove input failed", removeInputMutation.error],
          ["Create claim failed", createClaimMutation.error],
          ["Update claim failed", patchClaimMutation.error],
          ["Accept selected failed", acceptMutation.error]
        ]}
      />
    </main>
  );
}

function AcceptResultMessage({
  response
}: {
  response: AnalyzeReviewAcceptResponse | null;
}) {
  if (!response || response.acceptedAssemblyIds.length === 0) {
    return null;
  }

  const savedCount = response.acceptedAssemblyIds.length;
  const annotationCount = response.annotationCount;
  if (response.failures.length === 0) {
    return (
      <p className="panel-section mb-3 text-sm text-emerald-700">
        Saved {formatCount(savedCount, "assembly", "assemblies")} and{" "}
        {formatCount(annotationCount, "source/spec annotation", "source/spec annotations")}.
      </p>
    );
  }

  return (
    <p className="panel-section mb-3 text-sm text-amber-700">
      Saved {formatCount(savedCount, "assembly", "assemblies")} and{" "}
      {formatCount(annotationCount, "source/spec annotation", "source/spec annotations")}.{" "}
      {formatNeedsReview(response.failures.length)}
    </p>
  );
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatNeedsReview(count: number) {
  return `${formatCount(count, "assembly", "assemblies")} ${count === 1 ? "needs" : "need"} review.`;
}

function MutationErrors({ errors }: { errors: Array<[string, unknown]> }) {
  const visibleErrors = errors.filter(([, error]) => error instanceof Error);
  if (visibleErrors.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-2">
      {visibleErrors.map(([label, error]) => (
        <p key={label} className="text-sm text-red-700">
          {label}: {(error as Error).message}
        </p>
      ))}
    </div>
  );
}
