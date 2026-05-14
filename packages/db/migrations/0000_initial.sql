CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  repo_path text NOT NULL,
  specops_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_slug_unique UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS index_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL,
  entity_count integer NOT NULL DEFAULT 0,
  link_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  source_file_count integer NOT NULL DEFAULT 0,
  source_import_count integer NOT NULL DEFAULT 0,
  source_export_count integer NOT NULL DEFAULT 0,
  source_symbol_count integer NOT NULL DEFAULT 0,
  git_commit text,
  CONSTRAINT index_runs_id_project_id_unique UNIQUE (id, project_id)
);

ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_file_count integer NOT NULL DEFAULT 0;
ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_import_count integer NOT NULL DEFAULT 0;
ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_export_count integer NOT NULL DEFAULT 0;
ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_symbol_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS index_runs_project_id_idx ON index_runs(project_id);
CREATE INDEX IF NOT EXISTS index_runs_project_started_at_idx ON index_runs(project_id, started_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'index_runs_id_project_id_unique'
      AND conrelid = 'index_runs'::regclass
  ) THEN
    ALTER TABLE index_runs
      ADD CONSTRAINT index_runs_id_project_id_unique UNIQUE (id, project_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS spec_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_hash text NOT NULL,
  frontmatter_hash text,
  body_hash text NOT NULL,
  last_indexed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_files_project_id_path_unique UNIQUE (project_id, path)
);

CREATE INDEX IF NOT EXISTS spec_files_project_id_idx ON spec_files(project_id);

CREATE TABLE IF NOT EXISTS spec_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  file_path text NOT NULL,
  frontmatter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_markdown text NOT NULL,
  body_text text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_entities_project_id_entity_id_unique UNIQUE (project_id, entity_id)
);

CREATE INDEX IF NOT EXISTS spec_entities_project_id_idx ON spec_entities(project_id);
CREATE INDEX IF NOT EXISTS spec_entities_project_entity_id_idx ON spec_entities(project_id, entity_id);
CREATE INDEX IF NOT EXISTS spec_entities_project_type_idx ON spec_entities(project_id, type);
CREATE INDEX IF NOT EXISTS spec_entities_project_status_idx ON spec_entities(project_id, status);
CREATE INDEX IF NOT EXISTS spec_entities_search_vector_v2_idx ON spec_entities USING gin (
  (
    setweight(
      to_tsvector(
        'simple',
        coalesce(entity_id, '') || ' ' ||
          regexp_replace(coalesce(entity_id, ''), '[^[:alnum:]]+', ' ', 'g')
      ),
      'A'
    ) ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(status, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_text, '')), 'C')
  )
);
DROP INDEX IF EXISTS spec_entities_search_vector_idx;

CREATE TABLE IF NOT EXISTS spec_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_entity_id text NOT NULL,
  to_entity_id text NOT NULL,
  link_type text NOT NULL,
  source text NOT NULL,
  confidence double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_links_project_from_to_type_source_unique UNIQUE (
    project_id,
    from_entity_id,
    to_entity_id,
    link_type,
    source
  )
);

CREATE INDEX IF NOT EXISTS spec_links_project_id_idx ON spec_links(project_id);
CREATE INDEX IF NOT EXISTS spec_links_project_from_entity_id_idx ON spec_links(project_id, from_entity_id);
CREATE INDEX IF NOT EXISTS spec_links_project_to_entity_id_idx ON spec_links(project_id, to_entity_id);

CREATE TABLE IF NOT EXISTS validation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL,
  file_path text,
  entity_id text,
  level text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS validation_messages_project_id_idx ON validation_messages(project_id);
CREATE INDEX IF NOT EXISTS validation_messages_project_entity_id_idx ON validation_messages(project_id, entity_id);
CREATE INDEX IF NOT EXISTS validation_messages_index_run_id_idx ON validation_messages(index_run_id);

CREATE TABLE IF NOT EXISTS source_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text,
  kind text NOT NULL,
  size_bytes bigint NOT NULL,
  content_hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_files_project_id_path_unique UNIQUE (project_id, path),
  CONSTRAINT source_files_id_project_id_unique UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS source_files_project_id_idx ON source_files(project_id);
CREATE INDEX IF NOT EXISTS source_files_project_path_idx ON source_files(project_id, path);

WITH ranked_source_files AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id, path
      ORDER BY last_seen_at DESC, id DESC
    ) AS duplicate_rank
  FROM source_files
)
DELETE FROM source_files
USING ranked_source_files
WHERE source_files.id = ranked_source_files.id
  AND ranked_source_files.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS source_files_project_id_path_unique ON source_files(project_id, path);
CREATE UNIQUE INDEX IF NOT EXISTS source_files_id_project_id_unique ON source_files(id, project_id);

CREATE TABLE IF NOT EXISTS source_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL,
  file_path text NOT NULL,
  specifier text NOT NULL,
  import_kind text NOT NULL,
  imported_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_relative boolean NOT NULL,
  resolved_path text,
  CONSTRAINT source_imports_source_file_project_fk FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_imports_project_id_idx ON source_imports(project_id);
CREATE INDEX IF NOT EXISTS source_imports_source_file_id_idx ON source_imports(source_file_id);
CREATE INDEX IF NOT EXISTS source_imports_project_specifier_idx ON source_imports(project_id, specifier);

