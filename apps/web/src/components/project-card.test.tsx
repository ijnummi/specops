import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { confirmProjectMetadataDelete, ProjectCard } from "./project-card.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: React.ReactNode; params: { projectId: string } }) => (
    <a href={`/projects/${params.projectId}`}>{children}</a>
  )
}));

const project = {
  id: "project-1",
  name: "Sample",
  slug: "sample",
  description: "A sample project",
  repoPath: "/repo/sample",
  specopsPath: "/repo/sample/specops",
  createdAt: "2026-05-10T00:00:00.000Z",
  updatedAt: "2026-05-10T00:00:00.000Z"
};

describe("ProjectCard", () => {
  it("renders a metadata-only delete action when deletion is available", () => {
    const html = renderToStaticMarkup(<ProjectCard project={project} onDelete={() => undefined} />);

    expect(html).toContain("Delete project metadata");
    expect(html).toContain("Remove Sample from SpecOps");
  });

  it("confirms that delete leaves files on disk before calling delete", () => {
    const calls: string[] = [];

    const confirmed = confirmProjectMetadataDelete("Sample", (message) => {
      calls.push(message);
      return true;
    });

    expect(confirmed).toBe(true);
    expect(calls).toEqual([
      "Remove Sample from SpecOps? This only deletes workbench metadata; repository files and spec files stay on disk."
    ]);
  });

  it("cancels deletion when confirmation is rejected", () => {
    expect(confirmProjectMetadataDelete("Sample", () => false)).toBe(false);
  });
});
