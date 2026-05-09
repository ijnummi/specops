import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectActions } from "./project-actions.js";

describe("ProjectActions", () => {
  it("renders project action labels", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        isInitializing={false}
        isBootstrapping={false}
        isIndexing={false}
        isProjectActionPending={false}
        onInitialize={() => undefined}
        onBootstrap={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Init specops");
    expect(html).toContain("Bootstrap from source");
    expect(html).toContain("Re-index");
  });

  it("disables bootstrap while pending", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        isInitializing={false}
        isBootstrapping={true}
        isIndexing={false}
        isProjectActionPending={true}
        onInitialize={() => undefined}
        onBootstrap={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Bootstrap from source");
    expect(html).toContain('disabled=""');
  });

  it("disables all project actions while any project action is pending", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        isInitializing={false}
        isBootstrapping={true}
        isIndexing={false}
        isProjectActionPending={true}
        onInitialize={() => undefined}
        onBootstrap={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain("Bootstrap from source");
    expect(html).toContain("animate-spin");
  });
});
