import { Link } from "@tanstack/react-router";
import {
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  FolderSearch,
  FolderSync,
  GitCompareArrows,
  Play,
  RotateCw,
  Sparkles
} from "lucide-react";

export type ProjectActionsProps = {
  projectId: string;
  isAnalyzing: boolean;
  isInitializing: boolean;
  isIndexing: boolean;
  isProjectActionPending: boolean;
  onAnalyze: () => void;
  onInitialize: () => void;
  onReindex: () => void;
};

export function ProjectActions({
  projectId,
  isAnalyzing,
  isInitializing,
  isIndexing,
  isProjectActionPending,
  onAnalyze,
  onInitialize,
  onReindex
}: ProjectActionsProps) {
  return (
    <>
      <button
        type="button"
        className="button-primary"
        disabled={isProjectActionPending}
        onClick={onAnalyze}
      >
        {isAnalyzing ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <BrainCircuit className="h-4 w-4" aria-hidden="true" />
        )}
        Analyze project
      </button>
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
        to="/projects/$projectId/readiness"
        params={{ projectId }}
        className="button-secondary"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Readiness
      </Link>
      <Link
        to="/projects/$projectId/agent-runs"
        params={{ projectId }}
        className="button-secondary"
      >
        <ClipboardList className="h-4 w-4" aria-hidden="true" />
        Agent Runs
      </Link>
      <Link
        to="/projects/$projectId/diff-reviews"
        params={{ projectId }}
        className="button-secondary"
      >
        <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
        Diff Reviews
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
        className="button-secondary"
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
