import { Link } from "@tanstack/react-router";
import type {
  ProjectHealthDto,
  ProjectOverviewDto,
  ProjectReadinessDto
} from "@specops/contracts";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  FileText,
  GitBranch,
  ListChecks,
  Network,
  ShieldCheck
} from "lucide-react";

type ProjectOverviewDashboardProps = {
  projectId: string;
  overview: ProjectOverviewDto;
  health?: ProjectHealthDto;
  healthError?: Error | null;
  isHealthLoading?: boolean;
  readiness?: ProjectReadinessDto;
  readinessError?: Error | null;
  isReadinessLoading?: boolean;
};

export function ProjectOverviewDashboard({
  projectId,
  overview,
  health,
  healthError,
  isHealthLoading = false,
  readiness,
  readinessError,
  isReadinessLoading = false
}: ProjectOverviewDashboardProps) {
  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto">
      <section className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-[1.3fr_1fr_1fr]">
        <Panel title="Project Health" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Entities" value={overview.project.entityCount} />
            <Metric label="Links" value={overview.project.linkCount} />
            <Metric label="Errors" value={overview.project.validationErrorCount} tone="danger" />
            <Metric
              label="Warnings"
              value={overview.project.validationWarningCount}
              tone="warning"
            />
          </div>
          <ValidationSamples projectId={projectId} samples={overview.validationSummary.samples} />
        </Panel>

        <Panel title="Latest index" icon={<Database className="h-4 w-4" aria-hidden="true" />}>
          {overview.latestIndexRun ? (
            <dl className="grid gap-2 text-sm text-slate-700">
              <StatusRow label="Status" value={overview.latestIndexRun.status} />
              <StatusRow label="Finished" value={formatDate(overview.latestIndexRun.finishedAt)} />
              <StatusRow
                label="Indexed facts"
                value={`${overview.latestIndexRun.entityCount} specs, ${
                  overview.latestIndexRun.sourceFileCount ?? 0
                } files`}
              />
            </dl>
          ) : (
            <EmptyState title="No index runs yet" body="Run indexing to populate dashboard metrics." />
          )}
        </Panel>

        <Panel title="Git & Drift" icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}>
          <GitDriftPanel
            projectId={projectId}
            health={health}
            healthError={healthError}
            isHealthLoading={isHealthLoading}
          />
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <Panel title="Spec Inventory" icon={<FileText className="h-4 w-4" aria-hidden="true" />}>
          <GroupedCounts
            projectId={projectId}
            groups={overview.entityCountsByType.map((group) => ({
              label: group.type,
              count: group.count
            }))}
          />
          <div className="mt-3 border-t border-slate-200 pt-3">
            <GroupedCounts
              projectId={projectId}
              groups={overview.entityCountsByStatus.map((group) => ({
                label: group.status,
                count: group.count
              }))}
            />
          </div>
        </Panel>

        <Panel title="Source Inventory" icon={<FileCode2 className="h-4 w-4" aria-hidden="true" />}>
          {overview.sourceInventory.fileCount === 0 ? (
            <EmptyState
              title="No source facts"
              body="Source inventory is unavailable until indexing scans source files."
            />
          ) : (
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-4">
              <Metric label="Files" value={overview.sourceInventory.fileCount} />
              <Metric label="Symbols" value={overview.sourceInventory.symbolCount} />
              <Metric label="Imports" value={overview.sourceInventory.importCount} />
              <Metric label="Exports" value={overview.sourceInventory.exportCount} />
            </div>
          )}
        </Panel>

        <Panel title="Spec Readiness" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>
          <ReadinessSummaryPanel
            projectId={projectId}
            readiness={readiness}
            readinessError={readinessError}
            isReadinessLoading={isReadinessLoading}
          />
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <Panel title="Source Evidence" icon={<Network className="h-4 w-4" aria-hidden="true" />}>
          <p className="text-sm font-medium text-slate-900">
            {overview.sourceEvidence.withSourceEvidenceCount} with evidence,{" "}
            {overview.sourceEvidence.withoutSourceEvidenceCount} without evidence
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {overview.sourceEvidence.eligibleSpecCount} eligible specs
          </p>
          <LinkedEntityList projectId={projectId} items={overview.sourceEvidence.missingSamples} />
        </Panel>

        <Panel title="Agent Tasks" icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}>
          <p className="text-sm font-medium text-slate-900">
            {overview.agentTasks.totalCount} saved tasks
          </p>
          <LinkedEntityList projectId={projectId} items={overview.agentTasks.recent} />
        </Panel>

        <Panel title="Needs Attention" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
          {overview.attentionItems.length > 0 ? (
            <ul className="divide-y divide-slate-200">
              {overview.attentionItems.map((item, index) => (
                <li key={`${item.kind}-${item.entityId ?? item.filePath ?? index}`} className="py-2">
                  {item.entityId ? (
                    <Link
                      to="/projects/$projectId/entities/$entityId"
                      params={{ projectId, entityId: item.entityId }}
                      search={{ q: undefined }}
                      className="block min-w-0 text-xs text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline"
                    >
                      <span className="block truncate font-medium">
                        {attentionKindLabel(item.kind)}
                      </span>
                      <span className="mt-0.5 block truncate text-slate-500">{item.label}</span>
                    </Link>
                  ) : (
                    <div className="min-w-0 text-xs text-slate-700">
                      <span className="block truncate font-medium">
                        {attentionKindLabel(item.kind)}
                      </span>
                      <span className="mt-0.5 block truncate text-slate-500">{item.label}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No attention items"
              body="No validation or source evidence signals need attention."
            />
          )}
        </Panel>
      </section>
    </div>
  );
}

type PanelProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
};

function Panel({ title, icon, children }: PanelProps) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="shrink-0 text-slate-500">{icon}</span>
        <span className="truncate">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-950";

  return (
    <div className="min-w-0 border-l border-slate-200 pl-3 first:border-l-0 first:pl-0">
      <div className={`truncate text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="truncate text-xs text-slate-500">{label}</div>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[92px_1fr] gap-3">
      <dt className="truncate text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-xs font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function GitDriftPanel({
  projectId,
  health,
  healthError,
  isHealthLoading
}: {
  projectId: string;
  health?: ProjectHealthDto;
  healthError?: Error | null;
  isHealthLoading: boolean;
}) {
  if (isHealthLoading) {
    return (
      <EmptyState title="Loading Git health" body="Checking local repository state." />
    );
  }

  if (healthError) {
    return <EmptyState title="Git health unavailable" body={healthError.message} />;
  }

  if (!health) {
    return <EmptyState title="Git health unavailable" body="Health data has not loaded." />;
  }

  if (!health.git.isRepo) {
    return (
      <EmptyState
        title="Git unavailable"
        body="This project path is not inside a Git repository."
      />
    );
  }

  return (
    <div className="grid gap-3">
      <dl className="grid gap-2 text-sm text-slate-700">
        <StatusRow label="HEAD" value={shortCommit(health.git.headCommit)} />
        <StatusRow label="Indexed" value={shortCommit(health.git.indexedCommit)} />
        <StatusRow
          label="State"
          value={health.drift.indexIsBehindHead ? "Index behind HEAD" : "Index matches HEAD"}
        />
      </dl>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
        <Metric label="Spec changes" value={health.drift.currentSpecFileChangeCount} />
        <Metric label="Source changes" value={health.drift.currentSourceFileChangeCount} />
        <Metric label="Stale tasks" value={health.staleTasks.count} tone="warning" />
      </div>
      <HealthAttentionList projectId={projectId} items={health.attentionItems.slice(0, 5)} />
    </div>
  );
}

function ReadinessSummaryPanel({
  projectId,
  readiness,
  readinessError,
  isReadinessLoading
}: {
  projectId: string;
  readiness?: ProjectReadinessDto;
  readinessError?: Error | null;
  isReadinessLoading: boolean;
}) {
  if (isReadinessLoading) {
    return <EmptyState title="Loading readiness" body="Checking spec readiness signals." />;
  }

  if (readinessError) {
    return <EmptyState title="Readiness unavailable" body={readinessError.message} />;
  }

  if (!readiness) {
    return <EmptyState title="Readiness unavailable" body="Readiness data has not loaded." />;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <p className="truncate font-medium text-slate-900">{readiness.summary.ready} ready</p>
        <p className="truncate font-medium text-red-700">{readiness.summary.blocked} blocked</p>
        <p className="truncate font-medium text-amber-700">
          {readiness.summary.needsReview} needs review
        </p>
        <p className="truncate font-medium text-slate-700">
          {readiness.summary.needsContext} needs context
        </p>
      </div>
      <Link
        to="/projects/$projectId/readiness"
        params={{ projectId }}
        className="text-xs font-medium text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline"
      >
        Open readiness queue
      </Link>
    </div>
  );
}

function HealthAttentionList({
  projectId,
  items
}: {
  projectId: string;
  items: ProjectHealthDto["attentionItems"];
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">No Git health attention items.</span>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-200 border-t border-slate-200">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.entityId ?? item.filePath ?? index}`} className="py-2">
          {item.entityId ? (
            <Link
              to="/projects/$projectId/entities/$entityId"
              params={{ projectId, entityId: item.entityId }}
              search={{ q: undefined }}
              className="block min-w-0 text-xs text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline"
            >
              <HealthAttentionContent item={item} />
            </Link>
          ) : (
            <div className="min-w-0 text-xs text-slate-700">
              <HealthAttentionContent item={item} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function HealthAttentionContent({
  item
}: {
  item: ProjectHealthDto["attentionItems"][number];
}) {
  return (
    <>
      <span className="block truncate font-medium">{healthAttentionKindLabel(item.kind)}</span>
      <span className="mt-0.5 block truncate text-slate-500">{item.label}</span>
    </>
  );
}

function GroupedCounts({
  projectId,
  groups
}: {
  projectId: string;
  groups: Array<{ label: string; count: number }>;
}) {
  if (groups.length === 0) {
    return <EmptyState title="No specs indexed" body="Run indexing to populate spec inventory." />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {groups.map((group) => (
        <Link
          key={group.label}
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: group.label }}
          className="inline-flex max-w-full items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          <span className="truncate font-medium">{group.label}</span>
          <span className="shrink-0 text-slate-500">{group.count}</span>
        </Link>
      ))}
    </div>
  );
}

function ValidationSamples({
  projectId,
  samples
}: {
  projectId: string;
  samples: ProjectOverviewDto["validationSummary"]["samples"];
}) {
  if (samples.length === 0) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
        No validation samples.
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">
        Validation Samples
      </h3>
      <ul className="divide-y divide-slate-200">
        {samples.map((sample, index) => (
          <li
            key={`${sample.code}-${sample.entityId ?? sample.filePath ?? index}`}
            className="py-2"
          >
            {sample.entityId ? (
              <Link
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: sample.entityId }}
                search={{ q: undefined }}
                className="block min-w-0 text-xs text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline"
              >
                <ValidationSampleContent sample={sample} />
              </Link>
            ) : (
              <div className="min-w-0 text-xs text-slate-700">
                <ValidationSampleContent sample={sample} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ValidationSampleContent({
  sample
}: {
  sample: ProjectOverviewDto["validationSummary"]["samples"][number];
}) {
  return (
    <>
      <span className="block truncate font-medium">
        {sample.level} / {sample.code}
      </span>
      <span className="mt-0.5 block truncate text-slate-500">{sample.message}</span>
      <span className="mt-0.5 block truncate font-mono text-slate-400">
        {sample.entityId ?? sample.filePath ?? "Project"}
      </span>
    </>
  );
}

function LinkedEntityList({
  projectId,
  items
}: {
  projectId: string;
  items: Array<{ entityId: string; title: string; type?: string; status?: string }>;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">No linked items.</span>
      </div>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-slate-200">
      {items.map((item) => (
        <li key={item.entityId} className="py-2">
          <Link
            to="/projects/$projectId/entities/$entityId"
            params={{ projectId, entityId: item.entityId }}
            search={{ q: undefined }}
            className="block min-w-0 text-xs underline-offset-2 hover:text-slate-950 hover:underline"
          >
            <span className="block truncate font-medium text-slate-800">{item.title}</span>
            <span className="mt-0.5 block truncate text-slate-500">{item.entityId}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-slate-200 p-3 text-sm">
      <p className="font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{body}</p>
    </div>
  );
}

function attentionKindLabel(kind: ProjectOverviewDto["attentionItems"][number]["kind"]) {
  if (kind === "validation_error") return "Error";
  if (kind === "validation_warning") return "Warning";
  return "Missing source evidence";
}

function healthAttentionKindLabel(kind: ProjectHealthDto["attentionItems"][number]["kind"]) {
  if (kind === "index_behind_head") return "Index behind HEAD";
  if (kind === "changed_spec_files") return "Spec changes";
  if (kind === "changed_source_files") return "Source changes";
  if (kind === "stale_agent_task") return "Stale task";
  return "Missing task source";
}

function shortCommit(value: string | null) {
  return value ? value.slice(0, 7) : "Unknown";
}

function formatDate(value: string | null) {
  if (!value) return "Not finished";
  return new Date(value).toLocaleString();
}
