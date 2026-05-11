import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AcceptProposalsResponse,
  AcceptProposalsRequest,
  AiSpecEntityProposalEvidence,
  AiSpecEntityProposalPayload,
  ProposalDetailDto,
  ProposalPatchRequest,
  ProposalStatus,
  ProposalSummaryDto,
  ProposalType,
  SourceSpecEntityProposalEvidence,
  SourceSpecEntityProposalPayload
} from "@specops/contracts";
import type { ProjectDto } from "@specops/contracts";
import {
  aiSpecEntityProposalEvidenceSchema,
  aiSpecEntityProposalPayloadSchema,
  proposalPatchRequestSchema,
  proposalTypeSchema,
  sourceSpecEntityProposalEvidenceSchema,
  sourceSpecEntityProposalPayloadSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { aiProposals, specEntities } from "@specops/db";
import { discoverMarkdownFiles, parseSpecMarkdown } from "@specops/markdown";
import { scanRepository } from "@specops/repo-scanner";
import { generateBootstrapSpecProposals } from "@specops/source-bootstrap";
import { and, asc, eq, inArray } from "drizzle-orm";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";

type ProposalRow = typeof aiProposals.$inferSelect;
type ProposalServiceOptions = {
  acceptTestHooks?: {
    afterIndex?: (context: {
      projectId: string;
      proposalIds: string[];
      indexRun: AcceptProposalsResponse["indexRun"];
    }) => Promise<void>;
    beforeStatusUpdate?: (context: {
      projectId: string;
      proposalIds: string[];
    }) => Promise<void>;
  };
};

const sourceSpecEntityProposalType = "source_spec_entity";

type ProposalListFilters = {
  status?: ProposalStatus;
  proposalType?: ProposalType;
};

type SpecEntityProposalPayload =
  | SourceSpecEntityProposalPayload
  | AiSpecEntityProposalPayload;

export function createProposalService(db: Db, options: ProposalServiceOptions = {}) {
  const projectService = createProjectService(db);

  async function generateSourceImportProposals(projectId: string): Promise<ProposalSummaryDto[]> {
    const project = await projectService.getProject(projectId);
    const repoPath = assertAbsolutePath("repoPath", project.repoPath);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);

    assertInsideDirectory(repoPath, specopsPath);
    await assertRealPathInsideDirectory(repoPath, repoPath);
    await assertExistingParentInsideDirectory(repoPath, specopsPath);

    const scan = await scanRepository({ repoPath });
    const obsoletePendingProposals = async () => {
      await db
        .update(aiProposals)
        .set({ status: "obsolete", reviewedAt: new Date() })
        .where(
          and(
            eq(aiProposals.projectId, projectId),
            eq(aiProposals.proposalType, sourceSpecEntityProposalType),
            eq(aiProposals.status, "pending")
          )
        );
    };

    if (scan.files.length === 0) {
      await obsoletePendingProposals();
      throw new BadRequestError("No supported source files found");
    }

    const generated = generateBootstrapSpecProposals(scan);
    if (generated.length === 0) {
      await obsoletePendingProposals();
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

    return mapSummaries(rows, project);
  }

  async function listProposals(
    projectId: string,
    filters: ProposalListFilters = {}
  ): Promise<ProposalSummaryDto[]> {
    const project = await projectService.getProject(projectId);
    const proposalType = filters.proposalType ?? sourceSpecEntityProposalType;
    const conditions = [
      eq(aiProposals.projectId, projectId),
      eq(aiProposals.proposalType, proposalType)
    ];

    if (filters.status) {
      conditions.push(eq(aiProposals.status, filters.status));
    }

    const rows = await db
      .select()
      .from(aiProposals)
      .where(and(...conditions))
      .orderBy(asc(aiProposals.createdAt), asc(aiProposals.title), asc(aiProposals.id));

    return mapSummaries(rows, project);
  }

  async function getProposal(projectId: string, proposalId: string): Promise<ProposalDetailDto> {
    const project = await projectService.getProject(projectId);
    const row = await getProposalRow(projectId, proposalId);
    return mapDetail(row, await conflictForPayload(project, parsePayload(row)));
  }

  async function patchProposal(
    projectId: string,
    proposalId: string,
    input: ProposalPatchRequest
  ): Promise<ProposalDetailDto> {
    const project = await projectService.getProject(projectId);
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
      .where(
        and(
          eq(aiProposals.projectId, projectId),
          eq(aiProposals.id, proposalId),
          eq(aiProposals.status, "pending")
        )
      )
      .returning();

    if (!updated) {
      throw new ConflictError("Only pending proposals can be edited or rejected", {
        proposalId,
        status: "changed"
      });
    }

    return mapDetail(updated, await conflictForPayload(project, updatedPayload));
  }

  async function acceptProposals(
    projectId: string,
    input: AcceptProposalsRequest
  ): Promise<AcceptProposalsResponse> {
    const project = await projectService.getProject(projectId);
    const repoPath = assertAbsolutePath("repoPath", project.repoPath);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
    const writtenPaths: string[] = [];
    const indexerService = createIndexerService(db);
    let indexCompleted = false;

    assertInsideDirectory(repoPath, specopsPath);
    await assertRealPathInsideDirectory(repoPath, repoPath);
    await assertExistingParentInsideDirectory(repoPath, specopsPath);
    await mkdir(specopsPath, { recursive: true });
    const realSpecopsPath = await assertRealPathInsideDirectory(repoPath, specopsPath);

    const uniqueProposalIds = [...new Set(input.proposalIds)];
    const rows = await db
      .select()
      .from(aiProposals)
      .where(
        and(
          eq(aiProposals.projectId, projectId),
          inArray(aiProposals.id, uniqueProposalIds)
        )
      );
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const selectedRows = input.proposalIds.map((proposalId) => {
      const row = rowById.get(proposalId);
      if (!row) {
        throw new NotFoundError("Proposal not found", { projectId, proposalId });
      }
      return row;
    });

    const selected = await Promise.all(
      selectedRows.map(async (row) => {
        if (row.status !== "pending") {
          throw new ConflictError("Only pending proposals can be accepted", {
            proposalId: row.id,
            status: row.status
          });
        }

        const payload = parsePayload(row);
        const parsed = parseSpecMarkdown(payload.filePath, payload.markdown);
        const errorMessages = parsed.messages.filter((message) => message.level === "error");
        if (errorMessages.length > 0 || !parsed.entity) {
          throw new BadRequestError("Invalid proposal markdown", {
            proposalId: row.id,
            messages: parsed.messages
          });
        }

        if (parsed.entity.entityId !== payload.entityId) {
          throw new BadRequestError("Proposal markdown entity id mismatch", {
            proposalId: row.id,
            expectedEntityId: payload.entityId,
            receivedEntityId: parsed.entity.entityId
          });
        }

        if (parsed.entity.type !== payload.type) {
          throw new BadRequestError("Proposal markdown entity type mismatch", {
            proposalId: row.id,
            expectedEntityType: payload.type,
            receivedEntityType: parsed.entity.type
          });
        }

        const targetPath = assertInsideDirectory(
          realSpecopsPath,
          path.join(realSpecopsPath, payload.filePath)
        );
        await assertExistingParentInsideDirectory(realSpecopsPath, path.dirname(targetPath));

        try {
          await access(targetPath);
          throw new ConflictError("Proposal target markdown file already exists", {
            proposalId: row.id,
            filePath: payload.filePath
          });
        } catch (error) {
          if (!isNotFoundError(error)) {
            throw error;
          }
        }

        return {
          row,
          payload,
          targetPath,
          acceptedStatus: (
            payload.markdown === payload.generatedMarkdown ? "accepted" : "edited_and_accepted"
          ) as ProposalStatus
        };
      })
    );

    assertNoDuplicateSelectedTargets(selected);
    await assertNoExistingIndexedEntities(projectId, selected.map(({ payload }) => payload.entityId));
    await assertNoExistingCanonicalEntities(realSpecopsPath, selected);

    try {
      for (const item of selected) {
        const targetParent = path.dirname(item.targetPath);
        await mkdir(targetParent, { recursive: true });
        await assertRealPathInsideDirectory(realSpecopsPath, targetParent);
        await writeFile(item.targetPath, item.payload.markdown, { flag: "wx" });
        writtenPaths.push(item.targetPath);
      }

      const indexRun = await indexerService.indexProject(projectId);
      indexCompleted = true;
      await options.acceptTestHooks?.afterIndex?.({
        projectId,
        proposalIds: input.proposalIds,
        indexRun
      });
      const reviewedAt = new Date();

      await options.acceptTestHooks?.beforeStatusUpdate?.({
        projectId,
        proposalIds: input.proposalIds
      });

      await db.transaction(async (tx) => {
        for (const item of selected) {
          const [updated] = await tx
            .update(aiProposals)
            .set({ status: item.acceptedStatus, reviewedAt })
            .where(
              and(
                eq(aiProposals.projectId, projectId),
                eq(aiProposals.id, item.row.id),
                eq(aiProposals.status, "pending")
              )
            )
            .returning({ id: aiProposals.id });

          if (!updated) {
            throw new ConflictError("Only pending proposals can be accepted", {
              proposalId: item.row.id,
              status: "changed"
            });
          }
        }
      });

      return { acceptedProposalIds: input.proposalIds, indexRun };
    } catch (error) {
      await Promise.all(writtenPaths.map((writtenPath) => rm(writtenPath, { force: true })));
      if (indexCompleted) {
        await indexerService.indexProject(projectId);
      }
      if (isFileExistsError(error)) {
        throw new ConflictError("Proposal target markdown file already exists");
      }
      throw error;
    }
  }

  async function assertNoExistingIndexedEntities(
    projectId: string,
    entityIds: string[]
  ): Promise<void> {
    const rows = await db
      .select({ entityId: specEntities.entityId })
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), inArray(specEntities.entityId, entityIds)));

    if (rows.length > 0) {
      throw new ConflictError("Proposal target entity already exists", {
        entityId: rows[0].entityId
      });
    }
  }

  async function assertNoExistingCanonicalEntities(
    specopsPath: string,
    selected: Array<{
      payload: SpecEntityProposalPayload;
      targetPath: string;
    }>
  ): Promise<void> {
    const selectedByEntityId = new Map(selected.map((item) => [item.payload.entityId, item]));
    const markdownPaths = await discoverMarkdownFiles(specopsPath);

    for (const relativePath of markdownPaths) {
      const absolutePath = assertInsideDirectory(specopsPath, path.join(specopsPath, relativePath));
      const content = await readFile(absolutePath, "utf8");
      const parsed = parseSpecMarkdown(relativePath, content);

      if (!parsed.entity) {
        continue;
      }

      const selectedItem = selectedByEntityId.get(parsed.entity.entityId);
      if (!selectedItem || absolutePath === selectedItem.targetPath) {
        continue;
      }

      throw new ConflictError("Target entity already exists", {
        entityId: parsed.entity.entityId,
        filePath: relativePath
      });
    }
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
    project: Pick<ProjectDto, "id" | "repoPath" | "specopsPath">
  ): Promise<ProposalSummaryDto[]> {
    return Promise.all(
      rows.map(async (row) =>
        mapSummary(row, await conflictForPayload(project, parsePayload(row)))
      )
    );
  }

  async function conflictForPayload(
    project: Pick<ProjectDto, "id" | "repoPath" | "specopsPath">,
    payload: SpecEntityProposalPayload
  ): Promise<ProposalSummaryDto["conflict"]> {
    const [entity] = await db
      .select({ entityId: specEntities.entityId })
      .from(specEntities)
      .where(
        and(eq(specEntities.projectId, project.id), eq(specEntities.entityId, payload.entityId))
      )
      .limit(1);

    if (entity) {
      return { status: "entity_exists", entityId: entity.entityId };
    }

    try {
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
      assertInsideDirectory(repoPath, specopsPath);
      const targetPath = assertInsideDirectory(specopsPath, path.join(specopsPath, payload.filePath));

      await stat(targetPath);
      await assertRealPathInsideDirectory(specopsPath, targetPath);
      return { status: "file_exists", filePath: payload.filePath };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { status: "none" };
      }

      return {
        status: "unavailable",
        message: error instanceof Error ? error.message : "Conflict check unavailable"
      };
    }
  }

  return {
    generateSourceImportProposals,
    listProposals,
    getProposal,
    patchProposal,
    acceptProposals
  };
}

