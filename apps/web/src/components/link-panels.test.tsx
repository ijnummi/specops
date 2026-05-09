import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LinkPanels } from "./link-panels.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params
  }: {
    children: React.ReactNode;
    params: { projectId: string; entityId: string };
  }) => <a href={`/projects/${params.projectId}/entities/${params.entityId}`}>{children}</a>
}));

describe("LinkPanels", () => {
  it("links outgoing and backlink entity ids to their entity routes", () => {
    const html = renderToStaticMarkup(
      <LinkPanels
        projectId="demo"
        outgoing={[
          link({
            id: "outgoing-link",
            fromEntityId: "uc.create-workspace",
            toEntityId: "domain.workspace"
          })
        ]}
        backlinks={[
          link({
            id: "backlink",
            fromEntityId: "adr.markdown",
            toEntityId: "uc.create-workspace"
          })
        ]}
      />
    );

    expect(html).toContain('href="/projects/demo/entities/domain.workspace"');
    expect(html).toContain('href="/projects/demo/entities/adr.markdown"');
  });
});

function link(input: { id: string; fromEntityId: string; toEntityId: string }) {
  return {
    ...input,
    projectId: "demo",
    linkType: "uses",
    source: "frontmatter",
    confidence: 1,
    createdAt: "2026-05-09T12:00:00.000Z"
  };
}
