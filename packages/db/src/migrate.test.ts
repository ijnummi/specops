import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveMigrationConnectionString } from "./migrate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("migration connection string resolution", () => {
  it("loads DATABASE_URL from the nearest .env when process env is unset", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "specops-db-migrate-"));
    tempDirs.push(tempDir);
    const packageDir = join(tempDir, "packages", "db");
    await writeFile(
      join(tempDir, ".env"),
      "DATABASE_URL=postgres://specops:specops@localhost:5436/specops\n",
    );

    expect(resolveMigrationConnectionString(undefined, {}, packageDir)).toBe(
      "postgres://specops:specops@localhost:5436/specops",
    );
  });

  it("prefers an explicit connection string over env files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "specops-db-migrate-"));
    tempDirs.push(tempDir);
    await writeFile(join(tempDir, ".env"), "DATABASE_URL=postgres://from-file\n");

    expect(resolveMigrationConnectionString("postgres://explicit", {}, tempDir)).toBe("postgres://explicit");
  });
});
