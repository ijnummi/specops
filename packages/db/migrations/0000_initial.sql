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
  git_commit text
);

ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_file_count integer NOT NULL DEFAULT 0;
ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_import_count integer NOT NULL DEFAULT 0;
ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_export_count integer NOT NULL DEFAULT 0;
ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS source_symbol_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS index_runs_project_id_idx ON index_runs(project_id);
CREATE INDEX IF NOT EXISTS index_runs_project_started_at_idx ON index_runs(project_id, started_at);

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
  CONSTRAINT source_files_project_id_path_unique UNIQUE (project_id, path)
);

CREATE INDEX IF NOT EXISTS source_files_project_id_idx ON source_files(project_id);
CREATE INDEX IF NOT EXISTS source_files_project_path_idx ON source_files(project_id, path);
CREATE UNIQUE INDEX IF NOT EXISTS source_files_project_id_path_unique ON source_files(project_id, path);

CREATE TABLE IF NOT EXISTS source_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  specifier text NOT NULL,
  import_kind text NOT NULL,
  imported_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_relative boolean NOT NULL,
  resolved_path text
);

CREATE INDEX IF NOT EXISTS source_imports_project_id_idx ON source_imports(project_id);
CREATE INDEX IF NOT EXISTS source_imports_source_file_id_idx ON source_imports(source_file_id);
CREATE INDEX IF NOT EXISTS source_imports_project_specifier_idx ON source_imports(project_id, specifier);

CREATE TABLE IF NOT EXISTS source_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  exported_name text NOT NULL,
  export_kind text NOT NULL,
  source_specifier text
);

CREATE INDEX IF NOT EXISTS source_exports_project_id_idx ON source_exports(project_id);
CREATE INDEX IF NOT EXISTS source_exports_source_file_id_idx ON source_exports(source_file_id);
CREATE INDEX IF NOT EXISTS source_exports_project_exported_name_idx ON source_exports(project_id, exported_name);

CREATE TABLE IF NOT EXISTS source_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  name text NOT NULL,
  symbol_kind text NOT NULL,
  is_exported boolean NOT NULL DEFAULT false,
  line integer,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS source_symbols_project_id_idx ON source_symbols(project_id);
CREATE INDEX IF NOT EXISTS source_symbols_source_file_id_idx ON source_symbols(source_file_id);
CREATE INDEX IF NOT EXISTS source_symbols_project_name_idx ON source_symbols(project_id, name);

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
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_proposals_project_id_idx ON ai_proposals(project_id);
CREATE INDEX IF NOT EXISTS ai_proposals_project_status_idx ON ai_proposals(project_id, status);
