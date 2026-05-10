import type { ProjectActionsProps } from "../components/project-actions.js";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapFromSource: vi.fn(),
  mutationStates: [] as Array<{ isPending: boolean; error: Error | null }>,
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  debouncedValueOverride: null as string | null,
  overviewQueryOptions: [] as Array<{ enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }>,
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
  } as { data: unknown; error: Error | null; isLoading: boolean }
}));

vi.mock("../api/queries.js", () => ({
  bootstrapFromSource: mocks.bootstrapFromSource,
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
  projectQuery: vi.fn((projectId: string) => ({
    queryKey: ["projects", projectId],
    queryType: "project"
  })),
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
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
  useMutation: (options: { mutationFn: () => unknown; onSuccess?: () => unknown }) => {
    const state = mocks.mutationStates.shift() ?? { isPending: false, error: null };

    return {
      ...state,
      mutate: () => {
        const result = options.mutationFn();
        void options.onSuccess?.();
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
    if (options.queryType === "overview") {
      mocks.overviewQueryOptions.push(options);
      return mocks.overviewState;
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
        <button type="button" disabled={props.isProjectActionPending}>
          Bootstrap from source
        </button>
        <button type="button" disabled={props.isProjectActionPending}>
          Re-index
        </button>
      </>
    );
  }
}));

vi.mock("../components/project-overview-dashboard.js", () => ({
  ProjectOverviewDashboard: ({ projectId }: { projectId: string }) => (
    <div>Project overview dashboard: {projectId}</div>
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
    mocks.bootstrapFromSource.mockReset();
    mocks.searchQuery.mockClear();
    mocks.projectActionsProps = null;
    mocks.invalidateQueries.mockReset();
    mocks.debouncedValueOverride = null;
    mocks.overviewQueryOptions = [];
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
    mocks.mutationStates = [
      { isPending: false, error: null },
      { isPending: false, error: null },
      { isPending: false, error: null }
    ];
  });

  it("renders the bootstrap from source action", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html).toContain("Bootstrap from source");
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

  it("wires the bootstrap action to bootstrap the current project from source", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);

    mocks.projectActionsProps?.onBootstrap();

    expect(mocks.bootstrapFromSource).toHaveBeenCalledWith("project-1");
  });

  it("invalidates project overview after project actions succeed", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);

    mocks.projectActionsProps?.onBootstrap();

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "overview"]
    });
  });

  it("disables all project actions while bootstrap is pending", () => {
    mocks.mutationStates = [
      { isPending: false, error: null },
      { isPending: false, error: null },
      { isPending: true, error: null }
    ];

    const html = renderToStaticMarkup(
      <ProjectDetailPage projectId="project-1" entityId={null} query="" />
    );

    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(mocks.projectActionsProps?.isBootstrapping).toBe(true);
    expect(mocks.projectActionsProps?.isProjectActionPending).toBe(true);
  });
});
