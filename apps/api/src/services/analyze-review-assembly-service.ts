import type {
  AnalyzeReviewAcceptRequest,
  AnalyzeReviewAcceptResponse,
  AnalyzeReviewAssemblyDto,
  AnalyzeReviewAttachEvidenceRequest,
  AnalyzeReviewAttachInputRequest,
  AnalyzeReviewClaimDto,
  AnalyzeReviewCreateAssemblyRequest,
  AnalyzeReviewCreateClaimRequest,
  AnalyzeReviewEntityType,
  AnalyzeReviewEvidenceDto,
  AnalyzeReviewInputDto,
  AnalyzeReviewInputRole,
  AnalyzeReviewListResponse,
  AnalyzeReviewUpdateAssemblyRequest,
  AnalyzeReviewUpdateClaimRequest,
  AnalyzeReviewValidationMessage,
  AiSpecEntityProposalEvidence,
  AiSpecEntityProposalPayload,
  ProposalType,
  SourceSpecEntityProposalEvidence,
  SourceSpecEntityProposalPayload
} from "@specops/contracts";
import {
  aiSpecEntityProposalEvidenceSchema,
  aiSpecEntityProposalPayloadSchema,
  sourceSpecEntityProposalEvidenceSchema,
  sourceSpecEntityProposalPayloadSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  analyzeReviewAssemblies,
  analyzeReviewAssemblyInputs,
  analyzeReviewClaimEvidence,
  analyzeReviewClaims,
  analyzeRuns
} from "@specops/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import { renderAnalyzeReviewAssemblyMarkdown } from "./analyze-review-renderer.js";

type AnalyzeRunRow = typeof analyzeRuns.$inferSelect;
type AssemblyRow = typeof analyzeReviewAssemblies.$inferSelect;
type AssemblyInputRow = typeof analyzeReviewAssemblyInputs.$inferSelect;
type ClaimRow = typeof analyzeReviewClaims.$inferSelect;
type ClaimEvidenceRow = typeof analyzeReviewClaimEvidence.$inferSelect;
type ProposalRow = typeof aiProposals.$inferSelect;

type ProposalMetadata = {
  entityType: AnalyzeReviewEntityType;
  entityId: string;
  filePath: string;
  title: string;
  summary: string;
  proposedLinks: Array<{ linkType: string; targetEntityId: string; rationale: string }>;
};

type InitialClaim = {
  text: string;
  kind: "fact" | "hypothesis";
  confidence: number | null;
  evidence: Array<Omit<AnalyzeReviewEvidenceDto, "id">>;
};

