import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IndexRunDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { discoverMarkdownFiles, parseSpecMarkdown } from "@specops/markdown";
import { scanRepository } from "@specops/repo-scanner";
import {
  applySourceSpecAnnotations,
  generateBootstrapSpecFiles,
  type BootstrapGeneratedSpecFile
} from "@specops/source-bootstrap";
import { parse, stringify } from "yaml";

import { BadRequestError, ConflictError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";

type ProjectYaml = Record<string, unknown>;

export function createSourceBootstrapService(db: Db) {
  return {
    async bootstrapProject(projectId: string): Promise<IndexRunDto> {
      const project = await createProjectService(db).getProject(projectId);
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
      const writtenPaths: string[] = [];
      const sourceSnapshots: Array<{ path: string; original: string }> = [];

      assertInsideDirectory(repoPath, specopsPath);
      await assertRealPathInsideDirectory(repoPath, repoPath);
      await assertExistingParentInsideDirectory(repoPath, specopsPath);
      await mkdir(specopsPath, { recursive: true });
      const realSpecopsPath = await assertRealPathInsideDirectory(repoPath, specopsPath);

      const projectYamlPath = path.join(realSpecopsPath, "project.yaml");
      await assertSafeProjectYamlPath(realSpecopsPath, projectYamlPath);
      const projectYaml = await readProjectYaml(projectYamlPath);
      if (hasCompletedSourceBootstrap(projectYaml)) {
        throw new ConflictError("Source bootstrap has already completed");
      }

      await assertNoExistingEntitySpecs(realSpecopsPath);

      const scan = await scanRepository({ repoPath });
      if (scan.files.length === 0) {
        throw new BadRequestError("No supported source files found");
      }

      const generatedFiles = generateBootstrapSpecFiles(scan);
      if (generatedFiles.length === 0) {
        throw new BadRequestError("No eligible exported source symbols found");
      }

      try {
        for (const [sourceFile, annotations] of groupAnnotationsBySourceFile(generatedFiles)) {
          const sourcePath = assertInsideDirectory(repoPath, path.join(repoPath, sourceFile));
          const targetPath = await assertRealPathInsideDirectory(repoPath, sourcePath);
          const original = await readFile(targetPath, "utf8");
          const result = applySourceSpecAnnotations({
            content: original,
            annotations
          });

          if (!result.changed) continue;

          sourceSnapshots.push({ path: targetPath, original });
          await writeFile(targetPath, result.content, { flag: "w" });
        }

        for (const file of generatedFiles) {
          const targetPath = assertInsideDirectory(
            realSpecopsPath,
            path.join(realSpecopsPath, file.path)
          );
          const targetParent = path.dirname(targetPath);
          await assertExistingParentInsideDirectory(realSpecopsPath, targetParent);
          await mkdir(targetParent, { recursive: true });
          await assertRealPathInsideDirectory(realSpecopsPath, targetParent);
          await writeFile(targetPath, file.content, { flag: "wx" });
          writtenPaths.push(targetPath);
        }

        const result = await createIndexerService(db).indexProject(projectId);
        await assertSafeProjectYamlPath(realSpecopsPath, projectYamlPath);
        await writeProjectYaml(projectYamlPath, {
          ...projectYaml,
          source_bootstrap: {
            completed_at: new Date().toISOString(),
            scanner: "typescript",
            generated_entity_count: generatedFiles.length
          }
        });

        return result;
      } catch (error) {
        await Promise.all([
          ...sourceSnapshots.map((snapshot) => writeFile(snapshot.path, snapshot.original)),
          ...writtenPaths.map((writtenPath) => rm(writtenPath, { force: true }))
        ]);
        if (isSourceAnnotationConflict(error)) {
          throw new ConflictError(error.message);
        }
        if (isFileExistsError(error)) {
          throw new ConflictError("Generated bootstrap file already exists");
        }
        throw error;
      }
    }
  };
}

function groupAnnotationsBySourceFile(generatedFiles: BootstrapGeneratedSpecFile[]) {
  const byFile = new Map<
    string,
    Array<{ entityId: string; symbolName: string; symbolLine: number | null }>
  >();

  for (const file of generatedFiles) {
    for (const evidence of file.evidence) {
      const current = byFile.get(evidence.sourceFile) ?? [];
      current.push({
        entityId: file.entityId,
        symbolName: evidence.symbolName,
        symbolLine: evidence.line
      });
      byFile.set(evidence.sourceFile, current);
    }
  }

  return byFile;
}

async function assertSafeProjectYamlPath(specopsPath: string, projectYamlPath: string) {
  assertInsideDirectory(specopsPath, projectYamlPath);

  try {
    await assertRealPathInsideDirectory(specopsPath, projectYamlPath);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    await assertExistingParentInsideDirectory(specopsPath, projectYamlPath);
  }
}

async function assertNoExistingEntitySpecs(specopsPath: string) {
  const markdownPaths = await discoverMarkdownFiles(specopsPath);

  for (const relativePath of markdownPaths) {
    const content = await readFile(path.join(specopsPath, relativePath), "utf8");
    const parsed = parseSpecMarkdown(relativePath, content);

    if (parsed.entity) {
      throw new ConflictError("Source bootstrap requires an empty specops folder", {
        filePath: relativePath,
        entityId: parsed.entity.entityId
      });
    }
  }
}

async function readProjectYaml(projectYamlPath: string): Promise<ProjectYaml> {
  try {
    const raw = await readFile(projectYamlPath, "utf8");
    const parsed = parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }
}

async function writeProjectYaml(projectYamlPath: string, value: ProjectYaml) {
  await writeFile(projectYamlPath, `${stringify(value, { lineWidth: 0 }).trimEnd()}\n`, {
    flag: "w"
  });
}

function hasCompletedSourceBootstrap(projectYaml: ProjectYaml): boolean {
  const marker = projectYaml.source_bootstrap;
  return isRecord(marker) && typeof marker.completed_at === "string" && marker.completed_at.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isFileExistsError(error: unknown): boolean {
  return isRecord(error) && error.code === "EEXIST";
}

function isSourceAnnotationConflict(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.includes("already has a different @specops annotation")
  );
}
