import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
  AnalyzeReviewValidationSummary,
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
import { parseSpecMarkdown } from "@specops/markdown";
import {
  aiProposals,
  analyzeReviewAssemblies,
  analyzeReviewAssemblyInputs,
  analyzeReviewClaimEvidence,
  analyzeReviewClaims,
  analyzeRuns
} from "@specops/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { renderAnalyzeReviewAssemblyMarkdown } from "./analyze-review-renderer.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";

type AnalyzeRunRow = typeof analyzeRuns.$inferSelect;
type AssemblyRow = typeof analyzeReviewAssemblies.$inferSelect;
type AssemblyInputRow = typeof analyzeReviewAssemblyInputs.$inferSelect;
type ClaimRow = typeof analyzeReviewClaims.$inferSelect;
type ClaimEvidenceRow = typeof analyzeReviewClaimEvidence.$inferSelect;
type ProposalRow = typeof aiProposals.$inferSelect;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryClient = Db | Transaction;

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

const DISCARDED_INPUT_ROLE = "discarded";

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

    const assembly = await db.transaction(async (tx) => {
      await lockAssignmentWrites(
        tx,
        projectId,
        proposalRows.map((proposal) => proposal.id)
      );
      for (const proposal of proposalRows) {
        await assertNoActiveAssignment(tx, projectId, null, proposal.id);
      }

      return createDraftAssembly(tx, projectId, runId, {
        entityType,
        entityId,
        filePath,
        title,
        summary: input.summary ?? firstMetadata?.summary ?? "",
        proposedLinks: firstMetadata?.proposedLinks ?? [],
        proposals: proposalRows
      });
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
    await refreshRenderedMarkdown(db, projectId, assemblyId);

    return getMappedAssembly(projectId, run, assemblyId);
  }

  async function attachInput(
    projectId: string,
    runId: string,
    assemblyId: string,
    input: AnalyzeReviewAttachInputRequest
  ): Promise<AnalyzeReviewAssemblyDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await getRunProposalRows(projectId, run, [input.proposalId]);

    await db.transaction(async (tx) => {
      await getAssemblyRow(projectId, runId, assemblyId, tx);
      await lockAssignmentWrites(tx, projectId, [input.proposalId]);

      if (input.role !== "evidence_only") {
        await assertNoActiveAssignment(tx, projectId, assemblyId, input.proposalId);
      }

      const [existingInput] = await tx
        .select()
        .from(analyzeReviewAssemblyInputs)
        .where(
          and(
            eq(analyzeReviewAssemblyInputs.projectId, projectId),
            eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId),
            eq(analyzeReviewAssemblyInputs.proposalId, input.proposalId)
          )
        )
        .limit(1);

      if (existingInput?.role === DISCARDED_INPUT_ROLE) {
        await tx
          .update(analyzeReviewAssemblyInputs)
          .set({ role: input.role })
          .where(
            and(
              eq(analyzeReviewAssemblyInputs.projectId, projectId),
              eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId),
              eq(analyzeReviewAssemblyInputs.proposalId, input.proposalId)
            )
          );
      } else {
        await tx.insert(analyzeReviewAssemblyInputs).values({
          projectId,
          assemblyId,
          proposalId: input.proposalId,
          role: input.role
        });
      }
      await refreshRenderedMarkdown(tx, projectId, assemblyId);
    });

    return getMappedAssembly(projectId, run, assemblyId);
  }

  async function removeInput(
    projectId: string,
    runId: string,
    assemblyId: string,
    proposalId: string
  ): Promise<AnalyzeReviewAssemblyDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await db.transaction(async (tx) => {
      await getAssemblyRow(projectId, runId, assemblyId, tx);
      await lockAssignmentWrites(tx, projectId, [proposalId]);
      const inputs = await tx
        .select()
        .from(analyzeReviewAssemblyInputs)
        .where(
          and(
            eq(analyzeReviewAssemblyInputs.projectId, projectId),
            eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId)
          )
        );
      const removedInput = inputs.find((input) => input.proposalId === proposalId);
      const shouldDiscardAssembly =
        removedInput?.role !== undefined &&
        isActiveInput(removedInput) &&
        inputs.filter(isActiveInput).length === 1;

      if (removedInput) {
        await tx
          .update(analyzeReviewAssemblyInputs)
          .set({ role: DISCARDED_INPUT_ROLE })
          .where(
            and(
              eq(analyzeReviewAssemblyInputs.projectId, projectId),
              eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId),
              eq(analyzeReviewAssemblyInputs.proposalId, proposalId)
            )
          );
      }

      if (shouldDiscardAssembly) {
        const now = new Date();
        await tx
          .update(analyzeReviewAssemblies)
          .set({
            status: "discarded",
            discardedAt: now,
            updatedAt: now
          })
          .where(
            and(
              eq(analyzeReviewAssemblies.projectId, projectId),
              eq(analyzeReviewAssemblies.analyzeRunId, runId),
              eq(analyzeReviewAssemblies.id, assemblyId)
            )
          );
      }

      await refreshRenderedMarkdown(tx, projectId, assemblyId);
    });

    return getMappedAssembly(projectId, run, assemblyId);
  }

  async function createClaim(
    projectId: string,
    runId: string,
    assemblyId: string,
    input: AnalyzeReviewCreateClaimRequest
  ): Promise<AnalyzeReviewClaimDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    const [claim] = await db.transaction(async (tx) => {
      await getAssemblyRow(projectId, runId, assemblyId, tx);
      const claims = await tx
        .select({ sortOrder: analyzeReviewClaims.sortOrder })
        .from(analyzeReviewClaims)
        .where(
          and(
            eq(analyzeReviewClaims.projectId, projectId),
            eq(analyzeReviewClaims.assemblyId, assemblyId)
          )
        );
      const nextSortOrder =
        claims.length === 0 ? 0 : Math.max(...claims.map((item) => item.sortOrder)) + 1;
      const inserted = await tx
        .insert(analyzeReviewClaims)
        .values({
          projectId,
          assemblyId,
          text: input.text,
          kind: input.kind,
          confidence: input.confidence,
          sortOrder: nextSortOrder
        })
        .returning();
      await refreshRenderedMarkdown(tx, projectId, assemblyId);
      return inserted;
    });

    if (!claim) {
      throw new Error("Failed to create analyze review claim");
    }

    return getMappedClaim(projectId, run, assemblyId, claim.id);
  }

  async function patchClaim(
    projectId: string,
    runId: string,
    assemblyId: string,
    claimId: string,
    input: AnalyzeReviewUpdateClaimRequest
  ): Promise<AnalyzeReviewClaimDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await db.transaction(async (tx) => {
      await getAssemblyRow(projectId, runId, assemblyId, tx);
      await getClaimRow(projectId, assemblyId, claimId, tx);
      const update: Partial<typeof analyzeReviewClaims.$inferInsert> = {
        updatedAt: new Date()
      };

      if (input.text !== undefined) {
        update.text = input.text;
      }
      if (input.kind !== undefined) {
        update.kind = input.kind;
      }
      if (input.confidence !== undefined) {
        update.confidence = input.confidence;
      }
      if (input.sortOrder !== undefined) {
        update.sortOrder = input.sortOrder;
      }

      await tx
        .update(analyzeReviewClaims)
        .set(update)
        .where(
          and(
            eq(analyzeReviewClaims.projectId, projectId),
            eq(analyzeReviewClaims.assemblyId, assemblyId),
            eq(analyzeReviewClaims.id, claimId)
          )
        );
      await refreshRenderedMarkdown(tx, projectId, assemblyId);
    });

    return getMappedClaim(projectId, run, assemblyId, claimId);
  }

  async function attachEvidence(
    projectId: string,
    runId: string,
    assemblyId: string,
    claimId: string,
    input: AnalyzeReviewAttachEvidenceRequest
  ): Promise<AnalyzeReviewEvidenceDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    const [evidence] = await db.transaction(async (tx) => {
      await getAssemblyRow(projectId, runId, assemblyId, tx);
      await getClaimRow(projectId, assemblyId, claimId, tx);
      await getRunProposalRows(projectId, run, [input.proposalId], tx);
      const inserted = await tx
        .insert(analyzeReviewClaimEvidence)
        .values({
          projectId,
          claimId,
          proposalId: input.proposalId,
          sourceFilePath: input.sourceFilePath,
          symbolName: input.symbolName,
          startLine: input.startLine,
          endLine: input.endLine,
          provenance: input.provenance,
          confidence: input.confidence
        })
        .returning();
      await refreshRenderedMarkdown(tx, projectId, assemblyId);
      return inserted;
    });

    if (!evidence) {
      throw new Error("Failed to attach analyze review evidence");
    }

    return mapEvidence(evidence);
  }

  async function removeEvidence(
    projectId: string,
    runId: string,
    assemblyId: string,
    claimId: string,
    evidenceId: string
  ): Promise<AnalyzeReviewClaimDto> {
    const run = await getAnalyzeRunRow(projectId, runId);
    await db.transaction(async (tx) => {
      await getAssemblyRow(projectId, runId, assemblyId, tx);
      await getClaimRow(projectId, assemblyId, claimId, tx);
      await getEvidenceRow(projectId, claimId, evidenceId, tx);
      await tx
        .delete(analyzeReviewClaimEvidence)
        .where(
          and(
            eq(analyzeReviewClaimEvidence.projectId, projectId),
            eq(analyzeReviewClaimEvidence.claimId, claimId),
            eq(analyzeReviewClaimEvidence.id, evidenceId)
          )
        );
      await refreshRenderedMarkdown(tx, projectId, assemblyId);
    });

    return getMappedClaim(projectId, run, assemblyId, claimId);
  }

  async function acceptAssemblies(
    projectId: string,
    runId: string,
    input: AnalyzeReviewAcceptRequest
  ): Promise<AnalyzeReviewAcceptResponse> {
    const run = await getAnalyzeRunRow(projectId, runId);
    const project = await createProjectService(db).getProject(projectId);
    const repoPath = assertAbsolutePath("repoPath", project.repoPath);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
    const acceptedAssemblyIds: string[] = [];
    const failures: AnalyzeReviewAcceptResponse["failures"] = [];

    assertInsideDirectory(repoPath, specopsPath);
    await assertRealPathInsideDirectory(repoPath, repoPath);
    await assertExistingParentInsideDirectory(repoPath, specopsPath);
    await mkdir(specopsPath, { recursive: true });
    const realSpecopsPath = await assertRealPathInsideDirectory(repoPath, specopsPath);

    const review = await listReviewAssembliesWithoutDeriving(projectId, run);
    const assemblyById = new Map(review.assemblies.map((assembly) => [assembly.id, assembly]));
    const selectedAssemblies = input.assemblyIds.map((assemblyId) => {
      const assembly = assemblyById.get(assemblyId);
      if (!assembly) {
        throw new NotFoundError("Analyze review assembly not found", {
          projectId,
          runId,
          assemblyId
        });
      }
      return assembly;
    });

    for (const assembly of selectedAssemblies) {
      if (assembly.status === "discarded") {
        failures.push({
          assemblyId: assembly.id,
          messages: [
            {
              severity: "blocker",
              code: "assembly_discarded",
              message: "Discarded assemblies cannot be accepted.",
              field: "status"
            }
          ]
        });
        continue;
      }

      const blockerMessages = assembly.validation.messages.filter(
        (message) => message.severity === "blocker"
      );
      if (blockerMessages.length > 0) {
        failures.push({ assemblyId: assembly.id, messages: blockerMessages });
        continue;
      }

      const proposedLinks = await getProposedLinksForAssembly(db, projectId, assembly.id);
      const renderedMarkdown = renderAnalyzeReviewAssemblyMarkdown({
        entityId: assembly.entityId,
        entityType: assembly.entityType,
        title: assembly.title,
        summary: assembly.summary,
        claims: assembly.claims.map((claim) => ({
          text: claim.text,
          kind: claim.kind,
          evidence: claim.evidence.map((evidence) => ({
            sourceFilePath: evidence.sourceFilePath,
            symbolName: evidence.symbolName,
            startLine: evidence.startLine,
            endLine: evidence.endLine
          }))
        })),
        proposedLinks
      });
      const parseMessages = validationMessagesForRenderedMarkdown(assembly, renderedMarkdown);
      if (parseMessages.length > 0) {
        failures.push({ assemblyId: assembly.id, messages: parseMessages });
        continue;
      }

      const targetPath = assertInsideDirectory(
        realSpecopsPath,
        path.join(realSpecopsPath, assembly.filePath)
      );
      const targetParent = path.dirname(targetPath);
      await assertExistingParentInsideDirectory(realSpecopsPath, targetParent);
      await mkdir(targetParent, { recursive: true });
      await assertRealPathInsideDirectory(realSpecopsPath, targetParent);
      if (await pathExists(targetPath)) {
        failures.push({
          assemblyId: assembly.id,
          messages: [
            {
              severity: "blocker",
              code: "target_file_exists",
              message: "Target markdown file already exists.",
              field: "filePath"
            }
          ]
        });
        continue;
      }

      await writeFile(targetPath, renderedMarkdown, "utf8");
      const now = new Date();
      await db
        .update(analyzeReviewAssemblies)
        .set({
          status: "accepted",
          acceptedAt: now,
          renderedMarkdown,
          updatedAt: now
        })
        .where(
          and(
            eq(analyzeReviewAssemblies.projectId, projectId),
            eq(analyzeReviewAssemblies.analyzeRunId, runId),
            eq(analyzeReviewAssemblies.id, assembly.id)
          )
        );

      const proposalIds = assembly.inputs
        .filter((item) => item.assignmentState === "assigned")
        .map((item) => item.proposalId);
      if (proposalIds.length > 0) {
        await db
          .update(aiProposals)
          .set({ status: "accepted", reviewedAt: now })
          .where(
            and(
              eq(aiProposals.projectId, projectId),
              inArray(aiProposals.id, proposalIds),
              eq(aiProposals.status, "pending")
            )
          );
      }
      acceptedAssemblyIds.push(assembly.id);
    }

    const indexRun =
      acceptedAssemblyIds.length > 0
        ? await createIndexerService(db).indexProject(projectId)
        : null;

    return { acceptedAssemblyIds, failures, indexRun };
  }

  async function ensureInitialAssemblies(projectId: string, run: AnalyzeRunRow): Promise<void> {
    await db.transaction(async (tx) => {
      const runProposalIds = readProposalIds(run.proposalIdsJson);
      await lockDerivation(tx, projectId, run.id);
      await lockAssignmentWrites(tx, projectId, runProposalIds);

      const assemblies = await tx
        .select({ id: analyzeReviewAssemblies.id })
        .from(analyzeReviewAssemblies)
        .where(
          and(
            eq(analyzeReviewAssemblies.projectId, projectId),
            eq(analyzeReviewAssemblies.analyzeRunId, run.id)
          )
        );
      const assemblyIds = assemblies.map((assembly) => assembly.id);
      const inputs = assemblyIds.length
        ? await tx
            .select()
            .from(analyzeReviewAssemblyInputs)
            .where(
              and(
                eq(analyzeReviewAssemblyInputs.projectId, projectId),
                inArray(analyzeReviewAssemblyInputs.assemblyId, assemblyIds)
              )
            )
        : [];
      const representedProposalIds = new Set(
        inputs
          .filter((input) => input.role !== "evidence_only")
          .map((input) => input.proposalId)
      );
      const missingProposalIds = runProposalIds.filter(
        (proposalId) => !representedProposalIds.has(proposalId)
      );

      if (missingProposalIds.length === 0) {
        return;
      }

      const proposalRows = await getRunProposalRows(projectId, run, missingProposalIds, tx);
      for (const proposal of proposalRows) {
        try {
          await assertNoActiveAssignment(tx, projectId, null, proposal.id);
        } catch (error) {
          if (error instanceof ConflictError) {
            continue;
          }
          throw error;
        }

        const metadata = metadataForProposal(proposal);
        await createDraftAssembly(tx, projectId, run.id, {
          ...metadata,
          proposals: [proposal]
        });
      }
    });
  }

  async function createDraftAssembly(
    client: QueryClient,
    projectId: string,
    runId: string,
    input: ProposalMetadata & { proposals: ProposalRow[] }
  ): Promise<AssemblyRow> {
    const now = new Date();
    const [assembly] = await client
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
      await client.insert(analyzeReviewAssemblyInputs).values({
        projectId,
        assemblyId: assembly.id,
        proposalId: proposal.id,
        role: index === 0 ? "primary" : "supporting"
      });
    }

    const initialClaims = input.proposals.flatMap((proposal) => initialClaimsForProposal(proposal));
    for (const [sortOrder, claim] of initialClaims.entries()) {
      const [claimRow] = await client
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

      await client.insert(analyzeReviewClaimEvidence).values(
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

    await refreshRenderedMarkdown(client, projectId, assembly.id);
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
    assemblyId: string,
    client: QueryClient = db
  ): Promise<AssemblyRow> {
    const [row] = await client
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

  async function getClaimRow(
    projectId: string,
    assemblyId: string,
    claimId: string,
    client: QueryClient = db
  ): Promise<ClaimRow> {
    const [row] = await client
      .select()
      .from(analyzeReviewClaims)
      .where(
        and(
          eq(analyzeReviewClaims.projectId, projectId),
          eq(analyzeReviewClaims.assemblyId, assemblyId),
          eq(analyzeReviewClaims.id, claimId)
        )
      )
      .limit(1);

    if (!row) {
      throw new NotFoundError("Analyze review claim not found", {
        projectId,
        assemblyId,
        claimId
      });
    }

    return row;
  }

  async function getEvidenceRow(
    projectId: string,
    claimId: string,
    evidenceId: string,
    client: QueryClient = db
  ): Promise<ClaimEvidenceRow> {
    const [row] = await client
      .select()
      .from(analyzeReviewClaimEvidence)
      .where(
        and(
          eq(analyzeReviewClaimEvidence.projectId, projectId),
          eq(analyzeReviewClaimEvidence.claimId, claimId),
          eq(analyzeReviewClaimEvidence.id, evidenceId)
        )
      )
      .limit(1);

    if (!row) {
      throw new NotFoundError("Analyze review evidence not found", {
        projectId,
        claimId,
        evidenceId
      });
    }

    return row;
  }

  async function getRunProposalRows(
    projectId: string,
    run: AnalyzeRunRow,
    proposalIds: string[],
    client: QueryClient = db
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

    const rows = await client
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
    client: QueryClient,
    projectId: string,
    assemblyId: string | null,
    proposalId: string
  ): Promise<void> {
    const rows = await client
      .select()
      .from(analyzeReviewAssemblyInputs)
      .where(
        and(
          eq(analyzeReviewAssemblyInputs.projectId, projectId),
          eq(analyzeReviewAssemblyInputs.proposalId, proposalId)
        )
    );
    const blockingRows = rows.filter(
      (row) => isActiveInput(row) && (assemblyId === null || row.assemblyId !== assemblyId)
    );
    if (blockingRows.length === 0) {
      return;
    }

    const activeAssemblies = await client
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
            isActiveInput(input) &&
            assemblyById.get(input.assemblyId)?.status !== "discarded"
        )
        .map((input) => input.proposalId)
    );
    const discardedProposalIds = new Set(
      inputs
        .filter(
          (input) =>
            input.role === DISCARDED_INPUT_ROLE ||
            assemblyById.get(input.assemblyId)?.status === "discarded"
        )
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

  async function getMappedClaim(
    projectId: string,
    run: AnalyzeRunRow,
    assemblyId: string,
    claimId: string
  ): Promise<AnalyzeReviewClaimDto> {
    const assembly = await getMappedAssembly(projectId, run, assemblyId);
    const claim = assembly.claims.find((item) => item.id === claimId);
    if (!claim) {
      throw new NotFoundError("Analyze review claim not found", {
        projectId,
        runId: run.id,
        assemblyId,
        claimId
      });
    }

    return claim;
  }

  async function getProposedLinksForAssembly(
    client: QueryClient,
    projectId: string,
    assemblyId: string
  ): Promise<ProposalMetadata["proposedLinks"]> {
    const inputs = await client
      .select()
      .from(analyzeReviewAssemblyInputs)
      .where(
        and(
          eq(analyzeReviewAssemblyInputs.projectId, projectId),
          eq(analyzeReviewAssemblyInputs.assemblyId, assemblyId)
        )
      );
    const proposalRows = inputs.length
      ? await client
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

    return proposalRows.flatMap((proposal) => metadataForProposal(proposal).proposedLinks);
  }

  async function refreshRenderedMarkdown(
    client: QueryClient,
    projectId: string,
    assemblyId: string
  ): Promise<void> {
    const [assembly] = await client
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

    const claims = await client
      .select()
      .from(analyzeReviewClaims)
      .where(and(eq(analyzeReviewClaims.projectId, projectId), eq(analyzeReviewClaims.assemblyId, assemblyId)))
      .orderBy(asc(analyzeReviewClaims.sortOrder), asc(analyzeReviewClaims.createdAt));
    const claimIds = claims.map((claim) => claim.id);
    const evidence = claimIds.length
      ? await client
          .select()
          .from(analyzeReviewClaimEvidence)
          .where(
            and(
              eq(analyzeReviewClaimEvidence.projectId, projectId),
              inArray(analyzeReviewClaimEvidence.claimId, claimIds)
            )
          )
      : [];
    const proposedLinks = await getProposedLinksForAssembly(client, projectId, assemblyId);
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

    await client
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
      const isDiscarded = assembly.status === "discarded" || input.role === DISCARDED_INPUT_ROLE;
      return [
        mapProposalInput(
          proposal,
          isDiscarded ? "discarded" : "assigned",
          isDiscarded ? undefined : (input.role as AnalyzeReviewInputRole)
        )
      ];
    }),
    claims,
    validation: validateAssembly(assembly, claims),
    createdAt: assembly.createdAt.toISOString(),
    updatedAt: assembly.updatedAt.toISOString(),
    acceptedAt: assembly.acceptedAt?.toISOString() ?? null,
    discardedAt: assembly.discardedAt?.toISOString() ?? null
  };
}

