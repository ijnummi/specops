// @vitest-environment happy-dom

import type {
  DiffReviewDetailResponse,
  DiffReviewSummaryResponse
} from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listState: {
    data: null as DiffReviewSummaryResponse[] | null,
    error: null as Error | null,
    isLoading: false
  },
  detailState: {
    data: null as DiffReviewDetailResponse | null,
    error: null as Error | null,
    isLoading: false
  },
  mutationState: {
    isPending: false,
    mutate: vi.fn()
  },
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  diffReviewsQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "diff-reviews", "list"]
  })),
  diffReviewQuery: vi.fn((projectId: string, reviewId: string) => ({
    queryKey: ["projects", projectId, "diff-reviews", reviewId]
  })),
  createDiffReview: vi.fn(),
  updateDiffReviewStatus: vi.fn()
}));

type MutationOptions = {
  mutationFn: (input: unknown) => unknown;
  onSuccess?: (result: unknown, input: unknown) => unknown;
};

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => ({
    isPending: mocks.mutationState.isPending,
    mutate: vi.fn((input: unknown) => {
      const result = options.mutationFn(input);

      if (isPromiseLike(result)) {
        void result.then(async (resolved) => {
          await options.onSuccess?.(resolved, input);
        });
      } else {
        void options.onSuccess?.(result, input);
      }

      return result;
    })
  }),
  useQuery: (options: { queryKey: readonly unknown[] }) =>
    options.queryKey.at(-1) === "review-1" ? mocks.detailState : mocks.listState,
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to
  }: {
    children: ReactNode;
    className?: string;
    params?: Record<string, string>;
    to: string;
  }) => (
    <a
      className={className}
      href={to
        .replace("$projectId", params?.projectId ?? "")
        .replace("$reviewId", params?.reviewId ?? "")}
    >
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate
}));

vi.mock("../api/queries.js", () => ({
  createDiffReview: mocks.createDiffReview,
  diffReviewQuery: mocks.diffReviewQuery,
  diffReviewsQuery: mocks.diffReviewsQuery,
  queryKeys: {
    diffReview: (projectId: string, reviewId: string) =>
      ["projects", projectId, "diff-reviews", reviewId] as const,
    diffReviewsRoot: (projectId: string) => ["projects", projectId, "diff-reviews"] as const
  },
  updateDiffReviewStatus: mocks.updateDiffReviewStatus
}));

import { DiffReviewDetailPage } from "./diff-review-detail.js";
import { DiffReviewsPage } from "./diff-reviews.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mocks.listState = {
    data: null,
    error: null,
    isLoading: false
  };
  mocks.detailState = {
    data: null,
    error: null,
    isLoading: false
  };
  mocks.createDiffReview.mockReset();
  mocks.updateDiffReviewStatus.mockReset();
  mocks.invalidateQueries.mockReset();
  mocks.navigate.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

describe("DiffReviewsPage", () => {
  it("renders create controls and review summaries", () => {
    mocks.listState = {
      data: [diffReviewSummary],
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<DiffReviewsPage projectId="project-1" />);

    expect(html).toContain("Diff Reviews");
    expect(html).toContain("Review type");
    expect(html).toContain("Working tree");
    expect(html).toContain("Staged");
    expect(html).toContain("Ref range");
    expect(html).toContain("Create review");
    expect(html).toContain("working tree");
    expect(html).toContain("ready for review");
    expect(html).toContain("3 changed files");
    expect(html).toContain("1 blocker");
    expect(html).toContain("2 review");
    expect(html).toContain("abc1234");
    expect(html).toContain("fedcba9");
    expect(html).toContain("May 12, 2026");
    expect(html).toContain("/projects/project-1/diff-reviews/review-1");
  });

  it("renders ref range inputs only for ref range mode", async () => {
    mocks.listState = {
      data: [],
      error: null,
      isLoading: false
    };

    const { container } = await renderDiffReviewsPage();

    expect(container.textContent).not.toContain("Base ref");
    expect(container.textContent).not.toContain("Head ref");

    await changeSelect(container, "Review type", "ref_range");

    expect(container.textContent).toContain("Base ref");
    expect(container.textContent).toContain("Head ref");
  });

  it("creates a working tree review and navigates to the detail route", async () => {
    mocks.listState = {
      data: [],
      error: null,
      isLoading: false
    };
    mocks.createDiffReview.mockResolvedValue({
      ...diffReviewSummary,
      id: "created-review"
    });

    const { container } = await renderDiffReviewsPage();
    await submitForm(container);

    expect(mocks.createDiffReview).toHaveBeenCalledWith("project-1", {
      reviewType: "working_tree"
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "diff-reviews"]
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/diff-reviews/$reviewId",
      params: { projectId: "project-1", reviewId: "created-review" }
    });
  });

  it("creates a ref range review with base and head refs", async () => {
    mocks.listState = {
      data: [],
      error: null,
      isLoading: false
    };
    mocks.createDiffReview.mockResolvedValue({
      ...diffReviewSummary,
      id: "created-review"
    });

    const { container } = await renderDiffReviewsPage();

    await changeSelect(container, "Review type", "ref_range");
    await changeInput(container, "Base ref", "main");
    await changeInput(container, "Head ref", "feature/local-diff-review");
    await submitForm(container);

    expect(mocks.createDiffReview).toHaveBeenCalledWith("project-1", {
      reviewType: "ref_range",
      baseRef: "main",
      headRef: "feature/local-diff-review"
    });
  });
});