CREATE TABLE IF NOT EXISTS source_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL,
  file_path text NOT NULL,
  exported_name text NOT NULL,
  export_kind text NOT NULL,
  source_specifier text,
  CONSTRAINT source_exports_source_file_project_fk FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_exports_project_id_idx ON source_exports(project_id);
CREATE INDEX IF NOT EXISTS source_exports_source_file_id_idx ON source_exports(source_file_id);
CREATE INDEX IF NOT EXISTS source_exports_project_exported_name_idx ON source_exports(project_id, exported_name);

CREATE TABLE IF NOT EXISTS source_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL,
  file_path text NOT NULL,
  name text NOT NULL,
  symbol_kind text NOT NULL,
  is_exported boolean NOT NULL DEFAULT false,
  line integer,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT source_symbols_source_file_project_fk FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_symbols_project_id_idx ON source_symbols(project_id);
CREATE INDEX IF NOT EXISTS source_symbols_source_file_id_idx ON source_symbols(source_file_id);
CREATE INDEX IF NOT EXISTS source_symbols_project_name_idx ON source_symbols(project_id, name);

CREATE TABLE IF NOT EXISTS source_spec_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL,
  file_path text NOT NULL,
  entity_id text NOT NULL,
  symbol_name text NOT NULL,
  symbol_kind text NOT NULL,
  symbol_line integer,
  annotation_line integer,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_spec_links_project_file_symbol_entity_unique UNIQUE (
    project_id,
    source_file_id,
    symbol_name,
    entity_id
  ),
  CONSTRAINT source_spec_links_source_file_project_fk FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_spec_links_project_id_idx ON source_spec_links(project_id);
CREATE INDEX IF NOT EXISTS source_spec_links_project_entity_id_idx ON source_spec_links(project_id, entity_id);
CREATE INDEX IF NOT EXISTS source_spec_links_source_file_id_idx ON source_spec_links(source_file_id);

DELETE FROM source_imports
WHERE NOT EXISTS (
  SELECT 1
  FROM source_files
  WHERE source_files.id = source_imports.source_file_id
    AND source_files.project_id = source_imports.project_id
);

DELETE FROM source_exports
WHERE NOT EXISTS (
  SELECT 1
  FROM source_files
  WHERE source_files.id = source_exports.source_file_id
    AND source_files.project_id = source_exports.project_id
);

DELETE FROM source_symbols
WHERE NOT EXISTS (
  SELECT 1
  FROM source_files
  WHERE source_files.id = source_symbols.source_file_id
    AND source_files.project_id = source_symbols.project_id
);

