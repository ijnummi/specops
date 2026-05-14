import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { IndexRunDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { indexRuns, specEntities, specFiles, specLinks, validationMessages } from "@specops/db";
import { findBrokenLinks, findOrphanEntities } from "@specops/graph";
import { discoverMarkdownFiles, parseSpecMarkdown } from "@specops/markdown";
import type { ParsedSpecEntity, ParsedSpecLink, ParseMessage } from "@specops/markdown";
import { eq, sql } from "drizzle-orm";

import {
  assertAbsolutePath,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { readGitHeadCommit } from "./git-service.js";
import { createProjectGraphService } from "./project-graph-service.js";
import type { ProjectGraphFacts } from "./project-graph-service.js";
import { createProjectService } from "./project-service.js";
import { createSourceScanService } from "./source-scan-service.js";

type IndexedFile = {
  path: string;
  content: string;
  contentHash: string;
  frontmatterHash: string | null;
  bodyHash: string;
};

export function createIndexerService(db: Db) {
  return {
    async indexProject(projectId: string): Promise<IndexRunDto> {
      const project = await createProjectService(db).getProject(projectId);
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      const persistedSpecopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
      const [startedRun] = await db
        .insert(indexRuns)
        .values({ projectId, status: "running" })
        .returning();

      if (!startedRun) {
        throw new Error("Failed to create index run");
      }

      let finishedRun: typeof indexRuns.$inferSelect;
      let graphFacts: ProjectGraphFacts | null = null;
      const graphService = createProjectGraphService(db);
      try {
        const [transactionFinishedRun] = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);

          assertInsideDirectory(repoPath, persistedSpecopsPath);
          const specopsPath = await assertRealPathInsideDirectory(repoPath, persistedSpecopsPath);
          const gitCommit = await readGitHeadCommit(repoPath).catch(() => null);
          const relativePaths = await discoverMarkdownFiles(specopsPath);
          const parsedFiles = await Promise.all(
            relativePaths.map(async (relativePath) => {
              const absolutePath = assertInsideDirectory(
                specopsPath,
                path.join(specopsPath, relativePath)
              );
              const content = await readFile(absolutePath, "utf8");
              const parseResult = parseSpecMarkdown(relativePath, content);
              const indexedFile: IndexedFile = {
                path: relativePath,
                content,
                contentHash: sha256(content),
                frontmatterHash: parseResult.entity ? sha256(stableJson(parseResult.entity.frontmatter)) : null,
                bodyHash: sha256(parseResult.entity?.bodyMarkdown ?? content)
              };

              return { indexedFile, parseResult };
            })
          );

          const messages: ParseMessage[] = parsedFiles.flatMap(({ parseResult }) => parseResult.messages);
          const parsedEntities = parsedFiles
            .map(({ parseResult }) => parseResult.entity)
            .filter((entity): entity is ParsedSpecEntity => entity !== null);
          const duplicateIds = findDuplicateEntityIds(parsedEntities);

          for (const entity of parsedEntities) {
            if (duplicateIds.has(entity.entityId)) {
              messages.push({
                level: "error",
                code: "duplicate_entity_id",
                message: `Duplicate entity id "${entity.entityId}" appears in multiple files.`,
                filePath: entity.filePath,
                entityId: entity.entityId
              });
            }
          }

          const entities = parsedEntities.filter((entity) => !duplicateIds.has(entity.entityId));
          const entityIds = new Set(entities.map((entity) => entity.entityId));
          const parsedLinks = parsedFiles.flatMap(({ parseResult }) => parseResult.links);
          const sourceValidLinks = parsedLinks.filter((link) => entityIds.has(link.fromEntityId));
          const brokenLinks = findBrokenLinks(entities, sourceValidLinks);
          const brokenLinkKeys = new Set(brokenLinks.map(linkKey));

          for (const link of brokenLinks) {
            messages.push({
              level: "warning",
              code: "broken_link",
              message: `Broken ${link.linkType} link from "${link.fromEntityId}" to "${link.toEntityId}".`,
              filePath: findEntityFilePath(parsedEntities, link.fromEntityId),
              entityId: link.fromEntityId
            });
          }

          for (const entity of findOrphanEntities(entities, sourceValidLinks.filter((link) => !brokenLinkKeys.has(linkKey(link))))) {
            messages.push({
              level: "info",
              code: "orphan_entity",
              message: `Entity "${entity.entityId}" has no valid links.`,
              filePath: entity.filePath,
              entityId: entity.entityId
            });
          }

          const links = dedupeLinks(sourceValidLinks.filter((link) => !brokenLinkKeys.has(linkKey(link))));
          const errorCount = messages.filter((message) => message.level === "error").length;
          const warningCount = messages.filter((message) => message.level === "warning").length;
          const indexedAt = new Date();
          const existingEntities = await tx
            .select()
            .from(specEntities)
            .where(eq(specEntities.projectId, projectId));
          const existingEntityById = new Map(
            existingEntities.map((entity) => [entity.entityId, entity])
          );

          await tx.delete(validationMessages).where(eq(validationMessages.projectId, projectId));
          await tx.delete(specLinks).where(eq(specLinks.projectId, projectId));
          await tx.delete(specEntities).where(eq(specEntities.projectId, projectId));
          await tx.delete(specFiles).where(eq(specFiles.projectId, projectId));

          if (parsedFiles.length > 0) {
            await tx.insert(specFiles).values(
              parsedFiles.map(({ indexedFile }) => ({
                projectId,
                path: indexedFile.path,
                contentHash: indexedFile.contentHash,
                frontmatterHash: indexedFile.frontmatterHash,
                bodyHash: indexedFile.bodyHash
              }))
            );
          }

          if (entities.length > 0) {
            await tx.insert(specEntities).values(
              entities.map((entity) => {
                const contentHash =
                  parsedFiles.find(({ parseResult }) => parseResult.entity === entity)?.indexedFile
                    .contentHash ?? sha256(entity.bodyMarkdown);
                const existingEntity = existingEntityById.get(entity.entityId);
                const entityCreatedAt = existingEntity?.createdAt ?? indexedAt;
                const entityUpdatedAt =
                  existingEntity && existingEntity.contentHash === contentHash
                    ? existingEntity.updatedAt
                    : indexedAt;

                return {
                  projectId,
                  entityId: entity.entityId,
                  type: entity.type,
                  title: entity.title,
                  status: entity.status,
                  filePath: entity.filePath,
                  frontmatterJson: entity.frontmatter,
                  bodyMarkdown: entity.bodyMarkdown,
                  bodyText: entity.bodyText,
                  contentHash,
                  createdAt: entityCreatedAt,
                  updatedAt: entityUpdatedAt
                };
              })
            );
          }

          if (links.length > 0) {
            await tx.insert(specLinks).values(
              links.map((link) => ({
                projectId,
                fromEntityId: link.fromEntityId,
                toEntityId: link.toEntityId,
                linkType: link.linkType,
                source: link.source
              }))
            );
          }

          if (messages.length > 0) {
            await tx.insert(validationMessages).values(
              messages.map((message) => ({
                projectId,
                indexRunId: startedRun.id,
                filePath: message.filePath,
                entityId: message.entityId,
                level: message.level,
                code: message.code,
                message: message.message
              }))
            );
          }

          const sourceCounts = await createSourceScanService(tx).scanAndPersistProject({
            projectId,
            repoPath,
            indexRunId: startedRun.id
          });
          graphFacts = await graphService.loadProjectGraphFacts(projectId, tx);

          return tx
            .update(indexRuns)
            .set({
              status: "succeeded",
              finishedAt: new Date(),
              entityCount: entities.length,
              linkCount: links.length,
              errorCount,
              warningCount: warningCount + sourceCounts.warningCount,
              sourceFileCount: sourceCounts.sourceFileCount,
              sourceImportCount: sourceCounts.sourceImportCount,
              sourceExportCount: sourceCounts.sourceExportCount,
              sourceSymbolCount: sourceCounts.sourceSymbolCount,
              gitCommit
            })
            .where(eq(indexRuns.id, startedRun.id))
            .returning();
        });

        if (!transactionFinishedRun) {
          throw new Error("Failed to finish index run");
        }
        if (!graphFacts) {
          throw new Error("Failed to capture project graph facts");
        }

        finishedRun = transactionFinishedRun;
      } catch (error) {
        await db
          .update(indexRuns)
          .set({ status: "failed", finishedAt: new Date() })
          .where(eq(indexRuns.id, startedRun.id));
        throw error;
      }

      try {
        await graphService.buildProjectGraphFromFacts({
          projectId,
          indexRunId: finishedRun.id,
          facts: graphFacts
        });
      } catch (error) {
        await graphService.recordFailedGraphVersion({
          projectId,
          indexRunId: finishedRun.id,
          error
        }).catch(() => undefined);
      }

      return mapIndexRun(finishedRun);
    }
  };
}

