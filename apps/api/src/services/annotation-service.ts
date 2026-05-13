import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  AnnotationCreateRequest,
  AnnotationListQuery,
  AnnotationProvenance,
  AnnotationRelationshipType,
  SourceExcerptDto,
  SourceSpecAnnotationDto,
  SourceSpecAnnotationUpdateRequest
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  analyzeReviewClaims,
  projects,
  sourceFiles,
  sourceSpecAnnotations,
  specEntities
} from "@specops/db";
import { and, asc, eq } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import { assertInsideDirectory, assertRealPathInsideDirectory } from "../lib/path-safety.js";

const MAX_SOURCE_EXCERPT_FILE_BYTES = 256 * 1024;
const SOURCE_EXCERPT_CONCURRENCY = 4;

type SourceSpecAnnotationRow = typeof sourceSpecAnnotations.$inferSelect;
type AnnotationWriteClient = Pick<Db, "delete" | "insert" | "select">;

type BaseAnnotationInput = {
  sourceFileId?: string | null;
  sourceFilePath: string;
  symbolName?: string | null;
  symbolKind?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  annotationLine?: number | null;
  sourceContentHash?: string | null;
  entityId: string;
  specFilePath: string;
  relationshipType: AnnotationRelationshipType;
  confidence?: number | null;
};

export type ScannerAnnotationInput = BaseAnnotationInput;

export type AcceptedEvidenceAnnotationInput = BaseAnnotationInput & {
  provenance: AnnotationProvenance;
  claimId?: string | null;
  analyzeRunId?: string | null;
  proposalId?: string | null;
  assemblyId?: string | null;
  claimEvidenceId?: string | null;
};

