import { describe, expect, it } from "vitest";

import { createProjectRequestSchema, projectOverviewSchema } from "./projects.js";

describe("createProjectRequestSchema", () => {
  it("accepts kebab-case slugs", () => {
    const parsed = createProjectRequestSchema.parse({
      name: "SpecOps",
      slug: "specops-workbench",
      repoPath: "/repo",
      specopsPath: ".specops"
    });

    expect(parsed.slug).toBe("specops-workbench");
  });

  it("rejects slugs that are not kebab-case", () => {
    expect(() =>
      createProjectRequestSchema.parse({
        name: "SpecOps",
        slug: "SpecOps Workbench",
        repoPath: "/repo",
        specopsPath: ".specops"
      })
    ).toThrow();
  });
});

describe("projectOverviewSchema", () => {
  it("parses dashboard overview data", () => {
    const parsed = projectOverviewSchema.parse({
      project: {
        id: "project-1",
        name: "SpecOps",
        slug: "specops",
        description: null,
        repoPath: "/repo",
        specopsPath: "/repo/specops",
        createdAt: "2026-05-10T10:00:00.000Z",
        updatedAt: "2026-05-10T10:01:00.000Z",
        entityCount: 3,
        linkCount: 2,
        validationErrorCount: 1,
        validationWarningCount: 1,
        lastIndexedAt: "2026-05-10T10:02:00.000Z"
      },
      latestIndexRun: {
        id: "run-1",
        projectId: "project-1",
        startedAt: "2026-05-10T10:02:00.000Z",
        finishedAt: "2026-05-10T10:03:00.000Z",
        status: "succeeded",
        entityCount: 3,
        linkCount: 2,
        errorCount: 1,
        warningCount: 1,
        gitCommit: null,
        sourceFileCount: 1,
        sourceImportCount: 2,
        sourceExportCount: 3,
        sourceSymbolCount: 4
      },
      entityCountsByType: [{ type: "domain_entity", count: 2 }],
      entityCountsByStatus: [{ status: "draft", count: 3 }],
      validationSummary: {
        errorCount: 1,
        warningCount: 1,
        samples: [
          {
            level: "error",
            code: "broken_link",
            message: "Broken link",
            entityId: "domain.customer",
            filePath: "domain/customer.md"
          }
        ]
      },
      sourceInventory: {
        fileCount: 1,
        symbolCount: 4,
        importCount: 2,
        exportCount: 3
      },
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
            entityId: "task.domain-customer",
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
    });

    expect(parsed.project.entityCount).toBe(3);
    expect(parsed.sourceEvidence.withoutSourceEvidenceCount).toBe(1);
    expect(parsed.attentionItems[0]?.kind).toBe("validation_error");
  });
});
