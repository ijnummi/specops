import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to
  }: {
    children: ReactNode;
    className?: string;
    params?: { projectId?: string };
    to: string;
  }) => {
    const href = params?.projectId ? to.replace("$projectId", params.projectId) : to;

    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
}));

import { ProjectActions } from "./project-actions.js";

describe("ProjectActions", () => {
  it("renders project action labels", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        projectId="project-1"
        isInitializing={false}
        isIndexing={false}
        isProjectActionPending={false}
        onInitialize={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Init specops");
    expect(html).toContain("Import from source");
    expect(html).toContain('href="/projects/project-1/import/source"');
    expect(html).not.toContain("Bootstrap from source");
    expect(html).toContain("Re-index");
  });

  it("shows an active spinner while re-indexing", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        projectId="project-1"
        isInitializing={false}
        isIndexing={true}
        isProjectActionPending={true}
        onInitialize={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Re-index");
    expect(html).toContain("animate-spin");
  });

  it("shows an active spinner while initializing", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        projectId="project-1"
        isInitializing={true}
        isIndexing={false}
        isProjectActionPending={true}
        onInitialize={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Init specops");
    expect(html).toContain("animate-spin");
  });

  it("disables project action buttons while any project action is pending", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        projectId="project-1"
        isInitializing={false}
        isIndexing={true}
        isProjectActionPending={true}
        onInitialize={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("Import from source");
    expect(html).toContain("animate-spin");
  });
});
