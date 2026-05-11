import { describe, expect, it } from "vitest";

import {
  buildEntityReadiness,
  buildProjectReadiness,
  type ReadinessEntityInput,
  type ReadinessLinkInput
} from "../services/spec-readiness-service.js";

describe("buildEntityReadiness", () => {
  it("reports validation errors and broken outgoing links as blocked in deterministic order", () => {
    const readiness = buildEntityReadiness(
      entityInput({
        entityId: "interface.checkout",
        type: "interface",
        bodyText:
          "Checkout service contract with enough body text to avoid the short body context check.",
        validationMessages: [
          validationMessage("validation-b", "missing_field", "Missing required field"),
          validationMessage("validation-a", "duplicate_id", "Duplicate entity ID")
        ],
        outgoingLinks: [
          link("interface.checkout", "missing.payment", "uses"),
          link("interface.checkout", "missing.account", "uses")
        ],
        allEntityIds: ["interface.checkout"],
        hasSourceInventory: false
      })
    );

    expect(readiness.readiness).toBe("blocked");
    expect(readiness.checks.map((check) => check.id)).toEqual([
      "entity_validation_error:duplicate_id:validation-a",
      "entity_validation_error:missing_field:validation-b",
      "broken_outgoing_link:missing.account:uses",
      "broken_outgoing_link:missing.payment:uses",
      "interface_context_missing"
    ]);
  });

  it("checks use case markdown headings against bodyMarkdown, not bodyText", () => {
    const readiness = buildEntityReadiness(
      entityInput({
        entityId: "uc.checkout",
        type: "use_case",
        bodyMarkdown:
          "## Goal\nLet a shopper complete checkout using a saved payment method.\n\n" +
          "Detailed flow covers cart review, payment confirmation, receipt delivery, and error handling.",
        bodyText:
          "## Acceptance Criteria appears here only because this fixture proves markdown heading checks do not use bodyText. " +
          "The meaningful body is still long enough to avoid the short body check.",
        outgoingLinks: [link("uc.checkout", "interface.checkout", "uses")],
        allEntityIds: ["uc.checkout", "interface.checkout"],
        entityTypesById: { "interface.checkout": "interface" }
      })
    );

    expect(readiness.readiness).toBe("needs_context");
    expect(readiness.checks.map((check) => check.id)).toEqual([
      "use_case_acceptance_criteria_missing"
    ]);
  });

  it("blocks agent tasks with a missing source entity and reviews stale tasks with validation signal", () => {
    const missingSource = buildEntityReadiness(
      entityInput({
        entityId: "task.checkout",
        type: "agent_task",
        frontmatterJson: { source_entity: "uc.missing" },
        bodyText:
          "Run pnpm test after implementing checkout so this task includes validation command signal.",
        bodyMarkdown:
          "Run `pnpm test` after implementing checkout so this task includes validation command signal.",
        outgoingLinks: [],
        allEntityIds: ["task.checkout"]
      })
    );
    const stale = buildEntityReadiness(
      entityInput({
        entityId: "task.refresh-checkout",
        type: "agent_task",
        frontmatterJson: { source_entity: "uc.checkout" },
        bodyText:
          "Run pnpm --filter api test after refreshing checkout so this task includes validation command signal.",
        bodyMarkdown:
          "Run `pnpm --filter api test` after refreshing checkout so this task includes validation command signal.",
        outgoingLinks: [link("task.refresh-checkout", "uc.checkout", "generated_from")],
        allEntityIds: ["task.refresh-checkout", "uc.checkout"],
        staleTaskEntityIds: ["task.refresh-checkout"]
      })
    );

    expect(missingSource.readiness).toBe("blocked");
    expect(missingSource.checks.map((check) => check.id)).toContain("agent_task_source_missing");
    expect(stale.readiness).toBe("needs_review");
    expect(stale.checks.map((check) => check.id)).toEqual(["agent_task_stale"]);
  });
});

