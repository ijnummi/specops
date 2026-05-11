// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import type { EntityReadinessDto } from "@specops/contracts";
import { describe, expect, it } from "vitest";

import { ReadinessPanel } from "./readiness-panel.js";

describe("ReadinessPanel", () => {
  it("renders ready status with empty attention text", () => {
    const html = renderToStaticMarkup(<ReadinessPanel readiness={readiness({ checks: [] })} />);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("No readiness checks need attention.");
  });

  it("renders failed check labels, details, and suggested fixes", () => {
    const html = renderToStaticMarkup(
      <ReadinessPanel
        readiness={readiness({
          readiness: "blocked",
          checks: [
            {
              id: "task_missing",
              severity: "blocker",
              label: "Task missing",
              detail: "No implementation task links back to this spec.",
              suggestedFix: "Generate or link an agent task.",
              relatedEntityId: null,
              filePath: "spec/domain/decision.md"
            },
            {
              id: "context_missing",
              severity: "context",
              label: "Context missing",
              detail: "This spec has no incoming context links.",
              suggestedFix: "Link at least one related decision or task.",
              relatedEntityId: "domain.context",
              filePath: null
            }
          ]
        })}
      />
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.textContent).toContain("Blocked");
    expect(container.textContent).toContain("Task missing");
    expect(container.textContent).toContain("No implementation task links back to this spec.");
    expect(container.textContent).toContain("Generate or link an agent task.");
    expect(container.textContent).toContain("Context missing");
    expect(container.textContent).toContain("This spec has no incoming context links.");
    expect(container.textContent).toContain("Link at least one related decision or task.");
  });
});

function readiness(input: Partial<EntityReadinessDto>): EntityReadinessDto {
  return {
    entityId: "domain.decision",
    title: "Decision",
    type: "domain_entity",
    status: "draft",
    filePath: "spec/domain/decision.md",
    readiness: "ready",
    checks: [],
    ...input
  };
}
