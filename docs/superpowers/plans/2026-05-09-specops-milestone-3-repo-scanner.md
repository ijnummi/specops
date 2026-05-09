# SpecOps Milestone 3 Repository Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TypeScript-focused source scanning to the existing project indexing workflow, with persisted imports, exports, symbols, and an inspect-only source inventory UI.

**Architecture:** Keep `packages/repo-scanner` pure and filesystem/parser-only. The API integrates scanning into the existing `indexProject` flow, persists derived source facts in normalized PostgreSQL tables, and exposes read endpoints. The web app adds compact source inventory queries and components to project detail.

**Tech Stack:** TypeScript, pnpm workspace, TypeScript compiler API, Fastify, Zod, Drizzle/PostgreSQL, React, TanStack Query, Vitest.

---

## File Structure

- Create: `packages/contracts/src/source.ts` - Zod DTOs for source files, imports, exports, symbols, summaries, and filters.
- Modify: `packages/contracts/src/index.ts` - export source contracts.
- Modify: `packages/contracts/src/indexing.ts` - add source scan counts to `IndexRunDto` as optional fields for client compatibility.
- Create: `packages/contracts/src/source.test.ts` - contract parsing tests.
- Modify: `packages/db/src/schema.ts` - add source fact tables, source file uniqueness, and source count columns on `index_runs`.
- Modify: `packages/db/migrations/0000_initial.sql` - add source fact tables, indexes, source file uniqueness, and source count columns to the baseline migration.
- Modify: `packages/db/src/schema.typecheck.ts` - type assertions for source fact JSON and booleans.
- Create: `packages/repo-scanner/src/types.ts` - scanner result, file fact, import/export/symbol, warning types.
- Create: `packages/repo-scanner/src/classify.ts` - extension/language/kind classification helpers.
- Create: `packages/repo-scanner/src/discover.ts` - repository walking and exclusion rules.
- Create: `packages/repo-scanner/src/parse.ts` - TypeScript compiler API extraction.
- Create: `packages/repo-scanner/src/scan.ts` - orchestration that returns scan results.
- Modify: `packages/repo-scanner/src/index.ts` - public exports.
- Modify: `packages/repo-scanner/package.json` - add `typescript` dependency from the workspace root dependency set.
- Create: `packages/repo-scanner/src/__tests__/classify.test.ts` - classification tests.
- Create: `packages/repo-scanner/src/__tests__/scan.test.ts` - filesystem scanner tests.
- Create: `packages/repo-scanner/src/__tests__/parse.test.ts` - parser extraction tests.
- Modify: `apps/api/package.json` - add `@specops/repo-scanner`.
- Create: `apps/api/src/services/source-scan-service.ts` - persistence and read model service.
- Create: `apps/api/src/routes/source-files.ts` - source inventory read endpoints.
- Modify: `apps/api/src/services/indexer-service.ts` - call source scanning during indexing and persist warnings.
- Modify: `apps/api/src/routes/index-runs.ts` - map optional source scan counts.
- Modify: `apps/api/src/server.ts` - register source routes.
- Modify: `apps/api/src/__tests__/routes.test.ts` - DB-backed integrated scan and endpoint tests.
- Modify: `apps/web/src/api/queries.ts` - source inventory query keys and client helpers.
- Create: `apps/web/src/components/source-inventory-state.ts` - pure filtering and selection helpers.
- Create: `apps/web/src/components/source-inventory-state.test.ts` - helper tests.
- Create: `apps/web/src/components/source-inventory.tsx` - compact source inventory component.
- Create: `apps/web/src/components/source-inventory.test.tsx` - static render tests.
- Modify: `apps/web/src/routes/project-detail.tsx` - load and render source inventory data, invalidate on re-index.

## Task 1: Source Contracts And Index Run Counts

**Files:**
- Create: `packages/contracts/src/source.ts`
- Create: `packages/contracts/src/source.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/indexing.ts`

- [ ] **Step 1: Write failing source contract tests**

Create `packages/contracts/src/source.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  sourceFileDetailSchema,
  sourceFileListQuerySchema,
  sourceFileSummarySchema
} from "./source.js";
import { indexRunSchema } from "./indexing.js";

describe("source contracts", () => {
  it("parses source file list filters", () => {
    expect(
      sourceFileListQuerySchema.parse({
        language: "typescript",
        kind: "source",
        q: "indexer"
      })
    ).toEqual({
      language: "typescript",
      kind: "source",
      q: "indexer"
    });
  });

  it("parses source file summaries", () => {
    expect(
      sourceFileSummarySchema.parse({
        id: "file-1",
        projectId: "project-1",
        path: "apps/api/src/server.ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 1200,
        contentHash: "abc123",
        lastSeenAt: "2026-05-09T12:00:00.000Z",
        importCount: 3,
        exportCount: 1,
        symbolCount: 2
      })
    ).toMatchObject({
      path: "apps/api/src/server.ts",
      importCount: 3,
      exportCount: 1,
      symbolCount: 2
    });
  });

  it("parses source file details with imports, exports, and symbols", () => {
    expect(
      sourceFileDetailSchema.parse({
        id: "file-1",
        projectId: "project-1",
        path: "packages/repo-scanner/src/index.ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 80,
        contentHash: "hash",
        lastSeenAt: "2026-05-09T12:00:00.000Z",
        imports: [
          {
            id: "import-1",
            specifier: "typescript",
            importKind: "named",
            importedNames: ["createSourceFile"],
            isRelative: false,
            resolvedPath: null
          }
        ],
        exports: [
          {
            id: "export-1",
            exportedName: "scanRepository",
            exportKind: "named",
            sourceSpecifier: null
          }
        ],
        symbols: [
          {
            id: "symbol-1",
            name: "scanRepository",
            symbolKind: "function",
            isExported: true,
            line: 7,
            metadata: {}
          }
        ]
      })
    ).toMatchObject({
      path: "packages/repo-scanner/src/index.ts",
      imports: [{ specifier: "typescript" }],
      symbols: [{ name: "scanRepository", isExported: true }]
    });
  });

  it("keeps source counts optional on index runs", () => {
    expect(
      indexRunSchema.parse({
        id: "run-1",
        projectId: "project-1",
        startedAt: "2026-05-09T12:00:00.000Z",
        finishedAt: "2026-05-09T12:00:01.000Z",
        status: "succeeded",
        entityCount: 1,
        linkCount: 2,
        errorCount: 0,
        warningCount: 0,
        gitCommit: null,
        sourceFileCount: 5,
        sourceImportCount: 8,
        sourceExportCount: 4,
        sourceSymbolCount: 6
      })
    ).toMatchObject({
      sourceFileCount: 5,
      sourceImportCount: 8,
      sourceExportCount: 4,
      sourceSymbolCount: 6
    });
  });
});
```

