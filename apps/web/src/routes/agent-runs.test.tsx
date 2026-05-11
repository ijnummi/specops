import type { AgentRunDetail, AgentRunSummary } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listState: {
    data: null as AgentRunSummary[] | null,
    error: null as Error | null,
    isLoading: false
  },
  detailState: {
    data: null as AgentRunDetail | null,
    error: null as Error | null,
    isLoading: false
  },
  mutationState: {
    isPending: false,
    mutate: vi.fn()
  },
  invalidateQueries: vi.fn(),
  agentRunsQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "agent-runs"]
  })),
  agentRunQuery: vi.fn((projectId: string, runId: string) => ({
    queryKey: ["projects", projectId, "agent-runs", runId]
  })),
  finishAgentRun: vi.fn(),
  updateAgentRunStatus: vi.fn()
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => mocks.mutationState,
  useQuery: (options: { queryKey: readonly unknown[] }) =>
    options.queryKey.at(-1) === "run-1" ? mocks.detailState : mocks.listState,
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
        .replace("$runId", params?.runId ?? "")}
    >
      {children}
    </a>
  )
}));

vi.mock("../api/queries.js", () => ({
  agentRunQuery: mocks.agentRunQuery,
  agentRunsQuery: mocks.agentRunsQuery,
  finishAgentRun: mocks.finishAgentRun,
  queryKeys: {
    agentRun: (projectId: string, runId: string) =>
      ["projects", projectId, "agent-runs", runId] as const,
    agentRunsRoot: (projectId: string) => ["projects", projectId, "agent-runs"] as const
  },
  updateAgentRunStatus: mocks.updateAgentRunStatus
}));

import { AgentRunDetailPage } from "./agent-run-detail.js";
import { AgentRunsPage } from "./agent-runs.js";

describe("AgentRunsPage", () => {
  it("renders header, task summary fields, finding counts, and detail link", () => {
    mocks.listState = {
      data: [agentRunSummary],
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<AgentRunsPage projectId="project-1" />);

    expect(html).toContain("Agent Runs");
    expect(html).toContain("Review checkout validation");
    expect(html).toContain("task.checkout");
    expect(html).toContain("ready for review");
    expect(html).toContain("codex");
    expect(html).toContain("3 changed files");
    expect(html).toContain("1 blocker");
    expect(html).toContain("2 review");
    expect(html).toContain("abc1234");
    expect(html).toContain("fedcba9");
    expect(html).toContain("/projects/project-1/agent-runs/run-1");
  });
});

describe("AgentRunDetailPage", () => {
  it("renders task title, changed files, findings, and suggested validation commands", () => {
    mocks.detailState = {
      data: agentRunDetail,
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <AgentRunDetailPage projectId="project-1" runId="run-1" />
    );

    expect(html).toContain("Review checkout validation");
    expect(html).toContain("task.checkout");
    expect(html).toContain("codex");
    expect(html).toContain("ready for review");
    expect(html).toContain("specops/use/checkout.md");
    expect(html).toContain("apps/api/src/checkout.ts");
    expect(html).toContain("apps/api/src/checkout.test.ts");
    expect(html).toContain("Checkout source changed without a linked spec update.");
    expect(html).toContain("Update the checkout spec.");
    expect(html).toContain("pnpm test -- checkout");
    expect(html).toContain("pnpm typecheck");
  });
});

const agentRunSummary: AgentRunSummary = {
  id: "run-1",
  projectId: "project-1",
  taskEntityId: "task.checkout",
  taskTitle: "Review checkout validation",
  taskFilePath: "specops/tasks/checkout.md",
  agent: "codex",
  status: "ready_for_review",
  startedAt: "2026-05-12T08:00:00.000Z",
  finishedAt: "2026-05-12T08:30:00.000Z",
  startGitCommit: "abc1234567890",
  endGitCommit: "fedcba9876543",
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

const agentRunDetail: AgentRunDetail = {
  ...agentRunSummary,
  promptMarkdown: "Run checkout validation.",
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
    taskContext: {
      sourceEntityId: "task.checkout",
      contextEntityIds: ["use.checkout"],
      missingEntityIds: []
    },
    findings: [
      {
        id: "finding-1",
        severity: "blocker",
        kind: "source_changed_without_spec",
        message: "Checkout source changed without a linked spec update.",
        suggestedFollowUp: "Update the checkout spec.",
        entityId: "use.checkout",
        filePath: "apps/api/src/checkout.ts"
      }
    ],
    suggestedValidationCommands: ["pnpm test -- checkout", "pnpm typecheck"]
  }
};
