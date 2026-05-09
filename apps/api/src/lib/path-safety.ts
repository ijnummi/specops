import { realpath } from "node:fs/promises";
import path from "node:path";

export function assertInsideDirectory(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }

  throw new Error(`Path must be inside ${resolvedBase}: ${resolvedTarget}`);
}

export async function assertRealPathInsideDirectory(
  baseDir: string,
  targetPath: string
): Promise<string> {
  const [realBase, realTarget] = await Promise.all([
    realpath(path.resolve(baseDir)),
    realpath(path.resolve(targetPath))
  ]);
  assertInsideDirectory(realBase, realTarget);
  return realTarget;
}

export async function assertExistingParentInsideDirectory(
  baseDir: string,
  targetPath: string
): Promise<string> {
  const resolvedTarget = assertInsideDirectory(baseDir, targetPath);
  let candidate = resolvedTarget;

  while (true) {
    try {
      await assertRealPathInsideDirectory(baseDir, candidate);
      return resolvedTarget;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      candidate = parent;
    }
  }
}

export function assertAbsolutePath(label: string, value: string): string {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }

  return path.resolve(value);
}

export function normalizeProjectPaths(input: {
  repoPath: string;
  specopsPath: string;
}): { repoPath: string; specopsPath: string } {
  const repoPath = assertAbsolutePath("repoPath", input.repoPath);
  const specopsPath = assertAbsolutePath("specopsPath", input.specopsPath);
  assertInsideDirectory(repoPath, specopsPath);

  return { repoPath, specopsPath };
}

export async function normalizeProjectPathsForPersistence(input: {
  repoPath: string;
  specopsPath: string;
}): Promise<{ repoPath: string; specopsPath: string }> {
  const paths = normalizeProjectPaths(input);

  if (await pathExists(paths.repoPath)) {
    await assertExistingParentInsideDirectory(paths.repoPath, paths.specopsPath);
  }

  return paths;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await realpath(value);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}
