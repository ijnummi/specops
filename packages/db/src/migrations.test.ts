import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations/0000_initial.sql");

describe("initial migration", () => {
  it("deduplicates source files before enforcing project path uniqueness", async () => {
    const migration = await readFile(migrationPath, "utf8");

    const dedupePosition = migration.indexOf("WITH ranked_source_files AS");
    const uniquePosition = migration.indexOf(
      "CREATE UNIQUE INDEX IF NOT EXISTS source_files_project_id_path_unique",
    );

    expect(dedupePosition).toBeGreaterThan(-1);
    expect(uniquePosition).toBeGreaterThan(-1);
    expect(dedupePosition).toBeLessThan(uniquePosition);
    expect(migration).toContain("ORDER BY last_seen_at DESC, id DESC");
    expect(migration).toContain("ranked_source_files.duplicate_rank > 1");
  });

  it("enforces source fact project consistency through composite foreign keys", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CONSTRAINT source_files_id_project_id_unique UNIQUE (id, project_id)");

    for (const table of ["source_imports", "source_exports", "source_symbols"]) {
      expect(migration).toContain(
        `CONSTRAINT ${table}_source_file_project_fk FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE`,
      );
    }
  });

  it("creates agent runs storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS agent_runs");
    expect(migration).toContain("task_entity_id text NOT NULL");
    expect(migration).toContain("review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("agent_runs_project_id_idx");
    expect(migration).toContain("agent_runs_project_status_idx");
  });
});
