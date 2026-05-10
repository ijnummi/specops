import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { StateField, Text, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

type SourceCodeViewerProps = {
  filePath: string;
  value: string;
  focusLine: number | null;
};

const sourceFocusLineDecoration = Decoration.line({
  class: "cm-source-focused-line"
});

const sourceCodeViewerTheme = EditorView.theme({
  "&": {
    height: "100%"
  },
  ".cm-scroller": {
    overflow: "auto"
  },
  ".cm-source-focused-line": {
    backgroundColor: "#fef3c7"
  }
});

const sourceCodeViewerContentAttributes = EditorView.contentAttributes.of({
  "aria-label": "Source code"
});

export function SourceCodeViewer({ filePath, value, focusLine }: SourceCodeViewerProps) {
  return (
    <CodeMirror
      key={`${filePath}:${focusLine ?? ""}`}
      value={value}
      height="100%"
      minHeight="100%"
      className="h-full"
      extensions={sourceCodeViewerExtensions(filePath, focusLine)}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: false
      }}
      editable={false}
      readOnly={true}
      theme="light"
      onCreateEditor={(view) => {
        const effect = sourceFocusScrollEffect(view.state.doc, focusLine);
        if (effect) view.dispatch({ effects: effect });
      }}
    />
  );
}

export function sourceCodeViewerExtensions(filePath: string, focusLine: number | null): Extension[] {
  return [
    ...sourceLanguageExtensions(filePath),
    sourceFocusLineField(focusLine),
    sourceCodeViewerTheme,
    sourceCodeViewerContentAttributes
  ];
}

export function buildSourceFocusLineDecorations(
  doc: Text,
  focusLine: number | null
): DecorationSet {
  if (!focusLine || focusLine < 1 || focusLine > doc.lines) {
    return Decoration.none;
  }

  return Decoration.set([sourceFocusLineDecoration.range(doc.line(focusLine).from)], true);
}

export function sourceFocusScrollEffect(
  doc: Text,
  focusLine: number | null
): ReturnType<typeof EditorView.scrollIntoView> | null {
  if (!focusLine || focusLine < 1 || focusLine > doc.lines) {
    return null;
  }

  return EditorView.scrollIntoView(doc.line(focusLine).from, {
    y: "start",
    yMargin: 24
  });
}

function sourceLanguageExtensions(filePath: string): Extension[] {
  if (/\.[cm]?tsx$/i.test(filePath)) {
    return [javascript({ typescript: true, jsx: true })];
  }

  if (/\.[cm]?ts$/i.test(filePath)) {
    return [javascript({ typescript: true })];
  }

  if (/\.jsx$/i.test(filePath)) {
    return [javascript({ jsx: true })];
  }

  if (/\.[cm]?js$/i.test(filePath)) {
    return [javascript()];
  }

  return [];
}

function sourceFocusLineField(focusLine: number | null): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildSourceFocusLineDecorations(state.doc, focusLine);
    },
    update(decorations, transaction) {
      if (transaction.docChanged) {
        return buildSourceFocusLineDecorations(transaction.state.doc, focusLine);
      }

      return decorations.map(transaction.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    }
  });
}
