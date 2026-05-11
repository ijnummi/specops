import { describe, expect, it } from "vitest";

import {
  entityReadinessSchema,
  projectReadinessSchema,
  specReadinessCheckSchema,
  specReadinessStatusSchema
} from "./readiness.js";

describe("spec readiness contracts", () => {
  it("parses readiness statuses and check severities", () => {
    expect(specReadinessStatusSchema.parse("ready")).toBe("ready");
    expect(specReadinessStatusSchema.parse("needs_context")).toBe("needs_context");
    expect(specReadinessStatusSchema.parse("needs_review")).toBe("needs_review");
    expect(specReadinessStatusSchema.parse("blocked")).toBe("blocked");

    const check = specReadinessCheckSchema.parse({
      id: "use_case_acceptance_criteria_missing",
      severity: "context",
      label: "Acceptance criteria missing",
      detail: "Use case does not include an acceptance criteria section.",
      suggestedFix: "Add a ## Acceptance Criteria section.",
      relatedEntityId: null,
      filePath: "use-cases/order.md"
    });

    expect(check.severity).toBe("context");
  });

  it("parses project and entity readiness payloads", () => {
    const topCheck = {
      id: "broken_outgoing_link",
      severity: "blocker",
      label: "Broken outgoing link",
      detail: "Spec links to domain.missing, which is not indexed.",
      suggestedFix: "Create domain.missing or remove the link.",
      relatedEntityId: "domain.missing",
      filePath: "domain/customer.md"
    } as const;

    const project = projectReadinessSchema.parse({
      summary: { ready: 1, needsContext: 2, needsReview: 3, blocked: 4 },
      queue: [
        {
          entityId: "domain.customer",
          title: "Customer",
          type: "domain_entity",
          status: "draft",
          filePath: "domain/customer.md",
          readiness: "blocked",
          highestSeverity: "blocker",
          failedCheckCount: 1,
          topChecks: [topCheck]
        }
      ]
    });

    const entity = entityReadinessSchema.parse({
      entityId: "domain.customer",
      title: "Customer",
      type: "domain_entity",
      status: "draft",
      filePath: "domain/customer.md",
      readiness: "blocked",
      checks: [topCheck]
    });

    expect(project.summary.blocked).toBe(4);
    expect(entity.checks[0]?.id).toBe("broken_outgoing_link");
  });

  it("rejects unknown statuses and severities", () => {
    expect(() => specReadinessStatusSchema.parse("almost_ready")).toThrow();
    expect(() =>
      specReadinessCheckSchema.parse({
        id: "bad",
        severity: "critical",
        label: "Bad",
        detail: "Bad",
        suggestedFix: "Fix it.",
        relatedEntityId: null,
        filePath: null
      })
    ).toThrow();
  });
});
