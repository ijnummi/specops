import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  CreateDiffReviewRequest,
  DiffReviewSummaryResponse,
  DiffReviewStatus
} from "@specops/contracts";
import { useState, type FormEvent } from "react";

import { createDiffReview, diffReviewsQuery, queryKeys } from "../api/queries.js";

const reviewTypeOptions = [
  ["working_tree", "Working tree"],
  ["staged", "Staged"],
  ["ref_range", "Ref range"]
] satisfies Array<[CreateDiffReviewRequest["reviewType"], string]>;

export function DiffReviewsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reviews = useQuery(diffReviewsQuery(projectId));
  const [reviewType, setReviewType] =
    useState<CreateDiffReviewRequest["reviewType"]>("working_tree");
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");

  const createMutation = useMutation({
    mutationFn: (input: CreateDiffReviewRequest) => createDiffReview(projectId, input),
    onSuccess: async (review) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.diffReviewsRoot(projectId) });
      await navigate({
        to: "/projects/$projectId/diff-reviews/$reviewId",
        params: { projectId, reviewId: review.id }
      });
    }
  });

  if (reviews.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading diff reviews...</div>;
  }

  if (reviews.error) {
    return <div className="p-4 text-sm text-red-700">{reviews.error.message}</div>;
  }

  const data = reviews.data ?? [];

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateDiffReviewRequest =
      reviewType === "ref_range"
        ? { reviewType, baseRef: baseRef.trim(), headRef: headRef.trim() }
        : { reviewType };

    createMutation.mutate(input);
  }

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-950">Diff Reviews</h1>
          <p className="mt-1 text-sm text-slate-500">{data.length} local diff reviews</p>
        </div>
      </header>

      <form
        className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[minmax(12rem,0.35fr)_repeat(2,minmax(10rem,0.35fr))_auto]"
        onSubmit={submitReview}
      >
        <label className="field">
          <span>Review type</span>
          <select
            aria-label="Review type"
            className="input h-9 py-1"
            value={reviewType}
            onChange={(event) =>
              setReviewType(event.currentTarget.value as CreateDiffReviewRequest["reviewType"])
            }
          >
            {reviewTypeOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {reviewType === "ref_range" ? (
          <>
            <label className="field">
              <span>Base ref</span>
              <input
                aria-label="Base ref"
                className="input h-9"
                value={baseRef}
                onInput={(event) => setBaseRef(event.currentTarget.value)}
                placeholder="main"
                required
              />
            </label>
            <label className="field">
              <span>Head ref</span>
              <input
                aria-label="Head ref"
                className="input h-9"
                value={headRef}
                onInput={(event) => setHeadRef(event.currentTarget.value)}
                placeholder="HEAD"
                required
              />
            </label>
          </>
        ) : null}

        <div className="flex items-end">
          <button
            className="button-primary h-9"
            type="submit"
            disabled={createMutation.isPending}
          >
            Create review
          </button>
        </div>
      </form>

      {mutationErrorMessage(createMutation.error) ? (
        <section className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 shadow-sm">
          {mutationErrorMessage(createMutation.error)}
        </section>
      ) : null}

      {data.length === 0 ? (
        <section className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-sm">
          No diff reviews yet.
        </section>
      ) : (
        <section className="rounded border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-200">
            {data.map((review) => (
              <li key={review.id}>
                <Link
                  to="/projects/$projectId/diff-reviews/$reviewId"
                  params={{ projectId, reviewId: review.id }}
                  className="block min-w-0 p-3 underline-offset-2 hover:bg-slate-50 hover:underline"
                >
                  <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-950">
                        {formatReviewType(review.reviewType)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{formatStatus(review.status)}</span>
                        <span>
                          {shortSha(review.baseCommit)}...{shortSha(review.headCommit)}
                        </span>
                        <span>{formatRefs(review)}</span>
                      </div>
                    </div>
                    <div className="grid shrink-0 gap-1 text-xs text-slate-600 sm:grid-cols-3 lg:text-right">
                      <span>{formatCount(review.changedFileCount, "changed file")}</span>
                      <span>{formatFindingCounts(review.findingCounts)}</span>
                      <span>Created {formatDateTime(review.createdAt)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatReviewType(reviewType: CreateDiffReviewRequest["reviewType"]) {
  return reviewType.replaceAll("_", " ");
}

function formatStatus(status: DiffReviewStatus) {
  return status.replaceAll("_", " ");
}

function formatCount(count: number, label: string) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function formatRefs(review: DiffReviewSummaryResponse) {
  if (!review.baseRef && !review.headRef) {
    return "local changes";
  }

  return `${review.baseRef ?? "unknown"}...${review.headRef ?? "unknown"}`;
}

function formatFindingCounts(counts: DiffReviewSummaryResponse["findingCounts"]) {
  const allCounts: Array<[string, number]> = [
    ["blocker", counts.blocker],
    ["review", counts.review],
    ["context", counts.context],
    ["info", counts.info]
  ];
  const visible = allCounts.filter(([, count]) => count > 0);

  if (visible.length === 0) {
    return "0 findings";
  }

  return visible.map(([label, count]) => `${count} ${label}`).join(" / ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 7) : "unknown";
}

function mutationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : null;
}