- [ ] **Step 2: Run source contract tests and verify failure**

Run:

```bash
pnpm --filter @specops/contracts test -- src/source.test.ts
```

Expected: FAIL because `./source.js` does not exist.

- [ ] **Step 3: Add source contract schemas**

Create `packages/contracts/src/source.ts`:

```ts
import { z } from "zod";

export const sourceFileKindSchema = z.enum(["source", "test", "config", "entrypoint", "unknown"]);
export const sourceLanguageSchema = z.enum(["typescript", "tsx", "javascript", "jsx", "unknown"]);

export const sourceFileListQuerySchema = z.object({
  language: sourceLanguageSchema.optional(),
  kind: sourceFileKindSchema.optional(),
  q: z.string().optional()
});

export const sourceFileSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  path: z.string(),
  language: sourceLanguageSchema.nullable(),
  kind: sourceFileKindSchema,
  sizeBytes: z.number(),
  contentHash: z.string(),
  lastSeenAt: z.string(),
  importCount: z.number(),
  exportCount: z.number(),
  symbolCount: z.number()
});

export const sourceImportSchema = z.object({
  id: z.string(),
  specifier: z.string(),
  importKind: z.string(),
  importedNames: z.array(z.string()),
  isRelative: z.boolean(),
  resolvedPath: z.string().nullable()
});

export const sourceExportSchema = z.object({
  id: z.string(),
  exportedName: z.string(),
  exportKind: z.string(),
  sourceSpecifier: z.string().nullable()
});

export const sourceSymbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbolKind: z.string(),
  isExported: z.boolean(),
  line: z.number().nullable(),
  metadata: z.record(z.unknown())
});

export const sourceFileDetailSchema = sourceFileSummarySchema.omit({
  importCount: true,
  exportCount: true,
  symbolCount: true
}).extend({
  imports: z.array(sourceImportSchema),
  exports: z.array(sourceExportSchema),
  symbols: z.array(sourceSymbolSchema)
});

export const sourceAggregateSchema = z.object({
  totalFiles: z.number(),
  byLanguage: z.record(z.string(), z.number()),
  byKind: z.record(z.string(), z.number())
});

export type SourceFileKind = z.infer<typeof sourceFileKindSchema>;
export type SourceLanguage = z.infer<typeof sourceLanguageSchema>;
export type SourceFileListQuery = z.infer<typeof sourceFileListQuerySchema>;
export type SourceFileSummaryDto = z.infer<typeof sourceFileSummarySchema>;
export type SourceImportDto = z.infer<typeof sourceImportSchema>;
export type SourceExportDto = z.infer<typeof sourceExportSchema>;
export type SourceSymbolDto = z.infer<typeof sourceSymbolSchema>;
export type SourceFileDetailDto = z.infer<typeof sourceFileDetailSchema>;
export type SourceAggregateDto = z.infer<typeof sourceAggregateSchema>;
```

- [ ] **Step 4: Add source counts to index run schema**

Modify `packages/contracts/src/indexing.ts`:

```ts
import { z } from "zod";

export const indexRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  entityCount: z.number(),
  linkCount: z.number(),
  errorCount: z.number(),
  warningCount: z.number(),
  gitCommit: z.string().nullable(),
  sourceFileCount: z.number().optional(),
  sourceImportCount: z.number().optional(),
  sourceExportCount: z.number().optional(),
  sourceSymbolCount: z.number().optional()
});

export type IndexRunDto = z.infer<typeof indexRunSchema>;
```

- [ ] **Step 5: Export source contracts**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./entities.js";
export * from "./indexing.js";
export * from "./projects.js";
export * from "./source.js";
export * from "./validation.js";
```

- [ ] **Step 6: Run contract tests**

Run:

```bash
pnpm --filter @specops/contracts test -- src/source.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit contracts**

```bash
git add packages/contracts/src/source.ts packages/contracts/src/source.test.ts packages/contracts/src/index.ts packages/contracts/src/indexing.ts
git commit -m "feat: add source inventory contracts"
```

## Task 2: Source Fact Database Schema

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/schema.typecheck.ts`

- [ ] **Step 1: Write schema type assertions first**

Modify `packages/db/src/schema.typecheck.ts`:

```ts
import type { InferSelectModel } from "drizzle-orm";
import type { aiProposals, indexRuns, sourceImports, sourceSymbols, specLinks } from "./schema.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type SpecLink = InferSelectModel<typeof specLinks>;
type AiProposal = InferSelectModel<typeof aiProposals>;
type SourceImport = InferSelectModel<typeof sourceImports>;
type SourceSymbol = InferSelectModel<typeof sourceSymbols>;
type IndexRun = InferSelectModel<typeof indexRuns>;

