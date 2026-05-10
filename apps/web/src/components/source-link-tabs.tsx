import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SourceSpecLinkDto } from "@specops/contracts";

import { SourceCodeViewer } from "./source-code-viewer.js";

const DEFAULT_EXCERPT_MESSAGE = "Source excerpt unavailable.";

type SourceLinkTabsProps = {
  specTitle: string;
  sourceLinks: SourceSpecLinkDto[];
  sourceLinksError?: string | null;
  specPanel: ReactNode;
};

type ActiveTab = { type: "spec" } | { type: "source"; id: string };

export function SourceLinkTabs({
  specTitle,
  sourceLinks,
  sourceLinksError,
  specPanel
}: SourceLinkTabsProps) {
  const visibleSourceLinks = useMemo(() => sourceLinks, [sourceLinks]);
  const [activeTab, setActiveTab] = useState<ActiveTab>({ type: "spec" });
  const activeSourceLink =
    activeTab.type === "source"
      ? visibleSourceLinks.find((sourceLink) => sourceLink.id === activeTab.id)
      : undefined;
  const isSpecSelected = activeTab.type === "spec" || !activeSourceLink;

  useEffect(() => {
    setActiveTab({ type: "spec" });
  }, [specTitle]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-2"
        aria-label="Entity source panels"
      >
        <button
          type="button"
          aria-pressed={isSpecSelected}
          className={panelButtonClassName(isSpecSelected)}
          onClick={() => setActiveTab({ type: "spec" })}
        >
          Spec: {specTitle}
        </button>
        {visibleSourceLinks.map((sourceLink, index) => {
          const isSelected = activeSourceLink?.id === sourceLink.id;

          return (
            <button
              key={sourceLink.id}
              type="button"
              aria-label={`${sourceLink.filePath} ${sourceLink.symbolName}`}
              aria-pressed={isSelected}
              className={panelButtonClassName(isSelected)}
              onClick={() => setActiveTab({ type: "source", id: sourceLink.id })}
            >
              {sourceButtonLabel(sourceLink)}
            </button>
          );
        })}
        {sourceLinksError ? (
          <span className="shrink-0 px-2 pb-2 text-xs font-medium text-red-700">
            {sourceLinksError}
          </span>
        ) : null}
      </div>

      {isSpecSelected ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {specPanel}
        </div>
      ) : (
        <SourceLinkPanel sourceLink={activeSourceLink} />
      )}
    </div>
  );
}

function SourceLinkPanel({ sourceLink }: { sourceLink: SourceSpecLinkDto }) {
  return (
    <section
      data-testid="source-link-panel"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white md:flex-row"
    >
      <aside
        data-testid="source-link-metadata"
        className="grid shrink-0 gap-1 overflow-hidden border-b border-slate-200 p-3 text-xs text-slate-600 md:w-64 md:border-b-0 md:border-r"
      >
        <div className="break-words font-mono text-slate-900">{sourceLink.filePath}</div>
        <div>
          <span className="font-medium text-slate-700">{sourceLink.symbolKind}</span>{" "}
          <span>{sourceLink.symbolName}</span>
        </div>
        {sourceLink.symbolLine ? <div>Symbol line {sourceLink.symbolLine}</div> : null}
        {sourceLink.annotationLine ? <div>Annotation line {sourceLink.annotationLine}</div> : null}
      </aside>
      <div className="min-h-0 flex-1 p-3">
        <Excerpt sourceLink={sourceLink} />
      </div>
    </section>
  );
}

function Excerpt({ sourceLink }: { sourceLink: SourceSpecLinkDto }) {
  const excerpt = sourceLink.excerpt;

  if (!excerpt || excerpt.status !== "available") {
    return (
      <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {excerpt?.message || DEFAULT_EXCERPT_MESSAGE}
      </p>
    );
  }

  return (
    <div
      data-testid="source-code-frame"
      className="h-full min-h-0 flex-1 overflow-hidden rounded border border-slate-200"
    >
      <SourceCodeViewer
        filePath={sourceLink.filePath}
        value={excerpt.text}
        focusLine={sourceLink.annotationLine ?? sourceLink.symbolLine}
      />
    </div>
  );
}

function panelButtonClassName(isSelected: boolean) {
  return [
    "max-w-48 shrink-0 truncate rounded-t border border-b-0 px-3 py-2 text-xs font-medium",
    isSelected
      ? "border-slate-200 bg-white text-slate-950"
      : "border-transparent text-slate-600 hover:bg-white hover:text-slate-950"
  ].join(" ");
}

function basename(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function sourceButtonLabel(sourceLink: SourceSpecLinkDto) {
  return `${basename(sourceLink.filePath)} · ${sourceLink.symbolName}`;
}
