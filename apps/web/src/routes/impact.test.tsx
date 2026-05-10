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
    search
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
  }) => {
    const suffix = search?.depth ? `?depth=${search.depth}` : "";
    return <a href={`/projects/${params?.projectId}/entities/${params?.entityId}${suffix}`}>{children}</a>;
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
    const { container } = await renderImpactPage();

    expect(container.textContent).toContain("Decision");
    expect(container.textContent).toContain("Depth");
    expect(container.textContent).toContain("Direction");
    expect(container.textContent).toContain("Source evidence");
    expect(container.textContent).toContain("Upstream");
    expect(container.textContent).toContain("Downstream");
    expect(container.textContent).toContain("src/domain.ts");
    expect(container.innerHTML).toContain("/projects/project-1/entities/domain.decision");
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
          depth="1"
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
    upstreamPaths: [],
    downstreamPaths: [],
    sourceEvidence: [
      {
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        sourceFileId: "source-file-1",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 3,
        annotationLine: 2
      }
    ],
    truncated: {
      isTruncated: false,
      reason: null,
      nodeCount: 2,
      edgeCount: 1,
      sourceEvidenceCount: 1
    }
  };
}
