import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const primaryId = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const projects = pgTable(
  "projects",
  {
    id: primaryId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    repoPath: text("repo_path").notNull(),
    specopsPath: text("specops_path").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    slugUnique: unique("projects_slug_unique").on(table.slug),
  }),
);

export const indexRuns = pgTable(
  "index_runs",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    entityCount: integer("entity_count").notNull().default(0),
    linkCount: integer("link_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    sourceFileCount: integer("source_file_count").notNull().default(0),
    sourceImportCount: integer("source_import_count").notNull().default(0),
    sourceExportCount: integer("source_export_count").notNull().default(0),
    sourceSymbolCount: integer("source_symbol_count").notNull().default(0),
    gitCommit: text("git_commit"),
  },
  (table) => ({
    projectIdx: index("index_runs_project_id_idx").on(table.projectId),
    projectStartedAtIdx: index("index_runs_project_started_at_idx").on(table.projectId, table.startedAt),
    idProjectUnique: unique("index_runs_id_project_id_unique").on(table.id, table.projectId),
  }),
);

export const specFiles = pgTable(
  "spec_files",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    frontmatterHash: text("frontmatter_hash"),
    bodyHash: text("body_hash").notNull(),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("spec_files_project_id_idx").on(table.projectId),
    projectPathUnique: unique("spec_files_project_id_path_unique").on(table.projectId, table.path),
  }),
);

export const specEntities = pgTable(
  "spec_entities",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    filePath: text("file_path").notNull(),
    frontmatterJson: jsonb("frontmatter_json").notNull().default(sql`'{}'::jsonb`),
    bodyMarkdown: text("body_markdown").notNull(),
    bodyText: text("body_text").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("spec_entities_project_id_idx").on(table.projectId),
    projectEntityIdIdx: index("spec_entities_project_entity_id_idx").on(table.projectId, table.entityId),
    projectTypeIdx: index("spec_entities_project_type_idx").on(table.projectId, table.type),
    projectStatusIdx: index("spec_entities_project_status_idx").on(table.projectId, table.status),
    projectEntityUnique: unique("spec_entities_project_id_entity_id_unique").on(table.projectId, table.entityId),
  }),
);

export const specLinks = pgTable(
  "spec_links",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fromEntityId: text("from_entity_id").notNull(),
    toEntityId: text("to_entity_id").notNull(),
    linkType: text("link_type").notNull(),
    source: text("source").notNull(),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    projectIdx: index("spec_links_project_id_idx").on(table.projectId),
    projectFromEntityIdx: index("spec_links_project_from_entity_id_idx").on(table.projectId, table.fromEntityId),
    projectToEntityIdx: index("spec_links_project_to_entity_id_idx").on(table.projectId, table.toEntityId),
    projectLinkUnique: unique("spec_links_project_from_to_type_source_unique").on(
      table.projectId,
      table.fromEntityId,
      table.toEntityId,
      table.linkType,
      table.source,
    ),
  }),
);

export const validationMessages = pgTable(
  "validation_messages",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    filePath: text("file_path"),
    entityId: text("entity_id"),
    level: text("level").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    projectIdx: index("validation_messages_project_id_idx").on(table.projectId),
    projectEntityIdx: index("validation_messages_project_entity_id_idx").on(table.projectId, table.entityId),
    indexRunIdx: index("validation_messages_index_run_id_idx").on(table.indexRunId),
  }),
);

export const sourceFiles = pgTable(
  "source_files",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language"),
    kind: text("kind").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentHash: text("content_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("source_files_project_id_idx").on(table.projectId),
    projectPathIdx: index("source_files_project_path_idx").on(table.projectId, table.path),
    projectPathUnique: unique("source_files_project_id_path_unique").on(table.projectId, table.path),
    idProjectUnique: unique("source_files_id_project_id_unique").on(table.id, table.projectId),
  }),
);