export function createAnalyzeReviewAssemblyService(db: Db) {
  async function listReviewAssemblies(
    projectId: string,
    runId: string
  ): Promise<AnalyzeReviewListResponse> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await ensureInitialAssemblies(projectId, run);
    return listReviewAssembliesWithoutDeriving(projectId, run);
  }

  async function createAssembly(
    projectId: string,
    runId: string,
    input: AnalyzeReviewCreateAssemblyRequest
  ): Promise<AnalyzeReviewAssemblyDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    const proposalRows = await getRunProposalRows(projectId, run, input.proposalIds);
    const firstProposal = proposalRows[0];
    const firstMetadata = firstProposal ? metadataForProposal(firstProposal) : null;
    const entityType = input.entityType ?? firstMetadata?.entityType;
    const entityId = input.entityId ?? firstMetadata?.entityId;
    const filePath = input.filePath ?? firstMetadata?.filePath;
    const title = input.title ?? firstMetadata?.title;

    if (!entityType || !entityId || !filePath || !title) {
      throw new BadRequestError("Expected proposalIds or title, entityType, entityId, and filePath");
    }

    for (const proposal of proposalRows) {
      await assertNoActiveAssignment(projectId, "", proposal.id);
    }

    const assembly = await createDraftAssembly(projectId, runId, {
      entityType,
      entityId,
      filePath,
      title,
      summary: input.summary ?? firstMetadata?.summary ?? "",
      proposedLinks: firstMetadata?.proposedLinks ?? [],
      proposals: proposalRows
    });

    return getMappedAssembly(projectId, run, assembly.id);
  }

  async function patchAssembly(
    projectId: string,
    runId: string,
    assemblyId: string,
    input: AnalyzeReviewUpdateAssemblyRequest
  ): Promise<AnalyzeReviewAssemblyDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await getAssemblyRow(projectId, runId, assemblyId);
    const now = new Date();
    const update: Partial<typeof analyzeReviewAssemblies.$inferInsert> = {
      updatedAt: now
    };

    if (input.title !== undefined) {
      update.title = input.title;
    }
    if (input.entityType !== undefined) {
      update.entityType = input.entityType;
    }
    if (input.entityId !== undefined) {
      update.entityId = input.entityId;
    }
    if (input.filePath !== undefined) {
      update.filePath = input.filePath;
    }
    if (input.summary !== undefined) {
      update.summary = input.summary;
    }
    if (input.status !== undefined) {
      update.status = input.status;
      update.discardedAt = now;
    }

    await db
      .update(analyzeReviewAssemblies)
      .set(update)
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          eq(analyzeReviewAssemblies.analyzeRunId, runId),
          eq(analyzeReviewAssemblies.id, assemblyId)
        )
      );
    await refreshRenderedMarkdown(projectId, assemblyId);

    return getMappedAssembly(projectId, run, assemblyId);
  }

  async function attachInput(
    projectId: string,
    runId: string,
    assemblyId: string,
    input: AnalyzeReviewAttachInputRequest
  ): Promise<AnalyzeReviewAssemblyDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await getAssemblyRow(projectId, runId, assemblyId);
    await getRunProposalRows(projectId, run, [input.proposalId]);

    if (input.role !== "evidence_only") {
      await assertNoActiveAssignment(projectId, assemblyId, input.proposalId);
    }

    await db.insert(analyzeReviewAssemblyInputs).values({
      projectId,
      assemblyId,
      proposalId: input.proposalId,
      role: input.role
    });
    await refreshRenderedMarkdown(projectId, assemblyId);

    return getMappedAssembly(projectId, run, assemblyId);
  }

  async function removeInput(
    projectId: string,
    runId: string,
    assemblyId: string,
    proposalId: string
  ): Promise<AnalyzeReviewAssemblyDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await getAssemblyRow(projectId, runId, assemblyId);
    await db
      .delete(analyzeReviewAssemblyInputs)
      .where(
        and(
          eq(analyzeReviewAssemblyInputs.projectId, projectId),
          eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId),
          eq(analyzeReviewAssemblyInputs.proposalId, proposalId)
        )
      );
    await refreshRenderedMarkdown(projectId, assemblyId);

    return getMappedAssembly(projectId, run, assemblyId);
  }

  async function createClaim(
    _projectId: string,
    _runId: string,
    _assemblyId: string,
    _input: AnalyzeReviewCreateClaimRequest
  ): Promise<AnalyzeReviewClaimDto> {
    throw new Error("Not implemented");
  }

  async function patchClaim(
    _projectId: string,
    _runId: string,
    _assemblyId: string,
    _claimId: string,
    _input: AnalyzeReviewUpdateClaimRequest
  ): Promise<AnalyzeReviewClaimDto> {
    throw new Error("Not implemented");
  }

  async function attachEvidence(
    _projectId: string,
    _runId: string,
    _assemblyId: string,
    _claimId: string,
    _input: AnalyzeReviewAttachEvidenceRequest
  ): Promise<AnalyzeReviewEvidenceDto> {
    throw new Error("Not implemented");
  }

  async function removeEvidence(
    _projectId: string,
    _runId: string,
    _assemblyId: string,
    _claimId: string,
    _evidenceId: string
  ): Promise<AnalyzeReviewClaimDto> {
    throw new Error("Not implemented");
  }

  async function acceptAssemblies(
    _projectId: string,
    _runId: string,
    _input: AnalyzeReviewAcceptRequest
  ): Promise<AnalyzeReviewAcceptResponse> {
    throw new Error("Not implemented");
  }

  async function ensureInitialAssemblies(projectId: string, run: AnalyzeRunRow): Promise<void> {
    const [existing] = await db
      .select({ id: analyzeReviewAssemblies.id })
      .from(analyzeReviewAssemblies)
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          eq(analyzeReviewAssemblies.analyzeRunId, run.id)
        )
      )
      .limit(1);

    if (existing) {
      return;
    }

    const proposalRows = await getRunProposalRows(projectId, run, readProposalIds(run.proposalIdsJson));
    for (const proposal of proposalRows) {
      const metadata = metadataForProposal(proposal);
      await createDraftAssembly(projectId, run.id, {
        ...metadata,
        proposals: [proposal]
      });
    }
  }

  async function createDraftAssembly(
    projectId: string,
    runId: string,
    input: ProposalMetadata & { proposals: ProposalRow[] }
  ): Promise<AssemblyRow> {
    const now = new Date();
    const [assembly] = await db
      .insert(analyzeReviewAssemblies)
      .values({
        projectId,
        analyzeRunId: runId,
        status: "draft",
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        summary: input.summary,
        filePath: input.filePath,
        updatedAt: now
      })
      .returning();

    if (!assembly) {
      throw new Error("Failed to create analyze review assembly");
    }

    for (const [index, proposal] of input.proposals.entries()) {
      await db.insert(analyzeReviewAssemblyInputs).values({
        projectId,
        assemblyId: assembly.id,
        proposalId: proposal.id,
        role: index === 0 ? "primary" : "supporting"
      });
    }

    const initialClaims = input.proposals.flatMap((proposal) => initialClaimsForProposal(proposal));
    for (const [sortOrder, claim] of initialClaims.entries()) {
      const [claimRow] = await db
        .insert(analyzeReviewClaims)
        .values({
          projectId,
          assemblyId: assembly.id,
          text: claim.text,
          kind: claim.kind,
          confidence: claim.confidence,
          sortOrder
        })
        .returning();

      if (!claimRow || claim.evidence.length === 0) {
        continue;
      }

      await db.insert(analyzeReviewClaimEvidence).values(
        claim.evidence.map((evidence) => ({
          projectId,
          claimId: claimRow.id,
          proposalId: evidence.proposalId,
          sourceFilePath: evidence.sourceFilePath,
          symbolName: evidence.symbolName,
          startLine: evidence.startLine,
          endLine: evidence.endLine,
          provenance: evidence.provenance,
          confidence: evidence.confidence
        }))
      );
    }

    await refreshRenderedMarkdown(projectId, assembly.id);
    return assembly;
  }

  async function getAnalyzeRunRow(projectId: string, runId: string): Promise<AnalyzeRunRow> {
    const [row] = await db
      .select()
      .from(analyzeRuns)
      .where(and(eq(analyzeRuns.projectId, projectId), eq(analyzeRuns.id, runId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError("Analyze run not found", { projectId, runId });
    }

    return row;
  }

  async function getAssemblyRow(
    projectId: string,
    runId: string,
    assemblyId: string
  ): Promise<AssemblyRow> {
    const [row] = await db
      .select()
      .from(analyzeReviewAssemblies)
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          eq(analyzeReviewAssemblies.analyzeRunId, runId),
          eq(analyzeReviewAssemblies.id, assemblyId)
        )
      )
      .limit(1);

    if (!row) {
      throw new NotFoundError("Analyze review assembly not found", {
        projectId,
        runId,
        assemblyId
      });
    }

    return row;
  }

  async function getRunProposalRows(
    projectId: string,
    run: AnalyzeRunRow,
    proposalIds: string[]
  ): Promise<ProposalRow[]> {
    const uniqueProposalIds = [...new Set(proposalIds)];
    const runProposalIds = readProposalIds(run.proposalIdsJson);
    const disallowedProposalId = uniqueProposalIds.find((proposalId) => !runProposalIds.includes(proposalId));
    if (disallowedProposalId) {
      throw new BadRequestError("Proposal does not belong to analyze run", {
        projectId,
        runId: run.id,
        proposalId: disallowedProposalId
      });
    }

    if (uniqueProposalIds.length === 0) {
      return [];
    }

    const rows = await db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.projectId, projectId), inArray(aiProposals.id, uniqueProposalIds)));
    const rowById = new Map(rows.map((row) => [row.id, row]));

    return uniqueProposalIds.map((proposalId) => {
      const row = rowById.get(proposalId);
      if (!row) {
        throw new NotFoundError("Proposal not found", { projectId, proposalId });
      }
      return row;
    });
  }

  async function assertNoActiveAssignment(
    projectId: string,
    assemblyId: string,
    proposalId: string
  ): Promise<void> {
    const rows = await db
      .select()
      .from(analyzeReviewAssemblyInputs)
      .where(
        and(
          eq(analyzeReviewAssemblyInputs.projectId, projectId),
          eq(analyzeReviewAssemblyInputs.proposalId, proposalId)
        )
      );
    const blockingRows = rows.filter(
      (row) => row.role !== "evidence_only" && row.assemblyId !== assemblyId
    );
    if (blockingRows.length === 0) {
      return;
    }

    const activeAssemblies = await db
      .select({ id: analyzeReviewAssemblies.id })
      .from(analyzeReviewAssemblies)
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          inArray(
            analyzeReviewAssemblies.id,
            blockingRows.map((row) => row.assemblyId)
          ),
          inArray(analyzeReviewAssemblies.status, ["draft", "accepted"])
        )
      );

    if (activeAssemblies.length > 0) {
      throw new ConflictError("Proposal is already assigned to an active assembly", {
        proposalId,
        assemblyIds: activeAssemblies.map((row) => row.id)
      });
    }
  }

  async function listReviewAssembliesWithoutDeriving(
    projectId: string,
    run: AnalyzeRunRow
  ): Promise<AnalyzeReviewListResponse> {
    const runProposalIds = readProposalIds(run.proposalIdsJson);
    const proposals = await getRunProposalRows(projectId, run, runProposalIds);
    const assemblies = await db
      .select()
      .from(analyzeReviewAssemblies)
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          eq(analyzeReviewAssemblies.analyzeRunId, run.id)
        )
      )
      .orderBy(asc(analyzeReviewAssemblies.createdAt), asc(analyzeReviewAssemblies.id));
    const assemblyIds = assemblies.map((assembly) => assembly.id);
    const inputs = assemblyIds.length
      ? await db
          .select()
          .from(analyzeReviewAssemblyInputs)
          .where(
            and(
              eq(analyzeReviewAssemblyInputs.projectId, projectId),
              inArray(analyzeReviewAssemblyInputs.assemblyId, assemblyIds)
            )
          )
      : [];
    const claims = assemblyIds.length
      ? await db
          .select()
          .from(analyzeReviewClaims)
          .where(
            and(eq(analyzeReviewClaims.projectId, projectId), inArray(analyzeReviewClaims.assemblyId, assemblyIds))
          )
          .orderBy(asc(analyzeReviewClaims.sortOrder), asc(analyzeReviewClaims.createdAt))
      : [];
    const claimIds = claims.map((claim) => claim.id);
    const evidence = claimIds.length
      ? await db
          .select()
          .from(analyzeReviewClaimEvidence)
          .where(
            and(
              eq(analyzeReviewClaimEvidence.projectId, projectId),
              inArray(analyzeReviewClaimEvidence.claimId, claimIds)
            )
          )
          .orderBy(asc(analyzeReviewClaimEvidence.createdAt), asc(analyzeReviewClaimEvidence.id))
      : [];
    const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    const assemblyById = new Map(assemblies.map((assembly) => [assembly.id, assembly]));
    const assignedProposalIds = new Set(
      inputs
        .filter(
          (input) =>
            input.role !== "evidence_only" &&
            assemblyById.get(input.assemblyId)?.status !== "discarded"
        )
        .map((input) => input.proposalId)
    );
    const discardedProposalIds = new Set(
      inputs
        .filter((input) => assemblyById.get(input.assemblyId)?.status === "discarded")
        .map((input) => input.proposalId)
    );
    const mappedAssemblies = assemblies.map((assembly) =>
      mapAssembly(assembly, {
        inputs: inputs.filter((input) => input.assemblyId === assembly.id),
        claims: claims.filter((claim) => claim.assemblyId === assembly.id),
        evidence,
        proposalById
      })
    );
    const unassignedInputs = proposals
      .filter((proposal) => !assignedProposalIds.has(proposal.id))
      .map((proposal) => mapProposalInput(proposal, "unassigned"));

    return {
      assemblies: mappedAssemblies,
      unassignedInputs,
      counts: {
        assemblies: {
          draft: mappedAssemblies.filter((assembly) => assembly.status === "draft").length,
          accepted: mappedAssemblies.filter((assembly) => assembly.status === "accepted").length,
          discarded: mappedAssemblies.filter((assembly) => assembly.status === "discarded").length
        },
        inputs: {
          assigned: assignedProposalIds.size,
          unassigned: unassignedInputs.length,
          discarded: discardedProposalIds.size
        },
        validation: {
          blocker: mappedAssemblies.filter((assembly) => assembly.validation.state === "blocker").length,
          warning: mappedAssemblies.filter((assembly) => assembly.validation.state === "warning").length,
          ready: mappedAssemblies.filter((assembly) => assembly.validation.state === "ready").length
        }
      }
    };
  }

  async function getMappedAssembly(
    projectId: string,
    run: AnalyzeRunRow,
    assemblyId: string
  ): Promise<AnalyzeReviewAssemblyDto> {
    const response = await listReviewAssembliesWithoutDeriving(projectId, run);
    const assembly = response.assemblies.find((item) => item.id === assemblyId);
    if (!assembly) {
      throw new NotFoundError("Analyze review assembly not found", {
        projectId,
        runId: run.id,
        assemblyId
      });
    }

    return assembly;
  }

  async function refreshRenderedMarkdown(projectId: string, assemblyId: string): Promise<void> {
    const [assembly] = await db
      .select()
      .from(analyzeReviewAssemblies)
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          eq(analyzeReviewAssemblies.id, assemblyId)
        )
      )
      .limit(1);
    if (!assembly) {
      return;
    }

    const claims = await db
      .select()
      .from(analyzeReviewClaims)
      .where(and(eq(analyzeReviewClaims.projectId, projectId), eq(analyzeReviewClaims.assemblyId, assemblyId)))
      .orderBy(asc(analyzeReviewClaims.sortOrder), asc(analyzeReviewClaims.createdAt));
    const claimIds = claims.map((claim) => claim.id);
    const evidence = claimIds.length
      ? await db
          .select()
          .from(analyzeReviewClaimEvidence)
          .where(
            and(
              eq(analyzeReviewClaimEvidence.projectId, projectId),
              inArray(analyzeReviewClaimEvidence.claimId, claimIds)
            )
          )
      : [];
    const inputs = await db
      .select()
      .from(analyzeReviewAssemblyInputs)
      .where(
        and(
          eq(analyzeReviewAssemblyInputs.projectId, projectId),
          eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId)
        )
      );
    const proposalRows = inputs.length
      ? await db
          .select()
          .from(aiProposals)
          .where(
            and(
              eq(aiProposals.projectId, projectId),
              inArray(
                aiProposals.id,
                inputs.map((input) => input.proposalId)
              )
            )
          )
      : [];
    const proposedLinks = proposalRows.flatMap((proposal) => metadataForProposal(proposal).proposedLinks);
    const renderedMarkdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: assembly.entityId,
      entityType: assembly.entityType as AnalyzeReviewEntityType,
      title: assembly.title,
      summary: assembly.summary,
      claims: claims.map((claim) => ({
        text: claim.text,
        kind: claim.kind as "fact" | "hypothesis",
        evidence: evidence.filter((item) => item.claimId === claim.id).map(mapRenderEvidence)
      })),
      proposedLinks
    });

    await db
      .update(analyzeReviewAssemblies)
      .set({ renderedMarkdown, updatedAt: new Date() })
      .where(
        and(
          eq(analyzeReviewAssemblies.projectId, projectId),
          eq(analyzeReviewAssemblies.id, assemblyId)
        )
      );
  }

  return {
    listReviewAssemblies,
    createAssembly,
    patchAssembly,
    attachInput,
    removeInput,
    createClaim,
    patchClaim,
    attachEvidence,
    removeEvidence,
    acceptAssemblies
  };
}