describe("buildProjectReadiness", () => {
  it("summarizes all entities and sorts the non-ready queue by severity, type, and entityId", () => {
    const entities = [
      entityInput({
        entityId: "uc.needs-context-b",
        type: "use_case",
        bodyMarkdown: "## Goal\nPlan the checkout experience in detail.",
        bodyText:
          "Detailed body text is long enough to avoid the generic short body check for this use case.",
        outgoingLinks: [link("uc.needs-context-b", "interface.checkout", "uses")],
        allEntityIds: [
          "uc.needs-context-b",
          "agent.needs-review",
          "agent.blocked",
          "domain.ready",
          "uc.needs-context-a",
          "interface.checkout"
        ],
        entityTypesById: { "interface.checkout": "interface" }
      }),
      entityInput({
        entityId: "agent.needs-review",
        type: "agent_task",
        frontmatterJson: { source_entity: "domain.ready" },
        bodyText:
          "Run pnpm test after reviewing checkout so this task includes validation command signal.",
        bodyMarkdown:
          "Run `pnpm test` after reviewing checkout so this task includes validation command signal.",
        allEntityIds: ["agent.needs-review", "domain.ready"],
        staleTaskEntityIds: ["agent.needs-review"]
      }),
      entityInput({
        entityId: "agent.blocked",
        type: "agent_task",
        bodyText:
          "Run pnpm test after implementation to provide validation signal for this task and document enough execution context.",
        bodyMarkdown:
          "Run `pnpm test` after implementation to provide validation signal for this task and document enough execution context.",
        allEntityIds: ["agent.blocked"]
      }),
      entityInput({
        entityId: "domain.ready",
        type: "domain_entity",
        bodyText:
          "A domain entity with enough content and a link so it is not isolated in this project.",
        outgoingLinks: [link("domain.ready", "interface.checkout", "uses")],
        allEntityIds: ["domain.ready", "interface.checkout"],
        entityTypesById: { "interface.checkout": "interface" }
      }),
      entityInput({
        entityId: "uc.needs-context-a",
        type: "use_case",
        bodyMarkdown: "## Goal\nPlan the checkout experience in detail.",
        bodyText:
          "Detailed body text is long enough to avoid the generic short body check for this use case.",
        outgoingLinks: [link("uc.needs-context-a", "interface.checkout", "uses")],
        allEntityIds: ["uc.needs-context-a", "interface.checkout"],
        entityTypesById: { "interface.checkout": "interface" }
      })
    ].map(buildEntityReadiness);

    const project = buildProjectReadiness(entities);

    expect(project.summary).toEqual({
      ready: 1,
      needsContext: 2,
      needsReview: 1,
      blocked: 1
    });
    expect(project.queue.map((item) => item.entityId)).toEqual([
      "agent.blocked",
      "agent.needs-review",
      "uc.needs-context-a",
      "uc.needs-context-b"
    ]);
    expect(project.queue[0]?.topChecks.map((check) => check.id)).toEqual([
      "agent_task_source_missing"
    ]);
  });
});

function entityInput(overrides: Partial<ReadinessEntityInput>): ReadinessEntityInput {
  const entityId = overrides.entityId ?? "domain.default";
  const type = overrides.type ?? "domain_entity";
  return {
    entityId,
    title: overrides.title ?? entityId,
    type,
    status: overrides.status ?? "draft",
    filePath: overrides.filePath ?? `specops/${entityId}.md`,
    frontmatterJson: overrides.frontmatterJson ?? {},
    bodyMarkdown:
      overrides.bodyMarkdown ??
      "## Goal\nThis specification has enough markdown content for the readiness checks.",
    bodyText:
      overrides.bodyText ??
      "This specification has enough plain text content to satisfy the minimum meaningful body length.",
    validationMessages: overrides.validationMessages ?? [],
    incomingLinks: overrides.incomingLinks ?? [],
    outgoingLinks: overrides.outgoingLinks ?? [],
    allEntityIds: overrides.allEntityIds ?? [entityId],
    entityTypesById: overrides.entityTypesById ?? { [entityId]: type },
    sourceBackedEntityIds: overrides.sourceBackedEntityIds ?? [],
    hasSourceInventory: overrides.hasSourceInventory ?? false,
    staleTaskEntityIds: overrides.staleTaskEntityIds ?? []
  };
}

function link(fromEntityId: string, toEntityId: string, linkType: string): ReadinessLinkInput {
  return {
    id: `${fromEntityId}:${linkType}:${toEntityId}`,
    fromEntityId,
    toEntityId,
    linkType,
    source: "frontmatter"
  };
}

function validationMessage(id: string, code: string, message: string) {
  return {
    id,
    projectId: "project-1",
    indexRunId: null,
    filePath: "specops/interface.checkout.md",
    entityId: "interface.checkout",
    level: "error" as const,
    code,
    message,
    createdAt: "2026-05-11T00:00:00.000Z"
  };
}