export const sourceImports = pgTable(
  "source_imports",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id").notNull(),
    filePath: text("file_path").notNull(),
    specifier: text("specifier").notNull(),
    importKind: text("import_kind").notNull(),
    importedNames: text("imported_names").array().notNull().default(sql`ARRAY[]::text[]`),
    isRelative: boolean("is_relative").notNull(),
    resolvedPath: text("resolved_path"),
  },
  (table) => ({
    projectIdx: index("source_imports_project_id_idx").on(table.projectId),
    sourceFileIdx: index("source_imports_source_file_id_idx").on(table.sourceFileId),
    specifierIdx: index("source_imports_project_specifier_idx").on(table.projectId, table.specifier),
    sourceFileProjectFk: foreignKey({
      name: "source_imports_source_file_project_fk",
      columns: [table.sourceFileId, table.projectId],
      foreignColumns: [sourceFiles.id, sourceFiles.projectId],
    }).onDelete("cascade"),
  }),
);

export const sourceExports = pgTable(
  "source_exports",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id").notNull(),
    filePath: text("file_path").notNull(),
    exportedName: text("exported_name").notNull(),
    exportKind: text("export_kind").notNull(),
    sourceSpecifier: text("source_specifier"),
  },
  (table) => ({
    projectIdx: index("source_exports_project_id_idx").on(table.projectId),
    sourceFileIdx: index("source_exports_source_file_id_idx").on(table.sourceFileId),
    exportedNameIdx: index("source_exports_project_exported_name_idx").on(table.projectId, table.exportedName),
    sourceFileProjectFk: foreignKey({
      name: "source_exports_source_file_project_fk",
      columns: [table.sourceFileId, table.projectId],
      foreignColumns: [sourceFiles.id, sourceFiles.projectId],
    }).onDelete("cascade"),
  }),
);

export const sourceSymbols = pgTable(
  "source_symbols",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id").notNull(),
    filePath: text("file_path").notNull(),
    name: text("name").notNull(),
    symbolKind: text("symbol_kind").notNull(),
    isExported: boolean("is_exported").notNull().default(false),
    line: integer("line"),
    metadataJson: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    projectIdx: index("source_symbols_project_id_idx").on(table.projectId),
    sourceFileIdx: index("source_symbols_source_file_id_idx").on(table.sourceFileId),
    symbolNameIdx: index("source_symbols_project_name_idx").on(table.projectId, table.name),
    sourceFileProjectFk: foreignKey({
      name: "source_symbols_source_file_project_fk",
      columns: [table.sourceFileId, table.projectId],
      foreignColumns: [sourceFiles.id, sourceFiles.projectId],
    }).onDelete("cascade"),
  }),
);

export const sourceSpecLinks = pgTable(
  "source_spec_links",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id").notNull(),
    filePath: text("file_path").notNull(),
    entityId: text("entity_id").notNull(),
    symbolName: text("symbol_name").notNull(),
    symbolKind: text("symbol_kind").notNull(),
    symbolLine: integer("symbol_line"),
    annotationLine: integer("annotation_line"),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    projectIdx: index("source_spec_links_project_id_idx").on(table.projectId),
    projectEntityIdx: index("source_spec_links_project_entity_id_idx").on(table.projectId, table.entityId),
    sourceFileIdx: index("source_spec_links_source_file_id_idx").on(table.sourceFileId),
    projectSourceSymbolEntityUnique: unique("source_spec_links_project_file_symbol_entity_unique").on(
      table.projectId,
      table.sourceFileId,
      table.symbolName,
      table.entityId,
    ),
    sourceFileProjectFk: foreignKey({
      name: "source_spec_links_source_file_project_fk",
      columns: [table.sourceFileId, table.projectId],
      foreignColumns: [sourceFiles.id, sourceFiles.projectId],
    }).onDelete("cascade"),
  }),
);

export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    proposalType: text("proposal_type").notNull(),
    title: text("title").notNull(),
    payloadJson: jsonb("payload_json").notNull().default(sql`'{}'::jsonb`),
    evidenceJson: jsonb("evidence_json").notNull().default(sql`'{}'::jsonb`),
    confidence: doublePrecision("confidence"),
    status: text("status").notNull(),
    createdAt: createdAt(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index("ai_proposals_project_id_idx").on(table.projectId),
    projectStatusIdx: index("ai_proposals_project_status_idx").on(table.projectId, table.status),
    idProjectUnique: unique("ai_proposals_id_project_id_unique").on(table.id, table.projectId),
  }),
);