type _SpecLinkConfidenceIsNumberOrNull = Expect<Equal<SpecLink["confidence"], number | null>>;
type _AiProposalConfidenceIsNumberOrNull = Expect<Equal<AiProposal["confidence"], number | null>>;
type _SourceImportImportedNamesIsStringArray = Expect<Equal<SourceImport["importedNames"], string[]>>;
type _SourceSymbolIsExportedIsBoolean = Expect<Equal<SourceSymbol["isExported"], boolean>>;
type _SourceSymbolMetadataIsRecord = Expect<Equal<SourceSymbol["metadataJson"], unknown>>;
type _IndexRunSourceFileCountIsNumber = Expect<Equal<IndexRun["sourceFileCount"], number>>;
```

- [ ] **Step 2: Run DB typecheck and verify failure**

Run:

```bash
pnpm --filter @specops/db typecheck
```

Expected: FAIL because `sourceImports`, `sourceSymbols`, and `indexRuns.sourceFileCount` are not available yet.

- [ ] **Step 3: Add Drizzle source counts and fact tables**

Modify `packages/db/src/schema.ts`:

```ts
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
  }),
);

export const sourceImports = pgTable(
  "source_imports",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
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
  }),
);

export const sourceExports = pgTable(
  "source_exports",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    exportedName: text("exported_name").notNull(),
    exportKind: text("export_kind").notNull(),
    sourceSpecifier: text("source_specifier"),
  },
  (table) => ({
    projectIdx: index("source_exports_project_id_idx").on(table.projectId),
    sourceFileIdx: index("source_exports_source_file_id_idx").on(table.sourceFileId),
    exportedNameIdx: index("source_exports_project_exported_name_idx").on(table.projectId, table.exportedName),
  }),
);

export const sourceSymbols = pgTable(
  "source_symbols",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
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
  }),
);
```

Replace the existing `indexRuns` and `sourceFiles` table definitions rather than adding duplicate exports. Also add `boolean` to the `drizzle-orm/pg-core` import.

- [ ] **Step 4: Update baseline SQL migration**

Modify `packages/db/migrations/0000_initial.sql` by adding these columns to the existing `CREATE TABLE IF NOT EXISTS index_runs` statement:

```sql
  source_file_count integer NOT NULL DEFAULT 0,
  source_import_count integer NOT NULL DEFAULT 0,
  source_export_count integer NOT NULL DEFAULT 0,
  source_symbol_count integer NOT NULL DEFAULT 0,
```

Then add this source file constraint and the fact tables after the existing `source_files` indexes:

```sql
ALTER TABLE source_files
  ADD CONSTRAINT source_files_project_id_path_unique UNIQUE (project_id, path);

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
```

- [ ] **Step 5: Run DB typecheck**

Run:

```bash
pnpm --filter @specops/db typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit DB schema**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0000_initial.sql packages/db/src/schema.typecheck.ts
git commit -m "feat: add source fact tables"
```

## Task 3: Pure Repository Scanner Package

**Files:**
- Create: `packages/repo-scanner/src/types.ts`
- Create: `packages/repo-scanner/src/classify.ts`
- Create: `packages/repo-scanner/src/discover.ts`
- Create: `packages/repo-scanner/src/parse.ts`
- Create: `packages/repo-scanner/src/scan.ts`
- Modify: `packages/repo-scanner/src/index.ts`
- Modify: `packages/repo-scanner/package.json`
- Create: `packages/repo-scanner/src/__tests__/classify.test.ts`
- Create: `packages/repo-scanner/src/__tests__/parse.test.ts`
- Create: `packages/repo-scanner/src/__tests__/scan.test.ts`

- [ ] **Step 1: Add scanner package tests**

Create `packages/repo-scanner/src/__tests__/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "../classify.js";

describe("source file classification", () => {
  it("accepts TypeScript and JavaScript source extensions", () => {
    expect(isSupportedSourcePath("src/index.ts")).toBe(true);
    expect(isSupportedSourcePath("src/view.tsx")).toBe(true);
    expect(isSupportedSourcePath("src/index.js")).toBe(true);
    expect(isSupportedSourcePath("src/view.jsx")).toBe(true);
    expect(isSupportedSourcePath("README.md")).toBe(false);
  });

  it("excludes heavy and generated paths", () => {
    expect(shouldExcludePath("node_modules/react/index.js")).toBe(true);
    expect(shouldExcludePath(".git/config")).toBe(true);
    expect(shouldExcludePath("dist/index.js")).toBe(true);
    expect(shouldExcludePath("apps/api/src/server.ts")).toBe(false);
  });

  it("classifies file language and kind", () => {
    expect(classifySourceFile("src/index.ts")).toEqual({ language: "typescript", kind: "source" });
    expect(classifySourceFile("src/App.tsx")).toEqual({ language: "tsx", kind: "source" });
    expect(classifySourceFile("src/App.test.tsx")).toEqual({ language: "tsx", kind: "test" });
    expect(classifySourceFile("vite.config.ts")).toEqual({ language: "typescript", kind: "config" });
    expect(classifySourceFile("src/main.ts")).toEqual({ language: "typescript", kind: "entrypoint" });
  });
});
```

Create `packages/repo-scanner/src/__tests__/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseSourceFacts } from "../parse.js";

