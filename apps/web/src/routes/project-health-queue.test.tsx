// @vitest-environment happy-dom

import type { ProjectHealthQueueResponseDto } from "@specops/contracts";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  healthQueueState: {
    data: null as ProjectHealthQueueResponseDto | null,
    error: null as Error | null,
    isLoading: false
  },
  projectHealthQueueQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "health-queue"]
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mocks.healthQueueState
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    search,
    to
  }: {
    children: ReactNode;
    className?: string;
    params?: Record<string, string>;
    search?: Record<string, boolean | number | string | undefined>;
    to: string;
  }) => {
    const resolved = to
      .replace("$projectId", params?.projectId ?? "")
      .replace("$entityId", params?.entityId ?? "");
    const searchText = search
      ? Object.entries(search)
          .filter((entry): entry is [string, boolean | number | string] => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join("&")
      : "";

    return (
      <a className={className} href={searchText ? `${resolved}?${searchText}` : resolved}>
        {children}
      </a>
    );
  }
}));

vi.mock("../api/queries.js", () => ({
  projectHealthQueueQuery: mocks.projectHealthQueueQuery
}));

import { ProjectHealthQueuePage } from "./project-health-queue.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProjectHealthQueuePage", () => {
  beforeEach(() => {
    mocks.healthQueueState = {
      data: null,
      error: null,
      isLoading: false
    };
    mocks.projectHealthQueueQuery.mockClear();
  });

  afterEach(() => {
    cleanupRenderedRoots();
  });

  it("renders loading and error states", () => {
    mocks.healthQueueState = {
      data: null,
      error: null,
      isLoading: true
    };

    expect(renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />)).toContain(
      "Loading health queue"
    );
    expect(mocks.projectHealthQueueQuery).toHaveBeenCalledWith("project-1");

    mocks.healthQueueState = {
      data: null,
      error: new Error("health queue failed"),
      isLoading: false
    };

    expect(renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />)).toContain(
      "health queue failed"
    );
  });

  it("renders an empty state with source state labels", () => {
    mocks.healthQueueState = {
      data: healthQueueFixture({ items: [] }),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />);

    expect(html).toContain("No health queue items");
    expect(html).toContain("Index");
    expect(html).toContain("Graph");
    expect(html).toContain("Concepts");
  });

  it("renders queue items, detail evidence, diagnostics, and mapped actions", () => {
    mocks.healthQueueState = {
      data: healthQueueFixture(),
      error: null,
      isLoading: false
    };

    const html = renderToStaticMarkup(<ProjectHealthQueuePage projectId="project-1" />);

    expect(html).toContain("Health Queue");
    expect(html).toContain("Payment workflow missing source evidence");
    expect(html).toContain("spec / spec_missing_source_evidence");
    expect(html).toContain("blocker");
    expect(html).toContain("Payment workflow has no source links.");
    expect(html).toContain("Spec entity");
    expect(html).toContain("specops/use/payment.md");
    expect(html).toContain("Readiness warning");
    expect(html).toContain("source-links-missing");
    expect(html).toContain("Open spec");
    expect(html).toContain("/projects/project-1/entities/use.payment");
    expect(html).toContain("/projects/project-1/readiness");
    expect(html).toContain(
      "/projects/project-1/impact/use.payment?depth=1&amp;direction=both&amp;includeSource=true"
    );
    expect(html).toContain(
      "/projects/project-1/concepts?conceptId=00000000-0000-4000-8000-000000000010"
    );
    expect(html).toContain("/projects/project-1/graph?q=apps/api/src/payments.ts");
    expect(html).toContain(
      "/projects/project-1/graph?nodeId=00000000-0000-4000-8000-000000000011"
    );
    expect(html).toContain("/projects/project-1");
  });

  it("renders required filters and filters the queue by family", () => {
    mocks.healthQueueState = {
      data: healthQueueFixture({
        items: [
          specItem(),
          sourceItem(),
          conceptItem()
        ]
      }),
      error: null,
      isLoading: false
    };

    const { container } = renderPage();

    expect(selectOptionValues(container, "Family")).toEqual(["all", "spec", "source", "concept"]);
    expect(selectOptionValues(container, "Severity")).toEqual([
      "all",
      "blocker",
      "review",
      "context"
    ]);
    expect(container.textContent).toContain("Payment workflow missing source evidence");
    expect(container.textContent).toContain("Unmapped source file");
    expect(container.textContent).toContain("Checkout concept needs review");

    const familySelect = selectByLabel(container, "Family");
    act(() => {
      familySelect.value = "source";
      familySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Payment workflow missing source evidence");
    expect(container.textContent).toContain("Unmapped source file");
    expect(container.textContent).not.toContain("Checkout concept needs review");
  });
});

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);

  act(() => {
    root.render(<ProjectHealthQueuePage projectId="project-1" />);
  });

  return { container, root };
}