export const analyzeRuns = pgTable(
  "analyze_runs",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    currentStep: text("current_step"),
    stepsJson: jsonb("steps_json").notNull().default(sql`'[]'::jsonb`),
    selectionJson: jsonb("selection_json"),
    proposalIdsJson: jsonb("proposal_ids_json").notNull().default(sql`'[]'::jsonb`),
    sourceProposalCount: integer("source_proposal_count").notNull().default(0),
    aiProposalCount: integer("ai_proposal_count").notNull().default(0),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index("analyze_runs_project_id_idx").on(table.projectId),
    projectStatusIdx: index("analyze_runs_project_status_idx").on(table.projectId, table.status),
    projectCreatedAtIdx: index("analyze_runs_project_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
    indexRunIdx: index("analyze_runs_index_run_id_idx").on(table.indexRunId),
    idProjectUnique: unique("analyze_runs_id_project_id_unique").on(table.id, table.projectId),
    oneActivePerProjectIdx: uniqueIndex("analyze_runs_one_active_per_project_idx")
      .on(table.projectId)
      .where(sql`${table.status} in ('queued', 'running')`),
  }),
);

export const systemMapSnapshots = pgTable(
  "system_map_snapshots",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    analyzeRunId: uuid("analyze_run_id")
      .notNull()
      .references(() => analyzeRuns.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    coverageJson: jsonb("coverage_json").notNull().default(sql`'{}'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("system_map_snapshots_project_id_idx").on(table.projectId),
    projectRunIdx: index("system_map_snapshots_project_run_idx").on(
      table.projectId,
      table.analyzeRunId,
    ),
    analyzeRunProjectFk: foreignKey({
      name: "system_map_snapshots_analyze_run_project_fk",
      columns: [table.analyzeRunId, table.projectId],
      foreignColumns: [analyzeRuns.id, analyzeRuns.projectId],
    }).onDelete("cascade"),
    runUnique: unique("system_map_snapshots_analyze_run_id_unique").on(table.analyzeRunId),
    idProjectUnique: unique("system_map_snapshots_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
  }),
);

export const systemMapAreas = pgTable(
  "system_map_areas",
  {
    id: primaryId(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => systemMapSnapshots.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    areaType: text("area_type").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    confidence: doublePrecision("confidence"),
    evidenceJson: jsonb("evidence_json").notNull().default(sql`'[]'::jsonb`),
    keyFilesJson: jsonb("key_files_json").notNull().default(sql`'[]'::jsonb`),
    keySymbolsJson: jsonb("key_symbols_json").notNull().default(sql`'[]'::jsonb`),
    relatedProposalIdsJson: jsonb("related_proposal_ids_json").notNull().default(sql`'[]'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    snapshotIdx: index("system_map_areas_snapshot_id_idx").on(table.snapshotId),
    snapshotTypeIdx: index("system_map_areas_snapshot_type_idx").on(
      table.snapshotId,
      table.areaType,
    ),
    projectIdx: index("system_map_areas_project_id_idx").on(table.projectId),
    snapshotProjectFk: foreignKey({
      name: "system_map_areas_snapshot_project_fk",
      columns: [table.snapshotId, table.projectId],
      foreignColumns: [systemMapSnapshots.id, systemMapSnapshots.projectId],
    }).onDelete("cascade"),
  }),
);

export const projectGraphVersions = pgTable(
  "project_graph_versions",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    coverageJson: jsonb("coverage_json").notNull().default(sql`'{}'::jsonb`),
    diagnosticsJson: jsonb("diagnostics_json").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("project_graph_versions_project_id_idx").on(table.projectId),
    projectStatusCreatedIdx: index("project_graph_versions_project_status_created_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    indexRunIdx: index("project_graph_versions_index_run_id_idx").on(table.indexRunId),
    indexRunProjectFk: foreignKey({
      name: "project_graph_versions_index_run_project_fk",
      columns: [table.indexRunId, table.projectId],
      foreignColumns: [indexRuns.id, indexRuns.projectId],
    }).onDelete("set null"),
    idProjectUnique: unique("project_graph_versions_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
  }),
);