function mapAssembly(
  assembly: AssemblyRow,
  context: {
    inputs: AssemblyInputRow[];
    claims: ClaimRow[];
    evidence: ClaimEvidenceRow[];
    proposalById: Map<string, ProposalRow>;
  }
): AnalyzeReviewAssemblyDto {
  const claims = context.claims.map((claim) => mapClaim(claim, context.evidence));

  return {
    id: assembly.id,
    projectId: assembly.projectId,
    analyzeRunId: assembly.analyzeRunId,
    status: assembly.status as AnalyzeReviewAssemblyDto["status"],
    entityType: assembly.entityType as AnalyzeReviewEntityType,
    entityId: assembly.entityId,
    title: assembly.title,
    summary: assembly.summary,
    filePath: assembly.filePath,
    renderedMarkdown: assembly.renderedMarkdown,
    inputs: context.inputs.flatMap((input) => {
      const proposal = context.proposalById.get(input.proposalId);
      if (!proposal) {
        return [];
      }
      return [
        mapProposalInput(
          proposal,
          assembly.status === "discarded" ? "discarded" : "assigned",
          input.role as AnalyzeReviewInputRole
        )
      ];
    }),
    claims,
    validation: validateClaims(claims),
    createdAt: assembly.createdAt.toISOString(),
    updatedAt: assembly.updatedAt.toISOString(),
    acceptedAt: assembly.acceptedAt?.toISOString() ?? null,
    discardedAt: assembly.discardedAt?.toISOString() ?? null
  };
}

