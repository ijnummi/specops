import { Link } from "@tanstack/react-router";
import type { ProjectDto } from "@specops/contracts";
import { ArrowRight, FolderGit2 } from "lucide-react";

import type { ProjectSummaryDto } from "../api/queries.js";

type ProjectCardProps = {
  project: ProjectDto | ProjectSummaryDto;
};

export function ProjectCard({ project }: ProjectCardProps) {
  const summary = readSummary(project);

  return (
    <article className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <FolderGit2 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <h3 className="truncate text-sm font-semibold text-slate-950">{project.name}</h3>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{project.slug}</p>
        </div>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          search={{ q: undefined }}
          className="icon-button"
          title="Open project"
          aria-label={`Open ${project.name}`}
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {project.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-slate-600">{project.description}</p>
      ) : null}

      <dl className="mt-4 grid gap-2 text-xs text-slate-600">
        <Row label="Repository" value={project.repoPath} />
        <Row label="SpecOps" value={project.specopsPath} />
        {summary ? (
          <>
            <Row label="Entities" value={String(summary.entityCount)} />
            <Row label="Status" value={summary.status} />
          </>
        ) : null}
      </dl>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[82px_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function readSummary(project: ProjectDto | ProjectSummaryDto) {
  if (!("entityCount" in project)) {
    return null;
  }

  const issueCount = project.validationErrorCount + project.validationWarningCount;
  return {
    entityCount: project.entityCount,
    status: issueCount > 0 ? `${issueCount} validation messages` : "No validation messages"
  };
}
