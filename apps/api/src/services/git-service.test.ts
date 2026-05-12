import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  readGitRefRangeChangedFiles,
  readGitStagedChangedFiles,
  readGitWorkingTreeChangedFiles,
  resolveGitRef
} from "./git-service.js";

const execFileAsync = promisify(execFile);

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe("git-service diff helpers", () => {
  it("resolves HEAD to a 40-character SHA", async () => {
    const repoPath = await createRepo();
    await writeFile(join(repoPath, "tracked.txt"), "initial\n");
    await git(repoPath, "add", "tracked.txt");
    await git(repoPath, "commit", "-m", "initial");

    await expect(resolveGitRef(repoPath, "HEAD")).resolves.toMatch(/^[a-f0-9]{40}$/);
  });

  it("reads working tree changed files from unstaged tracked, staged, and untracked files", async () => {
    const repoPath = await createRepo();
    await writeFile(join(repoPath, "tracked.txt"), "initial\n");
    await git(repoPath, "add", "tracked.txt");
    await git(repoPath, "commit", "-m", "initial");

    await writeFile(join(repoPath, "tracked.txt"), "modified\n");
    await writeFile(join(repoPath, "staged.txt"), "staged\n");
    await git(repoPath, "add", "staged.txt");
    await writeFile(join(repoPath, "untracked.txt"), "untracked\n");

    await expect(readGitWorkingTreeChangedFiles(repoPath)).resolves.toEqual([
      "staged.txt",
      "tracked.txt",
      "untracked.txt"
    ]);
  });

  it("reads working tree changed files from an initialized repo with no commits", async () => {
    const repoPath = await createRepo();
    await writeFile(join(repoPath, "staged.txt"), "staged\n");
    await git(repoPath, "add", "staged.txt");
    await writeFile(join(repoPath, "untracked.txt"), "untracked\n");

    await expect(readGitWorkingTreeChangedFiles(repoPath)).resolves.toEqual([
      "staged.txt",
      "untracked.txt"
    ]);
  });

  it("reads staged changed files only", async () => {
    const repoPath = await createRepo();
    await writeFile(join(repoPath, "tracked.txt"), "initial\n");
    await git(repoPath, "add", "tracked.txt");
    await git(repoPath, "commit", "-m", "initial");

    await writeFile(join(repoPath, "tracked.txt"), "modified\n");
    await writeFile(join(repoPath, "staged.txt"), "staged\n");
    await git(repoPath, "add", "staged.txt");
    await writeFile(join(repoPath, "untracked.txt"), "untracked\n");

    await expect(readGitStagedChangedFiles(repoPath)).resolves.toEqual(["staged.txt"]);
  });

  it("reads changed files between two commits", async () => {
    const repoPath = await createRepo();
    await writeFile(join(repoPath, "a.txt"), "initial\n");
    await git(repoPath, "add", "a.txt");
    await git(repoPath, "commit", "-m", "initial");
    const baseCommit = await resolveGitRef(repoPath, "HEAD");

    await writeFile(join(repoPath, "a.txt"), "modified\n");
    await writeFile(join(repoPath, "b.txt"), "added\n");
    await git(repoPath, "add", "a.txt", "b.txt");
    await git(repoPath, "commit", "-m", "change files");
    const headCommit = await resolveGitRef(repoPath, "HEAD");

    await expect(readGitRefRangeChangedFiles(repoPath, baseCommit, headCommit)).resolves.toEqual([
      "a.txt",
      "b.txt"
    ]);
  });

  it("rejects invalid refs with a stable error message", async () => {
    const repoPath = await createRepo();

    await expect(resolveGitRef(repoPath, "not-a-ref")).rejects.toThrow("Invalid Git ref: not-a-ref");
  });

  it("rejects non-commit object expressions with a stable error message", async () => {
    const repoPath = await createRepo();
    await writeFile(join(repoPath, "tracked.txt"), "initial\n");
    await git(repoPath, "add", "tracked.txt");
    await git(repoPath, "commit", "-m", "initial");

    await expect(resolveGitRef(repoPath, "HEAD^{tree}")).rejects.toThrow(
      "Invalid Git ref: HEAD^{tree}"
    );
  });
});

async function createRepo(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "specops-git-service-"));
  await git(tempDir, "init");
  await git(tempDir, "config", "user.name", "SpecOps Tests");
  await git(tempDir, "config", "user.email", "specops@example.com");
  return tempDir;
}

async function git(repoPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoPath });
  return stdout.trim();
}