function isActiveInput(input: Pick<AssemblyInputRow, "role">): boolean {
  return input.role !== "evidence_only" && input.role !== DISCARDED_INPUT_ROLE;
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
  const aiEvidence = parseAiEvidence(proposal);
  const firstAiClaim = aiEvidence?.claims[0];

  if (aiEvidence && !firstAiClaim) {
    return [
      {
        text: proposal.title,
        kind: "hypothesis",
        confidence: proposal.confidence,
        evidence: []
      }
    ];
  }

  const evidence = evidenceForProposal(
    proposal,
    firstAiClaim ? new Set(firstAiClaim.sourceFiles) : undefined
  );

  if (evidence.length === 0 && !firstAiClaim) {
    return [
      {
        text: proposal.title,
        kind: "hypothesis",
        confidence: proposal.confidence,
        evidence: []
      }
    ];
  }

  return [
    {
      text: firstAiClaim?.text ?? proposal.title,
      kind: "fact",
      confidence: proposal.confidence,
      evidence
    }
  ];
}

function evidenceForProposal(
  proposal: ProposalRow,
  aiSourceFileFilter?: Set<string>
): Array<Omit<AnalyzeReviewEvidenceDto, "id">> {
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
    return aiEvidence.selectedSourceFiles
      .filter((sourceFile) => !aiSourceFileFilter || aiSourceFileFilter.has(sourceFile.file))
      .map((sourceFile) => ({
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

function validateAssembly(
  assembly: Pick<AssemblyRow, "title" | "entityId" | "entityType" | "filePath">,
  claims: AnalyzeReviewClaimDto[]
): AnalyzeReviewValidationSummary {
  const messages: AnalyzeReviewValidationMessage[] = [];
  const requiredFields = [
    ["title", assembly.title],
    ["entityId", assembly.entityId],
    ["entityType", assembly.entityType],
    ["filePath", assembly.filePath]
  ] as const;

  for (const [field, value] of requiredFields) {
    if (value.trim().length === 0) {
      messages.push({
        severity: "blocker",
        code: `${field}_missing`,
        message: `${field} is required.`,
        field
      });
    }
  }

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
  };
}

function validationMessagesForRenderedMarkdown(
  assembly: AnalyzeReviewAssemblyDto,
  markdown: string
): AnalyzeReviewValidationMessage[] {
  const parsed = parseSpecMarkdown(assembly.filePath, markdown);
  const messages: AnalyzeReviewValidationMessage[] = parsed.messages
    .filter((message) => message.level === "error")
    .map((message) => ({
      severity: "blocker",
      code: message.code,
      message: message.message,
      field: "renderedMarkdown"
    }));

  if (!parsed.entity) {
    return messages.length > 0
      ? messages
      : [
          {
            severity: "blocker",
            code: "invalid_markdown",
            message: "Rendered markdown did not produce a spec entity.",
            field: "renderedMarkdown"
          }
        ];
  }

  if (parsed.entity.entityId !== assembly.entityId) {
    messages.push({
      severity: "blocker",
      code: "entity_id_mismatch",
      message: "Rendered markdown entity id does not match the assembly.",
      field: "entityId"
    });
  }
  if (parsed.entity.type !== assembly.entityType) {
    messages.push({
      severity: "blocker",
      code: "entity_type_mismatch",
      message: "Rendered markdown entity type does not match the assembly.",
      field: "entityType"
    });
  }

  return messages;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
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

async function lockDerivation(
  client: QueryClient,
  projectId: string,
  runId: string
): Promise<void> {
  await client.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:analyze_review_derivation:${runId}`}, 0))`
  );
}

async function lockAssignmentWrites(
  client: QueryClient,
  projectId: string,
  proposalIds: string[]
): Promise<void> {
  const uniqueProposalIds = [...new Set(proposalIds)].sort();
  for (const proposalId of uniqueProposalIds) {
    await client.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:analyze_review_assignment:${proposalId}`}, 0))`
    );
  }
}

function readProposalIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
