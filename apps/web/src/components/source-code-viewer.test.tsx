import { renderToStaticMarkup } from "react-dom/server";
import type { Extension } from "@codemirror/state";
import { Text } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import {
  buildSourceFocusLineDecorations,
  sourceCodeViewerExtensions,
  SourceCodeViewer,
  sourceFocusScrollEffect
} from "./source-code-viewer.js";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    extensions,
    readOnly,
    editable,
    basicSetup
  }: {
    value: string;
    extensions: Extension[];
    readOnly: boolean;
    editable: boolean;
    basicSetup: { lineNumbers?: boolean };
  }) => (
    <div
      data-value={value}
      data-extension-count={extensions.length}
      data-read-only={String(readOnly)}
      data-editable={String(editable)}
      data-line-numbers={String(basicSetup.lineNumbers)}
    />
  )
}));

describe("SourceCodeViewer", () => {
  it("renders source content through a read-only line-numbered editor", () => {
    const html = renderToStaticMarkup(
      <SourceCodeViewer
        filePath="src/decision.ts"
        value="export interface Decision {}"
        focusLine={12}
      />
    );

    expect(html).toContain('data-value="export interface Decision {}"');
    expect(html).toContain('data-read-only="true"');
    expect(html).toContain('data-editable="false"');
    expect(html).toContain('data-line-numbers="true"');
  });

  it("uses language, focus-line, scroll, and theme extensions for TypeScript source", () => {
    expect(sourceCodeViewerExtensions("src/decision.ts", 12)).toHaveLength(4);
  });

  it("highlights the focus line", () => {
    const decorations = buildSourceFocusLineDecorations(
      Text.of(["const before = true;", "/** @specops domain.decision */", "export interface Decision {}"]),
      2
    );
    const decoratedLines: number[] = [];

    decorations.between(0, 80, (from) => {
      decoratedLines.push(from);
    });

    expect(decoratedLines).toEqual([21]);
  });

  it("scrolls the focus line near the top of the editor", () => {
    const effect = sourceFocusScrollEffect(
      Text.of(["const before = true;", "/** @specops domain.decision */", "export interface Decision {}"]),
      2
    );

    expect(effect?.value).toMatchObject({
      y: "start",
      yMargin: 24
    });
  });
});
