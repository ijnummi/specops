import { useState } from "react";
import type { ChangeImpactPreviewResponseDto } from "@specops/contracts";
import { Bot, RotateCw } from "lucide-react";

type Props = {
  preview: ChangeImpactPreviewResponseDto;
  selectedNodeId: string | null;
  onGenerateTask: () => void;
  isGeneratingTask: boolean;
};

type Tab = "overview" | "specs" | "source" | "warnings" | "tasks";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "specs", label: "Specs" },
  { id: "source", label: "Source" },
  { id: "warnings", label: "Warnings" },
  { id: "tasks", label: "Tasks" }
];

export function ChangeImpactPreviewPanel({
  preview,
  selectedNodeId,
  onGenerateTask,
  isGeneratingTask
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <aside
      data-testid="change-impact-preview-panel"
      className="flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white"
    >
      <header className="shrink-0 border-b border-slate-200 px-4 py-3">
        <p className="text-xs font-medium uppercase text-slate-500">Impact</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">Change Impact Preview</h2>
        <p className="mt-1 truncate font-mono text-xs text-slate-600">
          Root: {preview.rootEntity.entityId}
        </p>
      </header>

      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-2"
        aria-label="Change impact preview tabs"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            className={tabButtonClassName(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {activeTab === "overview" ? (
          <Overview preview={preview} selectedNodeId={selectedNodeId} />
        ) : null}
        {activeTab === "specs" ? <Specs preview={preview} /> : null}
        {activeTab === "source" ? <Source preview={preview} /> : null}
        {activeTab === "warnings" ? <Warnings preview={preview} /> : null}
        {activeTab === "tasks" ? <Tasks preview={preview} /> : null}
      </div>

      <footer className="shrink-0 border-t border-slate-200 p-3">
        <button
          type="button"
          className="button-primary w-full justify-center"
          disabled={isGeneratingTask}
          onClick={onGenerateTask}
        >
          {isGeneratingTask ? (
            <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Bot className="h-4 w-4" aria-hidden="true" />
          )}
          Generate task from impact
        </button>
      </footer>
    </aside>
  );
}

function Overview({
  preview,
  selectedNodeId
}: {
  preview: ChangeImpactPreviewResponseDto;
  selectedNodeId: string | null;
}) {
  const metrics = [
    { label: "Impacted specs", value: preview.overview.impactedSpecCount },
    { label: "Source files", value: preview.overview.sourceFileCount },
    { label: "Warnings", value: preview.overview.warningCount },
    { label: "Related tasks", value: preview.overview.relatedTaskCount }
  ];

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">{metric.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{metric.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1 text-sm">
        <div className="text-xs font-medium uppercase text-slate-500">
          Selected node
        </div>
        <div className="break-all font-mono text-slate-900">
          {selectedNodeId ?? preview.rootEntity.entityId}
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-950">Shortest paths</h3>
        {preview.overview.shortestPaths.length > 0 ? (
          <div className="space-y-2">
            {preview.overview.shortestPaths.map((path, index) => (
              <div
                key={`${path.direction}-${path.entityIds.join("-")}-${index}`}
                className="rounded border border-slate-200 p-3 text-sm"
              >
                <div className="mb-1 text-xs font-medium uppercase text-slate-500">
                  {labelForDirection(path.direction)}
                </div>
                <div className="text-slate-900">
                  {path.steps.map((step) => step.entityId).join(" -> ")}
                </div>
                {path.linkTypes.length > 0 ? (
                  <div className="mt-1 text-xs text-slate-500">{path.linkTypes.join(", ")}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            No shortest paths found.
          </p>
        )}
      </section>
    </section>
  );
}

function Specs({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.impactedSpecs.length === 0) {
    return <EmptyState>No linked specs found.</EmptyState>;
  }

  return (
    <section className="space-y-3">
      {preview.impactedSpecs.map((group) => (
        <section
          key={`${group.direction}-${group.type}`}
          className="rounded border border-slate-200"
        >
          <header className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-600">
            {labelForDirection(group.direction)} / {group.type}
          </header>
          <div className="divide-y divide-slate-200">
            {group.specs.map((spec) => (
              <EntityRow
                key={`${group.direction}-${spec.entityId}`}
                entityId={spec.entityId}
                title={spec.title}
                details={`${spec.status} - distance ${spec.distance} - ${spec.filePath}`}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function Source({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.sourceGroups.length === 0) {
    return <EmptyState>No source evidence found.</EmptyState>;
  }

  return (
    <section className="space-y-3">
      {preview.sourceGroups.map((group) => (
        <section key={group.filePath} className="rounded border border-slate-200">
          <header className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
            {group.filePath}
          </header>
          <div className="divide-y divide-slate-200">
            {group.symbols.map((symbol) => (
              <div
                key={`${symbol.filePath}-${symbol.symbolName}-${symbol.entityId}`}
                className="space-y-1 px-3 py-2 text-sm"
              >
                <div className="font-medium text-slate-950">
                  {symbol.symbolKind} {symbol.symbolName}
                </div>
                <div className="break-all font-mono text-xs text-slate-600">{symbol.entityId}</div>
                <div className="text-xs text-slate-500">
                  Symbol line {symbol.symbolLine ?? "unknown"}
                  {symbol.annotationLine ? ` - Annotation line ${symbol.annotationLine}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function Warnings({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  const hasWarnings =
    preview.validationMessages.length > 0 || preview.sectionWarnings.length > 0;

  if (!hasWarnings) {
    return <EmptyState>No warnings for this impact set.</EmptyState>;
  }

  return (
    <section className="space-y-3">
      {preview.validationMessages.map((message) => (
        <div key={message.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-mono text-xs font-semibold text-amber-900">{message.code}</div>
          <div className="mt-1 text-amber-950">{message.message}</div>
          <div className="mt-1 text-xs text-amber-800">
            {[message.level, message.entityId, message.filePath].filter(Boolean).join(" - ")}
          </div>
        </div>
      ))}
      {preview.sectionWarnings.map((warning) => (
        <div
          key={`${warning.section}-${warning.message}`}
          className="rounded border border-amber-200 bg-amber-50 p-3 text-sm"
        >
          <div className="font-mono text-xs font-semibold text-amber-900">{warning.section}</div>
          <div className="mt-1 text-amber-950">{warning.message}</div>
        </div>
      ))}
    </section>
  );
}

function Tasks({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.relatedTasks.length === 0) {
    return <EmptyState>No related tasks found.</EmptyState>;
  }

  return (
    <section className="space-y-2">
      {preview.relatedTasks.map((task) => (
        <EntityRow
          key={task.entityId}
          entityId={task.entityId}
          title={task.title}
          details={`${task.status} - ${task.linkTypes.join(", ")} - ${task.filePath}`}
        />
      ))}
    </section>
  );
}

function EntityRow({
  entityId,
  title,
  details
}: {
  entityId: string;
  title: string;
  details: string;
}) {
  return (
    <div className="space-y-1 px-3 py-2 text-sm">
      <div className="break-all font-mono text-xs font-semibold text-slate-900">{entityId}</div>
      <div className="font-medium text-slate-950">{title}</div>
      <div className="text-xs text-slate-500">{details}</div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
      {children}
    </p>
  );
}

function tabButtonClassName(isSelected: boolean) {
  return [
    "shrink-0 rounded-t border border-b-0 px-3 py-2 text-xs font-medium",
    isSelected
      ? "border-slate-200 bg-white text-slate-950"
      : "border-transparent text-slate-600 hover:bg-white hover:text-slate-950"
  ].join(" ");
}

function labelForDirection(direction: string) {
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}