export function createAnnotationService(db: Db) {
  return {
    async listAnnotations(
      projectId: string,
      query: AnnotationListQuery
    ): Promise<SourceSpecAnnotationDto[]> {
      const filters = [eq(sourceSpecAnnotations.projectId, projectId)];

      if (query.entityId) filters.push(eq(sourceSpecAnnotations.entityId, query.entityId));
      if (query.sourceFileId) filters.push(eq(sourceSpecAnnotations.sourceFileId, query.sourceFileId));
      if (query.filePath) filters.push(eq(sourceSpecAnnotations.sourceFilePath, query.filePath));
      if (query.relationshipType) {
        filters.push(eq(sourceSpecAnnotations.relationshipType, query.relationshipType));
      }
      if (query.status) filters.push(eq(sourceSpecAnnotations.status, query.status));
      if (query.provenance) filters.push(eq(sourceSpecAnnotations.provenance, query.provenance));

      const rows = await db
        .select()
        .from(sourceSpecAnnotations)
        .where(and(...filters))
        .orderBy(
          asc(sourceSpecAnnotations.relationshipType),
          asc(sourceSpecAnnotations.sourceFilePath),
          asc(sourceSpecAnnotations.symbolName),
          asc(sourceSpecAnnotations.id)
        );

      if (!query.includeExcerpt || rows.length === 0) {
        return rows.map((row) => mapAnnotation(row));
      }

      const project = await getProjectRow(db, projectId);
      const excerptCache = new Map<string, Promise<SourceExcerptDto>>();
      return mapWithConcurrency(rows, SOURCE_EXCERPT_CONCURRENCY, async (row) => {
        const excerptKey = sourceExcerptCacheKey(row);
        let excerpt = excerptCache.get(excerptKey);
        if (!excerpt) {
          excerpt = readSourceExcerpt(project.repoPath, row);
          excerptCache.set(excerptKey, excerpt);
        }

        return mapAnnotation(row, await excerpt);
      });
    },

    async createUserAnnotation(
      projectId: string,
      input: AnnotationCreateRequest
    ): Promise<SourceSpecAnnotationDto> {
      const entity = await getSpecEntityRow(db, projectId, input.entityId);
      const sourceFile = await getSourceFileForUserAnnotation(db, projectId, input);
      if (input.claimId !== null && input.claimId !== undefined) {
        await getClaimRow(db, projectId, input.claimId);
      }

      const [row] = await db
        .insert(sourceSpecAnnotations)
        .values({
          projectId,
          sourceFileId: sourceFile.id,
          sourceFilePath: sourceFile.path,
          symbolName: input.symbolName ?? null,
          symbolKind: input.symbolKind ?? null,
          startLine: input.startLine ?? null,
          endLine: input.endLine ?? null,
          annotationLine: input.annotationLine ?? null,
          sourceContentHash: sourceFile.contentHash,
          entityId: input.entityId,
          specFilePath: input.specFilePath ?? entity.filePath,
          claimId: input.claimId ?? null,
          relationshipType: input.relationshipType,
          confidence: input.confidence ?? null,
          provenance: "user",
          status: "active"
        })
        .returning();

      if (!row) {
        throw new Error("Failed to create source spec annotation");
      }

      return mapAnnotation(row);
    },

    async patchAnnotation(
      projectId: string,
      annotationId: string,
      input: SourceSpecAnnotationUpdateRequest
    ): Promise<SourceSpecAnnotationDto> {
      if (input.claimId !== undefined && input.claimId !== null) {
        await getClaimRow(db, projectId, input.claimId);
      }

      const values: Partial<typeof sourceSpecAnnotations.$inferInsert> = {
        updatedAt: new Date()
      };
      if (input.relationshipType !== undefined) values.relationshipType = input.relationshipType;
      if (input.confidence !== undefined) values.confidence = input.confidence;
      if (input.status !== undefined) values.status = input.status;
      if (input.claimId !== undefined) values.claimId = input.claimId;
      if (input.startLine !== undefined) values.startLine = input.startLine;
      if (input.endLine !== undefined) values.endLine = input.endLine;
      if (input.annotationLine !== undefined) values.annotationLine = input.annotationLine;

      const [row] = await db
        .update(sourceSpecAnnotations)
        .set(values)
        .where(
          and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.id, annotationId))
        )
        .returning();

      if (!row) {
        throw new NotFoundError("Source spec annotation not found", { projectId, annotationId });
      }

      return mapAnnotation(row);
    },

    async deleteAnnotation(projectId: string, annotationId: string): Promise<void> {
      const [row] = await db
        .delete(sourceSpecAnnotations)
        .where(
          and(eq(sourceSpecAnnotations.projectId, projectId), eq(sourceSpecAnnotations.id, annotationId))
        )
        .returning({ id: sourceSpecAnnotations.id });

      if (!row) {
        throw new NotFoundError("Source spec annotation not found", { projectId, annotationId });
      }
    },

    async replaceScannerAnnotations(
      projectId: string,
      indexRunId: string,
      annotations: ScannerAnnotationInput[],
      client: AnnotationWriteClient = db
    ): Promise<void> {
      await client
        .delete(sourceSpecAnnotations)
        .where(
          and(
            eq(sourceSpecAnnotations.projectId, projectId),
            eq(sourceSpecAnnotations.provenance, "scanner")
          )
        );

      if (annotations.length === 0) {
        return;
      }

      await client
        .insert(sourceSpecAnnotations)
        .values(
          annotations.map((annotation) => ({
            ...mapBaseInsert(projectId, annotation),
            provenance: "scanner",
            status: "active",
            indexRunId
          }))
        )
        .onConflictDoNothing();
    },

    async createAcceptedEvidenceAnnotations(
      projectId: string,
      annotations: AcceptedEvidenceAnnotationInput[],
      client: AnnotationWriteClient = db
    ): Promise<number> {
      if (annotations.length === 0) {
        return 0;
      }

      const inserted = await client
        .insert(sourceSpecAnnotations)
        .values(
          annotations.map((annotation) => ({
            ...mapBaseInsert(projectId, annotation),
            provenance: annotation.provenance,
            status: "active",
            claimId: annotation.claimId ?? null,
            analyzeRunId: annotation.analyzeRunId ?? null,
            proposalId: annotation.proposalId ?? null,
            assemblyId: annotation.assemblyId ?? null,
            claimEvidenceId: annotation.claimEvidenceId ?? null
          }))
        )
        .onConflictDoNothing()
        .returning({ id: sourceSpecAnnotations.id });

      return inserted.length;
    }
  };
}

function mapBaseInsert(projectId: string, annotation: BaseAnnotationInput) {
  return {
    projectId,
    sourceFileId: annotation.sourceFileId ?? null,
    sourceFilePath: annotation.sourceFilePath,
    symbolName: annotation.symbolName ?? null,
    symbolKind: annotation.symbolKind ?? null,
    startLine: annotation.startLine ?? null,
    endLine: annotation.endLine ?? null,
    annotationLine: annotation.annotationLine ?? null,
    sourceContentHash: annotation.sourceContentHash ?? null,
    entityId: annotation.entityId,
    specFilePath: annotation.specFilePath,
    relationshipType: annotation.relationshipType,
    confidence: annotation.confidence ?? null
  };
}

