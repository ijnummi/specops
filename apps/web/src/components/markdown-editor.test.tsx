import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./markdown-editor.js";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ height, minHeight }: { height: string; minHeight: string }) => (
    <div data-height={height} data-min-height={minHeight} />
  )
}));

describe("MarkdownEditor", () => {
  it("uses the default editor sizing when no override is provided", () => {
    const html = renderToStaticMarkup(<MarkdownEditor value="" onChange={() => undefined} />);

    expect(html).toContain('data-height="calc(100vh - 294px)"');
    expect(html).toContain('data-min-height="420px"');
  });

  it("allows entity detail to request compact viewport sizing", () => {
    const html = renderToStaticMarkup(
      <MarkdownEditor
        value=""
        height="calc(100vh - 460px)"
        minHeight="280px"
        onChange={() => undefined}
      />
    );

    expect(html).toContain('data-height="calc(100vh - 460px)"');
    expect(html).toContain('data-min-height="280px"');
  });
});