function mapClaim(claim: ClaimRow, evidenceRows: ClaimEvidenceRow[]): AnalyzeReviewClaimDto {
  return {
    id: claim.id,
    text: claim.text,
    kind: claim.kind as AnalyzeReviewClaimDto["kind"],
    confidence: claim.confidence,
    sortOrder: claim.sortOrder,
    evidence: evidenceRows.filter((evidence) => evidence.claimId === claim.id).map(mapEvidence)
  };
}

function mapEvidence(row: ClaimEvidenceRow): AnalyzeReviewEvidenceDto {
  return {
    id: row.id,
    proposalId: row.proposalId,
    sourceFilePath: row.sourceFilePath,
    symbolName: row.symbolName,
    startLine: row.startLine,
    endLine: row.endLine,
    provenance: row.provenance as AnalyzeReviewEvidenceDto["provenance"],
    confidence: row.confidence
  };
}

function mapRenderEvidence(row: ClaimEvidenceRow) {
  return {
    sourceFilePath: row.sourceFilePath,
    symbolName: row.symbolName,
    startLine: row.startLine,
    endLine: row.endLine
  };
}

function mapProposalInput(
  proposal: ProposalRow,
  assignmentState: AnalyzeReviewInputDto["assignmentState"],
  role?: AnalyzeReviewInputRole
): AnalyzeReviewInputDto {
  const metadata = metadataForProposal(proposal);
  const input: AnalyzeReviewInputDto = {
    proposalId: proposal.id,
    proposalType: proposal.proposalType as ProposalType,
    title: metadata.title,
    entityType: metadata.entityType,
    entityId: metadata.entityId,
    filePath: metadata.filePath,
    confidence: proposal.confidence,
    assignmentState,
    evidenceCount: evidenceCountForProposal(proposal)
  };

  if (role !== undefined) {
    input.role = role;
  }

  return input;
}