export const projectGraphNodes = pgTable(
  "project_graph_nodes",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    graphVersionId: uuid("graph_version_id")
      .notNull()
      .references(() => projectGraphVersions.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    nodeType: text("node_type").notNull(),
    label: text("label").notNull(),
    path: text("path"),
    symbolName: text("symbol_name"),
    entityId: text("entity_id"),
    sourceRefJson: jsonb("source_ref_json").notNull().default(sql`'{}'::jsonb`),
    metadataJson: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    versionIdx: index("project_graph_nodes_graph_version_id_idx").on(table.graphVersionId),
    versionTypeIdx: index("project_graph_nodes_version_type_idx").on(
      table.graphVersionId,
      table.nodeType,
    ),
    projectTypeIdx: index("project_graph_nodes_project_type_idx").on(table.projectId, table.nodeType),
    versionKeyUnique: unique("project_graph_nodes_version_key_unique").on(
      table.graphVersionId,
      table.nodeKey,
    ),
    idProjectUnique: unique("project_graph_nodes_id_project_id_unique").on(table.id, table.projectId),
    versionProjectFk: foreignKey({
      name: "project_graph_nodes_version_project_fk",
      columns: [table.graphVersionId, table.projectId],
      foreignColumns: [projectGraphVersions.id, projectGraphVersions.projectId],
    }).onDelete("cascade"),
  }),
);

export const projectGraphEdges = pgTable(
  "project_graph_edges",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    graphVersionId: uuid("graph_version_id")
      .notNull()
      .references(() => projectGraphVersions.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id").notNull(),
    toNodeId: uuid("to_node_id").notNull(),
    edgeType: text("edge_type").notNull(),
    provenance: text("provenance").notNull(),
    sourceRefJson: jsonb("source_ref_json").notNull().default(sql`'{}'::jsonb`),
    metadataJson: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    versionIdx: index("project_graph_edges_graph_version_id_idx").on(table.graphVersionId),
    versionTypeIdx: index("project_graph_edges_version_type_idx").on(
      table.graphVersionId,
      table.edgeType,
    ),
    fromNodeIdx: index("project_graph_edges_from_node_idx").on(table.fromNodeId),
    toNodeIdx: index("project_graph_edges_to_node_idx").on(table.toNodeId),
    versionProjectFk: foreignKey({
      name: "project_graph_edges_version_project_fk",
      columns: [table.graphVersionId, table.projectId],
      foreignColumns: [projectGraphVersions.id, projectGraphVersions.projectId],
    }).onDelete("cascade"),
    fromNodeProjectFk: foreignKey({
      name: "project_graph_edges_from_node_project_fk",
      columns: [table.fromNodeId, table.projectId],
      foreignColumns: [projectGraphNodes.id, projectGraphNodes.projectId],
    }).onDelete("cascade"),
    toNodeProjectFk: foreignKey({
      name: "project_graph_edges_to_node_project_fk",
      columns: [table.toNodeId, table.projectId],
      foreignColumns: [projectGraphNodes.id, projectGraphNodes.projectId],
    }).onDelete("cascade"),
  }),
);

export const analyzeReviewAssemblies = pgTable(
  "analyze_review_assemblies",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    analyzeRunId: uuid("analyze_run_id")
      .notNull()
      .references(() => analyzeRuns.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    filePath: text("file_path").notNull(),
    renderedMarkdown: text("rendered_markdown"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index("analyze_review_assemblies_project_idx").on(table.projectId),
    runIdx: index("analyze_review_assemblies_run_idx").on(table.analyzeRunId),
    runStatusIdx: index("analyze_review_assemblies_run_status_idx").on(
      table.analyzeRunId,
      table.status,
    ),
    idProjectUnique: unique("analyze_review_assemblies_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
    analyzeRunProjectFk: foreignKey({
      name: "analyze_review_assemblies_run_project_fk",
      columns: [table.analyzeRunId, table.projectId],
      foreignColumns: [analyzeRuns.id, analyzeRuns.projectId],
    }).onDelete("cascade"),
  }),
);

export const analyzeReviewAssemblyInputs = pgTable(
  "analyze_review_assembly_inputs",
  {
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => analyzeReviewAssemblies.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => aiProposals.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.assemblyId, table.proposalId] }),
    assemblyIdx: index("analyze_review_assembly_inputs_assembly_idx").on(table.assemblyId),
    proposalIdx: index("analyze_review_assembly_inputs_proposal_idx").on(table.proposalId),
    assemblyProjectFk: foreignKey({
      name: "analyze_review_assembly_inputs_assembly_project_fk",
      columns: [table.assemblyId, table.projectId],
      foreignColumns: [analyzeReviewAssemblies.id, analyzeReviewAssemblies.projectId],
    }).onDelete("cascade"),
    proposalProjectFk: foreignKey({
      name: "analyze_review_assembly_inputs_proposal_project_fk",
      columns: [table.proposalId, table.projectId],
      foreignColumns: [aiProposals.id, aiProposals.projectId],
    }).onDelete("cascade"),
  }),
);

