import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const sourceDir = dirname(fileURLToPath(import.meta.url));

async function resolveMigrationPath() {
  const sourcePath = join(sourceDir, "../migrations/0000_initial.sql");
  const packagePath = join(sourceDir, "../../migrations/0000_initial.sql");

  for (const path of [sourcePath, packagePath]) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next candidate; tsx and compiled output resolve from different dirs.
    }
  }

  return sourcePath;
}

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const sql = await readFile(await resolveMigrationPath(), "utf8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
}
