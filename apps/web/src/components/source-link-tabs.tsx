import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SourceSpecLinkDto } from "@specops/contracts";

const MAX_SOURCE_TABS = 4;
const DEFAULT_EXCERPT_MESSAGE = "Source excerpt unavailable.";

type SourceLinkTabsProps = {
  specTitle: string;
  sourceLinks: SourceSpecLinkDto[];
  specPanel: ReactNode;
};

type ActiveTab = { type: "spec" } | { type: "source"; id: string };

export function SourceLinkTabs({ specTitle, sourceLinks, specPanel }: SourceLinkTabsProps) {
  const visibleSourceLinks = useMemo(() => sourceLinks.slice(0, MAX_SOURCE_TABS), [sourceLinks]);
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
        {sourceLinks.length > MAX_SOURCE_TABS ? (
          <span
            className="shrink-0 px-2 pb-2 text-xs font-medium text-slate-500"
            title={overflowLabel(sourceLinks.length - MAX_SOURCE_TABS)}
            aria-label={overflowLabel(sourceLinks.length - MAX_SOURCE_TABS)}
          >
            +{sourceLinks.length - MAX_SOURCE_TABS}
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
    <section className="min-h-0 flex-1 overflow-auto bg-white p-3">
      <div className="mb-3 grid gap-1 text-xs text-slate-600">
        <div className="font-mono text-slate-900">{sourceLink.filePath}</div>
        <div>
          <span className="font-medium text-slate-700">{sourceLink.symbolKind}</span>{" "}
          <span>{sourceLink.symbolName}</span>
        </div>
        {sourceLink.symbolLine ? <div>Symbol line {sourceLink.symbolLine}</div> : null}
        {sourceLink.annotationLine ? <div>Annotation line {sourceLink.annotationLine}</div> : null}
      </div>
      <Excerpt excerpt={sourceLink.excerpt} />
    </section>
  );
}

function Excerpt({ excerpt }: { excerpt: SourceSpecLinkDto["excerpt"] }) {
  if (!excerpt || excerpt.status !== "available") {
    return (
      <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {excerpt?.message || DEFAULT_EXCERPT_MESSAGE}
      </p>
    );
  }

  const lines = excerpt.text.split(/\r?\n/);

  return (
    <pre className="overflow-auto rounded border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
      <code>
        {lines.map((line, index) => (
          <span key={`${excerpt.startLine + index}-${line}`} className="block whitespace-pre">
            <span className="mr-4 inline-block w-8 select-none text-right text-slate-500">
              {excerpt.startLine + index}
            </span>
            {line}
          </span>
        ))}
      </code>
    </pre>
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

function overflowLabel(count: number) {
  return `${count} additional source ${count === 1 ? "link" : "links"} not shown`;
}