ALTER TABLE source_imports DROP CONSTRAINT IF EXISTS source_imports_source_file_id_fkey;
ALTER TABLE source_exports DROP CONSTRAINT IF EXISTS source_exports_source_file_id_fkey;
ALTER TABLE source_symbols DROP CONSTRAINT IF EXISTS source_symbols_source_file_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_imports_source_file_project_fk'
      AND conrelid = 'source_imports'::regclass
  ) THEN
    ALTER TABLE source_imports
      ADD CONSTRAINT source_imports_source_file_project_fk
      FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_exports_source_file_project_fk'
      AND conrelid = 'source_exports'::regclass
  ) THEN
    ALTER TABLE source_exports
      ADD CONSTRAINT source_exports_source_file_project_fk
      FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_symbols_source_file_project_fk'
      AND conrelid = 'source_symbols'::regclass
  ) THEN
    ALTER TABLE source_symbols
      ADD CONSTRAINT source_symbols_source_file_project_fk
      FOREIGN KEY (source_file_id, project_id) REFERENCES source_files(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposal_type text NOT NULL,
  title text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence double precision,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT ai_proposals_id_project_id_unique UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS ai_proposals_project_id_idx ON ai_proposals(project_id);
CREATE INDEX IF NOT EXISTS ai_proposals_project_status_idx ON ai_proposals(project_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_proposals_id_project_id_unique'
      AND conrelid = 'ai_proposals'::regclass
  ) THEN
    ALTER TABLE ai_proposals
      ADD CONSTRAINT ai_proposals_id_project_id_unique UNIQUE (id, project_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_entity_id text NOT NULL,
  agent text NOT NULL,
  status text NOT NULL,
  prompt_markdown text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  start_git_commit text,
  end_git_commit text,
  start_dirty_files_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  end_dirty_files_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_files_json jsonb NOT NULL DEFAULT '{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb,
  review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_project_id_idx ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS agent_runs_project_status_idx ON agent_runs(project_id, status);
CREATE INDEX IF NOT EXISTS agent_runs_project_task_entity_id_idx ON agent_runs(project_id, task_entity_id);
CREATE INDEX IF NOT EXISTS agent_runs_project_started_at_idx ON agent_runs(project_id, started_at);

CREATE TABLE IF NOT EXISTS diff_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  review_type text NOT NULL,
  base_ref text,
  head_ref text,
  base_commit text,
  head_commit text,
  changed_files_json jsonb NOT NULL DEFAULT '{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb,
  review_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diff_reviews_project_id_idx ON diff_reviews(project_id);
CREATE INDEX IF NOT EXISTS diff_reviews_project_status_idx ON diff_reviews(project_id, status);
CREATE INDEX IF NOT EXISTS diff_reviews_project_created_at_idx ON diff_reviews(project_id, created_at);

CREATE TABLE IF NOT EXISTS analyze_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  current_step text,
  steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  selection_json jsonb,
  proposal_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_proposal_count integer NOT NULL DEFAULT 0,
  ai_proposal_count integer NOT NULL DEFAULT 0,
  index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT analyze_runs_id_project_id_unique UNIQUE (id, project_id)
);

ALTER TABLE analyze_runs ADD COLUMN IF NOT EXISTS proposal_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS analyze_runs_project_id_idx ON analyze_runs(project_id);
CREATE INDEX IF NOT EXISTS analyze_runs_project_status_idx ON analyze_runs(project_id, status);
CREATE INDEX IF NOT EXISTS analyze_runs_project_created_at_idx ON analyze_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS analyze_runs_index_run_id_idx ON analyze_runs(index_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS analyze_runs_one_active_per_project_idx ON analyze_runs(project_id) WHERE status IN ('queued', 'running');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_runs_id_project_id_unique'
      AND conrelid = 'analyze_runs'::regclass
  ) THEN
    ALTER TABLE analyze_runs
      ADD CONSTRAINT analyze_runs_id_project_id_unique UNIQUE (id, project_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "system_map_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "analyze_run_id" uuid NOT NULL,
  "status" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "coverage_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "diagnostics_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_map_snapshots_analyze_run_id_unique" UNIQUE("analyze_run_id"),
  CONSTRAINT "system_map_snapshots_id_project_id_unique" UNIQUE("id","project_id")
);

CREATE TABLE IF NOT EXISTS "system_map_areas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "area_type" text NOT NULL,
  "name" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "confidence" double precision,
  "evidence_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "key_files_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "key_symbols_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_proposal_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "diagnostics_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_snapshots_analyze_run_id_unique'
      AND conrelid = 'system_map_snapshots'::regclass
  ) THEN
    ALTER TABLE "system_map_snapshots"
      ADD CONSTRAINT "system_map_snapshots_analyze_run_id_unique" UNIQUE ("analyze_run_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_snapshots_id_project_id_unique'
      AND conrelid = 'system_map_snapshots'::regclass
  ) THEN
    ALTER TABLE "system_map_snapshots"
      ADD CONSTRAINT "system_map_snapshots_id_project_id_unique" UNIQUE ("id","project_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_snapshots_project_id_projects_id_fk'
      AND conrelid = 'system_map_snapshots'::regclass
  ) THEN
    ALTER TABLE "system_map_snapshots"
      ADD CONSTRAINT "system_map_snapshots_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_snapshots_analyze_run_id_analyze_runs_id_fk'
      AND conrelid = 'system_map_snapshots'::regclass
  ) THEN
    ALTER TABLE "system_map_snapshots"
      ADD CONSTRAINT "system_map_snapshots_analyze_run_id_analyze_runs_id_fk"
      FOREIGN KEY ("analyze_run_id") REFERENCES "analyze_runs"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_snapshots_analyze_run_project_fk'
      AND conrelid = 'system_map_snapshots'::regclass
  ) THEN
    ALTER TABLE "system_map_snapshots"
      ADD CONSTRAINT "system_map_snapshots_analyze_run_project_fk"
      FOREIGN KEY ("analyze_run_id","project_id") REFERENCES "analyze_runs"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_areas_snapshot_id_system_map_snapshots_id_fk'
      AND conrelid = 'system_map_areas'::regclass
  ) THEN
    ALTER TABLE "system_map_areas"
      ADD CONSTRAINT "system_map_areas_snapshot_id_system_map_snapshots_id_fk"
      FOREIGN KEY ("snapshot_id") REFERENCES "system_map_snapshots"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_areas_project_id_projects_id_fk'
      AND conrelid = 'system_map_areas'::regclass
  ) THEN
    ALTER TABLE "system_map_areas"
      ADD CONSTRAINT "system_map_areas_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_map_areas_snapshot_project_fk'
      AND conrelid = 'system_map_areas'::regclass
  ) THEN
    ALTER TABLE "system_map_areas"
      ADD CONSTRAINT "system_map_areas_snapshot_project_fk"
      FOREIGN KEY ("snapshot_id","project_id") REFERENCES "system_map_snapshots"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "system_map_snapshots_project_id_idx"
  ON "system_map_snapshots" ("project_id");

CREATE INDEX IF NOT EXISTS "system_map_snapshots_project_run_idx"
  ON "system_map_snapshots" ("project_id","analyze_run_id");

CREATE INDEX IF NOT EXISTS "system_map_areas_snapshot_id_idx"
  ON "system_map_areas" ("snapshot_id");

CREATE INDEX IF NOT EXISTS "system_map_areas_snapshot_type_idx"
  ON "system_map_areas" ("snapshot_id","area_type");

CREATE INDEX IF NOT EXISTS "system_map_areas_project_id_idx"
  ON "system_map_areas" ("project_id");

CREATE TABLE IF NOT EXISTS "project_graph_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "index_run_id" uuid REFERENCES "index_runs"("id") ON DELETE set null,
  "status" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "coverage_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "diagnostics_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_graph_versions_id_project_id_unique" UNIQUE("id","project_id")
);

