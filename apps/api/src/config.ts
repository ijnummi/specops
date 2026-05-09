import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ApiConfig = {
  databaseUrl: string;
  host: string;
  port: number;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = loadProcessEnvWithDotEnv()): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const port = Number.parseInt(env.API_PORT ?? "4004", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("API_PORT must be a valid TCP port");
  }

  return {
    databaseUrl,
    host: env.API_HOST ?? "127.0.0.1",
    port
  };
}

function loadProcessEnvWithDotEnv(cwd = process.cwd()): Env {
  const dotEnvPath = findNearestDotEnv(cwd);
  if (!dotEnvPath) {
    return process.env;
  }

  return {
    ...parseDotEnv(readFileSync(dotEnvPath, "utf8")),
    ...process.env
  };
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