export const analyzeReviewClaims = pgTable(
  "analyze_review_claims",
  {
    id: primaryId(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => analyzeReviewAssemblies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: text("kind").notNull(),
    confidence: doublePrecision("confidence"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    assemblyIdx: index("analyze_review_claims_assembly_idx").on(table.assemblyId),
    idProjectUnique: unique("analyze_review_claims_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
    assemblyProjectFk: foreignKey({
      name: "analyze_review_claims_assembly_project_fk",
      columns: [table.assemblyId, table.projectId],
      foreignColumns: [analyzeReviewAssemblies.id, analyzeReviewAssemblies.projectId],
    }).onDelete("cascade"),
  }),
);

export const analyzeReviewClaimEvidence = pgTable(
  "analyze_review_claim_evidence",
  {
    id: primaryId(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => analyzeReviewClaims.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => aiProposals.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFilePath: text("source_file_path").notNull(),
    symbolName: text("symbol_name"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    provenance: text("provenance").notNull(),
    confidence: doublePrecision("confidence"),
    createdAt: createdAt(),
  },
  (table) => ({
    claimIdx: index("analyze_review_claim_evidence_claim_idx").on(table.claimId),
    proposalIdx: index("analyze_review_claim_evidence_proposal_idx").on(table.proposalId),
    idProjectUnique: unique("analyze_review_claim_evidence_id_project_id_unique").on(
      table.id,
      table.projectId,
    ),
    claimProjectFk: foreignKey({
      name: "analyze_review_claim_evidence_claim_project_fk",
      columns: [table.claimId, table.projectId],
      foreignColumns: [analyzeReviewClaims.id, analyzeReviewClaims.projectId],
    }).onDelete("cascade"),
    proposalProjectFk: foreignKey({
      name: "analyze_review_claim_evidence_proposal_project_fk",
      columns: [table.proposalId, table.projectId],
      foreignColumns: [aiProposals.id, aiProposals.projectId],
    }).onDelete("cascade"),
  }),
);

export const sourceSpecAnnotations = pgTable(
  "source_spec_annotations",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id"),
    sourceFilePath: text("source_file_path").notNull(),
    symbolName: text("symbol_name"),
    symbolKind: text("symbol_kind"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    annotationLine: integer("annotation_line"),
    sourceContentHash: text("source_content_hash"),
    entityId: text("entity_id").notNull(),
    specFilePath: text("spec_file_path").notNull(),
    claimId: uuid("claim_id"),
    relationshipType: text("relationship_type").notNull(),
    confidence: doublePrecision("confidence"),
    provenance: text("provenance").notNull(),
    status: text("status").notNull().default("active"),
    analyzeRunId: uuid("analyze_run_id"),
    proposalId: uuid("proposal_id"),
    assemblyId: uuid("assembly_id"),
    claimEvidenceId: uuid("claim_evidence_id"),
    indexRunId: uuid("index_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectEntityIdx: index("source_spec_annotations_project_entity_idx").on(
      table.projectId,
      table.entityId,
    ),
    projectSourceFileIdx: index("source_spec_annotations_project_source_file_idx").on(
      table.projectId,
      table.sourceFilePath,
    ),
    projectRelationshipStatusIdx: index("source_spec_annotations_project_relationship_status_idx").on(
      table.projectId,
      table.relationshipType,
      table.status,
    ),
    analyzeOriginIdx: index("source_spec_annotations_analyze_origin_idx").on(
      table.projectId,
      table.analyzeRunId,
      table.assemblyId,
    ),
    claimProjectFk: foreignKey({
      name: "source_spec_annotations_claim_project_fk",
      columns: [table.claimId, table.projectId],
      foreignColumns: [analyzeReviewClaims.id, analyzeReviewClaims.projectId],
    }),
    analyzeRunProjectFk: foreignKey({
      name: "source_spec_annotations_analyze_run_project_fk",
      columns: [table.analyzeRunId, table.projectId],
      foreignColumns: [analyzeRuns.id, analyzeRuns.projectId],
    }),
    proposalProjectFk: foreignKey({
      name: "source_spec_annotations_proposal_project_fk",
      columns: [table.proposalId, table.projectId],
      foreignColumns: [aiProposals.id, aiProposals.projectId],
    }),
    assemblyProjectFk: foreignKey({
      name: "source_spec_annotations_assembly_project_fk",
      columns: [table.assemblyId, table.projectId],
      foreignColumns: [analyzeReviewAssemblies.id, analyzeReviewAssemblies.projectId],
    }),
    claimEvidenceProjectFk: foreignKey({
      name: "source_spec_annotations_claim_evidence_project_fk",
      columns: [table.claimEvidenceId, table.projectId],
      foreignColumns: [analyzeReviewClaimEvidence.id, analyzeReviewClaimEvidence.projectId],
    }),
    indexRunProjectFk: foreignKey({
      name: "source_spec_annotations_index_run_project_fk",
      columns: [table.indexRunId, table.projectId],
      foreignColumns: [indexRuns.id, indexRuns.projectId],
    }),
    activeDedupeIdx: uniqueIndex("source_spec_annotations_active_dedupe_idx")
      .on(
        table.projectId,
        table.sourceFilePath,
        table.entityId,
        table.relationshipType,
        table.provenance,
        sql`coalesce(${table.claimId}::text, '')`,
        sql`coalesce(${table.symbolName}, '')`,
        sql`coalesce(${table.startLine}, 0)`,
        sql`coalesce(${table.endLine}, 0)`,
      )
      .where(sql`${table.status} = 'active'`),
  }),
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskEntityId: text("task_entity_id").notNull(),
    agent: text("agent").notNull(),
    status: text("status").notNull(),
    promptMarkdown: text("prompt_markdown").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    startGitCommit: text("start_git_commit"),
    endGitCommit: text("end_git_commit"),
    startDirtyFilesJson: jsonb("start_dirty_files_json").notNull().default(sql`'[]'::jsonb`),
    endDirtyFilesJson: jsonb("end_dirty_files_json").notNull().default(sql`'[]'::jsonb`),
    changedFilesJson: jsonb("changed_files_json")
      .notNull()
      .default(sql`'{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb`),
    reviewSummaryJson: jsonb("review_summary_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("agent_runs_project_id_idx").on(table.projectId),
    projectStatusIdx: index("agent_runs_project_status_idx").on(table.projectId, table.status),
    projectTaskEntityIdIdx: index("agent_runs_project_task_entity_id_idx").on(
      table.projectId,
      table.taskEntityId,
    ),
    projectStartedAtIdx: index("agent_runs_project_started_at_idx").on(
      table.projectId,
      table.startedAt,
    ),
  }),
);

export const diffReviews = pgTable(
  "diff_reviews",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    reviewType: text("review_type").notNull(),
    baseRef: text("base_ref"),
    headRef: text("head_ref"),
    baseCommit: text("base_commit"),
    headCommit: text("head_commit"),
    changedFilesJson: jsonb("changed_files_json")
      .notNull()
      .default(sql`'{"specs":[],"source":[],"tests":[],"other":[]}'::jsonb`),
    reviewSummaryJson: jsonb("review_summary_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectIdx: index("diff_reviews_project_id_idx").on(table.projectId),
    projectStatusIdx: index("diff_reviews_project_status_idx").on(table.projectId, table.status),
    projectCreatedAtIdx: index("diff_reviews_project_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
  }),
);