function metadataForProposal(proposal: ProposalRow): ProposalMetadata {
  const payload = parseProposalPayload(proposal);
  const summary =
    typeof proposal.payloadJson === "object" &&
    proposal.payloadJson !== null &&
    "summary" in proposal.payloadJson &&
    typeof proposal.payloadJson.summary === "string"
      ? proposal.payloadJson.summary
      : "";

  return {
    entityType: payload.type,
    entityId: payload.entityId,
    filePath: payload.filePath,
    title: payload.title || proposal.title,
    summary,
    proposedLinks:
      "proposedLinks" in payload
        ? payload.proposedLinks.map((link) => ({
            linkType: link.linkType,
            targetEntityId: link.targetEntityId,
            rationale: link.rationale
          }))
        : []
  };
}

function initialClaimsForProposal(proposal: ProposalRow): InitialClaim[] {
  const evidence = evidenceForProposal(proposal);
  if (evidence.length === 0) {
    return [
      {
        text: proposal.title,
        kind: "hypothesis",
        confidence: proposal.confidence,
        evidence: []
      }
    ];
  }

  const aiEvidence = parseAiEvidence(proposal);
  const firstAiClaim = aiEvidence?.claims[0];

  return [
    {
      text: firstAiClaim?.text ?? proposal.title,
      kind: "fact",
      confidence: proposal.confidence,
      evidence
    }
  ];
}

