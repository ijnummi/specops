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

const yamlFrontmatterBlockLineDecoration = Decoration.line({
  class: "cm-yaml-frontmatter-block-line"
});

export function buildYamlFrontmatterBlockDecorations(doc: Text): DecorationSet {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
    return Decoration.none;
  }

  const ranges = [yamlFrontmatterBlockLineDecoration.range(doc.line(1).from)];
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    ranges.push(yamlFrontmatterBlockLineDecoration.range(line.from));
    if (line.text.trim() === "---") {
      return Decoration.set(ranges, true);
    }
  }

  return Decoration.none;
}

const yamlFrontmatterBlockField = StateField.define<DecorationSet>({
  create(state) {
    return buildYamlFrontmatterBlockDecorations(state.doc);
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
      return buildYamlFrontmatterBlockDecorations(transaction.state.doc);
    }
    return decorations.map(transaction.changes);
  },
  provide(field) {
    return EditorView.decorations.from(field);
  }
});

const yamlFrontmatterBlockTheme = EditorView.theme({
  ".cm-content": {
    overflowWrap: "anywhere"
  },
  ".cm-yaml-frontmatter-block-line span": {
    fontWeight: "400",
    textDecoration: "none",
    color: "#334155"
  }
});

export const markdownEditorExtensions = [
  markdown(),
  EditorView.lineWrapping,
  yamlFrontmatterBlockField,
  yamlFrontmatterBlockTheme
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
