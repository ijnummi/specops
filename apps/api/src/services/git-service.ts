import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitStatusEntry = {
  indexStatus: string;
  workTreeStatus: string;
  path: string;
  originalPath: string | null;
};

export type GitStatus = {
  isRepo: boolean;
  headCommit: string | null;
  entries: GitStatusEntry[];
};

export async function readGitHeadCommit(repoPath: string): Promise<string | null> {
  const status = await readGitStatus(repoPath, { includeEntries: false });
  return status.headCommit;
}

export async function readGitChangedFiles(
  repoPath: string,
  fromCommit: string,
  toCommit: string
): Promise<string[]> {
  return readGitDiffNameOnly(repoPath, [fromCommit, toCommit]);
}

export async function resolveGitRef(repoPath: string, ref: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", ref], {
      cwd: repoPath
    });
    const commit = stdout.trim();

    if (/^[0-9a-f]{40}$/i.test(commit)) {
      return commit;
    }
  } catch {
    // Fall through to the stable invalid-ref error below.
  }

  throw new Error(`Invalid Git ref: ${ref}`);
}

export async function readGitWorkingTreeChangedFiles(repoPath: string): Promise<string[]> {
  const changedFiles = new Set<string>();
  const [workingTreeFiles, stagedFiles, status] = await Promise.all([
    readGitDiffNameOnly(repoPath, ["HEAD"]),
    readGitDiffNameOnly(repoPath, ["--cached"]),
    readGitStatus(repoPath)
  ]);

  for (const filePath of workingTreeFiles) {
    changedFiles.add(filePath);
  }

  for (const filePath of stagedFiles) {
    changedFiles.add(filePath);
  }

  for (const entry of status.entries) {
    changedFiles.add(entry.path);

    if (entry.originalPath) {
      changedFiles.add(entry.originalPath);
    }
  }

  return sortPaths([...changedFiles].filter((filePath) => filePath.length > 0));
}

export async function readGitStagedChangedFiles(repoPath: string): Promise<string[]> {
  return readGitDiffNameOnly(repoPath, ["--cached"]);
}

export async function readGitRefRangeChangedFiles(
  repoPath: string,
  baseCommit: string,
  headCommit: string
): Promise<string[]> {
  return readGitDiffNameOnly(repoPath, [baseCommit, headCommit]);
}

export async function readGitStatus(
  repoPath: string,
  options: { includeEntries?: boolean } = {}
): Promise<GitStatus> {
  const isRepo = await isInsideWorkTree(repoPath);

  if (!isRepo) {
    return { isRepo: false, headCommit: null, entries: [] };
  }

  const headCommit = await readHeadCommit(repoPath);
  const includeEntries = options.includeEntries ?? true;
  const entries = includeEntries ? await readStatusEntries(repoPath) : [];

  return { isRepo: true, headCommit, entries };
}

async function isInsideWorkTree(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoPath
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function readHeadCommit(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath });
    const commit = stdout.trim();
    return commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

async function readStatusEntries(repoPath: string): Promise<GitStatusEntry[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: repoPath,
      encoding: "buffer"
    }
  );
  return parsePorcelainStatus(stdout.toString("utf8"));
}

async function readGitDiffNameOnly(repoPath: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["diff", "--name-only", ...args, "--"], {
    cwd: repoPath
  });

  return sortPaths(
    Array.from(
      new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      )
    )
  );
}

function sortPaths(paths: string[]): string[] {
  return paths.sort((left, right) => left.localeCompare(right));
}

function parsePorcelainStatus(output: string): GitStatusEntry[] {
  const records = output.split("\0").filter((record) => record.length > 0);
  const entries: GitStatusEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    const indexStatus = record[0] ?? " ";
    const workTreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    const hasOriginalPath = indexStatus === "R" || indexStatus === "C";
    const originalPath = hasOriginalPath ? records[index + 1] ?? null : null;

    if (hasOriginalPath) {
      index += 1;
    }

    entries.push({ indexStatus, workTreeStatus, path, originalPath });
  }

  return entries;
}