describe("parseSourceFacts", () => {
  it("extracts imports, exports, and top-level symbols", () => {
    const result = parseSourceFacts({
      path: "src/example.tsx",
      content:
        "import React, { useMemo as memo } from 'react';\n" +
        "import type { Project } from './types';\n" +
        "export const Example = () => memo(() => null, []);\n" +
        "export interface ExampleProps { name: string }\n" +
        "class Internal {}\n" +
        "export { Internal as RenamedInternal };\n"
    });

    expect(result.warnings).toEqual([]);
    expect(result.imports).toContainEqual(
      expect.objectContaining({
        specifier: "react",
        importKind: "mixed",
        importedNames: ["default", "useMemo"],
        isRelative: false
      })
    );
    expect(result.imports).toContainEqual(
      expect.objectContaining({
        specifier: "./types",
        importKind: "type",
        importedNames: ["Project"],
        isRelative: true
      })
    );
    expect(result.exports).toContainEqual(
      expect.objectContaining({ exportedName: "Example", exportKind: "named" })
    );
    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "Example",
        symbolKind: "react_component",
        isExported: true,
        line: 3
      })
    );
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "Internal", symbolKind: "class", isExported: false })
    );
  });

  it("returns parse warnings instead of throwing", () => {
    const result = parseSourceFacts({
      path: "src/broken.ts",
      content: "export const ="
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_parse_error",
        filePath: "src/broken.ts"
      })
    );
  });
});
```

Create `packages/repo-scanner/src/__tests__/scan.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanRepository } from "../scan.js";

describe("scanRepository", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("scans supported files and ignores generated directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-scanner-"));
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export function run() { return 1; }\n");
    await writeFile(path.join(root, "src", "index.test.ts"), "import { run } from './index';\n");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "export const ignored = true;\n");
    await writeFile(path.join(root, "README.md"), "# ignored\n");

    const result = await scanRepository({ repoPath: root });

    expect(result.files.map((file) => file.path).sort()).toEqual([
      "src/index.test.ts",
      "src/index.ts"
    ]);
    expect(result.files.find((file) => file.path === "src/index.ts")).toMatchObject({
      language: "typescript",
      kind: "source"
    });
    expect(result.files.find((file) => file.path === "src/index.test.ts")).toMatchObject({
      kind: "test"
    });
  });
});
```

- [ ] **Step 2: Run scanner tests and verify failure**

Run:

```bash
pnpm --filter @specops/repo-scanner test
```

Expected: FAIL because scanner modules do not exist.

- [ ] **Step 3: Add scanner types and package dependency**

Modify `packages/repo-scanner/package.json`:

```json
{
  "name": "@specops/repo-scanner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run --passWithNoTests",
    "build": "tsc -b"
  },
  "dependencies": {
    "typescript": "^6.0.3"
  },
  "devDependencies": {}
}
```

Create `packages/repo-scanner/src/types.ts`:

```ts
export type SourceLanguage = "typescript" | "tsx" | "javascript" | "jsx" | "unknown";
export type SourceFileKind = "source" | "test" | "config" | "entrypoint" | "unknown";

export type SourceImportFact = {
  specifier: string;
  importKind: "named" | "default" | "namespace" | "side_effect" | "type" | "mixed" | "re_export";
  importedNames: string[];
  isRelative: boolean;
  resolvedPath: string | null;
};

export type SourceExportFact = {
  exportedName: string;
  exportKind: "named" | "default" | "namespace" | "re_export" | "type";
  sourceSpecifier: string | null;
};

export type SourceSymbolFact = {
  name: string;
  symbolKind: string;
  isExported: boolean;
  line: number | null;
  metadata: Record<string, unknown>;
};

export type SourceScanWarning = {
  code: "source_parse_error" | "source_read_error";
  message: string;
  filePath: string;
};

export type SourceFileFact = {
  path: string;
  language: SourceLanguage;
  kind: SourceFileKind;
  sizeBytes: number;
  contentHash: string;
  imports: SourceImportFact[];
  exports: SourceExportFact[];
  symbols: SourceSymbolFact[];
};

export type ParseSourceFactsInput = {
  path: string;
  content: string;
};

export type ParseSourceFactsResult = {
  imports: SourceImportFact[];
  exports: SourceExportFact[];
  symbols: SourceSymbolFact[];
  warnings: SourceScanWarning[];
};

export type ScanRepositoryInput = {
  repoPath: string;
};

export type ScanRepositoryResult = {
  files: SourceFileFact[];
  warnings: SourceScanWarning[];
};
```

- [ ] **Step 4: Implement classification helpers**

Create `packages/repo-scanner/src/classify.ts` with exported functions:

```ts
import path from "node:path";
import type { SourceFileKind, SourceLanguage } from "./types.js";

const supportedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const excludedSegments = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

export function isSupportedSourcePath(relativePath: string): boolean {
  return supportedExtensions.has(path.extname(relativePath));
}

export function shouldExcludePath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some((segment) => excludedSegments.has(segment));
}

export function classifySourceFile(relativePath: string): { language: SourceLanguage; kind: SourceFileKind } {
  return {
    language: languageForPath(relativePath),
    kind: kindForPath(relativePath)
  };
}

function languageForPath(relativePath: string): SourceLanguage {
  const extension = path.extname(relativePath);
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return "typescript";
  if (extension === ".tsx") return "tsx";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "javascript";
  if (extension === ".jsx") return "jsx";
  return "unknown";
}