describe("DiffReviewDetailPage", () => {
  it("renders changed files, affected specs, related tasks, findings, and validation commands", () => {
    mocks.detailState = {
      data: diffReviewDetail,
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <DiffReviewDetailPage projectId="project-1" reviewId="review-1" />
    );

    expect(html).toContain("Diff Reviews");
    expect(html).toContain("working tree");
    expect(html).toContain("ready for review");
    expect(html).toContain("abc1234");
    expect(html).toContain("fedcba9");
    expect(html).toContain("Changed Files");
    expect(html).toContain("specops/use/checkout.md");
    expect(html).toContain("apps/api/src/checkout.ts");
    expect(html).toContain("apps/api/src/checkout.test.ts");
    expect(html).toContain("Affected Specs");
    expect(html).toContain("use.checkout");
    expect(html).toContain("Related Tasks");
    expect(html).toContain("task.checkout");
    expect(html).toContain("Findings");
    expect(html).toContain("Source files changed without a spec file update.");
    expect(html).toContain("Update the checkout spec.");
    expect(html).toContain("Validation Commands");
    expect(html).toContain("pnpm test -- checkout");
    expect(html).toContain("pnpm typecheck");
  });

  it("renders status buttons for ready reviews", () => {
    mocks.detailState = {
      data: diffReviewDetail,
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <DiffReviewDetailPage projectId="project-1" reviewId="review-1" />
    );

    expect(html).toContain("Mark accepted");
    expect(html).toContain("Needs follow-up");
    expect(html).toContain("Supersede");
  });

  it("updates ready review statuses and invalidates review queries", async () => {
    mocks.detailState = {
      data: diffReviewDetail,
      error: null,
      isLoading: false
    };
    mocks.updateDiffReviewStatus.mockResolvedValue({
      ...diffReviewDetail,
      status: "accepted"
    });

    const { container } = await renderDiffReviewDetailPage();

    await clickButton(container, "Mark accepted");
    expect(mocks.updateDiffReviewStatus).toHaveBeenLastCalledWith("project-1", "review-1", {
      status: "accepted"
    });
    expectReviewInvalidations();

    mocks.invalidateQueries.mockClear();
    await clickButton(container, "Needs follow-up");
    expect(mocks.updateDiffReviewStatus).toHaveBeenLastCalledWith("project-1", "review-1", {
      status: "needs_followup"
    });
    expectReviewInvalidations();

    mocks.invalidateQueries.mockClear();
    await clickButton(container, "Supersede");
    expect(mocks.updateDiffReviewStatus).toHaveBeenLastCalledWith("project-1", "review-1", {
      status: "superseded"
    });
    expectReviewInvalidations();
  });
});

const diffReviewSummary: DiffReviewSummaryResponse = {
  id: "review-1",
  projectId: "project-1",
  status: "ready_for_review",
  reviewType: "working_tree",
  baseRef: null,
  headRef: null,
  baseCommit: "abc1234567890",
  headCommit: "fedcba9876543",
  changedFileCount: 3,
  findingCounts: {
    blocker: 1,
    review: 2,
    context: 0,
    info: 1
  },
  createdAt: "2026-05-12T08:00:00.000Z",
  updatedAt: "2026-05-12T08:30:00.000Z"
};

const diffReviewDetail: DiffReviewDetailResponse = {
  ...diffReviewSummary,
  changedFiles: {
    specs: ["specops/use/checkout.md"],
    source: ["apps/api/src/checkout.ts"],
    tests: ["apps/api/src/checkout.test.ts"],
    other: ["pnpm-lock.yaml"]
  },
  reviewSummary: {
    changedFiles: {
      specs: ["specops/use/checkout.md"],
      source: ["apps/api/src/checkout.ts"],
      tests: ["apps/api/src/checkout.test.ts"],
      other: ["pnpm-lock.yaml"]
    },
    affectedSpecs: [
      {
        entityId: "use.checkout",
        title: "Checkout flow",
        type: "use_case",
        filePath: "specops/use/checkout.md",
        reason: "changed_spec"
      }
    ],
    relatedTasks: [
      {
        entityId: "task.checkout",
        title: "Review checkout validation",
        status: "ready",
        filePath: "agent-tasks/task.checkout.md",
        reason: "generated_from"
      }
    ],
    findings: [
      {
        id: "finding-1",
        severity: "blocker",
        kind: "source_changed_without_spec",
        message: "Source files changed without a spec file update.",
        suggestedFollowUp: "Update the checkout spec.",
        entityId: "use.checkout",
        filePath: "apps/api/src/checkout.ts"
      }
    ],
    suggestedValidationCommands: ["pnpm test -- checkout", "pnpm typecheck"]
  }
};

async function renderDiffReviewsPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(<DiffReviewsPage projectId="project-1" />);
  });

  return { container };
}

async function renderDiffReviewDetailPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(<DiffReviewDetailPage projectId="project-1" reviewId="review-1" />);
  });

  return { container };
}

async function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("Missing diff review form");
  }

  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();
  });
}

async function changeInput(container: HTMLElement, label: string, value: string) {
  const target = labelledControl<HTMLInputElement>(container, label, "input");
  await act(async () => {
    target.value = value;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  });
}

async function changeSelect(container: HTMLElement, label: string, value: string) {
  const target = labelledControl<HTMLSelectElement>(container, label, "select");
  await act(async () => {
    target.value = value;
    target.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickButton(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text
  );
  if (!button) {
    throw new Error(`Missing button ${text}`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function expectReviewInvalidations() {
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["projects", "project-1", "diff-reviews"]
  });
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["projects", "project-1", "diff-reviews", "review-1"]
  });
}

function labelledControl<T extends HTMLInputElement | HTMLSelectElement>(
  container: HTMLElement,
  label: string,
  selector: "input" | "select"
): T {
  const labelled = [...container.querySelectorAll(`${selector}[aria-label="${label}"]`)].at(0);
  if (!labelled) {
    throw new Error(`Missing ${selector} labelled ${label}`);
  }

  return labelled as T;
}
