import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
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
    gitCommit: text("git_commit"),
  },
  (table) => ({
    projectIdx: index("index_runs_project_id_idx").on(table.projectId),
    projectStartedAtIdx: index("index_runs_project_started_at_idx").on(table.projectId, table.startedAt),
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
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
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
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index("ai_proposals_project_id_idx").on(table.projectId),
    projectStatusIdx: index("ai_proposals_project_status_idx").on(table.projectId, table.status),
  }),
);