async function getProjectRow(db: Pick<Db, "select">, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new NotFoundError("Project not found", { projectId });
  }

  return project;
}

async function getSpecEntityRow(db: Pick<Db, "select">, projectId: string, entityId: string) {
  const [entity] = await db
    .select()
    .from(specEntities)
    .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, entityId)))
    .limit(1);

  if (!entity) {
    throw new NotFoundError("Spec entity not found", { projectId, entityId });
  }

  return entity;
}

async function getClaimRow(db: Pick<Db, "select">, projectId: string, claimId: string) {
  const [claim] = await db
    .select()
    .from(analyzeReviewClaims)
    .where(and(eq(analyzeReviewClaims.projectId, projectId), eq(analyzeReviewClaims.id, claimId)))
    .limit(1);

  if (!claim) {
    throw new NotFoundError("Analyze review claim not found", { projectId, claimId });
  }

  return claim;
}

async function getSourceFileForUserAnnotation(
  db: Pick<Db, "select">,
  projectId: string,
  input: AnnotationCreateRequest
) {
  const filters = [eq(sourceFiles.projectId, projectId)];
  if (input.sourceFileId) {
    filters.push(eq(sourceFiles.id, input.sourceFileId));
  } else if (input.sourceFilePath) {
    filters.push(eq(sourceFiles.path, input.sourceFilePath));
  }

  const [sourceFile] = await db.select().from(sourceFiles).where(and(...filters)).limit(1);
  if (!sourceFile) {
    throw new NotFoundError("Source file not found", {
      projectId,
      sourceFileId: input.sourceFileId,
      sourceFilePath: input.sourceFilePath
    });
  }

  return sourceFile;
}

function mapAnnotation(
  row: SourceSpecAnnotationRow,
  excerpt?: SourceExcerptDto
): SourceSpecAnnotationDto {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceFileId: row.sourceFileId,
    sourceFilePath: row.sourceFilePath,
    symbolName: row.symbolName,
    symbolKind: row.symbolKind,
    startLine: row.startLine,
    endLine: row.endLine,
    annotationLine: row.annotationLine,
    sourceContentHash: row.sourceContentHash,
    entityId: row.entityId,
    specFilePath: row.specFilePath,
    claimId: row.claimId,
    relationshipType: row.relationshipType as SourceSpecAnnotationDto["relationshipType"],
    confidence: row.confidence,
    provenance: row.provenance as SourceSpecAnnotationDto["provenance"],
    status: row.status as SourceSpecAnnotationDto["status"],
    analyzeRunId: row.analyzeRunId,
    proposalId: row.proposalId,
    assemblyId: row.assemblyId,
    claimEvidenceId: row.claimEvidenceId,
    indexRunId: row.indexRunId,
    ...(excerpt ? { excerpt } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await mapper(items[index]);
      }
    })
  );

  return results;
}

function sourceExcerptCacheKey(annotation: SourceSpecAnnotationRow): string {
  return [
    annotation.sourceFilePath,
    annotation.sourceContentHash ?? "",
    annotation.annotationLine ?? "",
    annotation.startLine ?? "",
    annotation.endLine ?? ""
  ].join("|");
}

async function readSourceExcerpt(
  repoPath: string,
  annotation: SourceSpecAnnotationRow
): Promise<SourceExcerptDto> {
  try {
    const targetPath = assertInsideDirectory(repoPath, path.join(repoPath, annotation.sourceFilePath));
    const safePath = await assertRealPathInsideDirectory(repoPath, targetPath);
    const fileStats = await stat(safePath);

    if (fileStats.size > MAX_SOURCE_EXCERPT_FILE_BYTES) {
      return {
        status: "unavailable",
        message: "Source file is too large to excerpt."
      };
    }

    const content = await readFile(safePath, "utf8");
    if (annotation.sourceContentHash && sha256(content) !== annotation.sourceContentHash) {
      return {
        status: "unavailable",
        message: "Source file changed since the annotation was created."
      };
    }

    const text = content.replace(/\r?\n$/, "");
    const lines = text.length > 0 ? text.split(/\r?\n/) : [""];
    return {
      status: "available",
      startLine: 1,
      endLine: lines.length,
      text
    };
  } catch {
    return {
      status: "unavailable",
      message: "Source excerpt unavailable."
    };
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
