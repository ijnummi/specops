import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { AgentRunSummary, AgentRunStatus } from "@specops/contracts";
import { useMemo, useState } from "react";

import { agentRunsQuery } from "../api/queries.js";

const statusFilters = [
  "running",
  "ready_for_review",
  "accepted",
  "needs_followup",
  "superseded"
] satisfies AgentRunStatus[];

export function AgentRunsPage({ projectId }: { projectId: string }) {
  const runs = useQuery(agentRunsQuery(projectId));
  const [statusFilter, setStatusFilter] = useState<AgentRunStatus | "all">("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [textFilter, setTextFilter] = useState("");
  const data = runs.data ?? [];
  const agents = useMemo(
    () => [...new Set(data.map((run) => run.agent))].sort((left, right) => left.localeCompare(right)),
    [data]
  );
  const normalizedTextFilter = textFilter.trim().toLowerCase();
  const filteredRuns = data.filter((run) => {
    const statusMatches = statusFilter === "all" || run.status === statusFilter;
    const agentMatches = agentFilter === "all" || run.agent === agentFilter;
    const textMatches =
      normalizedTextFilter.length === 0 ||
      run.taskEntityId.toLowerCase().includes(normalizedTextFilter) ||
      run.taskTitle.toLowerCase().includes(normalizedTextFilter);

    return statusMatches && agentMatches && textMatches;
  });

  if (runs.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading agent runs...</div>;
  }

  if (runs.error) {
    return <div className="p-4 text-sm text-red-700">{runs.error.message}</div>;
  }

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-4">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-950">Agent Runs</h1>
          <p className="mt-1 text-sm text-slate-500">
            {filteredRuns.length} of {data.length} review runs
          </p>
        </div>
      </header>

      <section className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[minmax(12rem,1fr)_minmax(10rem,0.35fr)_minmax(10rem,0.35fr)]">
        <label className="field">
          <span>Search</span>
          <input
            aria-label="Search task id or title"
            className="input h-9"
            type="search"
            value={textFilter}
            onInput={(event) => setTextFilter(event.currentTarget.value)}
            placeholder="Task id or title"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select
            aria-label="Status"
            className="input h-9 py-1"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as AgentRunStatus | "all")}
          >
            <option value="all">All statuses</option>
            {statusFilters.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Agent</span>
          <select
            aria-label="Agent"
            className="input h-9 py-1"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.currentTarget.value)}
          >
            <option value="all">All agents</option>
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
        </label>
      </section>

      {data.length === 0 ? (
        <section className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-sm">
          No agent runs yet.
        </section>
      ) : filteredRuns.length === 0 ? (
        <section className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-sm">
          No agent runs match the current filters.
        </section>
      ) : (
        <section className="rounded border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-200">
            {filteredRuns.map((run) => (
              <li key={run.id}>
                <Link
                  to="/projects/$projectId/agent-runs/$runId"
                  params={{ projectId, runId: run.id }}
                  className="block min-w-0 p-3 underline-offset-2 hover:bg-slate-50 hover:underline"
                >
                  <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-950">
                        {run.taskTitle}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{run.taskEntityId}</span>
                        <span>{run.agent}</span>
                        <span>{formatStatus(run.status)}</span>
                      </div>
                    </div>
                    <div className="grid shrink-0 gap-1 text-xs text-slate-600 sm:grid-cols-3 lg:text-right">
                      <span>{formatCount(run.changedFileCount, "changed file")}</span>
                      <span>{formatFindingCounts(run.findingCounts)}</span>
                      <span>
                        {shortSha(run.startGitCommit)}...{shortSha(run.endGitCommit)}
                      </span>
                      <span>Started {formatDateTime(run.startedAt)}</span>
                      <span>
                        Finished {run.finishedAt ? formatDateTime(run.finishedAt) : "in progress"}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatStatus(status: AgentRunStatus) {
  return status.replaceAll("_", " ");
}

function formatCount(count: number, label: string) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function formatFindingCounts(counts: AgentRunSummary["findingCounts"]) {
  const allCounts: Array<[string, number]> = [
    ["blocker", counts.blocker],
    ["review", counts.review],
    ["context", counts.context],
    ["info", counts.info]
  ];
  const visible = allCounts.filter(([, count]) => count > 0);

  if (visible.length === 0) {
    return "0 findings";
  }

  return visible.map(([label, count]) => `${count} ${label}`).join(" / ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 7) : "unknown";
}