function assertNoDuplicateSelectedTargets(
  selected: Array<{
    row: ProposalRow;
    payload: SpecEntityProposalPayload;
    targetPath: string;
  }>
): void {
  const entityIds = new Map<string, string>();
  const targetPaths = new Map<string, string>();

  for (const item of selected) {
    const existingEntityProposalId = entityIds.get(item.payload.entityId);
    if (existingEntityProposalId) {
      throw new ConflictError("Selected proposals target the same entity", {
        entityId: item.payload.entityId,
        proposalIds: [existingEntityProposalId, item.row.id]
      });
    }
    entityIds.set(item.payload.entityId, item.row.id);

    const existingFileProposalId = targetPaths.get(item.targetPath);
    if (existingFileProposalId) {
      throw new ConflictError("Selected proposals target the same file", {
        filePath: item.payload.filePath,
        proposalIds: [existingFileProposalId, item.row.id]
      });
    }
    targetPaths.set(item.targetPath, item.row.id);
  }
}

function parsePayload(row: ProposalRow): SpecEntityProposalPayload {
  const proposalType = proposalTypeSchema.parse(row.proposalType);

  if (proposalType === "ai_spec_entity") {
    return aiSpecEntityProposalPayloadSchema.parse(row.payloadJson);
  }

  return parseSourcePayload(row);
}

