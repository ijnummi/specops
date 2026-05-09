import { existsSync, readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const sourceDir = dirname(fileURLToPath(import.meta.url));

type Env = Record<string, string | undefined>;

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

export async function migrate(connectionString = resolveMigrationConnectionString()) {
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

export function resolveMigrationConnectionString(
  explicitConnectionString?: string,
  env: Env = process.env,
  cwd = process.cwd(),
) {
  if (explicitConnectionString) {
    return explicitConnectionString;
  }

  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  const dotEnvPath = findNearestDotEnv(cwd);
  if (!dotEnvPath) {
    return undefined;
  }

  return parseDotEnv(readFileSync(dotEnvPath, "utf8")).DATABASE_URL;
}

function findNearestDotEnv(startDir: string): string | null {
  let current = startDir;
  while (true) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function parseDotEnv(contents: string): Env {
  const env: Env = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    env[key] = unquote(rawValue);
  }
  return env;
}

function unquote(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
}
