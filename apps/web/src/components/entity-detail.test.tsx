// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SpecEntityDto } from "@specops/contracts";
import { describe, expect, it, vi } from "vitest";

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
  } satisfies SpecEntityDto
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn()
  }),
  useQueries: () => [
    { data: [], error: null },
    { data: [], error: null }
  ],
  useQuery: (options: { queryKey: readonly string[] }) => {
    if (options.queryKey[0] === "entity") {
      return { data: mocks.entity, error: null, isLoading: false };
    }

    return { data: [], error: null, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn()
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
    search?: Record<string, string | boolean | undefined>;
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
  }
}));

vi.mock("../api/queries.js", () => ({
  backlinksQuery: () => ({ queryKey: ["backlinks"] }),
  entityQuery: () => ({ queryKey: ["entity"] }),
  entitySourceLinksQuery: () => ({ queryKey: ["source-links"] }),
  outgoingLinksQuery: () => ({ queryKey: ["outgoing-links"] }),
  previewAgentTask: vi.fn(),
  queryKeys: {
    backlinks: (projectId: string, entityId: string) => ["backlinks", projectId, entityId],
    entities: (projectId: string) => ["entities", projectId],
    entity: (projectId: string, entityId: string) => ["entity", projectId, entityId],
    indexRuns: (projectId: string) => ["index-runs", projectId],
    outgoingLinks: (projectId: string, entityId: string) => ["outgoing-links", projectId, entityId],
    project: (projectId: string) => ["project", projectId],
    sourceLinks: (projectId: string, entityId: string) => ["source-links", projectId, entityId],
    validation: (projectId: string) => ["validation", projectId]
  },
  saveAgentTask: vi.fn(),
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
  it("links the loaded entity to the impact view", () => {
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
  });
});
