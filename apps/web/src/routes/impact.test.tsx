// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EntityImpactResponseDto } from "@specops/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImpactPage } from "./impact.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, boolean | number | string | undefined>;
    to: string;
  }) => {
    const suffix = search?.depth !== undefined ? `?depth=${String(search.depth)}` : "";
    const href = to
      .replace("$projectId", params?.projectId ?? "")
      .replace("$entityId", params?.entityId ?? "");

    return <a href={`${href}${suffix}`}>{children}</a>;
  },
  useNavigate: () => vi.fn()
}));

vi.mock("../api/queries.js", async () => {
  const actual = await vi.importActual<typeof import("../api/queries.js")>("../api/queries.js");
  return {
    ...actual,
    entityImpactQuery: () => ({
      queryKey: ["impact-test"],
      queryFn: async () => impactResponse()
    })
  };
});

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ImpactPage", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    for (const container of containers.splice(0)) {
      container.remove();
    }
  });

  it("renders impact controls, counts, and navigation", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { container } = await renderImpactPage();

      expect(container.textContent).toContain("Decision");
      expect(container.textContent).toContain("Depth");
      expect(container.textContent).toContain("Direction");
      expect(container.textContent).toContain("Source evidence");
      expect(container.textContent).toContain("Upstream");
      expect(container.textContent).toContain("Downstream");
      expect(container.textContent).toContain("Trace Details");
      expect(container.textContent).toContain("Impact Brief");
      expect(container.textContent).toContain("Upstream 2 / Downstream 1 / Source 2");
      expect(container.querySelector('[data-testid="impact-graph"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="impact-brief"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="impact-trace-panel"]')).not.toBeNull();
      expect(definitionValue(container, "Upstream")).toBe("1");
      expect(definitionValue(container, "Downstream")).toBe("1");
      expect(definitionValue(container, "Source evidence")).toBe("2");
      expect(container.textContent).toContain("Selection");
      expect(container.textContent).not.toContain("Select a graph node for details.");
      expect(container.textContent).toContain("src/domain.ts");
      expect(linkHref(container, "Open Editor")).toBe(
        "/projects/project-1/entities/domain.decision"
      );
      expect(consoleError.mock.calls.flat().join("\n")).not.toContain(
        "Encountered two children with the same key"
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

async function renderImpactPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ImpactPage
          projectId="project-1"
          entityId="domain.decision"
          depth={1}
          direction="both"
          includeSource={true}
        />
      </QueryClientProvider>
    );
  });

  await act(async () => {
    await waitForQueryResult();
  });

  return { container, root };
}

function waitForQueryResult() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function definitionValue(container: HTMLElement, label: string) {
  const item = Array.from(container.querySelectorAll("dl > div")).find(
    (element) => element.querySelector("dt")?.textContent === label
  );

  return item?.querySelector("dd")?.textContent;
}

function linkHref(container: HTMLElement, label: string) {
  const link = Array.from(container.querySelectorAll("a")).find((element) =>
    element.textContent?.includes(label)
  );

  return link?.getAttribute("href");
}

function impactResponse(): EntityImpactResponseDto {
  return {
    rootEntity: {
      entityId: "domain.decision",
      type: "domain_entity",
      title: "Decision",
      status: "draft",
      filePath: "domain/decision.md"
    },
    nodes: [
      {
        id: "spec:domain.decision",
        kind: "spec",
        label: "Decision",
        entityId: "domain.decision",
        type: "domain_entity",
        status: "draft",
        title: "Decision",
        filePath: "domain/decision.md"
      },
      {
        id: "source:src/domain.ts:Decision:domain.decision",
        kind: "source",
        label: "Decision",
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 3,
        annotationLine: 2
      }
    ],
    edges: [
      {
        id: "source-evidence:src/domain.ts:Decision:domain.decision",
        from: "spec:domain.decision",
        to: "source:src/domain.ts:Decision:domain.decision",
        kind: "source_evidence",
        label: "@specops",
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        symbolName: "Decision"
      }
    ],
    upstreamPaths: [
      {
        direction: "upstream",
        entityIds: ["domain.policy", "domain.decision"],
        steps: [
          {
            entityId: "domain.policy",
            title: "Policy",
            type: "domain_entity",
            status: "draft"
          },
          {
            entityId: "domain.decision",
            title: "Decision",
            type: "domain_entity",
            status: "draft"
          }
        ],
        linkTypes: ["relates_to"]
      },
      {
        direction: "upstream",
        entityIds: ["domain.policy", "domain.decision"],
        steps: [
          {
            entityId: "domain.policy",
            title: "Policy",
            type: "domain_entity",
            status: "draft"
          },
          {
            entityId: "domain.decision",
            title: "Decision",
            type: "domain_entity",
            status: "draft"
          }
        ],
        linkTypes: ["depends_on"]
      }
    ],
    downstreamPaths: [
      {
        direction: "downstream",
        entityIds: ["domain.decision", "domain.outcome"],
        steps: [
          {
            entityId: "domain.decision",
            title: "Decision",
            type: "domain_entity",
            status: "draft"
          },
          {
            entityId: "domain.outcome",
            title: "Outcome",
            type: "domain_entity",
            status: "draft"
          }
        ],
        linkTypes: ["depends_on"]
      }
    ],
    sourceEvidence: [
      {
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        sourceFileId: "source-file-1",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 3,
        annotationLine: 2
      },
      {
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        sourceFileId: "source-file-2",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 7,
        annotationLine: 6
      }
    ],
    truncated: {
      isTruncated: false,
      reason: null,
      nodeCount: 2,
      edgeCount: 1,
      sourceEvidenceCount: 2
    }
  };
}
