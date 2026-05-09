import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { classifySourceFile, isSupportedSourcePath } from "./classify.js";
import { discoverSourceFiles } from "./discover.js";
import { parseSourceFacts } from "./parse.js";
import type { ScanRepositoryInput, ScanRepositoryResult, SourceImportFact, SourceScanWarning } from "./types.js";

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

export async function scanRepository(input: ScanRepositoryInput): Promise<ScanRepositoryResult> {
  const discoveredFiles = await discoverSourceFiles(input.repoPath);
  const discoveredFileSet = new Set(discoveredFiles);
  const warnings: SourceScanWarning[] = [];
  const files: ScanRepositoryResult["files"] = [];

  for (const relativePath of discoveredFiles) {
    try {
      const absolutePath = path.join(input.repoPath, relativePath);
      const content = await readFile(absolutePath, "utf8");
      const parsed = parseSourceFacts({ path: relativePath, content });
      warnings.push(...parsed.warnings);

      const classified = classifySourceFile(relativePath);
      files.push({
        path: relativePath,
        language: classified.language,
        kind: classified.kind,
        sizeBytes: Buffer.byteLength(content),
        contentHash: createHash("sha256").update(content).digest("hex"),
        imports: parsed.imports.map((sourceImport) => resolveImport(relativePath, sourceImport, discoveredFileSet)),
        exports: parsed.exports,
        symbols: parsed.symbols
      });
    } catch (error) {
      warnings.push({
        code: "source_read_error",
        message: error instanceof Error ? error.message : String(error),
        filePath: relativePath
      });
    }
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    warnings
  };
}

function resolveImport(
  importerPath: string,
  sourceImport: SourceImportFact,
  discoveredFileSet: Set<string>
): SourceImportFact {
  if (!sourceImport.isRelative) return sourceImport;

  const importerDir = path.posix.dirname(importerPath);
  const normalized = path.posix.normalize(path.posix.join(importerDir, sourceImport.specifier));
  const candidates = isSupportedSourcePath(normalized)
    ? [normalized]
    : sourceExtensions.map((extension) => `${normalized}${extension}`);
  const resolvedPath = candidates.find((candidate) => discoveredFileSet.has(candidate)) ?? null;

  return { ...sourceImport, resolvedPath };
}
