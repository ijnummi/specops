import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";

type MarkdownEditorProps = {
  value: string;
  height?: string;
  minHeight?: string;
  className?: string;
  onChange: (value: string) => void;
};

export const markdownEditorExtensions = [
  markdown(),
  EditorView.lineWrapping,
  EditorView.theme({
    ".cm-content": {
      overflowWrap: "anywhere"
    },
    ".cm-line span": {
      fontWeight: "400",
      textDecoration: "none"
    },
    ".cmt-heading, .cmt-strong, .cmt-meta, .cmt-keyword": {
      fontWeight: "400"
    },
    ".cmt-link, .cmt-url, .cmt-meta": {
      textDecoration: "none"
    },
    ".cmt-meta": {
      color: "#475569"
    }
  })
];

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
