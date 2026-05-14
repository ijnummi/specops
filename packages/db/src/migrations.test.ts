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
    expect(migration).toContain("status text NOT NULL");
    expect(migration).toContain("current_step text");
    expect(migration).toContain("steps_json jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("selection_json jsonb");
    expect(migration).toContain("proposal_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("source_proposal_count integer NOT NULL DEFAULT 0");
    expect(migration).toContain("ai_proposal_count integer NOT NULL DEFAULT 0");
    expect(migration).toContain("index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL");
    expect(migration).toContain("error_message text");
    expect(migration).toContain("created_at timestamptz NOT NULL DEFAULT now()");
    expect(migration).toContain("started_at timestamptz");
    expect(migration).toContain("finished_at timestamptz");
    expect(migration).toContain("CONSTRAINT index_runs_id_project_id_unique UNIQUE (id, project_id)");
    expect(migration).toContain("analyze_runs_project_id_idx");
    expect(migration).toContain("analyze_runs_project_status_idx");
    expect(migration).toContain("analyze_runs_project_created_at_idx");
    expect(migration).toContain("analyze_runs_index_run_id_idx");
    expect(migration).toContain("analyze_runs_one_active_per_project_idx");
    expect(migration).toContain("WHERE status IN ('queued', 'running')");
    expect(migration).toContain(
      "ALTER TABLE analyze_runs ADD COLUMN IF NOT EXISTS proposal_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb",
    );
  });

  it("creates system map storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "system_map_snapshots"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "system_map_areas"');
    expect(migration).toContain(
      'CONSTRAINT "system_map_snapshots_analyze_run_id_unique" UNIQUE("analyze_run_id")',
    );
    expect(migration).toContain(
      'CONSTRAINT "system_map_snapshots_id_project_id_unique" UNIQUE("id","project_id")',
    );
    expect(migration).toContain("system_map_snapshots_project_id_idx");
    expect(migration).toContain("system_map_snapshots_project_run_idx");
    expect(migration).toContain("system_map_areas_snapshot_id_idx");
    expect(migration).toContain("system_map_areas_snapshot_type_idx");
    expect(migration).toContain("system_map_areas_project_id_idx");
    for (const constraintName of [
      "system_map_snapshots_analyze_run_id_unique",
      "system_map_snapshots_id_project_id_unique",
      "system_map_snapshots_project_id_projects_id_fk",
      "system_map_snapshots_analyze_run_id_analyze_runs_id_fk",
      "system_map_snapshots_analyze_run_project_fk",
      "system_map_areas_snapshot_id_system_map_snapshots_id_fk",
      "system_map_areas_project_id_projects_id_fk",
      "system_map_areas_snapshot_project_fk",
    ]) {
      expect(migration).toContain(`conname = '${constraintName}'`);
    }
    expect(migration).toContain(
      'ADD CONSTRAINT "system_map_snapshots_analyze_run_project_fk"',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "system_map_snapshots_analyze_run_id_unique" UNIQUE ("analyze_run_id")',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "system_map_snapshots_id_project_id_unique" UNIQUE ("id","project_id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("analyze_run_id","project_id") REFERENCES "analyze_runs"("id","project_id") ON DELETE cascade',
    );
    expect(migration).toContain("conname = 'system_map_areas_snapshot_project_fk'");
    expect(migration).toContain('ADD CONSTRAINT "system_map_areas_snapshot_project_fk"');
    expect(migration).toContain(
      'FOREIGN KEY ("snapshot_id","project_id") REFERENCES "system_map_snapshots"("id","project_id") ON DELETE cascade',
    );
  });

  it("creates project graph storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_graph_versions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_graph_nodes"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "project_graph_edges"');
    expect(migration).toContain('CONSTRAINT "project_graph_versions_id_project_id_unique" UNIQUE("id","project_id")');
    expect(migration).toContain('CONSTRAINT "project_graph_nodes_id_project_id_unique" UNIQUE("id","project_id")');
    expect(migration).toContain('CONSTRAINT "project_graph_nodes_version_key_unique" UNIQUE("graph_version_id","node_key")');
    expect(migration).toContain("project_graph_versions_project_id_idx");
    expect(migration).toContain("project_graph_versions_project_status_created_idx");
    expect(migration).toContain("project_graph_versions_index_run_id_idx");
    expect(migration).toContain("project_graph_nodes_graph_version_id_idx");
    expect(migration).toContain("project_graph_nodes_version_type_idx");
    expect(migration).toContain("project_graph_nodes_project_type_idx");
    expect(migration).toContain("project_graph_edges_graph_version_id_idx");
    expect(migration).toContain("project_graph_edges_version_type_idx");
    expect(migration).toContain("project_graph_edges_from_node_idx");
    expect(migration).toContain("project_graph_edges_to_node_idx");
    for (const constraintName of [
      "project_graph_versions_index_run_project_fk",
      "project_graph_nodes_version_project_fk",
      "project_graph_edges_version_project_fk",
      "project_graph_edges_from_node_project_fk",
      "project_graph_edges_to_node_project_fk"
    ]) {
      expect(migration).toContain(`conname = '${constraintName}'`);
    }
    expect(migration).toContain(
      'FOREIGN KEY ("index_run_id","project_id") REFERENCES "index_runs"("id","project_id") ON DELETE SET NULL ("index_run_id")',
    );
  });

  it("creates analyze review assembly storage", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_assemblies");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_assembly_inputs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_claims");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analyze_review_claim_evidence");
    expect(migration).toContain("CONSTRAINT ai_proposals_id_project_id_unique UNIQUE (id, project_id)");
    expect(migration).toContain("CONSTRAINT analyze_runs_id_project_id_unique UNIQUE (id, project_id)");
    expect(migration).toContain(
      "CONSTRAINT analyze_review_assemblies_id_project_id_unique UNIQUE (id, project_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT analyze_review_claims_id_project_id_unique UNIQUE (id, project_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT analyze_review_claim_evidence_id_project_id_unique UNIQUE (id, project_id)",
    );
    expect(migration).toContain(
      [
        "CREATE TABLE IF NOT EXISTS analyze_review_assemblies (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,",
      ].join("\n"),
    );
    expect(migration).toContain("analyze_review_assemblies_project_idx");
    expect(migration).toContain("analyze_review_assemblies_run_idx");
    expect(migration).toContain("analyze_review_assemblies_run_status_idx");
    expect(migration).toContain("analyze_review_assembly_inputs_assembly_idx");
    expect(migration).toContain("analyze_review_assembly_inputs_proposal_idx");
    expect(migration).toContain("analyze_review_claims_assembly_idx");
    expect(migration).toContain("analyze_review_claim_evidence_claim_idx");
    expect(migration).toContain("analyze_review_claim_evidence_proposal_idx");
    expect(migration).toContain(
      "CONSTRAINT analyze_review_assemblies_run_project_fk FOREIGN KEY (analyze_run_id, project_id) REFERENCES analyze_runs(id, project_id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "assembly_id uuid NOT NULL REFERENCES analyze_review_assemblies(id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "claim_id uuid NOT NULL REFERENCES analyze_review_claims(id) ON DELETE CASCADE",
    );
    expect(
      migration.match(/proposal_id uuid NOT NULL REFERENCES ai_proposals\(id\) ON DELETE CASCADE/g),
    ).toHaveLength(2);
    expect(migration).toContain("project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE");
    expect(migration).toContain(
      "CONSTRAINT analyze_review_assembly_inputs_assembly_project_fk FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "CONSTRAINT analyze_review_assembly_inputs_proposal_project_fk FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "CONSTRAINT analyze_review_claims_assembly_project_fk FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "CONSTRAINT analyze_review_claim_evidence_claim_project_fk FOREIGN KEY (claim_id, project_id) REFERENCES analyze_review_claims(id, project_id) ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "CONSTRAINT analyze_review_claim_evidence_proposal_project_fk FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE CASCADE",
    );
  });

  it("creates source spec annotation storage and lookup indexes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS source_spec_annotations");
    expect(migration).toContain("relationship_type text NOT NULL");
    expect(migration).toContain("provenance text NOT NULL");
    expect(migration).toContain("status text NOT NULL");
    expect(migration).toContain("annotation_line integer");
    expect(migration).toContain("source_file_id uuid");
    expect(migration).not.toContain("FOREIGN KEY (source_file_id) REFERENCES source_files");
    expect(migration).toContain(
      "CONSTRAINT source_spec_annotations_claim_project_fk FOREIGN KEY (claim_id, project_id) REFERENCES analyze_review_claims(id, project_id) ON DELETE SET NULL (claim_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT source_spec_annotations_analyze_run_project_fk FOREIGN KEY (analyze_run_id, project_id) REFERENCES analyze_runs(id, project_id) ON DELETE SET NULL (analyze_run_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT source_spec_annotations_proposal_project_fk FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE SET NULL (proposal_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT source_spec_annotations_assembly_project_fk FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE SET NULL (assembly_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT source_spec_annotations_claim_evidence_project_fk FOREIGN KEY (claim_evidence_id, project_id) REFERENCES analyze_review_claim_evidence(id, project_id) ON DELETE SET NULL (claim_evidence_id)",
    );
    expect(migration).toContain(
      "CONSTRAINT source_spec_annotations_index_run_project_fk FOREIGN KEY (index_run_id, project_id) REFERENCES index_runs(id, project_id) ON DELETE SET NULL (index_run_id)",
    );
    expect(migration).toContain("source_spec_annotations_project_entity_idx");
    expect(migration).toContain("source_spec_annotations_project_source_file_idx");
    expect(migration).toContain("source_spec_annotations_project_relationship_status_idx");
    expect(migration).toContain("source_spec_annotations_active_dedupe_idx");
  });
});
