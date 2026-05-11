import type { ProjectReadinessDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readinessState: {
    data: null as ProjectReadinessDto | null,
    error: null as Error | null,
    isLoading: false
  },
  projectReadinessQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "readiness"]
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mocks.readinessState
}));

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

vi.mock("../api/queries.js", () => ({
  projectReadinessQuery: mocks.projectReadinessQuery
}));

import { ReadinessPage } from "./readiness.js";

describe("ReadinessPage", () => {
  it("renders summary counts and groups non-ready queue items by readiness state", () => {
    mocks.readinessState = {
      data: readiness,
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ReadinessPage projectId="project-1" />);

    expect(html).toContain("Spec Readiness");
    expect(html).toContain("Ready");
    expect(html).toContain("Blocked");
    expect(html).toContain("Needs Review");
    expect(html).toContain("Needs Context");
    expect(html).toContain("Payment workflow");
    expect(html).toContain("Acceptance criteria are missing.");
    expect(html).toContain("Customer profile");
    expect(html).toContain("Source evidence is stale.");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:use.payment:");
    expect(html).toContain("/projects/$projectId/entities/$entityId:project-1:domain.customer:");
    expect(html).toContain("No specs in this group.");
  });
});

const readiness: ProjectReadinessDto = {
  summary: {
    ready: 4,
    blocked: 1,
    needsReview: 1,
    needsContext: 0
  },
  queue: [
    {
      entityId: "use.payment",
      title: "Payment workflow",
      type: "use_case",
      status: "draft",
      filePath: "specops/use/payment.md",
      readiness: "blocked",
      highestSeverity: "blocker",
      failedCheckCount: 2,
      topChecks: [
        {
          id: "use_case_acceptance_criteria_missing",
          severity: "blocker",
          label: "Missing acceptance criteria",
          detail: "Acceptance criteria are missing.",
          suggestedFix: "Add verifiable acceptance criteria.",
          relatedEntityId: null,
          filePath: "specops/use/payment.md"
        }
      ]
    },
    {
      entityId: "domain.customer",
      title: "Customer profile",
      type: "domain_entity",
      status: "accepted",
      filePath: "specops/domain/customer.md",
      readiness: "needs_review",
      highestSeverity: "review",
      failedCheckCount: 1,
      topChecks: [
        {
          id: "source_evidence_stale",
          severity: "review",
          label: "Stale source evidence",
          detail: "Source evidence is stale.",
          suggestedFix: "Review linked source evidence.",
          relatedEntityId: null,
          filePath: "specops/domain/customer.md"
        }
      ]
    }
  ]
};
