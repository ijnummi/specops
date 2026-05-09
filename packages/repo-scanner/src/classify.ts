import path from "node:path";
import type { SourceFileKind, SourceLanguage } from "./types.js";

const supportedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const excludedSegments = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

export function isSupportedSourcePath(relativePath: string): boolean {
  return supportedExtensions.has(path.extname(relativePath));
}

export function shouldExcludePath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some((segment) => excludedSegments.has(segment));
}

export function classifySourceFile(relativePath: string): { language: SourceLanguage; kind: SourceFileKind } {
  return {
    language: languageForPath(relativePath),
    kind: kindForPath(relativePath)
  };
}

function languageForPath(relativePath: string): SourceLanguage {
  const extension = path.extname(relativePath);
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return "typescript";
  if (extension === ".tsx") return "tsx";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "javascript";
  if (extension === ".jsx") return "jsx";
  return "unknown";
}

function kindForPath(relativePath: string): SourceFileKind {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = path.basename(normalized);
  if (/(\.|-)(test|spec)\.[cm]?[jt]sx?$/.test(basename) || normalized.includes("/__tests__/")) return "test";
  if (/(^|\/)(vite|vitest|playwright|postcss|tailwind|eslint|prettier|drizzle)\.config\.[cm]?[jt]s$/.test(normalized)) return "config";
  if (/\/?src\/main\.[cm]?[jt]sx?$/.test(normalized)) return "entrypoint";
  if (/(^|\/)index\.[cm]?[jt]s$/.test(normalized) && !normalized.startsWith("src/")) return "entrypoint";
  return "source";
}
