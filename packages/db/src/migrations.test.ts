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

  it("creates diff review storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS diff_reviews");
    expect(migration).toContain("project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE");
    expect(migration).toContain("status text NOT NULL");
    expect(migration).toContain("review_type text NOT NULL");
    expect(migration).toContain("base_ref text");
    expect(migration).toContain("head_ref text");
    expect(migration).toContain("base_commit text");
    expect(migration).toContain("head_commit text");
    expect(migration).toContain(
      "changed_files_json jsonb NOT NULL DEFAULT '{\"specs\":[],\"source\":[],\"tests\":[],\"other\":[]}'::jsonb",
    );
    expect(migration).toContain("review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("created_at timestamptz NOT NULL DEFAULT now()");
    expect(migration).toContain("updated_at timestamptz NOT NULL DEFAULT now()");
    expect(migration).toContain("diff_reviews_project_id_idx");
    expect(migration).toContain("diff_reviews_project_status_idx");
    expect(migration).toContain("diff_reviews_project_created_at_idx");
  });

  it("creates analyze run storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_runs");
    expect(migration).toContain("project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE");
    expect(migration).toContain("steps_json jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("selection_json jsonb");
    expect(migration).toContain("source_proposal_count integer NOT NULL DEFAULT 0");
    expect(migration).toContain("ai_proposal_count integer NOT NULL DEFAULT 0");
    expect(migration).toContain("analyze_runs_project_id_idx");
    expect(migration).toContain("analyze_runs_project_status_idx");
  });
});
