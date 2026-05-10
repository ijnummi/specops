import { mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory,
  ensureProjectSpecopsDirectory,
  normalizeProjectPaths
} from "../lib/path-safety.js";

describe("path safety", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("allows a target equal to base or inside it", () => {
    const base = path.join(os.tmpdir(), "repo");

    expect(assertInsideDirectory(base, base)).toBe(path.resolve(base));
    expect(assertInsideDirectory(base, path.join(base, ".specops"))).toBe(
      path.resolve(base, ".specops")
    );
  });

  it("rejects sibling and traversal targets", () => {
    const base = path.join(os.tmpdir(), "repo");

    expect(() => assertInsideDirectory(base, path.join(base, "..", "repo-sibling"))).toThrow(
      /inside/
    );
    expect(() => assertInsideDirectory(base, path.join(os.tmpdir(), "repo-sibling"))).toThrow(
      /inside/
    );
  });

  it("rejects an existing symlink that resolves outside the base directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-path-safety-"));
    tempRoots.push(root);
    const repo = path.join(root, "repo");
    const outside = path.join(root, "outside");
    await mkdir(repo);
    await mkdir(outside);
    await symlink(outside, path.join(repo, ".specops"), "dir");

    await expect(assertRealPathInsideDirectory(repo, path.join(repo, ".specops"))).rejects.toThrow(
      /inside/
    );
  });

  it("allows an existing path whose realpath stays inside the base directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-path-safety-"));
    tempRoots.push(root);
    const repo = path.join(root, "repo");
    const specopsPath = path.join(repo, ".specops");
    await mkdir(specopsPath, { recursive: true });
    await symlink(specopsPath, path.join(repo, "specops-link"), "dir");

    await expect(
      assertRealPathInsideDirectory(await realpath(repo), path.join(repo, "specops-link"))
    ).resolves.toBe(await realpath(specopsPath));
  });

  it("rejects a missing target when its existing parent resolves outside the base directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-path-safety-"));
    tempRoots.push(root);
    const repo = path.join(root, "repo");
    const outside = path.join(root, "outside");
    await mkdir(repo);
    await mkdir(outside);
    await symlink(outside, path.join(repo, "escape"), "dir");

    await expect(
      assertExistingParentInsideDirectory(repo, path.join(repo, "escape", ".specops"))
    ).rejects.toThrow(/inside/);
  });

  it("defaults the specops path to a specops folder under the repository", () => {
    const repo = path.join(os.tmpdir(), "repo");

    expect(normalizeProjectPaths({ repoPath: repo }).specopsPath).toBe(
      path.resolve(repo, "specops")
    );
  });

  it("creates the default specops directory for an existing repository", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "specops-path-safety-"));
    tempRoots.push(repo);
    const specopsPath = path.join(repo, "specops");

    await ensureProjectSpecopsDirectory({ repoPath: repo, specopsPath });

    expect((await stat(specopsPath)).isDirectory()).toBe(true);
  });
});
