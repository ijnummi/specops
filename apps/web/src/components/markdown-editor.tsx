import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="calc(100vh - 294px)"
      minHeight="420px"
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