function evidenceForProposal(proposal: ProposalRow): Array<Omit<AnalyzeReviewEvidenceDto, "id">> {
  const sourceEvidence = parseSourceEvidence(proposal);
  if (sourceEvidence) {
    return sourceEvidence.sourceFiles.map((sourceFile) => ({
      proposalId: proposal.id,
      sourceFilePath: sourceFile.file,
      symbolName: sourceFile.symbolName,
      startLine: sourceFile.line,
      endLine: sourceFile.line,
      provenance: "scanner",
      confidence: proposal.confidence
    }));
  }

  const aiEvidence = parseAiEvidence(proposal);
  if (aiEvidence) {
    return aiEvidence.selectedSourceFiles.map((sourceFile) => ({
      proposalId: proposal.id,
      sourceFilePath: sourceFile.file,
      symbolName: null,
      startLine: sourceFile.excerptStartLine,
      endLine: sourceFile.excerptEndLine,
      provenance: "ai",
      confidence: proposal.confidence
    }));
  }

  return [];
}

function evidenceCountForProposal(proposal: ProposalRow): number {
  return evidenceForProposal(proposal).length;
}

function validateClaims(claims: AnalyzeReviewClaimDto[]) {
  const messages: AnalyzeReviewValidationMessage[] = [];

  for (const claim of claims) {
    if (claim.kind === "fact" && claim.evidence.length === 0) {
      messages.push({
        severity: "blocker",
        code: "fact_missing_evidence",
        message: "Fact claims require evidence.",
        field: "claims"
      });
    }
    if (claim.kind === "hypothesis") {
      messages.push({
        severity: "warning",
        code: "hypothesis_requires_review",
        message: "Hypothesis claims require reviewer confirmation.",
        field: "claims"
      });
    }
  }

  return {
    state: messages.some((message) => message.severity === "blocker")
      ? "blocker"
      : messages.some((message) => message.severity === "warning")
        ? "warning"
        : "ready",
    messages
  } as const;
}

function parseProposalPayload(
  proposal: ProposalRow
): SourceSpecEntityProposalPayload | AiSpecEntityProposalPayload {
  if (proposal.proposalType === "source_spec_entity") {
    const parsed = sourceSpecEntityProposalPayloadSchema.safeParse(proposal.payloadJson);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const parsed = aiSpecEntityProposalPayloadSchema.safeParse(proposal.payloadJson);
  if (parsed.success) {
    return parsed.data;
  }

  throw new BadRequestError("Proposal payload is not parseable", { proposalId: proposal.id });
}

function parseSourceEvidence(proposal: ProposalRow): SourceSpecEntityProposalEvidence | null {
  const parsed = sourceSpecEntityProposalEvidenceSchema.safeParse(proposal.evidenceJson);
  return parsed.success ? parsed.data : null;
}

function parseAiEvidence(proposal: ProposalRow): AiSpecEntityProposalEvidence | null {
  const parsed = aiSpecEntityProposalEvidenceSchema.safeParse(proposal.evidenceJson);
  return parsed.success ? parsed.data : null;
}

function readProposalIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