CREATE TABLE IF NOT EXISTS "project_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "graph_version_id" uuid NOT NULL REFERENCES "project_graph_versions"("id") ON DELETE cascade,
  "node_key" text NOT NULL,
  "node_type" text NOT NULL,
  "label" text NOT NULL,
  "path" text,
  "symbol_name" text,
  "entity_id" text,
  "source_ref_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_graph_nodes_version_key_unique" UNIQUE("graph_version_id","node_key"),
  CONSTRAINT "project_graph_nodes_id_project_id_unique" UNIQUE("id","project_id"),
  CONSTRAINT "project_graph_nodes_id_project_id_graph_version_id_unique" UNIQUE("id","project_id","graph_version_id")
);

CREATE TABLE IF NOT EXISTS "project_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "graph_version_id" uuid NOT NULL REFERENCES "project_graph_versions"("id") ON DELETE cascade,
  "from_node_id" uuid NOT NULL,
  "to_node_id" uuid NOT NULL,
  "edge_type" text NOT NULL,
  "provenance" text NOT NULL,
  "source_ref_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_versions_index_run_project_fk'
      AND conrelid = 'project_graph_versions'::regclass
  ) THEN
    ALTER TABLE "project_graph_versions"
      ADD CONSTRAINT "project_graph_versions_index_run_project_fk"
      FOREIGN KEY ("index_run_id","project_id") REFERENCES "index_runs"("id","project_id") ON DELETE SET NULL ("index_run_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_nodes_id_project_id_graph_version_id_unique'
      AND conrelid = 'project_graph_nodes'::regclass
  ) THEN
    ALTER TABLE "project_graph_nodes"
      ADD CONSTRAINT "project_graph_nodes_id_project_id_graph_version_id_unique" UNIQUE("id","project_id","graph_version_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_nodes_version_project_fk'
      AND conrelid = 'project_graph_nodes'::regclass
  ) THEN
    ALTER TABLE "project_graph_nodes"
      ADD CONSTRAINT "project_graph_nodes_version_project_fk"
      FOREIGN KEY ("graph_version_id","project_id") REFERENCES "project_graph_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_edges_version_project_fk'
      AND conrelid = 'project_graph_edges'::regclass
  ) THEN
    ALTER TABLE "project_graph_edges"
      ADD CONSTRAINT "project_graph_edges_version_project_fk"
      FOREIGN KEY ("graph_version_id","project_id") REFERENCES "project_graph_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

ALTER TABLE "project_graph_edges" DROP CONSTRAINT IF EXISTS "project_graph_edges_from_node_project_fk";
ALTER TABLE "project_graph_edges" DROP CONSTRAINT IF EXISTS "project_graph_edges_to_node_project_fk";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_edges_from_node_project_fk'
      AND conrelid = 'project_graph_edges'::regclass
  ) THEN
    ALTER TABLE "project_graph_edges"
      ADD CONSTRAINT "project_graph_edges_from_node_project_fk"
      FOREIGN KEY ("from_node_id","project_id","graph_version_id") REFERENCES "project_graph_nodes"("id","project_id","graph_version_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_graph_edges_to_node_project_fk'
      AND conrelid = 'project_graph_edges'::regclass
  ) THEN
    ALTER TABLE "project_graph_edges"
      ADD CONSTRAINT "project_graph_edges_to_node_project_fk"
      FOREIGN KEY ("to_node_id","project_id","graph_version_id") REFERENCES "project_graph_nodes"("id","project_id","graph_version_id") ON DELETE cascade;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_graph_versions_project_id_idx"
  ON "project_graph_versions" ("project_id");
CREATE INDEX IF NOT EXISTS "project_graph_versions_project_status_created_idx"
  ON "project_graph_versions" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "project_graph_versions_index_run_id_idx"
  ON "project_graph_versions" ("index_run_id");
CREATE INDEX IF NOT EXISTS "project_graph_nodes_graph_version_id_idx"
  ON "project_graph_nodes" ("graph_version_id");
CREATE INDEX IF NOT EXISTS "project_graph_nodes_version_type_idx"
  ON "project_graph_nodes" ("graph_version_id","node_type");
CREATE INDEX IF NOT EXISTS "project_graph_nodes_project_type_idx"
  ON "project_graph_nodes" ("project_id","node_type");
CREATE INDEX IF NOT EXISTS "project_graph_edges_graph_version_id_idx"
  ON "project_graph_edges" ("graph_version_id");
CREATE INDEX IF NOT EXISTS "project_graph_edges_version_type_idx"
  ON "project_graph_edges" ("graph_version_id","edge_type");
CREATE INDEX IF NOT EXISTS "project_graph_edges_from_node_idx"
  ON "project_graph_edges" ("from_node_id");
CREATE INDEX IF NOT EXISTS "project_graph_edges_to_node_idx"
  ON "project_graph_edges" ("to_node_id");

CREATE TABLE IF NOT EXISTS "project_concept_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_graph_version_id" uuid NOT NULL REFERENCES "project_graph_versions"("id") ON DELETE cascade,
  "status" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "coverage_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "diagnostics_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_concept_versions_id_project_id_unique" UNIQUE("id","project_id"),
  CONSTRAINT "project_concept_versions_id_project_id_project_graph_version_id_unique" UNIQUE("id","project_id","project_graph_version_id")
);

