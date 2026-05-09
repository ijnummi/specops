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
        onInitialize={() => undefined}
        onBootstrap={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Bootstrap from source");
    expect(html).toContain('disabled=""');
  });
});
