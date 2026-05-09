import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutationStates: [] as Array<{ isPending: boolean; error: Error | null }>,
  navigate: vi.fn(),
  invalidateQueries: vi.fn()
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useMutation: () => {
    const state = mocks.mutationStates.shift() ?? { isPending: false, error: null };

    return {
      ...state,
      mutate: vi.fn()
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

vi.mock("../components/validation-panel.js", () => ({
  ValidationPanel: () => null
}));

import { ProjectDetailPage } from "./project-detail.js";

describe("ProjectDetailPage actions", () => {
  beforeEach(() => {
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
    expect(html).toContain("animate-spin");
  });
});