function kindForPath(relativePath: string): SourceFileKind {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = path.basename(normalized);
  if (/(\.|-)(test|spec)\.[cm]?[jt]sx?$/.test(basename) || normalized.includes("/__tests__/")) return "test";
  if (/(^|\/)(vite|vitest|playwright|postcss|tailwind|eslint|prettier|drizzle)\.config\.[cm]?[jt]s$/.test(normalized)) return "config";
  if (/\/?src\/(main|index)\.[cm]?[jt]sx?$/.test(normalized) || /(^|\/)index\.[cm]?[jt]s$/.test(normalized)) return "entrypoint";
  return "source";
}
```

- [ ] **Step 5: Implement discovery, parsing, scanning, and exports**

Create `discover.ts`, `parse.ts`, `scan.ts`, and update `index.ts` so these exports exist:

```ts
export { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "./classify.js";
export { discoverSourceFiles } from "./discover.js";
export { parseSourceFacts } from "./parse.js";
export { scanRepository } from "./scan.js";
export type {
  ParseSourceFactsInput,
  ParseSourceFactsResult,
  ScanRepositoryInput,
  ScanRepositoryResult,
  SourceExportFact,
  SourceFileFact,
  SourceFileKind,
  SourceImportFact,
  SourceLanguage,
  SourceScanWarning,
  SourceSymbolFact
} from "./types.js";
```

Implementation requirements:

- `discoverSourceFiles(repoPath)` recursively reads directories with `fs.readdir({ withFileTypes: true })`.
- It returns sorted project-relative POSIX paths.
- It skips `shouldExcludePath(relativePath)`.
- `scanRepository({ repoPath })` reads each discovered file, hashes content with SHA-256, classifies it, calls `parseSourceFacts`, and returns sorted files plus warnings.
- `parseSourceFacts(input)` uses `typescript.createSourceFile(input.path, input.content, ScriptTarget.Latest, true, scriptKind)`.
- `parseSourceFacts` checks `sourceFile.parseDiagnostics` and returns `source_parse_error` warnings while still extracting what it can.
- Top-level symbol line numbers use `sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1`.
- Export detection should handle `export` modifiers and `export { Name }` declarations.
- React component detection can classify exported or top-level PascalCase arrow functions/functions returning JSX as `react_component`; otherwise use `function`, `class`, `interface`, `type_alias`, `enum`, or `constant`.
- Import extraction should handle default, namespace, named, side-effect, and type-only imports.
- Basic relative resolution should normalize `./foo` or `../foo` to a project-relative path when a direct file exists with a supported extension. If resolution is not found, keep `resolvedPath: null`.

- [ ] **Step 6: Run scanner tests and typecheck**

Run:

```bash
pnpm --filter @specops/repo-scanner test
pnpm --filter @specops/repo-scanner typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit scanner package**

```bash
git add packages/repo-scanner
git commit -m "feat: add TypeScript repository scanner"
```

## Task 4: Source Scan Persistence And Integrated Indexing

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/services/source-scan-service.ts`
- Modify: `apps/api/src/services/indexer-service.ts`
- Modify: `apps/api/src/routes/index-runs.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing integrated API test**

Add this test to `apps/api/src/__tests__/routes.test.ts` inside `describeWithDb("database-backed routes", ...)`:

```ts
it("refreshes source files and facts during project indexing", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await mkdir(path.join(project.repoPath, "src"), { recursive: true });
  await writeFile(
    path.join(project.repoPath, "src", "math.ts"),
    "import { strict as assert } from 'node:assert';\n" +
      "export function add(left: number, right: number) {\n" +
      "  assert.ok(true);\n" +
      "  return left + right;\n" +
      "}\n"
  );

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/index`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    sourceFileCount: 1,
    sourceImportCount: 1,
    sourceExportCount: 1,
    sourceSymbolCount: 1
  });
});
```

- [ ] **Step 2: Run API test and verify failure**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: FAIL until source scan persistence is implemented. If PostgreSQL is unavailable locally, record that the DB-backed test could not be run and continue with typecheck after implementation.

- [ ] **Step 3: Add repo scanner dependency**

Modify `apps/api/package.json` dependencies:

```json
"@specops/repo-scanner": "workspace:*"
```

- [ ] **Step 4: Implement source scan service**

Create `apps/api/src/services/source-scan-service.ts` with:

```ts
import type { SourceAggregateDto, SourceFileDetailDto, SourceFileListQuery, SourceFileSummaryDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { sourceExports, sourceFiles, sourceImports, sourceSymbols, validationMessages } from "@specops/db";
import { scanRepository, type ScanRepositoryResult } from "@specops/repo-scanner";
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

export type SourceScanCounts = {
  sourceFileCount: number;
  sourceImportCount: number;
  sourceExportCount: number;
  sourceSymbolCount: number;
  warningCount: number;
};

export function createSourceScanService(db: Db) {
  return {
    async scanAndPersistProject(input: {
      projectId: string;
      repoPath: string;
      indexRunId: string;
    }): Promise<SourceScanCounts> {
      const result = await scanRepository({ repoPath: input.repoPath });
      return persistSourceScan(db, input.projectId, input.indexRunId, result);
    },

    async listSourceFiles(projectId: string, query: SourceFileListQuery): Promise<SourceFileSummaryDto[]> {
      return listSourceFiles(db, projectId, query);
    },

    async getSourceFileDetail(projectId: string, sourceFileId: string): Promise<SourceFileDetailDto> {
      return getSourceFileDetail(db, projectId, sourceFileId);
    },

    async getSourceAggregate(projectId: string): Promise<SourceAggregateDto> {
      return getSourceAggregate(db, projectId);
    }
  };
}
```

Add `persistSourceScan`, `listSourceFiles`, `getSourceFileDetail`, and `getSourceAggregate` helper functions below `createSourceScanService` with these rules:

- `persistSourceScan` performs deletes and inserts through the `db` argument passed to the service. When called from `indexProject`, that argument is the existing index transaction, so source refresh is atomic with the index run update.
- Delete existing `sourceSymbols`, `sourceExports`, `sourceImports`, and `sourceFiles` rows for the project in that order.
- Insert `sourceFiles` first and keep a `Map<path, id>`.
- Insert imports, exports, and symbols using the inserted file IDs.
- Insert scanner warnings into `validationMessages` with `level: "warning"`, `code`, `message`, `filePath`, and `indexRunId`.
- Return counts from the scan result.
- `listSourceFiles` joins aggregate counts with subqueries or uses simple follow-up count queries; keep the output sorted by path.
- `getSourceFileDetail` throws `NotFoundError("Source file not found", { projectId, sourceFileId })` when missing.
- `getSourceAggregate` returns `{ totalFiles, byLanguage, byKind }`.

- [ ] **Step 5: Integrate source scanning into indexer**

Modify `apps/api/src/services/indexer-service.ts`:

- Import `createSourceScanService`.
- After markdown entities/links/messages are written and before the index run is marked succeeded, call:

```ts
const sourceScanCounts = await createSourceScanService(tx as unknown as Db).scanAndPersistProject({
  projectId,
  repoPath,
  indexRunId: startedRun.id
});
```

- Add source scan warnings to final `warningCount`.
- Set `sourceFileCount`, `sourceImportCount`, `sourceExportCount`, and `sourceSymbolCount` on the finished `index_runs` row from `sourceScanCounts`.
- Return `mapIndexRun(finishedRun)`.

- [ ] **Step 6: Map source counts in index run routes**

Modify both `mapIndexRun` functions in `apps/api/src/services/indexer-service.ts` and `apps/api/src/routes/index-runs.ts` so returned objects include:

```ts
sourceFileCount: row.sourceFileCount,
sourceImportCount: row.sourceImportCount,
sourceExportCount: row.sourceExportCount,
sourceSymbolCount: row.sourceSymbolCount
```

- [ ] **Step 7: Run API typecheck and integrated test**

Run:

```bash
pnpm --filter api typecheck
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: typecheck PASS. DB-backed test PASS when local PostgreSQL test DB is available.

- [ ] **Step 8: Commit source scan integration**

```bash
git add apps/api/package.json apps/api/src/services/source-scan-service.ts apps/api/src/services/indexer-service.ts apps/api/src/routes/index-runs.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: persist source scan facts during indexing"
```

## Task 5: Source Inventory API Routes

**Files:**
- Create: `apps/api/src/routes/source-files.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Add tests to `apps/api/src/__tests__/routes.test.ts`:

```ts
it("lists source files with filters and returns source file detail", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await mkdir(path.join(project.repoPath, "src"), { recursive: true });
  await writeFile(path.join(project.repoPath, "src", "math.ts"), "export function add() { return 1; }\n");
  await writeFile(path.join(project.repoPath, "src", "math.test.ts"), "import { add } from './math';\n");

  const indexResponse = await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
  expect(indexResponse.statusCode).toBe(200);

  const listResponse = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/source-files?kind=source&q=math`
  });
  expect(listResponse.statusCode).toBe(200);
  const listBody = listResponse.json() as Array<{ id: string; path: string; symbolCount: number }>;
  expect(listBody).toHaveLength(1);
  expect(listBody[0]).toMatchObject({ path: "src/math.ts", symbolCount: 1 });

  const detailResponse = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/source-files/${listBody[0].id}`
  });
  expect(detailResponse.statusCode).toBe(200);
  expect(detailResponse.json()).toMatchObject({
    path: "src/math.ts",
    symbols: [expect.objectContaining({ name: "add" })],
    exports: [expect.objectContaining({ exportedName: "add" })]
  });
});

