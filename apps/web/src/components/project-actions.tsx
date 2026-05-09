import { FolderSearch, FolderSync, Play, RotateCw } from "lucide-react";

export type ProjectActionsProps = {
  isInitializing: boolean;
  isBootstrapping: boolean;
  isIndexing: boolean;
  isProjectActionPending: boolean;
  onInitialize: () => void;
  onBootstrap: () => void;
  onReindex: () => void;
};

export function ProjectActions({
  isInitializing,
  isBootstrapping,
  isIndexing,
  isProjectActionPending,
  onInitialize,
  onBootstrap,
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
      <button
        type="button"
        className="button-secondary"
        disabled={isProjectActionPending}
        onClick={onBootstrap}
      >
        {isBootstrapping ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <FolderSearch className="h-4 w-4" aria-hidden="true" />
        )}
        Bootstrap from source
      </button>
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