function parseSourcePayload(row: ProposalRow): SourceSpecEntityProposalPayload {
  return sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson);
}

function parseSourceEvidence(row: ProposalRow): SourceSpecEntityProposalEvidence {
  return sourceSpecEntityProposalEvidenceSchema.parse(row.evidenceJson);
}

function parseAiEvidence(row: ProposalRow): AiSpecEntityProposalEvidence {
  return aiSpecEntityProposalEvidenceSchema.parse(row.evidenceJson);
}

function mapSummary(
  row: ProposalRow,
  conflict: ProposalSummaryDto["conflict"]
): ProposalSummaryDto {
  const proposalType = proposalTypeSchema.parse(row.proposalType);
  const base = {
    id: row.id,
    projectId: row.projectId,
    status: row.status as ProposalStatus,
    title: row.title,
    confidence: row.confidence,
    conflict,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null
  };

  if (proposalType === "ai_spec_entity") {
    const payload = aiSpecEntityProposalPayloadSchema.parse(row.payloadJson);

    return {
      ...base,
      proposalType: "ai_spec_entity",
      entityId: payload.entityId,
      entityType: payload.type,
      filePath: payload.filePath
    };
  }

  const payload = parseSourcePayload(row);

  return {
    ...base,
    proposalType: "source_spec_entity",
    entityId: payload.entityId,
    entityType: payload.type,
    filePath: payload.filePath
  };
}

function mapDetail(
  row: ProposalRow,
  conflict: ProposalDetailDto["conflict"]
): ProposalDetailDto {
  const proposalType = proposalTypeSchema.parse(row.proposalType);

  if (proposalType === "ai_spec_entity") {
    const payload = aiSpecEntityProposalPayloadSchema.parse(row.payloadJson);

    return {
      ...mapSummary(row, conflict),
      proposalType: "ai_spec_entity",
      entityType: payload.type,
      payload,
      evidence: parseAiEvidence(row)
    };
  }

  const payload = parseSourcePayload(row);

  return {
    ...mapSummary(row, conflict),
    proposalType: "source_spec_entity",
    entityType: payload.type,
    payload,
    evidence: parseSourceEvidence(row)
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