it("returns source file aggregate counts", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await mkdir(path.join(project.repoPath, "src"), { recursive: true });
  await writeFile(path.join(project.repoPath, "src", "index.ts"), "export const value = 1;\n");
  await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/source-files/aggregate`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    totalFiles: 1,
    byLanguage: { typescript: 1 }
  });
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: FAIL with 404 for source routes.

- [ ] **Step 3: Add source routes**

Create `apps/api/src/routes/source-files.ts`:

```ts
import { sourceFileListQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectService } from "../services/project-service.js";
import { createSourceScanService } from "../services/source-scan-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const sourceFileParamsSchema = z.object({
  projectId: z.string().min(1),
  sourceFileId: z.string().min(1)
});

export const registerSourceFileRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const sourceScanService = createSourceScanService(db);

  app.get("/projects/:projectId/source-files", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = sourceFileListQuerySchema.parse(request.query);
    await projectService.getProject(projectId);
    return sourceScanService.listSourceFiles(projectId, query);
  });

  app.get("/projects/:projectId/source-files/aggregate", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return sourceScanService.getSourceAggregate(projectId);
  });

  app.get("/projects/:projectId/source-files/:sourceFileId", async (request) => {
    const { projectId, sourceFileId } = sourceFileParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return sourceScanService.getSourceFileDetail(projectId, sourceFileId);
  });
};
```

Modify `apps/api/src/server.ts`:

```ts
import { registerSourceFileRoutes } from "./routes/source-files.js";
```

and register it:

```ts
app.register(registerSourceFileRoutes, { prefix: "/api", db });
```

- [ ] **Step 4: Run API tests**

Run:

```bash
pnpm --filter api typecheck
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: PASS when local PostgreSQL test DB is available.

- [ ] **Step 5: Commit source inventory API**

```bash
git add apps/api/src/routes/source-files.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add source inventory API"
```

