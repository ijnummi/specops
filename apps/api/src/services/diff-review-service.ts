import type {
  CreateDiffReviewRequest,
  DiffReviewChangedFiles,
  DiffReviewDetailResponse,
  DiffReviewFinding,
  DiffReviewStatus,
  DiffReviewSummaryResponse,
  UpdateDiffReviewStatusRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { diffReviews, projects } from "@specops/db";
import { and, desc, eq } from "drizzle-orm";

import { BadRequestError, NotFoundError } from "../lib/http-errors.js";
import {
  readGitHeadCommit,
  readGitRefRangeChangedFiles,
  readGitStagedChangedFiles,
  readGitStatus,
  readGitWorkingTreeChangedFiles,
  resolveGitRef
} from "./git-service.js";
import {
  buildDiffReviewSummary,
  classifyChangedFiles,
  countChangedFiles,
  EMPTY_DIFF_REVIEW_SUMMARY,
  normalizePath,
  readChangedFiles,
  readDiffReviewSummary
} from "./review-summary-service.js";

type DiffReviewRow = typeof diffReviews.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

const TERMINAL_STATUSES = new Set<DiffReviewStatus>([
  "accepted",
  "needs_followup",
  "superseded"
]);

export function createDiffReviewService(db: Db) {
  async function createReview(
    projectId: string,
    input: CreateDiffReviewRequest
  ): Promise<DiffReviewDetailResponse> {
    const project = await loadProject(projectId);
    const comparison = await resolveDiffSource(project, input);
    const changedFiles = classifyChangedFiles(project, comparison.paths);
    const reviewSummary = await buildDiffReviewSummary({
      db,
      project,
      changedFiles,
      gitComparisonUnavailable: comparison.gitComparisonUnavailable
    });
    const [row] = await db
      .insert(diffReviews)
      .values({
        projectId,
        status: "ready_for_review",
        reviewType: input.reviewType,
        baseRef: input.reviewType === "ref_range" ? input.baseRef : null,
        headRef: input.reviewType === "ref_range" ? input.headRef : null,
        baseCommit: comparison.baseCommit,
        headCommit: comparison.headCommit,
        changedFilesJson: changedFiles,
        reviewSummaryJson: reviewSummary
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create diff review");
    }

    return mapReviewDetail(row);
  }

  async function listReviews(projectId: string): Promise<DiffReviewSummaryResponse[]> {
    await loadProject(projectId);
    const rows = await db
      .select()
      .from(diffReviews)
      .where(eq(diffReviews.projectId, projectId))
      .orderBy(desc(diffReviews.createdAt), desc(diffReviews.id));

    return rows.map(mapReviewSummary);
  }

  async function getReview(
    projectId: string,
    reviewId: string
  ): Promise<DiffReviewDetailResponse> {
    return mapReviewDetail(await loadReview(projectId, reviewId));
  }

  async function updateReviewStatus(
    projectId: string,
    reviewId: string,
    input: UpdateDiffReviewStatusRequest
  ): Promise<DiffReviewDetailResponse> {
    const row = await loadReview(projectId, reviewId);
    const currentStatus = row.status as DiffReviewStatus;

    if (currentStatus === input.status) {
      return mapReviewDetail(row);
    }

    if (TERMINAL_STATUSES.has(currentStatus)) {
      throw new BadRequestError("Diff review already has a terminal status", {
        reviewId,
        status: currentStatus,
        requestedStatus: input.status
      });
    }

    const [updated] = await db
      .update(diffReviews)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(diffReviews.projectId, projectId), eq(diffReviews.id, reviewId)))
      .returning();

    if (!updated) {
      throw new NotFoundError("Diff review not found", { projectId, reviewId });
    }

    return mapReviewDetail(updated);
  }

  async function loadProject(projectId: string): Promise<ProjectRow> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }

    return project;
  }

  async function loadReview(projectId: string, reviewId: string): Promise<DiffReviewRow> {
    const [row] = await db
      .select()
      .from(diffReviews)
      .where(and(eq(diffReviews.projectId, projectId), eq(diffReviews.id, reviewId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError("Diff review not found", { projectId, reviewId });
    }

    return row;
  }

  return {
    createReview,
    listReviews,
    getReview,
    updateReviewStatus
  };
}

async function resolveDiffSource(
  project: ProjectRow,
  input: CreateDiffReviewRequest
): Promise<{
  paths: string[];
  baseCommit: string | null;
  headCommit: string | null;
  gitComparisonUnavailable: boolean;
}> {
  if (input.reviewType === "ref_range") {
    const baseCommit = await resolveReviewRef(project.repoPath, input.baseRef);
    const headCommit = await resolveReviewRef(project.repoPath, input.headRef);
    const paths = await readGitRefRangeChangedFiles(project.repoPath, baseCommit, headCommit);

    return {
      paths: normalizePaths(paths),
      baseCommit,
      headCommit,
      gitComparisonUnavailable: false
    };
  }

  const status = await readGitStatus(project.repoPath, { includeEntries: false });
  if (!status.isRepo) {
    return {
      paths: [],
      baseCommit: null,
      headCommit: null,
      gitComparisonUnavailable: true
    };
  }

  const paths =
    input.reviewType === "working_tree"
      ? await readGitWorkingTreeChangedFiles(project.repoPath)
      : await readGitStagedChangedFiles(project.repoPath);
  const headCommit = await readGitHeadCommit(project.repoPath);

  return {
    paths: normalizePaths(paths),
    baseCommit: headCommit,
    headCommit,
    gitComparisonUnavailable: headCommit === null
  };
}

async function resolveReviewRef(repoPath: string, ref: string): Promise<string> {
  try {
    return await resolveGitRef(repoPath, ref);
  } catch (error) {
    throw new BadRequestError("Invalid Git ref", {
      ref,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function mapReviewSummary(row: DiffReviewRow): DiffReviewSummaryResponse {
  const changedFiles = readChangedFiles(row.changedFilesJson);
  const reviewSummary = readDiffReviewSummary(row.reviewSummaryJson, changedFiles);

  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as DiffReviewStatus,
    reviewType: row.reviewType as DiffReviewSummaryResponse["reviewType"],
    baseRef: row.baseRef,
    headRef: row.headRef,
    baseCommit: row.baseCommit,
    headCommit: row.headCommit,
    changedFileCount: countChangedFiles(changedFiles),
    findingCounts: countDiffReviewFindings(reviewSummary.findings),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapReviewDetail(row: DiffReviewRow): DiffReviewDetailResponse {
  const changedFiles = readChangedFiles(row.changedFilesJson);
  const reviewSummary = readDiffReviewSummary(
    row.reviewSummaryJson ?? EMPTY_DIFF_REVIEW_SUMMARY,
    changedFiles
  );

  return {
    ...mapReviewSummary(row),
    changedFiles,
    reviewSummary
  };
}

function countDiffReviewFindings(
  findings: DiffReviewFinding[]
): DiffReviewSummaryResponse["findingCounts"] {
  const counts: DiffReviewSummaryResponse["findingCounts"] = {
    blocker: 0,
    review: 0,
    context: 0,
    info: 0
  };

  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return counts;
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter((filePath) => filePath.length > 0))].sort();
}
