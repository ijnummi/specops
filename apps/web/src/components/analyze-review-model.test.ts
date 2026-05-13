import type { AnalyzeReviewAssemblyDto, AnalyzeReviewInputDto } from "@specops/contracts";
import { describe, expect, it } from "vitest";

import {
  groupAnalyzeReviewInputs,
  sortAnalyzeReviewAssemblies
} from "./analyze-review-model.js";

describe("analyze review model", () => {
  it("groups inputs by entity type and unknown confidence", () => {
    const groups = groupAnalyzeReviewInputs([
      input({ entityType: "domain_entity", title: "Project" }),
      input({ entityType: "interface", title: "Project service" }),
      input({ entityType: "interface", title: "Project API" }),
      input({ entityType: "use_case", title: "Review drafts", confidence: null })
    ]);

    expect(groups.Domain).toHaveLength(1);
    expect(groups.Services).toHaveLength(1);
    expect(groups.Interfaces).toHaveLength(1);
    expect(groups.Unknowns).toHaveLength(1);
  });

  it("sorts blocker assemblies before warnings and ready assemblies", () => {
    const sorted = sortAnalyzeReviewAssemblies([
      assembly("ready", "Ready"),
      assembly("blocker", "Blocked"),
      assembly("warning", "Warning")
    ]);

    expect(sorted.map((item) => item.title)).toEqual(["Blocked", "Warning", "Ready"]);
  });

  it("sorts draft assemblies before accepted or discarded assemblies", () => {
    const sorted = sortAnalyzeReviewAssemblies([
      assembly("blocker", "Accepted blocker", { status: "accepted" }),
      assembly("ready", "Draft ready", { status: "draft" }),
      assembly("blocker", "Discarded blocker", { status: "discarded" }),
      assembly("warning", "Draft warning", { status: "draft" })
    ]);

    expect(sorted.map((item) => item.title)).toEqual([
      "Draft warning",
      "Draft ready",
      "Accepted blocker",
      "Discarded blocker"
    ]);
  });
});

function input(overrides: Partial<AnalyzeReviewInputDto> = {}): AnalyzeReviewInputDto {
  return {
    proposalId: "00000000-0000-4000-8000-000000000001",
    role: "primary",
    proposalType: "source_spec_entity",
    title: "Project",
    entityType: "domain_entity",
    entityId: "project",
    filePath: "specs/project.md",
    confidence: 0.8,
    assignmentState: "unassigned",
    evidenceCount: 0,
    ...overrides
  };
}

function assembly(
  state: AnalyzeReviewAssemblyDto["validation"]["state"],
  title: string,
  overrides: Partial<AnalyzeReviewAssemblyDto> = {}
): AnalyzeReviewAssemblyDto {
  return {
    id: `00000000-0000-4000-8000-00000000000${state.length}`,
    projectId: "00000000-0000-4000-8000-000000000010",
    analyzeRunId: "00000000-0000-4000-8000-000000000020",
    status: "draft",
    entityType: "domain_entity",
    entityId: title.toLowerCase(),
    title,
    summary: "",
    filePath: `specs/${title.toLowerCase()}.md`,
    renderedMarkdown: null,
    inputs: [],
    claims: [],
    validation: {
      state,
      messages: []
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    acceptedAt: null,
    discardedAt: null,
    ...overrides
  };
}
