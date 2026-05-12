import type { ProjectActionsProps } from "../components/project-actions.js";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutationStates: [] as Array<{ isPending: boolean; error: Error | null }>,
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  debouncedValueOverride: null as string | null,
  healthQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
  overviewQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
  readinessQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
  projectHealthQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "health"],
    queryType: "health"
  })),
  projectReadinessQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "readiness"],
    queryType: "readiness"
  })),
  startAnalyzeRun: vi.fn(() => ({ id: "run-1" })),
  searchQuery: vi.fn((projectId: string, input: { q: string; limit: number }) => ({
    queryKey: ["projects", projectId, "search", input],
    queryType: "search"
  })),
  searchQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
  searchState: {
    data: [
      {
        entityId: "entity-2",
        title: "Customer Portal",
        type: "feature",
        status: "draft",
        snippet: "Customer-facing workflow"
      }
    ],
    error: null,
    isLoading: false
  } as { data: unknown[]; error: Error | null; isLoading: boolean },
  projectActionsProps: null as ProjectActionsProps | null,
  overviewState: {
    data: { project: { id: "project-1", name: "SpecOps" } },
    error: null,
    isLoading: false
  } as { data: unknown; error: Error | null; isLoading: boolean },
  healthState: {
    data: { git: { isRepo: true } },
    error: null,
    isLoading: false
  } as { data: unknown; error: Error | null; isLoading: boolean },
  readinessState: {
    data: { summary: { ready: 1, blocked: 0, needsReview: 0, needsContext: 0 }, queue: [] },
    error: null,
    isLoading: false
  } as { data: unknown; error: Error | null; isLoading: boolean }
}));

vi.mock("../api/queries.js", () => ({
  entitiesQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "entities"],
    queryType: "entities"
  })),
  indexRunsQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "index-runs"],
    queryType: "indexRuns"
  })),
  initializeSpecops: vi.fn(),
  projectOverviewQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "overview"],
    queryType: "overview"
  })),
  projectHealthQuery: mocks.projectHealthQuery,
  projectReadinessQuery: mocks.projectReadinessQuery,
  projectQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId],
    queryType: "project"
  })),
  startAnalyzeRun: mocks.startAnalyzeRun,
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    projectReadiness: (projectId: string) => ["projects", projectId, "readiness"],
    search: (projectId: string, input: { q: string; limit: number }) => [
      "projects",
      projectId,
      "search",
      input
    ],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  },
  reindexProject: vi.fn(),
  searchQuery: mocks.searchQuery,
  validationMessagesQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId, "validation-messages"],
    queryType: "validation"
  }))
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useMutation: (options: { mutationFn: () => unknown; onSuccess?: (data: unknown) => unknown }) => {
    const state = mocks.mutationStates.shift() ?? { isPending: false, error: null };

    return {
      ...state,
      mutate: () => {
        const result = options.mutationFn();
        void options.onSuccess?.(result);
        return result;
      }
    };
  },
  useQueries: () => [
    {
      data: [
        {
          entityId: "entity-1",
          title: "Entity One",
          type: "feature",
          status: "draft",
          bodyText: "Body",
          filePath: "specops/entity-one.md"
        }
      ],
      error: null,
      isLoading: false
    },
    { data: [], error: null },
    { data: [], error: null }
  ],
  useQuery: (options: { enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }) => {
    if (options.queryType === "health") {
      mocks.healthQueryOptions.push(options);
      return mocks.healthState;
    }

    if (options.queryType === "overview") {
      mocks.overviewQueryOptions.push(options);
      return mocks.overviewState;
    }

    if (options.queryType === "readiness") {
      mocks.readinessQueryOptions.push(options);
      return mocks.readinessState;
    }

    if (options.queryType === "search") {
      mocks.searchQueryOptions.push(options);
      return mocks.searchState;
    }

    return {
      data: {
        entityCount: 0,
        linkCount: 0,
        name: "SpecOps",
        repoPath: "/repo",
        specopsPath: "specops",
        validationErrorCount: 0,
        validationWarningCount: 0
      },
      error: null
    };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../components/entity-create-form.js", () => ({
  EntityCreateForm: () => null
}));

vi.mock("../components/entity-detail.js", () => ({
  EntityDetail: ({ entityId }: { entityId: string }) => <div>Entity editor: {entityId}</div>
}));

