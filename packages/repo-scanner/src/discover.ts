import { readdir } from "node:fs/promises";
import path from "node:path";

import { isSupportedSourcePath, shouldExcludePath } from "./classify.js";

export async function discoverSourceFiles(repoPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = path.join(repoPath, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (shouldExcludePath(relativePath)) return;

        if (entry.isDirectory()) {
          await walk(relativePath);
          return;
        }

        if (entry.isFile() && isSupportedSourcePath(relativePath)) {
          files.push(relativePath);
        }
      })
    );
  }

  await walk("");
  return files.sort();
}
