import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

type MarkdownEditorProps = {
  value: string;
  height?: string;
  minHeight?: string;
  className?: string;
  onChange: (value: string) => void;
};

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
      extensions={[markdown()]}
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