function cleanupRenderedRoots() {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
}

function selectByLabel(container: HTMLElement, label: string) {
  const select = container.querySelector(`select[aria-label="${label}"]`);
  expect(select).toBeTruthy();
  return select as HTMLSelectElement;
}

function selectOptionValues(container: HTMLElement, label: string) {
  return Array.from(selectByLabel(container, label).querySelectorAll("option")).map(
    (option) => option.value
  );
}

function healthQueueFixture(
  overrides: Partial<ProjectHealthQueueResponseDto> = {}
): ProjectHealthQueueResponseDto {
  return {
    generatedAt: "2026-05-15T10:00:00.000Z",
    sourceState: {
      latestIndexRunId: "00000000-0000-4000-8000-000000000001",
      latestIndexRunStatus: "succeeded",
      latestProjectGraphVersionId: "00000000-0000-4000-8000-000000000002",
      latestProjectGraphStatus: "ready",
      latestConceptGraphVersionId: "00000000-0000-4000-8000-000000000003",
      latestConceptGraphStatus: "limited",
      hasProjectGraph: true,
      hasConceptGraph: true
    },
    summary: {
      total: overrides.items?.length ?? 1,
      byFamily: { spec: 1, source: 0, concept: 0 },
      bySeverity: { blocker: 1, review: 0, context: 0 },
      byKind: { spec_missing_source_evidence: 1 }
    },
    diagnostics: [
      {
        level: "warning",
        code: "stale-graph",
        message: "Readiness warning"
      }
    ],
    items: [specItem()],
    ...overrides
  };
}

function specItem(): ProjectHealthQueueResponseDto["items"][number] {
  return {
    id: "spec_missing_source_evidence:use.payment",
    family: "spec",
    kind: "spec_missing_source_evidence",
    severity: "blocker",
    title: "Payment workflow missing source evidence",
    detail: "Payment workflow has no source links.",
    primaryTarget: {
      kind: "spec",
      entityId: "use.payment",
      title: "Payment workflow",
      type: "use_case",
      status: "draft",
      filePath: "specops/use/payment.md"
    },
    evidence: [
      {
        kind: "spec_entity",
        label: "Spec entity",
        detail: "specops/use/payment.md",
        entityId: "use.payment",
        filePath: "specops/use/payment.md"
      }
    ],
    actions: [
      { kind: "open_spec", label: "Open spec", entityId: "use.payment" },
      { kind: "open_readiness", label: "Open readiness", entityId: "use.payment" },
      { kind: "open_impact", label: "Open impact", entityId: "use.payment" },
      {
        kind: "open_concept",
        label: "Open concept",
        conceptId: "00000000-0000-4000-8000-000000000010"
      },
      { kind: "open_project_graph", label: "Open graph", q: "apps/api/src/payments.ts" },
      {
        kind: "open_graph_node",
        label: "Open graph node",
        graphNodeId: "00000000-0000-4000-8000-000000000011"
      },
      { kind: "open_analyze_run", label: "Open analyze run" }
    ],
    diagnostics: [
      {
        level: "error",
        code: "source-links-missing",
        message: "No source evidence is linked."
      }
    ]
  };
}

function sourceItem(): ProjectHealthQueueResponseDto["items"][number] {
  return {
    id: "source_without_spec:apps/api/src/payments.ts",
    family: "source",
    kind: "source_without_spec",
    severity: "review",
    title: "Unmapped source file",
    detail: "Source file has no supporting spec.",
    primaryTarget: {
      kind: "source",
      graphNodeId: null,
      nodeKey: "file:apps/api/src/payments.ts",
      nodeType: "file",
      path: "apps/api/src/payments.ts",
      symbolName: null
    },
    evidence: [
      {
        kind: "source_path",
        label: "Source path",
        detail: "apps/api/src/payments.ts",
        filePath: "apps/api/src/payments.ts"
      }
    ],
    actions: [{ kind: "open_project_graph", label: "Open graph" }],
    diagnostics: []
  };
}

function conceptItem(): ProjectHealthQueueResponseDto["items"][number] {
  return {
    id: "concept_low_confidence:checkout",
    family: "concept",
    kind: "concept_low_confidence",
    severity: "context",
    title: "Checkout concept needs review",
    detail: "Concept confidence is low.",
    primaryTarget: {
      kind: "concept",
      conceptId: "00000000-0000-4000-8000-000000000012",
      conceptKey: "checkout",
      conceptType: "workflow",
      name: "Checkout"
    },
    evidence: [
      {
        kind: "concept",
        label: "Concept",
        detail: "Checkout",
        conceptId: "00000000-0000-4000-8000-000000000012",
        confidence: 0.42
      }
    ],
    actions: [
      {
        kind: "open_concept",
        label: "Open concept",
        conceptId: "00000000-0000-4000-8000-000000000012"
      }
    ],
    diagnostics: []
  };
}