function mapIndexRun(row: typeof indexRuns.$inferSelect): IndexRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status as IndexRunDto["status"],
    entityCount: row.entityCount,
    linkCount: row.linkCount,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    gitCommit: row.gitCommit,
    sourceFileCount: row.sourceFileCount,
    sourceImportCount: row.sourceImportCount,
    sourceExportCount: row.sourceExportCount,
    sourceSymbolCount: row.sourceSymbolCount
  };
}

function findDuplicateEntityIds(entities: ParsedSpecEntity[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entity of entities) {
    if (seen.has(entity.entityId)) {
      duplicates.add(entity.entityId);
    }

    seen.add(entity.entityId);
  }

  return duplicates;
}

function dedupeLinks(links: ParsedSpecLink[]): ParsedSpecLink[] {
  const seen = new Set<string>();
  const deduped: ParsedSpecLink[] = [];

  for (const link of links) {
    const key = linkKey(link);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

function linkKey(link: ParsedSpecLink): string {
  return `${link.fromEntityId}\u0000${link.toEntityId}\u0000${link.linkType}\u0000${link.source}`;
}

function findEntityFilePath(entities: ParsedSpecEntity[], entityId: string): string {
  return entities.find((entity) => entity.entityId === entityId)?.filePath ?? "";
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJson(entryValue)])
    );
  }

  return value;
}