CREATE TABLE IF NOT EXISTS "project_concepts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "concept_version_id" uuid NOT NULL REFERENCES "project_concept_versions"("id") ON DELETE cascade,
  "concept_key" text NOT NULL,
  "concept_type" text NOT NULL,
  "name" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "confidence" double precision NOT NULL,
  "provenance" text NOT NULL,
  "evidence_summary" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'active',
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_concepts_version_key_unique" UNIQUE("concept_version_id","concept_key"),
  CONSTRAINT "project_concepts_id_project_id_unique" UNIQUE("id","project_id"),
  CONSTRAINT "project_concepts_id_project_id_concept_version_id_unique" UNIQUE("id","project_id","concept_version_id")
);

CREATE TABLE IF NOT EXISTS "project_concept_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "concept_version_id" uuid NOT NULL,
  "project_graph_version_id" uuid NOT NULL,
  "concept_id" uuid NOT NULL,
  "graph_node_id" uuid NOT NULL,
  "role" text NOT NULL,
  "confidence" double precision NOT NULL,
  "rationale" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "project_concept_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "concept_version_id" uuid NOT NULL REFERENCES "project_concept_versions"("id") ON DELETE cascade,
  "from_concept_id" uuid NOT NULL,
  "to_concept_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "confidence" double precision NOT NULL,
  "rationale" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "project_concept_memberships"
  ADD COLUMN IF NOT EXISTS "project_graph_version_id" uuid;

UPDATE "project_concept_memberships" AS membership
SET "project_graph_version_id" = version."project_graph_version_id"
FROM "project_concept_versions" AS version
WHERE membership."project_graph_version_id" IS NULL
  AND membership."concept_version_id" = version."id"
  AND membership."project_id" = version."project_id";

ALTER TABLE "project_concept_memberships"
  ALTER COLUMN "project_graph_version_id" SET NOT NULL;

DELETE FROM "project_concept_memberships" AS membership
WHERE NOT EXISTS (
  SELECT 1
  FROM "project_graph_nodes" AS node
  WHERE node."id" = membership."graph_node_id"
    AND node."project_id" = membership."project_id"
    AND node."graph_version_id" = membership."project_graph_version_id"
);

DELETE FROM "project_concept_relationships" AS relationship
WHERE EXISTS (
  SELECT 1
  FROM "project_concepts" AS concept
  WHERE concept."id" IN (relationship."from_concept_id", relationship."to_concept_id")
    AND concept."project_id" = relationship."project_id"
    AND concept."concept_version_id" = relationship."concept_version_id"
    AND NOT EXISTS (
      SELECT 1
      FROM "project_concept_memberships" AS membership
      WHERE membership."concept_id" = concept."id"
        AND membership."project_id" = concept."project_id"
        AND membership."concept_version_id" = concept."concept_version_id"
    )
);

DELETE FROM "project_concepts" AS concept
WHERE NOT EXISTS (
  SELECT 1
  FROM "project_concept_memberships" AS membership
  WHERE membership."concept_id" = concept."id"
    AND membership."project_id" = concept."project_id"
    AND membership."concept_version_id" = concept."concept_version_id"
);