## Task 6: Web Source Inventory Queries And State

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/source-inventory-state.ts`
- Create: `apps/web/src/components/source-inventory-state.test.ts`

- [ ] **Step 1: Add source inventory state tests**

Create `apps/web/src/components/source-inventory-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildSourceFileQueryString, selectInitialSourceFileId } from "./source-inventory-state.js";

describe("source inventory state helpers", () => {
  it("builds source file query strings without empty filters", () => {
    expect(
      buildSourceFileQueryString({
        language: "typescript",
        kind: "source",
        q: "server"
      })
    ).toBe("language=typescript&kind=source&q=server");

    expect(buildSourceFileQueryString({ language: "", kind: "", q: "" })).toBe("");
  });

  it("keeps selected source file when it remains in the list", () => {
    expect(selectInitialSourceFileId("b", [{ id: "a" }, { id: "b" }])).toBe("b");
  });

  it("falls back to the first source file", () => {
    expect(selectInitialSourceFileId("missing", [{ id: "a" }, { id: "b" }])).toBe("a");
    expect(selectInitialSourceFileId(null, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run web helper tests and verify failure**

Run:

```bash
pnpm --filter web test -- src/components/source-inventory-state.test.ts
```

Expected: FAIL because helper file does not exist.

- [ ] **Step 3: Add source inventory state helpers**

Create `apps/web/src/components/source-inventory-state.ts`:

```ts
export type SourceFileFilters = {
  language?: string;
  kind?: string;
  q?: string;
};

export function buildSourceFileQueryString(filters: SourceFileFilters): string {
  const params = new URLSearchParams();
  if (filters.language) params.set("language", filters.language);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

export function selectInitialSourceFileId(
  currentId: string | null,
  files: Array<{ id: string }>
): string | null {
  if (currentId && files.some((file) => file.id === currentId)) {
    return currentId;
  }

  return files[0]?.id ?? null;
}
```

- [ ] **Step 4: Add query helpers**

Modify `apps/web/src/api/queries.ts`:

- Import source DTO types, including `SourceFileListQuery`.
- Add query keys:

```ts
sourceFiles: (projectId: string, filters: SourceFileListQuery) =>
  ["projects", projectId, "source-files", filters] as const,
sourceFileDetail: (projectId: string, sourceFileId: string) =>
  ["projects", projectId, "source-files", sourceFileId] as const,
sourceAggregate: (projectId: string) => ["projects", projectId, "source-files", "aggregate"] as const,
```

- Add helpers:

```ts
export function sourceFilesQuery(projectId: string, filters: SourceFileListQuery) {
  const queryString = buildSourceFileQueryString(filters);
  return queryOptions({
    queryKey: queryKeys.sourceFiles(projectId, filters),
    queryFn: () =>
      apiGet<SourceFileSummaryDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/source-files${queryString ? `?${queryString}` : ""}`
      )
  });
}

export function sourceFileDetailQuery(projectId: string, sourceFileId: string) {
  return queryOptions({
    queryKey: queryKeys.sourceFileDetail(projectId, sourceFileId),
    queryFn: () =>
      apiGet<SourceFileDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/source-files/${encodeURIComponent(sourceFileId)}`
      )
  });
}

export function sourceAggregateQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.sourceAggregate(projectId),
    queryFn: () =>
      apiGet<SourceAggregateDto>(
        `/api/projects/${encodeURIComponent(projectId)}/source-files/aggregate`
      )
  });
}
```

- [ ] **Step 5: Run web tests and typecheck**

Run:

```bash
pnpm --filter web test -- src/components/source-inventory-state.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit web source query helpers**

```bash
git add apps/web/src/api/queries.ts apps/web/src/components/source-inventory-state.ts apps/web/src/components/source-inventory-state.test.ts
git commit -m "feat: add source inventory web queries"
```

## Task 7: Source Inventory UI

**Files:**
- Create: `apps/web/src/components/source-inventory.tsx`
- Create: `apps/web/src/components/source-inventory.test.tsx`
- Modify: `apps/web/src/routes/project-detail.tsx`

- [ ] **Step 1: Add static render test**

Create `apps/web/src/components/source-inventory.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SourceInventory } from "./source-inventory.js";

describe("SourceInventory", () => {
  it("renders source counts, files, and selected file facts", () => {
    const html = renderToStaticMarkup(
      <SourceInventory
        aggregate={{
          totalFiles: 1,
          byLanguage: { typescript: 1 },
          byKind: { source: 1 }
        }}
        files={[
          {
            id: "file-1",
            projectId: "project-1",
            path: "src/math.ts",
            language: "typescript",
            kind: "source",
            sizeBytes: 100,
            contentHash: "hash",
            lastSeenAt: "2026-05-09T12:00:00.000Z",
            importCount: 1,
            exportCount: 1,
            symbolCount: 1
          }
        ]}
        selectedFile={{
          id: "file-1",
          projectId: "project-1",
          path: "src/math.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 100,
          contentHash: "hash",
          lastSeenAt: "2026-05-09T12:00:00.000Z",
          imports: [{ id: "import-1", specifier: "node:assert", importKind: "named", importedNames: ["strict"], isRelative: false, resolvedPath: null }],
          exports: [{ id: "export-1", exportedName: "add", exportKind: "named", sourceSpecifier: null }],
          symbols: [{ id: "symbol-1", name: "add", symbolKind: "function", isExported: true, line: 2, metadata: {} }]
        }}
        filters={{ language: "", kind: "", q: "" }}
        selectedFileId="file-1"
        isLoading={false}
        errorMessage={null}
        onFiltersChange={() => undefined}
        onSelectFile={() => undefined}
      />
    );

    expect(html).toContain("Source Inventory");
    expect(html).toContain("src/math.ts");
    expect(html).toContain("node:assert");
    expect(html).toContain("add");
  });

  it("renders an empty state", () => {
    const html = renderToStaticMarkup(
      <SourceInventory
        aggregate={{ totalFiles: 0, byLanguage: {}, byKind: {} }}
        files={[]}
        selectedFile={null}
        filters={{ language: "", kind: "", q: "" }}
        selectedFileId={null}
        isLoading={false}
        errorMessage={null}
        onFiltersChange={() => undefined}
        onSelectFile={() => undefined}
      />
    );

    expect(html).toContain("No source files scanned.");
  });
});
```

- [ ] **Step 2: Run component test and verify failure**

Run:

```bash
pnpm --filter web test -- src/components/source-inventory.test.tsx
```

Expected: FAIL because `source-inventory.tsx` does not exist.

- [ ] **Step 3: Implement source inventory component**

Create `apps/web/src/components/source-inventory.tsx` with these props:

```ts
import type {
  SourceAggregateDto,
  SourceFileDetailDto,
  SourceFileSummaryDto
} from "@specops/contracts";
import { FileCode2 } from "lucide-react";
import type { SourceFileFilters } from "./source-inventory-state.js";

type SourceInventoryProps = {
  aggregate: SourceAggregateDto | null;
  files: SourceFileSummaryDto[];
  selectedFile: SourceFileDetailDto | null;
  filters: Required<SourceFileFilters>;
  selectedFileId: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  onFiltersChange: (filters: Required<SourceFileFilters>) => void;
  onSelectFile: (sourceFileId: string) => void;
};
```

Render requirements:

- Use a top-level `<section className="panel-section">`.
- Header text: `Source Inventory`.
- Show total file count and compact language/kind counts.
- Render `<select>` controls for language and kind with empty `All languages` and `All kinds` options.
- Render a search input with placeholder `Search source files`.
- Render files as buttons with path, kind, language, and `symbolCount/importCount/exportCount`.
- Render selected file detail with three subsections: `Symbols`, `Imports`, `Exports`.
- Render `No source files scanned.` when not loading and `files.length === 0`.
- Render loading and error text when applicable.

- [ ] **Step 4: Integrate into project detail**

Modify `apps/web/src/routes/project-detail.tsx`:

- Import `useState`, source queries, `SourceInventory`, and `selectInitialSourceFileId`.
- Add source aggregate/files queries to `useQueries` or separate `useQuery` calls.
- Keep local filters state:

```ts
const [sourceFilters, setSourceFilters] = useState({ language: "", kind: "", q: "" });
const [selectedSourceFileId, setSelectedSourceFileId] = useState<string | null>(null);
```

- Select a source file ID from current state and source file list.
- Load source file detail only when a selected source file ID exists.
- In `invalidateProject`, also invalidate `queryKeys.sourceAggregate(projectId)` and source file queries.
- Render `SourceInventory` in the `inspector` after index runs and before validation.
- In latest run status, add source counts when `latestRun.sourceFileCount !== undefined`.

- [ ] **Step 5: Run web tests and typecheck**

Run:

```bash
pnpm --filter web test -- src/components/source-inventory.test.tsx src/components/source-inventory-state.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit source inventory UI**

```bash
git add apps/web/src/components/source-inventory.tsx apps/web/src/components/source-inventory.test.tsx apps/web/src/routes/project-detail.tsx
git commit -m "feat: show source inventory in project detail"
```

## Task 8: Full Verification And Documentation Touch-Up

**Files:**
- Modify: `README.md` if the visible workflow text needs a short Milestone 3 note.

- [ ] **Step 1: Run full workspace checks**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: PASS. DB-backed API tests may skip unless `TEST_DATABASE_URL` is set; that is acceptable for local full-suite verification if a separate DB-backed run is recorded.

- [ ] **Step 2: Run DB-backed API checks when PostgreSQL test DB is available**

Run:

```bash
export TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test
pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: PASS. If PostgreSQL is unavailable, document the exact missing prerequisite in the final handoff.

- [ ] **Step 3: Update README workflow note if needed**

If the UI label or endpoint behavior changed user-visible indexing behavior, add a short README note under `Milestone 1 Workflow` or create a new `Source Inventory` subsection:

```md
Running project indexing also refreshes TypeScript/JavaScript source inventory. The project detail view shows source files, imports, exports, and top-level symbols as derived cache data.
```

- [ ] **Step 4: Re-run focused docs-free checks after README change**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit verification/docs**

```bash
git add README.md
git commit -m "docs: document source inventory indexing"
```

Skip the commit if README did not need changes.

## Self-Review Checklist

- Spec coverage:
  - Pure scanner package: Task 3.
  - Normalized DB tables: Task 2.
  - Integrated indexing workflow: Task 4.
  - Source inventory read API: Task 5.
  - Inspect-only UI: Tasks 6 and 7.
  - Parse warnings as validation messages: Task 4.
  - Generated directory exclusions: Task 3.
  - Tests across scanner, API, and web: Tasks 3, 4, 5, 6, 7, and 8.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or unspecified test steps should remain.
- Type consistency:
  - Contract DTO names use `SourceFileSummaryDto`, `SourceFileDetailDto`, `SourceAggregateDto`.
  - Scanner facts use `SourceFileFact`, `SourceImportFact`, `SourceExportFact`, `SourceSymbolFact`.
  - DB table names use `sourceFiles`, `sourceImports`, `sourceExports`, `sourceSymbols`.
  - Web helper filter type uses `SourceFileFilters`.
