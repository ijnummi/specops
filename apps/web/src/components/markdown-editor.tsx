import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { StateField, Text, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

type MarkdownEditorProps = {
  value: string;
  height?: string;
  minHeight?: string;
  className?: string;
  onChange: (value: string) => void;
};

const frontmatterLineDecoration = Decoration.line({ class: "cm-frontmatter-line" });

export function buildFrontmatterLineDecorations(doc: Text): DecorationSet {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
    return Decoration.none;
  }

  const ranges = [frontmatterLineDecoration.range(doc.line(1).from)];
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    ranges.push(frontmatterLineDecoration.range(line.from));
    if (line.text.trim() === "---") {
      return Decoration.set(ranges, true);
    }
  }

  return Decoration.none;
}

const frontmatterLineField = StateField.define<DecorationSet>({
  create(state) {
    return buildFrontmatterLineDecorations(state.doc);
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
      return buildFrontmatterLineDecorations(transaction.state.doc);
    }
    return decorations.map(transaction.changes);
  },
  provide(field) {
    return EditorView.decorations.from(field);
  }
});

const frontmatterTheme = EditorView.theme({
  ".cm-content": {
    overflowWrap: "anywhere"
  },
  ".cm-frontmatter-line span": {
    fontWeight: "400",
    textDecoration: "none",
    color: "#334155"
  }
});

export const markdownEditorExtensions = [
  markdown(),
  EditorView.lineWrapping,
  frontmatterLineField,
  frontmatterTheme
] satisfies Extension[];

export function MarkdownEditor({
  value,
  height = "calc(100vh - 294px)",
  minHeight = "420px",
  className,
  onChange
}: MarkdownEditorProps) {
  return (
    <CodeMirror
      value={value}
      height={height}
      minHeight={minHeight}
      className={className}
      extensions={markdownEditorExtensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true
      }}
      onChange={onChange}
      theme="light"
    />
  );
}
