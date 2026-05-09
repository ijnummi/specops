import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { initialSpecopsFiles } from "./templates.js";
import type { InitializeSpecopsFolderResult } from "./types.js";

export async function initializeSpecopsFolder(
  specopsPath: string
): Promise<InitializeSpecopsFolderResult> {
  const createdPaths: string[] = [];
  const skippedPaths: string[] = [];

  await mkdir(specopsPath, { recursive: true });

  for (const file of initialSpecopsFiles()) {
    const absolutePath = path.join(specopsPath, file.path);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await writeFile(absolutePath, file.content, { flag: "wx" });
      createdPaths.push(file.path);
    } catch (error) {
      if (isFileExistsError(error)) {
        skippedPaths.push(file.path);
        continue;
      }

      throw error;
    }
  }

  return {
    createdCount: createdPaths.length,
    skippedCount: skippedPaths.length,
    createdPaths,
    skippedPaths
  };
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
