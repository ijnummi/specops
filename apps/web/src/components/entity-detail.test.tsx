// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EntityReadinessDto, SpecEntityDto } from "@specops/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entity: {
    id: "entity-1",
    projectId: "project-1",
    entityId: "domain.decision",
    type: "domain_entity",
    title: "Decision",
    status: "draft",
    filePath: "spec/domain/decision.md",
    frontmatter: {
      id: "domain.decision",
      type: "domain_entity",
      title: "Decision",
      status: "draft"
    },
    bodyMarkdown: "Decision body",
    bodyText: "Decision body",
    contentHash: "hash-1",
    createdAt: "2026-05-09T12:00:00.000Z",
    updatedAt: "2026-05-09T12:00:00.000Z"
  } satisfies SpecEntityDto,
  readiness: {
    entityId: "domain.decision",
    title: "Decision",
    type: "domain_entity",
    status: "draft",
    filePath: "spec/domain/decision.md",
    readiness: "ready",
    checks: []
  } satisfies EntityReadinessDto,
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  mutationOptions: [] as Array<{
    onSuccess?: (data: unknown, variables: unknown) => unknown;
  }>
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { onSuccess?: (data: unknown, variables: unknown) => unknown }) => {
    mocks.mutationOptions.push(options);

    return {
      error: null,
      isPending: false,
      mutate: vi.fn()
    };
  },
  useQueries: () => [
    { data: [], error: null },
    { data: [], error: null }
  ],
  useQuery: (options: { queryKey: readonly string[] }) => {
    if (options.queryKey[0] === "entity") {
      return { data: mocks.entity, error: null, isLoading: false };
    }
    if (options.queryKey[0] === "entity-readiness") {
      return { data: mocks.readiness, error: null, isLoading: false };
    }

    return { data: [], error: null, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to
  }: {
    children: ReactNode;
    params: { projectId: string; entityId: string };
    search?: Record<string, boolean | number | string | undefined>;
    to: string;
  }) => {
    const href = to
      .replace("$projectId", params.projectId)
      .replace("$entityId", params.entityId);
    const query = search
      ? `?${new URLSearchParams(
          Object.entries(search).map(([key, value]) => [key, String(value)])
        ).toString()}`
      : "";

    return <a href={`${href}${query}`}>{children}</a>;
  },
  useNavigate: () => mocks.navigate
}));

vi.mock("../api/queries.js", () => ({
  backlinksQuery: () => ({ queryKey: ["backlinks"] }),
  entityReadinessQuery: () => ({ queryKey: ["entity-readiness"] }),
  entityQuery: () => ({ queryKey: ["entity"] }),
  entitySourceLinksQuery: () => ({ queryKey: ["source-links"] }),
  outgoingLinksQuery: () => ({ queryKey: ["outgoing-links"] }),
  previewAgentTask: vi.fn(),
  queryKeys: {
    agentRunsRoot: (projectId: string) => ["agent-runs", projectId],
    backlinks: (projectId: string, entityId: string) => ["backlinks", projectId, entityId],
    entities: (projectId: string) => ["entities", projectId],
    entity: (projectId: string, entityId: string) => ["entity", projectId, entityId],
    entityReadiness: (projectId: string, entityId: string) => [
      "entity-readiness",
      projectId,
      entityId
    ],
    indexRuns: (projectId: string) => ["index-runs", projectId],
    annotationsRoot: (projectId: string) => ["annotations", projectId],
    outgoingLinks: (projectId: string, entityId: string) => ["outgoing-links", projectId, entityId],
    project: (projectId: string) => ["project", projectId],
    projectHealth: (projectId: string) => ["project-health", projectId],
    projectOverview: (projectId: string) => ["project-overview", projectId],
    projectReadiness: (projectId: string) => ["project-readiness", projectId],
    sourceLinks: (projectId: string, entityId: string) => ["source-links", projectId, entityId],
    validation: (projectId: string) => ["validation", projectId]
  },
  saveAgentTask: vi.fn(),
  startAgentRun: vi.fn(),
  updateEntityMarkdown: vi.fn(),
  validationMessagesQuery: () => ({ queryKey: ["validation"] })
}));