vi.mock("../components/entity-list.js", () => ({
  EntityList: () => <div>Entity list</div>
}));

vi.mock("../components/entity-search-results.js", () => ({
  EntitySearchResults: ({
    query,
    variant
  }: {
    query: string;
    variant: "compact" | "expanded";
  }) => <div>{variant} search results: {query}</div>
}));

vi.mock("../components/project-actions.js", () => ({
  ProjectActions: (props: ProjectActionsProps) => {
    mocks.projectActionsProps = props;

    return (
      <>
        <button type="button" disabled={props.isProjectActionPending}>
          Init specops
        </button>
        <button type="button" disabled={props.isProjectActionPending} onClick={props.onAnalyze}>
          Analyze project
        </button>
        <a href={`/projects/${props.projectId}/import/source`}>Import from source</a>
        <button type="button" disabled={props.isProjectActionPending}>
          Re-index
        </button>
      </>
    );
  }
}));

vi.mock("../components/project-overview-dashboard.js", () => ({
  ProjectOverviewDashboard: ({
    projectId,
    healthError,
    readinessError
  }: {
    projectId: string;
    healthError?: Error | null;
    readinessError?: Error | null;
  }) => (
    <div>
      Project overview dashboard: {projectId}
      {healthError ? <span>{healthError.message}</span> : null}
      {readinessError ? <span>{readinessError.message}</span> : null}
    </div>
  )
}));

vi.mock("../components/validation-panel.js", () => ({
  ValidationPanel: () => null
}));

vi.mock("../lib/use-debounced-value.js", () => ({
  useDebouncedValue: (value: string) => mocks.debouncedValueOverride ?? value
}));

import { ProjectDetailPage } from "./project-detail.js";

