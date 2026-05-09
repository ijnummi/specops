import type { ProjectActionsProps } from "../components/project-actions.js";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapFromSource: vi.fn(),
  mutationStates: [] as Array<{ isPending: boolean; error: Error | null }>,
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  projectActionsProps: null as ProjectActionsProps | null
}));

vi.mock("../api/queries.js", () => ({
  bootstrapFromSource: mocks.bootstrapFromSource,
  entitiesQuery: vi.fn(),
  indexRunsQuery: vi.fn(),
  initializeSpecops: vi.fn(),
  projectQuery: vi.fn(),
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  },
  reindexProject: vi.fn(),
  validationMessagesQuery: vi.fn()
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useMutation: (options: { mutationFn: () => unknown }) => {
    const state = mocks.mutationStates.shift() ?? { isPending: false, error: null };

    return {
      ...state,
      mutate: () => options.mutationFn()
    };
  },
  useQueries: () => [
    { data: [], error: null, isLoading: false },
    { data: [], error: null },
    { data: [], error: null }
  ],
  useQuery: () => ({
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
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../components/entity-create-form.js", () => ({
  EntityCreateForm: () => null
}));

vi.mock("../components/entity-detail.js", () => ({
  EntityDetail: () => null
}));

vi.mock("../components/entity-list.js", () => ({
  EntityList: () => null
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

vi.mock("../components/validation-panel.js", () => ({
  ValidationPanel: () => null
}));

import { ProjectDetailPage } from "./project-detail.js";

describe("ProjectDetailPage actions", () => {
  beforeEach(() => {
    mocks.bootstrapFromSource.mockReset();
    mocks.projectActionsProps = null;
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

  it("wires the bootstrap action to bootstrap the current project from source", () => {
    renderToStaticMarkup(<ProjectDetailPage projectId="project-1" entityId={null} query="" />);

    mocks.projectActionsProps?.onBootstrap();

    expect(mocks.bootstrapFromSource).toHaveBeenCalledWith("project-1");
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