vi.mock("./agent-task-preview.js", () => ({
  AgentTaskPreview: () => null
}));

vi.mock("./link-panels.js", () => ({
  LinkPanels: () => null
}));

vi.mock("./markdown-editor.js", () => ({
  MarkdownEditor: () => null
}));

vi.mock("./source-link-tabs.js", () => ({
  SourceLinkTabs: ({ specPanel }: { specPanel: ReactNode }) => <div>{specPanel}</div>
}));

import { EntityDetail } from "./entity-detail.js";

describe("EntityDetail", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.navigate.mockReset();
    mocks.mutationOptions = [];
    mocks.entity = {
      ...mocks.entity,
      entityId: "domain.decision",
      type: "domain_entity",
      title: "Decision",
      filePath: "spec/domain/decision.md",
      frontmatter: {
        id: "domain.decision",
        type: "domain_entity",
        title: "Decision",
        status: "draft"
      }
    };
  });

  it("links the loaded entity to the impact views", () => {
    const html = renderToStaticMarkup(
      <EntityDetail
        projectId="project-1"
        entityId="domain.decision"
        draft={null}
        onDraftChange={vi.fn()}
        onFetchedMarkdown={vi.fn()}
        onSaveDraft={vi.fn()}
      />
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.innerHTML).toContain("/projects/project-1/impact/domain.decision");
    expect(container.textContent).toContain("Impact");
    expect(linkHref(container, "Preview Change Impact")).toBe(
      "/projects/project-1/change-impact/domain.decision?depth=1&direction=both&includeSource=true"
    );
  });

  it("invalidates the project overview after saving entity markdown", async () => {
    renderEntityDetail();

    await mocks.mutationOptions[0]?.onSuccess?.(
      { ...mocks.entity, contentHash: "hash-2" },
      "# Decision\n\nUpdated body"
    );

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-overview", "project-1"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-health", "project-1"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["entity-readiness", "project-1", "domain.decision"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-readiness", "project-1"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["annotations", "project-1"]
    });
  });

  it("invalidates the project overview after saving a generated task", async () => {
    renderEntityDetail();

    await mocks.mutationOptions[2]?.onSuccess?.(savedTaskResponse(), {
      projectId: "project-1",
      sourceEntityId: "domain.decision",
      preview: {
        contextSpecIds: ["domain.outcome"],
        filePath: "tasks/domain-decision.md",
        markdown: "# Task",
        sourceSpecIds: ["domain.decision"],
        taskId: "task.domain-decision",
        title: "Task",
        warnings: []
      }
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-overview", "project-1"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-health", "project-1"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["entity-readiness", "project-1", "domain.decision"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-readiness", "project-1"]
    });
  });

  it("renders a start agent run action for loaded agent task entities", () => {
    mocks.entity = {
      ...mocks.entity,
      id: "entity-task-1",
      entityId: "task.domain-decision",
      type: "agent_task",
      title: "Task",
      filePath: "tasks/domain-decision.md",
      frontmatter: {
        id: "task.domain-decision",
        type: "agent_task",
        title: "Task",
        status: "draft"
      }
    };

    const html = renderEntityDetail();

    expect(html).toContain("Start Agent Run");
  });

  it("does not render a start agent run action for loaded non-agent task entities", () => {
    mocks.entity = { ...mocks.entity, type: "domain_entity" };

    const html = renderEntityDetail();

    expect(html).not.toContain("Start Agent Run");
  });
});

function renderEntityDetail() {
  return renderToStaticMarkup(
    <EntityDetail
      projectId="project-1"
      entityId="domain.decision"
      draft={null}
      onDraftChange={vi.fn()}
      onFetchedMarkdown={vi.fn()}
      onSaveDraft={vi.fn()}
    />
  );
}

function linkHref(container: HTMLElement, label: string) {
  const link = Array.from(container.querySelectorAll("a")).find((element) =>
    element.textContent?.includes(label)
  );

  return link?.getAttribute("href");
}

function savedTaskResponse(): SpecEntityDto {
  return {
    ...mocks.entity,
    id: "entity-task-1",
    entityId: "task.domain-decision",
    type: "agent_task",
    title: "Task",
    filePath: "tasks/domain-decision.md"
  };
}
