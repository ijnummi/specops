import { describe, expect, it } from "vitest";

import {
  agentRunDetailSchema,
  finishAgentRunResponseSchema,
  startAgentRunRequestSchema,
  updateAgentRunStatusRequestSchema
} from "./agent-runs.js";

describe("agent run contracts", () => {
  it("parses start agent run requests", () => {
    expect(
      startAgentRunRequestSchema.parse({
        taskEntityId: "task.review-dashboard",
        agent: "codex"
      })
    ).toEqual({
      taskEntityId: "task.review-dashboard",
      agent: "codex"
    });
  });

  it("rejects running as an update status", () => {
    expect(() => updateAgentRunStatusRequestSchema.parse({ status: "running" })).toThrow();
  });

  it("parses agent run detail and finish responses", () => {
    const payload = agentRunDetail();

    const parsedDetail = agentRunDetailSchema.parse(payload);
    const parsedFinish = finishAgentRunResponseSchema.parse(payload);

    expect(parsedDetail.status).toBe("ready_for_review");
    expect(parsedDetail.changedFiles.source).toEqual(["apps/web/src/routes/review.tsx"]);
    expect(parsedDetail.changedFiles.tests).toEqual(["apps/web/src/routes/review.test.tsx"]);
    expect(parsedDetail.reviewSummary.affectedSpecs[0]).toEqual({
      entityId: "task.review-dashboard",
      title: "Review Dashboard",
      type: "task",
      filePath: "spec/tasks/review-dashboard.md",
      reason: "changed_spec"
    });
    expect(parsedDetail.reviewSummary.taskContext.sourceEntityId).toBe("interface.review-service");
    expect(parsedDetail.reviewSummary.findings[0]).toMatchObject({
      id: "finding-1",
      severity: "review",
      kind: "possible_missing_test_change",
      message: "Review dashboard changed without an end-to-end test update.",
      suggestedFollowUp: "Add browser coverage for the dashboard review action.",
      entityId: "task.review-dashboard",
      filePath: "apps/web/src/routes/review.tsx"
    });
    expect(parsedDetail.startedAt).toBe("2026-05-11T10:00:00.000Z");
    expect(parsedDetail.finishedAt).toBe("2026-05-11T10:08:00.000Z");
    expect(parsedDetail.startGitCommit).toBe("abc1234");
    expect(parsedDetail.endGitCommit).toBe("def5678");
    expect(parsedFinish).toEqual(parsedDetail);
  });
});

function agentRunDetail() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    taskEntityId: "task.review-dashboard",
    taskTitle: "Review Dashboard",
    taskFilePath: "spec/tasks/review-dashboard.md",
    agent: "codex",
    status: "ready_for_review",
    startedAt: "2026-05-11T10:00:00.000Z",
    finishedAt: "2026-05-11T10:08:00.000Z",
    startGitCommit: "abc1234",
    endGitCommit: "def5678",
    changedFileCount: 3,
    findingCounts: {
      blocker: 0,
      review: 1,
      context: 0,
      info: 0
    },
    createdAt: "2026-05-11T10:00:00.000Z",
    updatedAt: "2026-05-11T10:08:00.000Z",
    promptMarkdown: "# Review dashboard task",
    changedFiles: {
      specs: ["spec/tasks/review-dashboard.md"],
      source: ["apps/web/src/routes/review.tsx"],
      tests: ["apps/web/src/routes/review.test.tsx"],
      other: []
    },
    reviewSummary: {
      changedFiles: {
        specs: ["spec/tasks/review-dashboard.md"],
        source: ["apps/web/src/routes/review.tsx"],
        tests: ["apps/web/src/routes/review.test.tsx"],
        other: []
      },
      affectedSpecs: [
        {
          entityId: "task.review-dashboard",
          title: "Review Dashboard",
          type: "task",
          filePath: "spec/tasks/review-dashboard.md",
          reason: "changed_spec"
        }
      ],
      taskContext: {
        sourceEntityId: "interface.review-service",
        contextEntityIds: ["uc.review-loop"],
        missingEntityIds: ["interface.missing-review-adapter"]
      },
      findings: [
        {
          id: "finding-1",
          severity: "review",
          kind: "possible_missing_test_change",
          message: "Review dashboard changed without an end-to-end test update.",
          suggestedFollowUp: "Add browser coverage for the dashboard review action.",
          entityId: "task.review-dashboard",
          filePath: "apps/web/src/routes/review.tsx"
        }
      ],
      suggestedValidationCommands: [
        "pnpm --filter web test -- review.test.tsx",
        "pnpm --filter web build"
      ]
    }
  };
}