ALTER TABLE "project_concept_versions" DROP CONSTRAINT IF EXISTS "project_concept_versions_graph_version_project_fk";
ALTER TABLE "project_concepts" DROP CONSTRAINT IF EXISTS "project_concepts_version_project_fk";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_concept_version_id_fkey";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_concept_version_id_project_concept_versions_id_fk";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_version_project_fk";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_version_project_graph_version_fk";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_concept_project_fk";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_graph_node_project_fk";
ALTER TABLE "project_concept_memberships" DROP CONSTRAINT IF EXISTS "project_concept_memberships_graph_node_project_graph_version_fk";
ALTER TABLE "project_concept_relationships" DROP CONSTRAINT IF EXISTS "project_concept_relationships_version_project_fk";
ALTER TABLE "project_concept_relationships" DROP CONSTRAINT IF EXISTS "project_concept_relationships_from_concept_project_fk";
ALTER TABLE "project_concept_relationships" DROP CONSTRAINT IF EXISTS "project_concept_relationships_to_concept_project_fk";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_versions_id_project_id_project_graph_version_id_unique'
      AND conrelid = 'project_concept_versions'::regclass
  ) THEN
    ALTER TABLE "project_concept_versions"
      ADD CONSTRAINT "project_concept_versions_id_project_id_project_graph_version_id_unique" UNIQUE("id","project_id","project_graph_version_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_versions_graph_version_project_fk'
      AND conrelid = 'project_concept_versions'::regclass
  ) THEN
    ALTER TABLE "project_concept_versions"
      ADD CONSTRAINT "project_concept_versions_graph_version_project_fk"
      FOREIGN KEY ("project_graph_version_id","project_id") REFERENCES "project_graph_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concepts_version_project_fk'
      AND conrelid = 'project_concepts'::regclass
  ) THEN
    ALTER TABLE "project_concepts"
      ADD CONSTRAINT "project_concepts_version_project_fk"
      FOREIGN KEY ("concept_version_id","project_id") REFERENCES "project_concept_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_memberships_version_project_graph_version_fk'
      AND conrelid = 'project_concept_memberships'::regclass
  ) THEN
    ALTER TABLE "project_concept_memberships"
      ADD CONSTRAINT "project_concept_memberships_version_project_graph_version_fk"
      FOREIGN KEY ("concept_version_id","project_id","project_graph_version_id") REFERENCES "project_concept_versions"("id","project_id","project_graph_version_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_memberships_concept_project_fk'
      AND conrelid = 'project_concept_memberships'::regclass
  ) THEN
    ALTER TABLE "project_concept_memberships"
      ADD CONSTRAINT "project_concept_memberships_concept_project_fk"
      FOREIGN KEY ("concept_id","project_id","concept_version_id") REFERENCES "project_concepts"("id","project_id","concept_version_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_memberships_graph_node_project_graph_version_fk'
      AND conrelid = 'project_concept_memberships'::regclass
  ) THEN
    ALTER TABLE "project_concept_memberships"
      ADD CONSTRAINT "project_concept_memberships_graph_node_project_graph_version_fk"
      FOREIGN KEY ("graph_node_id","project_id","project_graph_version_id") REFERENCES "project_graph_nodes"("id","project_id","graph_version_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_relationships_version_project_fk'
      AND conrelid = 'project_concept_relationships'::regclass
  ) THEN
    ALTER TABLE "project_concept_relationships"
      ADD CONSTRAINT "project_concept_relationships_version_project_fk"
      FOREIGN KEY ("concept_version_id","project_id") REFERENCES "project_concept_versions"("id","project_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_relationships_from_concept_project_fk'
      AND conrelid = 'project_concept_relationships'::regclass
  ) THEN
    ALTER TABLE "project_concept_relationships"
      ADD CONSTRAINT "project_concept_relationships_from_concept_project_fk"
      FOREIGN KEY ("from_concept_id","project_id","concept_version_id") REFERENCES "project_concepts"("id","project_id","concept_version_id") ON DELETE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_concept_relationships_to_concept_project_fk'
      AND conrelid = 'project_concept_relationships'::regclass
  ) THEN
    ALTER TABLE "project_concept_relationships"
      ADD CONSTRAINT "project_concept_relationships_to_concept_project_fk"
      FOREIGN KEY ("to_concept_id","project_id","concept_version_id") REFERENCES "project_concepts"("id","project_id","concept_version_id") ON DELETE cascade;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "project_concept_versions_project_id_idx"
  ON "project_concept_versions" ("project_id");
CREATE INDEX IF NOT EXISTS "project_concept_versions_project_status_created_idx"
  ON "project_concept_versions" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "project_concept_versions_graph_version_id_idx"
  ON "project_concept_versions" ("project_graph_version_id");
CREATE INDEX IF NOT EXISTS "project_concepts_concept_version_id_idx"
  ON "project_concepts" ("concept_version_id");
CREATE INDEX IF NOT EXISTS "project_concepts_version_type_idx"
  ON "project_concepts" ("concept_version_id","concept_type");
CREATE INDEX IF NOT EXISTS "project_concepts_project_status_idx"
  ON "project_concepts" ("project_id","status");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_concept_version_id_idx"
  ON "project_concept_memberships" ("concept_version_id");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_graph_version_id_idx"
  ON "project_concept_memberships" ("project_graph_version_id");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_concept_id_idx"
  ON "project_concept_memberships" ("concept_id");
CREATE INDEX IF NOT EXISTS "project_concept_memberships_graph_node_id_idx"
  ON "project_concept_memberships" ("graph_node_id");
CREATE INDEX IF NOT EXISTS "project_concept_relationships_concept_version_id_idx"
  ON "project_concept_relationships" ("concept_version_id");
CREATE INDEX IF NOT EXISTS "project_concept_relationships_from_concept_idx"
  ON "project_concept_relationships" ("from_concept_id");
CREATE INDEX IF NOT EXISTS "project_concept_relationships_to_concept_idx"
  ON "project_concept_relationships" ("to_concept_id");

