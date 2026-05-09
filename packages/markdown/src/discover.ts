import { readdir } from "node:fs/promises";
import path from "node:path";

export async function discoverMarkdownFiles(
  specopsPath: string
): Promise<string[]> {
  const files = await walk(specopsPath, "");
  return files.sort();
}

async function walk(rootPath: string, relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(rootPath, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await walk(rootPath, relativePath)));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !entry.name.endsWith(".template.md")
    ) {
      files.push(relativePath);
    }
  }

  return files;
}