describe("ProjectDetailPage actions", () => {
  beforeEach(() => {
    mocks.projectHealthQuery.mockClear();
    mocks.projectReadinessQuery.mockClear();
    mocks.startAnalyzeRun.mockClear();
    mocks.searchQuery.mockClear();
    mocks.navigate.mockReset();
    mocks.projectActionsProps = null;
    mocks.invalidateQueries.mockReset();
    mocks.debouncedValueOverride = null;
    mocks.healthQueryOptions = [];
    mocks.overviewQueryOptions = [];
    mocks.readinessQueryOptions = [];
    mocks.searchQueryOptions = [];
    mocks.searchState = {
      data: [
        {
          entityId: "entity-2",
          title: "Customer Portal",
          type: "feature",
          status: "draft",
          snippet: "Customer-facing workflow"
        }
      ],
      error: null,
      isLoading: false
    };
    mocks.overviewState = {
      data: { project: { id: "project-1", name: "SpecOps" } },
      error: null,
      isLoading: false
    };
    mocks.healthState = {
      data: { git: { isRepo: true } },
      error: null,
      isLoading: false
    };
    mocks.readinessState = {
      data: { summary: { ready: 1, blocked: 0, needsReview: 0, needsContext: 0 }, queue: [] },
      error: null,
      isLoading: false
    };
    mocks.mutationStates = [
      { isPending: false, error: null },
      { isPending: false, error: null },
      { isPending: false, error: null }
    ];
  });

  it("renders the import from source action", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Import from source");
    expect(html).toContain('/projects/project-1/import/source');
    expect(mocks.projectActionsProps?.projectId).toBe("project-1");
  });

  it("renders the project overview dashboard when no entity is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Project overview dashboard: project-1");
    expect(html).not.toContain("Entity editor:");
  });

  it("renders the entity editor and not the overview dashboard when an entity is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId="entity-1" query="" />
    );

    expect(html).toContain("Entity editor: entity-1");
    expect(html).not.toContain("Project overview dashboard:");
  });

  it("renders expanded search results instead of the overview for an active query with no selected entity", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="customer" />
    );

    expect(html).toContain("expanded search results: customer");
    expect(html).not.toContain("Project overview dashboard:");
  });

  it("keeps the entity editor visible for an active query with a selected entity", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId="entity-1" query="customer" />
    );

    expect(html).toContain("Entity editor: entity-1");
    expect(html).not.toContain("expanded search results:");
  });

  it("enables server search only for non-empty queries with the project search query key", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);
    renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query=" customer " />
    );

    expect(mocks.searchQueryOptions).toEqual([
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "search", { q: "", limit: 25 }]
      }),
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "search", { q: "customer", limit: 25 }]
      })
    ]);
  });

  it("keeps server search disabled while an active query is waiting for debounce", () => {
    mocks.debouncedValueOverride = "";

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="customer" />
    );

    expect(html).toContain("Searching");
    expect(html).not.toContain("expanded search results:");
    expect(mocks.searchQueryOptions).toEqual([
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "search", { q: "", limit: 25 }]
      })
    ]);
  });

  it("shows searching instead of stale results while a changed query is waiting for debounce", () => {
    mocks.debouncedValueOverride = "customer";

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="portal" />
    );

    expect(html).toContain("Searching");
    expect(html).not.toContain("expanded search results: customer");
    expect(mocks.searchQueryOptions).toEqual([
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "search", { q: "customer", limit: 25 }]
      })
    ]);
  });

  it("shows searching instead of a stale error while a changed query is waiting for debounce", () => {
    mocks.debouncedValueOverride = "customer";
    mocks.searchState = {
      data: [],
      error: new Error("Stale customer search failed"),
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="portal" />
    );

    expect(html).toContain("Searching");
    expect(html).not.toContain("Stale customer search failed");
    expect(mocks.searchQueryOptions).toEqual([
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "search", { q: "customer", limit: 25 }]
      })
    ]);
  });

  it("keeps empty query behavior when a cleared query has a stale debounced value", () => {
    mocks.debouncedValueOverride = "customer";

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Entity list");
    expect(html).toContain("Project overview dashboard: project-1");
    expect(html).not.toContain("Searching");
    expect(html).not.toContain("expanded search results:");
    expect(mocks.searchQueryOptions).toEqual([
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "search", { q: "customer", limit: 25 }]
      })
    ]);
  });

  it("disables the project overview query when an entity is selected", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId="entity-1" query="" />);

    expect(mocks.overviewQueryOptions).toContainEqual(
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "overview"]
      })
    );
  });

  it("enables project health only for the overview route", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId="entity-1" query="" />);
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="customer" />);

    expect(mocks.healthQueryOptions).toEqual([
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "health"]
      }),
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "health"]
      }),
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "health"]
      })
    ]);
  });

  it("enables project readiness only for the overview route", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId="entity-1" query="" />);
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="customer" />);

    expect(mocks.readinessQueryOptions).toEqual([
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "readiness"]
      }),
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "readiness"]
      }),
      expect.objectContaining({
        enabled: false,
        queryKey: ["projects", "project-1", "readiness"]
      })
    ]);
  });

  it("passes project health errors to the overview dashboard", () => {
    mocks.healthState = {
      data: undefined,
      error: new Error("Git health failed"),
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Project overview dashboard: project-1");
    expect(html).toContain("Git health failed");
  });

  it("passes project readiness errors to the overview dashboard", () => {
    mocks.readinessState = {
      data: undefined,
      error: new Error("Readiness failed"),
      isLoading: false
    };

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Project overview dashboard: project-1");
    expect(html).toContain("Readiness failed");
  });

  it("invalidates project overview after project actions succeed", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);

    mocks.projectActionsProps?.onReindex();

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "overview"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "health"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "readiness"]
    });
  });

  it("navigates to the created analyze run after starting analysis", () => {
    mocks.startAnalyzeRun.mockReturnValueOnce({ id: "run-42" });
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);

    mocks.projectActionsProps?.onAnalyze();

    expect(mocks.startAnalyzeRun).toHaveBeenCalledWith("project-1");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/analyze-runs/$runId",
      params: { projectId: "project-1", runId: "run-42" }
    });
  });

  it("renders analyze errors with project action errors", () => {
    mocks.mutationStates = [
      { isPending: false, error: null },
      { isPending: false, error: null },
      { isPending: false, error: new Error("Analyze failed") }
    ];

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Analyze failed");
  });

  it("disables project action buttons while re-index is pending", () => {
    mocks.mutationStates = [
      { isPending: false, error: null },
      { isPending: true, error: null },
      { isPending: false, error: null }
    ];

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(mocks.projectActionsProps?.isIndexing).toBe(true);
    expect(mocks.projectActionsProps?.isProjectActionPending).toBe(true);
  });
});
