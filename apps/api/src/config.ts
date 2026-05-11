import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ApiConfig = {
  databaseUrl: string;
  host: string;
  port: number;
  aiPrefill: {
    ollamaBaseUrl: string;
    openAiBaseUrl: string;
    openAiApiKey?: string;
    timeoutMs: number;
    maxFiles: number;
    maxTotalBytes: number;
  };
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
    port,
    aiPrefill: {
      ollamaBaseUrl: env.AI_PREFILL_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      openAiBaseUrl: env.AI_PREFILL_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      openAiApiKey: env.OPENAI_API_KEY,
      timeoutMs: parseIntegerConfig(env.AI_PREFILL_TIMEOUT_MS, {
        name: "AI_PREFILL_TIMEOUT_MS",
        defaultValue: 60_000,
        min: 1_000
      }),
      maxFiles: parseIntegerConfig(env.AI_PREFILL_MAX_FILES, {
        name: "AI_PREFILL_MAX_FILES",
        defaultValue: 5,
        min: 1,
        max: 20
      }),
      maxTotalBytes: parseIntegerConfig(env.AI_PREFILL_MAX_TOTAL_BYTES, {
        name: "AI_PREFILL_MAX_TOTAL_BYTES",
        defaultValue: 60_000,
        min: 1_000
      })
    }
  };
}

function parseIntegerConfig(
  value: string | undefined,
  options: { name: string; defaultValue: number; min: number; max?: number }
): number {
  const parsed = Number.parseInt(value ?? String(options.defaultValue), 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < options.min ||
    (options.max !== undefined && parsed > options.max)
  ) {
    const maxMessage = options.max === undefined ? "" : ` and <= ${options.max}`;
    throw new Error(`${options.name} must be an integer >= ${options.min}${maxMessage}`);
  }
  return parsed;
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
