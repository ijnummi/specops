import type {
  AcceptProposalsRequest,
  ProposalDetailDto,
  ProposalPatchRequest,
  ProposalStatus,
  ProposalSummaryDto,
  SourceSpecEntityProposalEvidence,
  SourceSpecEntityProposalPayload
} from "@specops/contracts";
import {
  proposalPatchRequestSchema,
  sourceSpecEntityProposalEvidenceSchema,
  sourceSpecEntityProposalPayloadSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { aiProposals, specEntities } from "@specops/db";
import { scanRepository } from "@specops/repo-scanner";
import { generateBootstrapSpecProposals } from "@specops/source-bootstrap";
import { and, asc, eq } from "drizzle-orm";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

type ProposalRow = typeof aiProposals.$inferSelect;

const sourceSpecEntityProposalType = "source_spec_entity";

export function createProposalService(db: Db) {
  const projectService = createProjectService(db);

  async function generateSourceImportProposals(projectId: string): Promise<ProposalSummaryDto[]> {
    const project = await projectService.getProject(projectId);
    const repoPath = assertAbsolutePath("repoPath", project.repoPath);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);

    assertInsideDirectory(repoPath, specopsPath);
    await assertRealPathInsideDirectory(repoPath, repoPath);
    await assertExistingParentInsideDirectory(repoPath, specopsPath);

    const scan = await scanRepository({ repoPath });
    if (scan.files.length === 0) {
      throw new BadRequestError("No supported source files found");
    }

    const generated = generateBootstrapSpecProposals(scan);
    if (generated.length === 0) {
      throw new BadRequestError("No eligible exported source symbols found");
    }

    const rows = await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(aiProposals)
        .set({ status: "obsolete", reviewedAt: now })
        .where(
          and(
            eq(aiProposals.projectId, projectId),
            eq(aiProposals.proposalType, sourceSpecEntityProposalType),
            eq(aiProposals.status, "pending")
          )
        );

      return tx
        .insert(aiProposals)
        .values(
          generated.map((proposal) => ({
            projectId,
            proposalType: proposal.proposalType,
            title: proposal.title,
            payloadJson: proposal.payload,
            evidenceJson: proposal.evidence,
            confidence: proposal.confidence,
            status: "pending"
          }))
        )
        .returning();
    });

    return mapSummaries(rows, projectId);
  }

  async function listProposals(
    projectId: string,
    status?: ProposalStatus
  ): Promise<ProposalSummaryDto[]> {
    await projectService.getProject(projectId);

    const rows = status
      ? await db
          .select()
          .from(aiProposals)
          .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.status, status)))
          .orderBy(asc(aiProposals.createdAt), asc(aiProposals.title), asc(aiProposals.id))
      : await db
          .select()
          .from(aiProposals)
          .where(eq(aiProposals.projectId, projectId))
          .orderBy(asc(aiProposals.createdAt), asc(aiProposals.title), asc(aiProposals.id));

    return mapSummaries(rows, projectId);
  }

  async function getProposal(projectId: string, proposalId: string): Promise<ProposalDetailDto> {
    await projectService.getProject(projectId);
    const row = await getProposalRow(projectId, proposalId);
    return mapDetail(row, await conflictForPayload(projectId, parsePayload(row)));
  }

  async function patchProposal(
    projectId: string,
    proposalId: string,
    input: ProposalPatchRequest
  ): Promise<ProposalDetailDto> {
    await projectService.getProject(projectId);
    const patch = proposalPatchRequestSchema.parse(input);
    const row = await getProposalRow(projectId, proposalId);

    if (row.status !== "pending") {
      throw new ConflictError("Only pending proposals can be edited or rejected", {
        proposalId,
        status: row.status
      });
    }

    const payload = parsePayload(row);
    const updatedPayload =
      patch.markdown === undefined ? payload : { ...payload, markdown: patch.markdown };
    const update: Partial<typeof aiProposals.$inferInsert> = {
      payloadJson: updatedPayload
    };

    if (patch.status === "rejected") {
      update.status = "rejected";
      update.reviewedAt = new Date();
    }

    const [updated] = await db
      .update(aiProposals)
      .set(update)
      .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.id, proposalId)))
      .returning();

    return mapDetail(updated, await conflictForPayload(projectId, updatedPayload));
  }

  async function acceptProposals(
    _projectId: string,
    _input: AcceptProposalsRequest
  ): Promise<never> {
    throw new BadRequestError("Proposal acceptance is not implemented");
  }

  async function getProposalRow(projectId: string, proposalId: string): Promise<ProposalRow> {
    const [row] = await db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.id, proposalId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError("Proposal not found", { projectId, proposalId });
    }

    return row;
  }

  async function mapSummaries(
    rows: ProposalRow[],
    projectId: string
  ): Promise<ProposalSummaryDto[]> {
    return Promise.all(
      rows.map(async (row) =>
        mapSummary(row, await conflictForPayload(projectId, parsePayload(row)))
      )
    );
  }

  async function conflictForPayload(
    projectId: string,
    payload: SourceSpecEntityProposalPayload
  ): Promise<ProposalSummaryDto["conflict"]> {
    const [entity] = await db
      .select({ entityId: specEntities.entityId })
      .from(specEntities)
      .where(
        and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, payload.entityId))
      )
      .limit(1);

    return entity ? { status: "entity_exists", entityId: entity.entityId } : { status: "none" };
  }

  return {
    generateSourceImportProposals,
    listProposals,
    getProposal,
    patchProposal,
    acceptProposals
  };
}

function parsePayload(row: ProposalRow): SourceSpecEntityProposalPayload {
  return sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson);
}

function parseEvidence(row: ProposalRow): SourceSpecEntityProposalEvidence {
  return sourceSpecEntityProposalEvidenceSchema.parse(row.evidenceJson);
}

function mapSummary(
  row: ProposalRow,
  conflict: ProposalSummaryDto["conflict"]
): ProposalSummaryDto {
  const payload = parsePayload(row);

  return {
    id: row.id,
    projectId: row.projectId,
    proposalType: sourceSpecEntityProposalType,
    status: row.status as ProposalStatus,
    title: row.title,
    entityId: payload.entityId,
    entityType: payload.type,
    filePath: payload.filePath,
    confidence: row.confidence,
    conflict,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null
  };
}

function mapDetail(
  row: ProposalRow,
  conflict: ProposalDetailDto["conflict"]
): ProposalDetailDto {
  return {
    ...mapSummary(row, conflict),
    payload: parsePayload(row),
    evidence: parseEvidence(row)
  };
}
