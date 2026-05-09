import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor, markdownEditorExtensions } from "./markdown-editor.js";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    height,
    minHeight,
    extensions
  }: {
    height: string;
    minHeight: string;
    extensions: unknown[];
  }) => (
    <div
      data-height={height}
      data-min-height={minHeight}
      data-extension-count={extensions.length}
    />
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

  it("enables line wrapping and calmer markdown token styling", () => {
    const html = renderToStaticMarkup(<MarkdownEditor value="" onChange={() => undefined} />);

    expect(markdownEditorExtensions).toHaveLength(3);
    expect(html).toContain('data-extension-count="3"');
  });
});
