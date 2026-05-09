import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IndexRunDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { discoverMarkdownFiles, parseSpecMarkdown } from "@specops/markdown";
import { scanRepository } from "@specops/repo-scanner";
import { generateBootstrapSpecFiles } from "@specops/source-bootstrap";
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

      assertInsideDirectory(repoPath, specopsPath);
      await assertRealPathInsideDirectory(repoPath, repoPath);
      await assertExistingParentInsideDirectory(repoPath, specopsPath);
      await mkdir(specopsPath, { recursive: true });
      const realSpecopsPath = await assertRealPathInsideDirectory(repoPath, specopsPath);

      const projectYamlPath = path.join(realSpecopsPath, "project.yaml");
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
        for (const file of generatedFiles) {
          const targetPath = assertInsideDirectory(
            realSpecopsPath,
            path.join(realSpecopsPath, file.path)
          );
          await mkdir(path.dirname(targetPath), { recursive: true });
          await writeFile(targetPath, file.content, { flag: "wx" });
          writtenPaths.push(targetPath);
        }
      } catch (error) {
        await Promise.all(writtenPaths.map((writtenPath) => rm(writtenPath, { force: true })));
        if (isFileExistsError(error)) {
          throw new ConflictError("Generated bootstrap file already exists");
        }
        throw error;
      }

      const result = await createIndexerService(db).indexProject(projectId);
      await writeProjectYaml(projectYamlPath, {
        ...projectYaml,
        source_bootstrap: {
          completed_at: new Date().toISOString(),
          scanner: "typescript",
          generated_entity_count: generatedFiles.length
        }
      });

      return result;
    }
  };
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
