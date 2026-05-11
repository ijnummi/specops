import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
let tempDir: string | null = null;

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe("loadConfig", () => {
  it("defaults to the normal local API port when API_PORT is unset", () => {
    expect(
      loadConfig({
        DATABASE_URL: "postgres://specops:specops@localhost:5436/specops"
      })
    ).toEqual({
      databaseUrl: "postgres://specops:specops@localhost:5436/specops",
      host: "127.0.0.1",
      port: 4004,
      aiPrefill: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiApiKey: undefined,
        timeoutMs: 60_000,
        maxFiles: 5,
        maxTotalBytes: 60_000
      }
    });
  });

  it("loads DATABASE_URL from the nearest parent .env when process env is unset", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "specops-config-"));
    const apiDir = join(tempDir, "apps", "api");
    await mkdir(apiDir, { recursive: true });
    await writeFile(
      join(tempDir, ".env"),
      [
        "DATABASE_URL=postgres://specops:specops@localhost:5436/specops",
        "API_HOST=0.0.0.0",
        "API_PORT=4010"
      ].join("\n")
    );

    delete process.env.DATABASE_URL;
    delete process.env.API_HOST;
    delete process.env.API_PORT;
    process.chdir(apiDir);

    expect(loadConfig()).toEqual({
      databaseUrl: "postgres://specops:specops@localhost:5436/specops",
      host: "0.0.0.0",
      port: 4010,
      aiPrefill: {
        ollamaBaseUrl: "http://127.0.0.1:11434",
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiApiKey: undefined,
        timeoutMs: 60_000,
        maxFiles: 5,
        maxTotalBytes: 60_000
      }
    });
  });
});