CREATE TABLE IF NOT EXISTS analyze_review_assemblies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analyze_run_id uuid NOT NULL,
  status text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  file_path text NOT NULL,
  rendered_markdown text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  discarded_at timestamptz,
  FOREIGN KEY (analyze_run_id) REFERENCES analyze_runs(id) ON DELETE CASCADE,
  CONSTRAINT analyze_review_assemblies_id_project_id_unique UNIQUE (id, project_id),
  CONSTRAINT analyze_review_assemblies_run_project_fk FOREIGN KEY (analyze_run_id, project_id) REFERENCES analyze_runs(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analyze_review_assemblies_project_idx ON analyze_review_assemblies(project_id);
CREATE INDEX IF NOT EXISTS analyze_review_assemblies_run_idx ON analyze_review_assemblies(analyze_run_id);
CREATE INDEX IF NOT EXISTS analyze_review_assemblies_run_status_idx ON analyze_review_assemblies(analyze_run_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_assemblies_id_project_id_unique'
      AND conrelid = 'analyze_review_assemblies'::regclass
  ) THEN
    ALTER TABLE analyze_review_assemblies
      ADD CONSTRAINT analyze_review_assemblies_id_project_id_unique UNIQUE (id, project_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_assemblies_run_project_fk'
      AND conrelid = 'analyze_review_assemblies'::regclass
  ) THEN
    ALTER TABLE analyze_review_assemblies
      ADD CONSTRAINT analyze_review_assemblies_run_project_fk
      FOREIGN KEY (analyze_run_id, project_id) REFERENCES analyze_runs(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analyze_review_assembly_inputs (
  assembly_id uuid NOT NULL REFERENCES analyze_review_assemblies(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assembly_id, proposal_id),
  CONSTRAINT analyze_review_assembly_inputs_assembly_project_fk FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE CASCADE,
  CONSTRAINT analyze_review_assembly_inputs_proposal_project_fk FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analyze_review_assembly_inputs_assembly_idx ON analyze_review_assembly_inputs(assembly_id);
CREATE INDEX IF NOT EXISTS analyze_review_assembly_inputs_proposal_idx ON analyze_review_assembly_inputs(proposal_id);

ALTER TABLE analyze_review_assembly_inputs ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

UPDATE analyze_review_assembly_inputs
SET project_id = analyze_review_assemblies.project_id
FROM analyze_review_assemblies
WHERE analyze_review_assembly_inputs.assembly_id = analyze_review_assemblies.id
  AND analyze_review_assembly_inputs.project_id IS NULL;

ALTER TABLE analyze_review_assembly_inputs ALTER COLUMN project_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_assembly_inputs_assembly_project_fk'
      AND conrelid = 'analyze_review_assembly_inputs'::regclass
  ) THEN
    ALTER TABLE analyze_review_assembly_inputs
      ADD CONSTRAINT analyze_review_assembly_inputs_assembly_project_fk
      FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_assembly_inputs_proposal_project_fk'
      AND conrelid = 'analyze_review_assembly_inputs'::regclass
  ) THEN
    ALTER TABLE analyze_review_assembly_inputs
      ADD CONSTRAINT analyze_review_assembly_inputs_proposal_project_fk
      FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analyze_review_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id uuid NOT NULL REFERENCES analyze_review_assemblies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text text NOT NULL,
  kind text NOT NULL,
  confidence double precision,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analyze_review_claims_id_project_id_unique UNIQUE (id, project_id),
  CONSTRAINT analyze_review_claims_assembly_project_fk FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analyze_review_claims_assembly_idx ON analyze_review_claims(assembly_id);

ALTER TABLE analyze_review_claims ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

UPDATE analyze_review_claims
SET project_id = analyze_review_assemblies.project_id
FROM analyze_review_assemblies
WHERE analyze_review_claims.assembly_id = analyze_review_assemblies.id
  AND analyze_review_claims.project_id IS NULL;

ALTER TABLE analyze_review_claims ALTER COLUMN project_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_claims_id_project_id_unique'
      AND conrelid = 'analyze_review_claims'::regclass
  ) THEN
    ALTER TABLE analyze_review_claims
      ADD CONSTRAINT analyze_review_claims_id_project_id_unique UNIQUE (id, project_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_claims_assembly_project_fk'
      AND conrelid = 'analyze_review_claims'::regclass
  ) THEN
    ALTER TABLE analyze_review_claims
      ADD CONSTRAINT analyze_review_claims_assembly_project_fk
      FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analyze_review_claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES analyze_review_claims(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_path text NOT NULL,
  symbol_name text,
  start_line integer,
  end_line integer,
  provenance text NOT NULL,
  confidence double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analyze_review_claim_evidence_id_project_id_unique UNIQUE (id, project_id),
  CONSTRAINT analyze_review_claim_evidence_claim_project_fk FOREIGN KEY (claim_id, project_id) REFERENCES analyze_review_claims(id, project_id) ON DELETE CASCADE,
  CONSTRAINT analyze_review_claim_evidence_proposal_project_fk FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analyze_review_claim_evidence_claim_idx ON analyze_review_claim_evidence(claim_id);
CREATE INDEX IF NOT EXISTS analyze_review_claim_evidence_proposal_idx ON analyze_review_claim_evidence(proposal_id);

ALTER TABLE analyze_review_claim_evidence ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

UPDATE analyze_review_claim_evidence
SET project_id = analyze_review_claims.project_id
FROM analyze_review_claims
WHERE analyze_review_claim_evidence.claim_id = analyze_review_claims.id
  AND analyze_review_claim_evidence.project_id IS NULL;

ALTER TABLE analyze_review_claim_evidence ALTER COLUMN project_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_claim_evidence_id_project_id_unique'
      AND conrelid = 'analyze_review_claim_evidence'::regclass
  ) THEN
    ALTER TABLE analyze_review_claim_evidence
      ADD CONSTRAINT analyze_review_claim_evidence_id_project_id_unique UNIQUE (id, project_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_claim_evidence_claim_project_fk'
      AND conrelid = 'analyze_review_claim_evidence'::regclass
  ) THEN
    ALTER TABLE analyze_review_claim_evidence
      ADD CONSTRAINT analyze_review_claim_evidence_claim_project_fk
      FOREIGN KEY (claim_id, project_id) REFERENCES analyze_review_claims(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyze_review_claim_evidence_proposal_project_fk'
      AND conrelid = 'analyze_review_claim_evidence'::regclass
  ) THEN
    ALTER TABLE analyze_review_claim_evidence
      ADD CONSTRAINT analyze_review_claim_evidence_proposal_project_fk
      FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS source_spec_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid,
  source_file_path text NOT NULL,
  symbol_name text,
  symbol_kind text,
  start_line integer,
  end_line integer,
  annotation_line integer,
  source_content_hash text,
  entity_id text NOT NULL,
  spec_file_path text NOT NULL,
  claim_id uuid,
  relationship_type text NOT NULL,
  confidence double precision,
  provenance text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  analyze_run_id uuid,
  proposal_id uuid,
  assembly_id uuid,
  claim_evidence_id uuid,
  index_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_spec_annotations_claim_project_fk FOREIGN KEY (claim_id, project_id) REFERENCES analyze_review_claims(id, project_id) ON DELETE SET NULL (claim_id),
  CONSTRAINT source_spec_annotations_analyze_run_project_fk FOREIGN KEY (analyze_run_id, project_id) REFERENCES analyze_runs(id, project_id) ON DELETE SET NULL (analyze_run_id),
  CONSTRAINT source_spec_annotations_proposal_project_fk FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id) ON DELETE SET NULL (proposal_id),
  CONSTRAINT source_spec_annotations_assembly_project_fk FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id) ON DELETE SET NULL (assembly_id),
  CONSTRAINT source_spec_annotations_claim_evidence_project_fk FOREIGN KEY (claim_evidence_id, project_id) REFERENCES analyze_review_claim_evidence(id, project_id) ON DELETE SET NULL (claim_evidence_id),
  CONSTRAINT source_spec_annotations_index_run_project_fk FOREIGN KEY (index_run_id, project_id) REFERENCES index_runs(id, project_id) ON DELETE SET NULL (index_run_id)
);

ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_source_file_fk;
ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_claim_id_fkey;
ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_analyze_run_id_fkey;
ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_proposal_id_fkey;
ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_assembly_id_fkey;
ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_claim_evidence_id_fkey;
ALTER TABLE source_spec_annotations DROP CONSTRAINT IF EXISTS source_spec_annotations_index_run_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_spec_annotations_claim_project_fk'
      AND conrelid = 'source_spec_annotations'::regclass
  ) THEN
    ALTER TABLE source_spec_annotations
      ADD CONSTRAINT source_spec_annotations_claim_project_fk
      FOREIGN KEY (claim_id, project_id) REFERENCES analyze_review_claims(id, project_id)
      ON DELETE SET NULL (claim_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_spec_annotations_analyze_run_project_fk'
      AND conrelid = 'source_spec_annotations'::regclass
  ) THEN
    ALTER TABLE source_spec_annotations
      ADD CONSTRAINT source_spec_annotations_analyze_run_project_fk
      FOREIGN KEY (analyze_run_id, project_id) REFERENCES analyze_runs(id, project_id)
      ON DELETE SET NULL (analyze_run_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_spec_annotations_proposal_project_fk'
      AND conrelid = 'source_spec_annotations'::regclass
  ) THEN
    ALTER TABLE source_spec_annotations
      ADD CONSTRAINT source_spec_annotations_proposal_project_fk
      FOREIGN KEY (proposal_id, project_id) REFERENCES ai_proposals(id, project_id)
      ON DELETE SET NULL (proposal_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_spec_annotations_assembly_project_fk'
      AND conrelid = 'source_spec_annotations'::regclass
  ) THEN
    ALTER TABLE source_spec_annotations
      ADD CONSTRAINT source_spec_annotations_assembly_project_fk
      FOREIGN KEY (assembly_id, project_id) REFERENCES analyze_review_assemblies(id, project_id)
      ON DELETE SET NULL (assembly_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_spec_annotations_claim_evidence_project_fk'
      AND conrelid = 'source_spec_annotations'::regclass
  ) THEN
    ALTER TABLE source_spec_annotations
      ADD CONSTRAINT source_spec_annotations_claim_evidence_project_fk
      FOREIGN KEY (claim_evidence_id, project_id) REFERENCES analyze_review_claim_evidence(id, project_id)
      ON DELETE SET NULL (claim_evidence_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_spec_annotations_index_run_project_fk'
      AND conrelid = 'source_spec_annotations'::regclass
  ) THEN
    ALTER TABLE source_spec_annotations
      ADD CONSTRAINT source_spec_annotations_index_run_project_fk
      FOREIGN KEY (index_run_id, project_id) REFERENCES index_runs(id, project_id)
      ON DELETE SET NULL (index_run_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS source_spec_annotations_project_entity_idx
  ON source_spec_annotations(project_id, entity_id);
CREATE INDEX IF NOT EXISTS source_spec_annotations_project_source_file_idx
  ON source_spec_annotations(project_id, source_file_path);
CREATE INDEX IF NOT EXISTS source_spec_annotations_project_relationship_status_idx
  ON source_spec_annotations(project_id, relationship_type, status);
CREATE INDEX IF NOT EXISTS source_spec_annotations_analyze_origin_idx
  ON source_spec_annotations(project_id, analyze_run_id, assembly_id);
CREATE UNIQUE INDEX IF NOT EXISTS source_spec_annotations_active_dedupe_idx
  ON source_spec_annotations(
    project_id,
    source_file_path,
    entity_id,
    relationship_type,
    provenance,
    coalesce(claim_id::text, ''),
    coalesce(symbol_name, ''),
    coalesce(start_line, 0),
    coalesce(end_line, 0)
  )
  WHERE status = 'active';
