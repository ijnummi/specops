import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectDto } from "@specops/contracts";
import { parse } from "yaml";

import {
  assertAbsolutePath,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";

export const fallbackValidationCommands = ["pnpm typecheck", "pnpm test"];

export async function readValidationCommands(
  project: Pick<ProjectDto, "repoPath" | "specopsPath">
): Promise<string[]> {
  const persistedSpecopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
  const specopsPath = await assertRealPathInsideDirectory(project.repoPath, persistedSpecopsPath);
  const projectYamlPath = assertInsideDirectory(specopsPath, path.join(specopsPath, "project.yaml"));

  try {
    const content = await readFile(projectYamlPath, "utf8");
    const parsed = parse(content) as unknown;

    if (!isRecord(parsed)) {
      return fallbackValidationCommands;
    }

    const defaults = parsed.agent_task_defaults;
    if (!isRecord(defaults) || !Array.isArray(defaults.validation_commands)) {
      return fallbackValidationCommands;
    }

    const commands = defaults.validation_commands.filter(
      (command): command is string => typeof command === "string" && command.trim().length > 0
    );

    return commands.length > 0 ? commands : fallbackValidationCommands;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return fallbackValidationCommands;
    }

    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
