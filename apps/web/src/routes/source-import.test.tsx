import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptProposals: vi.fn(),
  generateSourceImportProposals: vi.fn(),
  invalidateQueries: vi.fn(),
  patchProposal: vi.fn(),
  proposalQueryOptions: [] as Array<{
    enabled?: boolean;
    queryKey: readonly unknown[];
    queryType?: string;
  }>,
  proposalsQuery: vi.fn((projectId: string, input: { status?: string } = {}) => ({
    queryKey: ["projects", projectId, "proposals", input],
    queryType: "proposals"
  })),
  proposalQuery: vi.fn((projectId: string, proposalId: string) => ({
    queryKey: ["projects", projectId, "proposals", proposalId],
    queryType: "proposal"
  }))
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    to: string;
  }) => {
    const href = to.replace("$projectId", params?.projectId ?? "");
    const query = search?.q ? `?q=${encodeURIComponent(search.q)}` : "";

    return <a href={`${href}${query}`}>{children}</a>;
  }
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: () => unknown; onSuccess?: () => unknown }) => ({
    error: null,
    isPending: false,
    mutate: () => {
      const result = options.mutationFn();
      void options.onSuccess?.();
      return result;
    }
  }),
  useQuery: (options: { enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }) => {
    if (options.queryType === "proposals") {
      return {
        data: [
          {
            id: "proposal-1",
            projectId: "project-1",
            proposalType: "source_spec_entity",
            status: "pending",
            title: "DecisionService",
            entityId: "interfaces.decision-service",
            entityType: "interface",
            filePath: "interfaces/decision-service.md",
            confidence: 0.92,
            conflict: { status: "none" },
            createdAt: "2026-05-11T10:00:00.000Z",
            reviewedAt: null
          }
        ],
        error: null,
        isLoading: false
      };
    }

    if (options.queryType === "proposal") {
      mocks.proposalQueryOptions.push(options);

      return {
        data: {
          id: "proposal-1",
          projectId: "project-1",
          proposalType: "source_spec_entity",
          status: "pending",
          title: "DecisionService",
          entityId: "interfaces.decision-service",
          entityType: "interface",
          filePath: "interfaces/decision-service.md",
          confidence: 0.92,
          conflict: { status: "none" },
          createdAt: "2026-05-11T10:00:00.000Z",
          reviewedAt: null,
          payload: {
            entityId: "interfaces.decision-service",
            type: "interface",
            title: "DecisionService",
            status: "draft",
            filePath: "interfaces/decision-service.md",
            generatedMarkdown: "# DecisionService",
            markdown: "# DecisionService\n\nCoordinates policy decisions.",
            sourceFiles: ["apps/api/src/decision-service.ts"],
            symbols: [
              {
                name: "DecisionService",
                kind: "class",
                exported: true,
                file: "apps/api/src/decision-service.ts",
                line: 12
              }
            ]
          },
          evidence: {
            scanner: "typescript",
            sourceFiles: [
              {
                file: "apps/api/src/decision-service.ts",
                symbolName: "DecisionService",
                symbolKind: "class",
                exported: true,
                line: 12
              }
            ]
          }
        },
        error: null,
        isLoading: false
      };
    }

    return { data: undefined, error: null, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../api/queries.js", () => ({
  acceptProposals: mocks.acceptProposals,
  generateSourceImportProposals: mocks.generateSourceImportProposals,
  patchProposal: mocks.patchProposal,
  proposalQuery: mocks.proposalQuery,
  proposalsQuery: mocks.proposalsQuery,
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    proposal: (projectId: string, proposalId: string) => [
      "projects",
      projectId,
      "proposals",
      proposalId
    ],
    proposals: (projectId: string, input: { status?: string } = {}) => [
      "projects",
      projectId,
      "proposals",
      input
    ],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  }
}));

vi.mock("../components/markdown-editor.js", () => ({
  MarkdownEditor: ({ value }: { value: string; onChange: (value: string) => void }) => (
    <textarea readOnly value={value} />
  )
}));

import { SourceImportPage } from "./source-import.js";

describe("SourceImportPage", () => {
  beforeEach(() => {
    mocks.acceptProposals.mockReset();
    mocks.generateSourceImportProposals.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.patchProposal.mockReset();
    mocks.proposalQuery.mockClear();
    mocks.proposalQueryOptions = [];
    mocks.proposalsQuery.mockClear();
  });

  it("renders pending proposal review content from cached data", () => {
    const html = renderToStaticMarkup(<SourceImportPage projectId="project-1" />);

    expect(html).toContain("Import from source");
    expect(html).toContain("DecisionService");
    expect(html).toContain("interfaces/decision-service.md");
    expect(html).toContain("Generate proposals");
    expect(html).toContain("Accept selected");
  });

  it("loads pending proposals and enables the first proposal detail query from cached proposals", () => {
    renderToStaticMarkup(<SourceImportPage projectId="project-1" />);

    expect(mocks.proposalsQuery).toHaveBeenCalledWith("project-1", { status: "pending" });
    expect(mocks.proposalQuery).toHaveBeenCalledWith("project-1", "proposal-1");
    expect(mocks.proposalQueryOptions).toContainEqual(
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "proposals", "proposal-1"]
      })
    );
  });
});
