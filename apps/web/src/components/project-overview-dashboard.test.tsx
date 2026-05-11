import type { ProjectHealthDto, ProjectOverviewDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    className?: string;
  }) => (
    <a
      className={className}
      href={`${to}:${params?.projectId ?? ""}:${params?.entityId ?? ""}:${search?.q ?? ""}`}
    >
      {children}
    </a>
  )
}));

import { ProjectOverviewDashboard } from "./project-overview-dashboard.js";

describe("ProjectOverviewDashboard", () => {
  it("renders health, index, inventory, source evidence, tasks, attention, and entity links", () => {
    const html = renderToStaticMarkup(
      <ProjectOverviewDashboard projectId="project-1" overview={overview} health={health} />
    );

    expect(html).toContain("Project Health");
    expect(html).toContain("Latest index");
    expect(html).toContain("Git &amp; Drift");
    expect(html).toContain("Spec Inventory");
    expect(html).toContain("Source Inventory");
    expect(html).toContain("Source Evidence");
    expect(html).toContain("Agent Tasks");
    expect(html).toContain("Needs Attention");
    expect(html).toContain("domain_entity");
    expect(html).toContain("1 without evidence");
    expect(html).toContain("Validation sample needs routing");
    expect(html).toContain("Update Customer");
    expect(html).toContain("Broken link");
    expect(html).toContain("abc1234");
    expect(html).toContain("def5678");
    expect(html).toContain("Index behind HEAD");
    expect(html).toContain("Stale tasks");
    expect(html).toContain("Refresh Customer");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:domain.customer:");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:domain.order:");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:task.customer:");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:task.refresh-customer:");
    expect(html).toContain("/projects/$projectId:project-1::domain_entity");
  });

  it("renders health errors without replacing the overview dashboard", () => {
    const html = renderToStaticMarkup(
      <ProjectOverviewDashboard
        projectId="project-1"
        overview={overview}
        healthError={new Error("Git command failed")}
      />
    );

    expect(html).toContain("Project Health");
    expect(html).toContain("Latest index");
    expect(html).toContain("Git health unavailable");
    expect(html).toContain("Git command failed");
  });

  it("renders no-index and no-source-facts empty states", () => {
    const html = renderToStaticMarkup(
      <ProjectOverviewDashboard
        projectId="project-1"
        overview={{
          ...overview,
          latestIndexRun: null,
          project: { ...overview.project, lastIndexedAt: null },
          sourceInventory: { fileCount: 0, symbolCount: 0, importCount: 0, exportCount: 0 }
        }}
      />
    );

    expect(html).toContain("No index runs yet");
    expect(html).toContain("Run indexing to populate dashboard metrics.");
    expect(html).toContain("No source facts");
    expect(html).toContain("Source inventory is unavailable until indexing scans source files.");
  });
});

const overview: ProjectOverviewDto = {
  project: {
    id: "project-1",
    name: "SpecOps",
    slug: "specops",
    description: null,
    repoPath: "/repo",
    specopsPath: "/repo/specops",
    createdAt: "2026-05-10T10:00:00.000Z",
    updatedAt: "2026-05-10T10:01:00.000Z",
    entityCount: 4,
    linkCount: 2,
    validationErrorCount: 1,
    validationWarningCount: 1,
    lastIndexedAt: "2026-05-10T10:03:00.000Z"
  },
  latestIndexRun: {
    id: "run-1",
    projectId: "project-1",
    startedAt: "2026-05-10T10:02:00.000Z",
    finishedAt: "2026-05-10T10:03:00.000Z",
    status: "succeeded",
    entityCount: 4,
    linkCount: 2,
    errorCount: 1,
    warningCount: 1,
    gitCommit: null,
    sourceFileCount: 1,
    sourceImportCount: 2,
    sourceExportCount: 3,
    sourceSymbolCount: 4
  },
  entityCountsByType: [
    { type: "agent_task", count: 1 },
    { type: "domain_entity", count: 2 }
  ],
  entityCountsByStatus: [
    { status: "accepted", count: 1 },
    { status: "draft", count: 3 }
  ],
  validationSummary: {
    errorCount: 1,
    warningCount: 1,
    samples: [
      {
        level: "error",
        code: "broken_link",
        message: "Validation sample needs routing",
        entityId: "domain.customer",
        filePath: "domain/customer.md"
      }
    ]
  },
  sourceInventory: { fileCount: 1, symbolCount: 4, importCount: 2, exportCount: 3 },
  sourceEvidence: {
    eligibleSpecCount: 2,
    withSourceEvidenceCount: 1,
    withoutSourceEvidenceCount: 1,
    missingSamples: [{ entityId: "domain.order", title: "Order", type: "domain_entity" }]
  },
  agentTasks: {
    totalCount: 1,
    recent: [
      {
        entityId: "task.customer",
        title: "Update Customer",
        status: "draft",
        updatedAt: "2026-05-10T10:04:00.000Z"
      }
    ]
  },
  attentionItems: [
    {
      kind: "validation_error",
      label: "Broken link",
      entityId: "domain.customer",
      filePath: "domain/customer.md"
    }
  ]
};

const health: ProjectHealthDto = {
  git: {
    isRepo: true,
    headCommit: "abc123456789",
    indexedCommit: "def567812345",
    hasUncommittedChanges: true,
    changedSpecFiles: ["specops/domain/customer.md"],
    changedSourceFiles: ["src/customer.ts"],
    untrackedSpecFiles: [],
    untrackedSourceFiles: []
  },
  drift: {
    indexIsBehindHead: true,
    currentSpecFileChangeCount: 1,
    currentSourceFileChangeCount: 1
  },
  staleTasks: {
    count: 1,
    samples: [
      {
        entityId: "task.refresh-customer",
        title: "Refresh Customer",
        sourceEntityId: "domain.customer",
        reason: "source_spec_changed"
      }
    ]
  },
  attentionItems: [
    {
      kind: "index_behind_head",
      label: "Index is behind the current Git HEAD.",
      entityId: null,
      filePath: null
    },
    {
      kind: "stale_agent_task",
      label: "Refresh Customer may need to be refreshed.",
      entityId: "task.refresh-customer",
      filePath: null
    }
  ]
};
