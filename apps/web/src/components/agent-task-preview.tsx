import type { AgentTaskPreviewResponse } from "@specops/contracts";
import { Copy, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { taskPreviewHasChanges } from "./agent-task-preview-state.js";
import { MarkdownEditor } from "./markdown-editor.js";

type AgentTaskPreviewProps = {
  preview: AgentTaskPreviewResponse;
  originalMarkdown: string;
  isSaving: boolean;
  saveError: string | null;
  onMarkdownChange: (markdown: string) => void;
  onSave: () => void;
  onClose: () => void;
};

export function AgentTaskPreview({
  preview,
  originalMarkdown,
  isSaving,
  saveError,
  onMarkdownChange,
  onSave,
  onClose
}: AgentTaskPreviewProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const hasChanges = useMemo(
    () => taskPreviewHasChanges(originalMarkdown, preview.markdown),
    [originalMarkdown, preview.markdown]
  );

  useEffect(() => {
    setCopyStatus("idle");
  }, [preview.markdown, preview.taskId]);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(preview.markdown);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="overflow-hidden rounded border border-slate-200 bg-white">
      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">Agent Task Preview</h3>
          <p className="truncate text-xs text-slate-500">
            {preview.taskId} / {preview.filePath}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="button-secondary" onClick={copyMarkdown}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy
          </button>
          <button type="button" className="button-primary" disabled={isSaving} onClick={onSave}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save Task
          </button>
          <button type="button" className="button-secondary" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            Close
          </button>
        </div>
      </div>

      {preview.warnings.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <ul className="grid gap-1">
            {preview.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.entityId ?? "project"}`}>
                <span className="font-medium">{warning.code}</span>: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <MarkdownEditor
        value={preview.markdown}
        onChange={(value) => {
          setCopyStatus("idle");
          onMarkdownChange(value);
        }}
      />

      <div
        className="flex items-center gap-3 border-t border-slate-200 p-3 text-xs text-slate-500"
        role="status"
        aria-live="polite"
      >
        <span>{hasChanges ? "Edited preview" : "Generated preview"}</span>
        {copyStatus === "copied" ? <span>Copied</span> : null}
        {copyStatus === "failed" ? <span className="text-red-700">Copy failed</span> : null}
        {saveError ? <span className="text-red-700">{saveError}</span> : null}
      </div>
    </section>
  );
}
