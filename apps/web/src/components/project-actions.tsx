import { Link } from "@tanstack/react-router";
import { FolderSearch, FolderSync, Play, RotateCw, Sparkles } from "lucide-react";

export type ProjectActionsProps = {
  projectId: string;
  isInitializing: boolean;
  isIndexing: boolean;
  isProjectActionPending: boolean;
  onInitialize: () => void;
  onReindex: () => void;
};

export function ProjectActions({
  projectId,
  isInitializing,
  isIndexing,
  isProjectActionPending,
  onInitialize,
  onReindex
}: ProjectActionsProps) {
  return (
    <>
      <button
        type="button"
        className="button-secondary"
        disabled={isProjectActionPending}
        onClick={onInitialize}
      >
        {isInitializing ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <FolderSync className="h-4 w-4" aria-hidden="true" />
        )}
        Init specops
      </button>
      <Link
        to="/projects/$projectId/import/source"
        params={{ projectId }}
        className="button-secondary"
      >
        <FolderSearch className="h-4 w-4" aria-hidden="true" />
        Import from source
      </Link>
      <Link
        to="/projects/$projectId/ai-prefill"
        params={{ projectId }}
        className="button-secondary"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        AI Prefill
      </Link>
      <button
        type="button"
        className="button-primary"
        disabled={isProjectActionPending}
        onClick={onReindex}
      >
        {isIndexing ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
        Re-index
      </button>
    </>
  );
}
