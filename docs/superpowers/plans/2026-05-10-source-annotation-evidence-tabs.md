# Source Annotation Evidence Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build explicit source-to-spec evidence using JSDoc `@specops <entity-id>` annotations, with bootstrap writing annotations, indexing reading them, and entity detail showing source files as read-only tabs.

**Architecture:** Extend the scanner to extract annotation facts from leading JSDoc on top-level symbols, persist those facts as rebuildable `source_spec_links`, expose entity-specific source evidence through the API, and render the evidence as tabs beside the editable spec. Bootstrap plans source edits before writing and normal re-index remains read-only for source files.

**Tech Stack:** TypeScript, TypeScript compiler API, Fastify, Drizzle/PostgreSQL, Vitest, React, TanStack Query, Tailwind CSS, CodeMirror.

---

## Working Notes

- Use a feature worktree before implementation: `git worktree add .worktrees/source-annotation-evidence -b source-annotation-evidence`.
- The current main checkout may contain unrelated `sample/specops` working-tree changes from manual bootstrap experiments. Do not revert or commit those unless the user explicitly asks.
- Keep each task as its own commit.
- DB-backed API tests require `TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test`.

## File Structure

- Modify `packages/repo-scanner/src/types.ts`: add annotation fact types to source symbol facts.
- Modify `packages/repo-scanner/src/parse.ts`: extract `@specops` tags from JSDoc attached to top-level declarations.
- Modify `packages/repo-scanner/src/__tests__/parse.test.ts`: scanner parser coverage.
- Modify `packages/contracts/src/source.ts`: add source-spec link DTO schemas.
- Modify `packages/contracts/src/source.test.ts`: contract coverage for source-link DTOs.
- Modify `packages/db/src/schema.ts`: add `sourceSpecLinks` table.
- Modify `packages/db/migrations/0000_initial.sql`: create and index `source_spec_links`.
- Modify `packages/db/src/schema.typecheck.ts`: include the new table in Drizzle type checks.
- Modify `apps/api/src/services/source-scan-service.ts`: persist source links, validate missing entities, read entity links and excerpts.
- Modify `apps/api/src/routes/entities.ts`: add `GET /projects/:projectId/entities/:entityId/source-links`.
- Modify `apps/api/src/__tests__/routes.test.ts`: API indexing, validation, endpoint, and path-safety tests.
- Create `packages/source-bootstrap/src/annotate.ts`: pure source annotation planner/applicator.
- Modify `packages/source-bootstrap/src/index.ts`: export annotation helpers.
- Create `packages/source-bootstrap/src/annotate.test.ts`: annotation writer tests.
- Modify `apps/api/src/services/source-bootstrap-service.ts`: apply source annotation edits during bootstrap and restore on failure.
- Modify `packages/source-bootstrap/src/generate.ts`: carry enough evidence line data for annotation planning.
- Modify `apps/web/src/api/queries.ts`: add source-link query key, DTO import, and fetcher.
- Create `apps/web/src/components/source-link-tabs.tsx`: tab rendering and read-only source excerpts.
- Create `apps/web/src/components/source-link-tabs.test.tsx`: UI component tests.
- Modify `apps/web/src/components/entity-detail.tsx`: wrap editor in spec/source tabs.
- Modify `apps/web/src/components/entity-detail.test.tsx` or add route-level tests if existing test shape makes that easier.

---

### Task 1: Scanner Parses `@specops` JSDoc Annotations

**Files:**
- Modify: `packages/repo-scanner/src/types.ts`
- Modify: `packages/repo-scanner/src/parse.ts`
- Test: `packages/repo-scanner/src/__tests__/parse.test.ts`

- [ ] **Step 1: Add failing parser tests**

Append these tests to `packages/repo-scanner/src/__tests__/parse.test.ts`:

```ts
  it("extracts specops annotations from leading JSDoc", () => {
    const result = parseSourceFacts({
      path: "src/decision.ts",
      content:
        "/**\n" +
        " * Domain decision record.\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    });

    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "Decision",
        specopsAnnotations: [
          {
            entityId: "domain.decision",
            line: 3
          }
        ]
      })
    );
  });

  it("extracts multiple specops annotations on one declaration", () => {
    const result = parseSourceFacts({
      path: "src/decision-service.ts",
      content:
        "/**\n" +
        " * @specops interface.decision-service\n" +
        " * @specops uc.create-decision\n" +
        " */\n" +
        "export class DecisionService {}\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "DecisionService"))
      .toMatchObject({
        specopsAnnotations: [
          { entityId: "interface.decision-service", line: 2 },
          { entityId: "uc.create-decision", line: 3 }
        ]
      });
  });

  it("ignores unrelated leading comments", () => {
    const result = parseSourceFacts({
      path: "src/workspace.ts",
      content:
        "// specops: domain.workspace\n" +
        "/** not a specops tag */\n" +
        "export type Workspace = { id: string }\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "Workspace"))
      .toMatchObject({ specopsAnnotations: [] });
  });

  it("keeps empty specops annotations for API validation", () => {
    const result = parseSourceFacts({
      path: "src/broken-annotation.ts",
      content:
        "/**\n" +
        " * @specops\n" +
        " */\n" +
        "export interface BrokenAnnotation { id: string }\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "BrokenAnnotation"))
      .toMatchObject({
        specopsAnnotations: [{ entityId: "", line: 2 }]
      });
  });

  it("warns when a specops JSDoc tag is not attached to a symbol declaration", () => {
    const result = parseSourceFacts({
      path: "src/barrel.ts",
      content:
        "/** @specops domain.decision */\n" +
        "export { Decision } from './decision';\n"
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_spec_unresolved_symbol",
        filePath: "src/barrel.ts"
      })
    );
  });
```

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
pnpm --filter @specops/repo-scanner test -- parse --run
```

Expected: FAIL because `specopsAnnotations` is not present on symbols.

- [ ] **Step 3: Add scanner types**

Update `packages/repo-scanner/src/types.ts`:

```ts
export type SourceSpecopsAnnotationFact = {
  entityId: string;
  line: number | null;
};

export type SourceSymbolFact = {
  name: string;
  symbolKind: string;
  isExported: boolean;
  line: number | null;
  metadata: Record<string, unknown>;
  specopsAnnotations: SourceSpecopsAnnotationFact[];
};

export type SourceScanWarning = {
  code: "source_parse_error" | "source_read_error" | "source_spec_unresolved_symbol";
  message: string;
  filePath: string;
};
```

- [ ] **Step 4: Implement JSDoc extraction**

In `packages/repo-scanner/src/parse.ts`, update `symbolFact` and add helper functions:

```ts
function symbolFact(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  symbolKind: string,
  isExported: boolean
): SourceSymbolFact {
  return {
    name,
    symbolKind,
    isExported,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    metadata: {},
    specopsAnnotations: readSpecopsAnnotations(sourceFile, node)
  };
}

function readSpecopsAnnotations(
  sourceFile: ts.SourceFile,
  node: ts.Node
): SourceSymbolFact["specopsAnnotations"] {
  const fullText = sourceFile.getFullText();
  const ranges = ts.getJSDocCommentRanges(node, fullText) ?? [];
  const annotations: SourceSymbolFact["specopsAnnotations"] = [];

  for (const range of ranges) {
    const text = fullText.slice(range.pos, range.end);
    const startLine = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const match = /@specops(?:\s+([^\s*]+))?/.exec(lines[index] ?? "");
      if (!match) continue;
      annotations.push({
        entityId: match[1]?.trim() ?? "",
        line: startLine + index
      });
    }
  }

  return annotations;
}

function unresolvedSpecopsWarnings(
  sourceFile: ts.SourceFile,
  node: ts.Node
): SourceScanWarning[] {
  return readSpecopsAnnotations(sourceFile, node).map((annotation) => ({
    code: "source_spec_unresolved_symbol",
    filePath: sourceFile.fileName,
    message: `Source annotation "${annotation.entityId || "@specops"}" is not attached to a supported top-level symbol.`
  }));
}
```

Call `warnings.push(...unresolvedSpecopsWarnings(sourceFile, statement))` before `continue` in parse branches that consume a top-level statement without creating a symbol fact, including `ExportDeclaration`, anonymous default function/class/export assignment branches, and the final unsupported-statement path.

- [ ] **Step 5: Update any symbol expectations that compare full objects**

If tests fail because older expected objects omit `specopsAnnotations`, add `specopsAnnotations: []` only where exact equality is used. Prefer `expect.objectContaining` in existing tests.

- [ ] **Step 6: Run scanner tests**

Run:

```bash
pnpm --filter @specops/repo-scanner test -- parse --run
```

Expected: PASS.

- [ ] **Step 7: Commit scanner parser work**

```bash
git add packages/repo-scanner/src/types.ts packages/repo-scanner/src/parse.ts packages/repo-scanner/src/__tests__/parse.test.ts
git commit -m "feat: parse specops source annotations"
```

---

### Task 2: Persist Source-Spec Links During Indexing

**Files:**
- Modify: `packages/contracts/src/source.ts`
- Modify: `packages/contracts/src/source.test.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `apps/api/src/services/source-scan-service.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add source-link contract tests**

Append to `packages/contracts/src/source.test.ts`:

```ts
  it("parses source spec link DTOs", () => {
    expect(
      sourceSpecLinkSchema.parse({
        id: "link-1",
        projectId: "project-1",
        sourceFileId: "file-1",
        filePath: "src/decision.ts",
        entityId: "domain.decision",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 5,
        annotationLine: 3,
        contentHash: "abc123",
        excerpt: {
          status: "available",
          startLine: 1,
          endLine: 6,
          text:
            "/**\n" +
            " * @specops domain.decision\n" +
            " */\n" +
            "export interface Decision {}\n"
        },
        createdAt: "2026-05-10T00:00:00.000Z"
      })
    ).toMatchObject({
      entityId: "domain.decision",
      filePath: "src/decision.ts",
      excerpt: { status: "available" }
    });
  });
```

Also update the import list in that test file to include `sourceSpecLinkSchema`.

- [ ] **Step 2: Add contract schemas**

In `packages/contracts/src/source.ts`, add:

```ts
export const sourceExcerptSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    startLine: z.number(),
    endLine: z.number(),
    text: z.string()
  }),
  z.object({
    status: z.enum(["missing", "changed", "unavailable"]),
    message: z.string()
  })
]);

export const sourceSpecLinkSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceFileId: z.string(),
  filePath: z.string(),
  entityId: z.string(),
  symbolName: z.string(),
  symbolKind: z.string(),
  symbolLine: z.number().nullable(),
  annotationLine: z.number().nullable(),
  contentHash: z.string(),
  excerpt: sourceExcerptSchema.optional(),
  createdAt: z.string()
});

export type SourceExcerptDto = z.infer<typeof sourceExcerptSchema>;
export type SourceSpecLinkDto = z.infer<typeof sourceSpecLinkSchema>;
```

- [ ] **Step 3: Run contract tests to verify pass/fail loop**

Run:

```bash
pnpm --filter @specops/contracts test -- source --run
```

Expected after Step 2: PASS.

- [ ] **Step 4: Add Drizzle table**

In `packages/db/src/schema.ts`, after `sourceSymbols`, add:

```ts
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
```

In `packages/db/src/schema.typecheck.ts`, include `sourceSpecLinks` in the import and add:

```ts
type SourceSpecLink = InferSelectModel<typeof sourceSpecLinks>;
const _sourceSpecLink = null as unknown as SourceSpecLink;
void _sourceSpecLink;
```

- [ ] **Step 5: Add SQL migration block**

Append to `packages/db/migrations/0000_initial.sql` after `source_symbols` index/fk setup:

```sql
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
```

- [ ] **Step 6: Add failing API tests for persistence and missing entity warning**

Append near the source scan tests in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("persists source spec links from JSDoc annotations during indexing", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\n" +
        "id: domain.decision\n" +
        "type: domain_entity\n" +
        "title: Decision\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });

    expect(response.statusCode).toBe(200);

    const linksResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(linksResponse.statusCode).toBe(200);
    expect(linksResponse.json()).toContainEqual(
      expect.objectContaining({
        entityId: "domain.decision",
        filePath: "src/decision.ts",
        symbolName: "Decision",
        symbolKind: "interface",
        annotationLine: 2,
        symbolLine: 4
      })
    );
  });

  it("warns when a source annotation references a missing markdown entity", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(project.specopsPath, { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/** @specops domain.missing */\n" +
        "export interface Decision { id: string }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });

    expect(response.statusCode).toBe(200);

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/validation-messages`
    });

    expect(messagesResponse.json()).toContainEqual(
      expect.objectContaining({
        code: "source_spec_missing_entity",
        filePath: "src/decision.ts",
        entityId: "domain.missing",
        level: "warning"
      })
    );
  });

  it("warns when a source annotation has an invalid entity id", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(project.specopsPath, { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/** @specops */\n" +
        "export interface Decision { id: string }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });

    expect(response.statusCode).toBe(200);

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/validation-messages`
    });

    expect(messagesResponse.json()).toContainEqual(
      expect.objectContaining({
        code: "source_spec_invalid_entity_id",
        filePath: "src/decision.ts",
        level: "warning"
      })
    );
  });
```

- [ ] **Step 7: Run API test to verify failure**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: FAIL because route and persistence do not exist yet.

- [ ] **Step 8: Persist source-spec links in source scan service**

Modify imports in `apps/api/src/services/source-scan-service.ts`:

```ts
import type {
  SourceAggregateDto,
  SourceFileDetailDto,
  SourceFileListQuery,
  SourceFileSummaryDto,
  SourceSpecLinkDto
} from "@specops/contracts";
import {
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  validationMessages
} from "@specops/db";
```

Delete links during refresh before source files:

```ts
await db.delete(sourceSpecLinks).where(eq(sourceSpecLinks.projectId, projectId));
await db.delete(sourceSymbols).where(eq(sourceSymbols.projectId, projectId));
```

After inserting symbols, insert link rows:

```ts
const existingEntityRows = await db
  .select({ entityId: specEntities.entityId })
  .from(specEntities)
  .where(eq(specEntities.projectId, projectId));
const existingEntityIds = new Set(existingEntityRows.map((row) => row.entityId));

const sourceSpecLinkRows = result.files.flatMap((file) => {
  const sourceFileId = sourceFileIdsByPath.get(file.path);
  if (!sourceFileId) return [];

  return file.symbols.flatMap((symbol) =>
    symbol.specopsAnnotations.map((annotation) => ({
      projectId,
      sourceFileId,
      filePath: file.path,
      entityId: annotation.entityId,
      symbolName: symbol.name,
      symbolKind: symbol.symbolKind,
      symbolLine: symbol.line,
      annotationLine: annotation.line,
      contentHash: file.contentHash
    }))
  );
});

const invalidAnnotationWarnings = sourceSpecLinkRows
  .filter((link) => !isValidSpecopsEntityId(link.entityId))
  .map((link) => ({
    projectId,
    indexRunId,
    filePath: link.filePath,
    entityId: link.entityId || null,
    level: "warning",
    code: "source_spec_invalid_entity_id",
    message: "Source annotation has an invalid SpecOps entity id."
  }));

const validSourceSpecLinkRows = sourceSpecLinkRows.filter((link) =>
  isValidSpecopsEntityId(link.entityId)
);

if (validSourceSpecLinkRows.length > 0) {
  await db.insert(sourceSpecLinks).values(validSourceSpecLinkRows).onConflictDoNothing();
}

const missingEntityWarnings = validSourceSpecLinkRows
  .filter((link) => !existingEntityIds.has(link.entityId))
  .map((link) => ({
    projectId,
    indexRunId,
    filePath: link.filePath,
    entityId: link.entityId,
    level: "warning",
    code: "source_spec_missing_entity",
    message: `Source annotation references missing spec entity "${link.entityId}".`
  }));

if (missingEntityWarnings.length > 0) {
  await db.insert(validationMessages).values(missingEntityWarnings);
}

if (invalidAnnotationWarnings.length > 0) {
  await db.insert(validationMessages).values(invalidAnnotationWarnings);
}
```

Add this helper near the bottom of `apps/api/src/services/source-scan-service.ts`:

```ts
function isValidSpecopsEntityId(value: string): boolean {
  return /^[a-z][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)+$/.test(value);
}
```

- [ ] **Step 9: Commit persistence foundation**

```bash
git add packages/contracts/src/source.ts packages/contracts/src/source.test.ts packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/migrations/0000_initial.sql apps/api/src/services/source-scan-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: persist source spec annotations"
```

---

### Task 3: Add Entity Source-Link Endpoint With Safe Excerpts

**Files:**
- Modify: `apps/api/src/services/source-scan-service.ts`
- Modify: `apps/api/src/routes/entities.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing excerpt tests**

Append near source-link API tests in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("returns bounded source excerpts for entity source links", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "const before = true;\n" +
        "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n" +
        "const after = true;\n"
    );
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "available",
        startLine: 1,
        endLine: 6
      }
    });
    expect(response.json()[0].excerpt.text).toContain("@specops domain.decision");
  });

  it("marks source excerpts changed when file content hash differs", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\n---\n\n# Decision\n"
    );
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    const sourcePath = path.join(project.repoPath, "src", "decision.ts");
    await writeFile(sourcePath, "/** @specops domain.decision */\nexport interface Decision {}\n");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/index` });
    await writeFile(sourcePath, "export interface Decision { changed: true }\n");

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({
      excerpt: {
        status: "changed",
        message: "Source file changed since the last index run."
      }
    });
  });
```

- [ ] **Step 2: Add service method and excerpt helpers**

In `apps/api/src/services/source-scan-service.ts`, add to the returned object:

```ts
async listSourceSpecLinksForEntity(input: {
  projectId: string;
  repoPath: string;
  entityId: string;
}): Promise<SourceSpecLinkDto[]> {
  return listSourceSpecLinksForEntity(db, input);
}
```

Add helper functions:

```ts
async function listSourceSpecLinksForEntity(
  db: SourceScanDb,
  input: { projectId: string; repoPath: string; entityId: string }
): Promise<SourceSpecLinkDto[]> {
  const rows = await db
    .select()
    .from(sourceSpecLinks)
    .where(and(eq(sourceSpecLinks.projectId, input.projectId), eq(sourceSpecLinks.entityId, input.entityId)))
    .orderBy(asc(sourceSpecLinks.filePath), asc(sourceSpecLinks.symbolName), asc(sourceSpecLinks.id));

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      projectId: row.projectId,
      sourceFileId: row.sourceFileId,
      filePath: row.filePath,
      entityId: row.entityId,
      symbolName: row.symbolName,
      symbolKind: row.symbolKind,
      symbolLine: row.symbolLine,
      annotationLine: row.annotationLine,
      contentHash: row.contentHash,
      excerpt: await readSourceExcerpt(input.repoPath, row),
      createdAt: row.createdAt.toISOString()
    }))
  );
}
```

Use repo path safety helpers already available in `apps/api/src/lib/path-safety.ts`. The excerpt helper should resolve `row.filePath` inside `repoPath`, reject escapes, read a maximum small file, compare sha256 with `row.contentHash`, and return 3 lines before/after the annotation or symbol line:

```ts
async function readSourceExcerpt(
  repoPath: string,
  link: typeof sourceSpecLinks.$inferSelect
): Promise<SourceSpecLinkDto["excerpt"]> {
  try {
    const targetPath = assertInsideDirectory(repoPath, path.join(repoPath, link.filePath));
    const safePath = await assertRealPathInsideDirectory(repoPath, targetPath);
    const content = await readFile(safePath, "utf8");

    if (sha256(content) !== link.contentHash) {
      return { status: "changed", message: "Source file changed since the last index run." };
    }

    const lines = content.split(/\r?\n/);
    const centerLine = link.annotationLine ?? link.symbolLine ?? 1;
    const startLine = Math.max(1, centerLine - 3);
    const endLine = Math.min(lines.length, centerLine + 4);
    return {
      status: "available",
      startLine,
      endLine,
      text: lines.slice(startLine - 1, endLine).join("\n")
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Source excerpt unavailable."
    };
  }
}
```

Add or reuse `sha256`, `path`, `readFile`, `assertInsideDirectory`, and `assertRealPathInsideDirectory` imports.

- [ ] **Step 3: Add route**

In `apps/api/src/routes/entities.ts`, import `createSourceScanService`, create the service beside `indexerService`, and add:

```ts
  app.get("/projects/:projectId/entities/:entityId/source-links", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    const project = await projectService.getProject(projectId);
    await getEntity(db, projectId, entityId);
    return sourceScanService.listSourceSpecLinksForEntity({
      projectId,
      repoPath: project.repoPath,
      entityId
    });
  });
```

- [ ] **Step 4: Run focused API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: PASS.

- [ ] **Step 5: Commit endpoint work**

```bash
git add apps/api/src/services/source-scan-service.ts apps/api/src/routes/entities.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose entity source evidence"
```

---

### Task 4: Bootstrap Writes JSDoc Source Annotations

**Files:**
- Create: `packages/source-bootstrap/src/annotate.ts`
- Create: `packages/source-bootstrap/src/annotate.test.ts`
- Modify: `packages/source-bootstrap/src/index.ts`
- Modify: `apps/api/src/services/source-bootstrap-service.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add annotation planner tests**

Create `packages/source-bootstrap/src/annotate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { applySourceSpecAnnotations } from "./annotate.js";

describe("applySourceSpecAnnotations", () => {
  it("adds a JSDoc specops tag before a declaration line", () => {
    const result = applySourceSpecAnnotations({
      content: "export interface Decision { id: string }\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 1 }]
    });

    expect(result.content).toBe(
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    );
    expect(result.changed).toBe(true);
  });

  it("preserves existing JSDoc while adding the specops tag", () => {
    const result = applySourceSpecAnnotations({
      content:
        "/**\n" +
        " * Domain object.\n" +
        " */\n" +
        "export interface Decision { id: string }\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 4 }]
    });

    expect(result.content).toContain(" * Domain object.\n * @specops domain.decision\n");
  });

  it("refuses conflicting specops tags on the target declaration", () => {
    expect(() =>
      applySourceSpecAnnotations({
        content:
          "/** @specops domain.other */\n" +
          "export interface Decision { id: string }\n",
        annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 2 }]
      })
    ).toThrow(/already has a different @specops annotation/);
  });
});
```

- [ ] **Step 2: Implement annotation helper**

Create `packages/source-bootstrap/src/annotate.ts`:

```ts
export type SourceSpecAnnotationInput = {
  entityId: string;
  symbolName: string;
  symbolLine: number | null;
};

export type ApplySourceSpecAnnotationsInput = {
  content: string;
  annotations: SourceSpecAnnotationInput[];
};

export type ApplySourceSpecAnnotationsResult = {
  content: string;
  changed: boolean;
};

export function applySourceSpecAnnotations(
  input: ApplySourceSpecAnnotationsInput
): ApplySourceSpecAnnotationsResult {
  const lines = input.content.split(/(?<=\n)/);
  let changed = false;
  const sorted = [...input.annotations]
    .filter((annotation) => annotation.symbolLine !== null)
    .sort((a, b) => (b.symbolLine ?? 0) - (a.symbolLine ?? 0));

  for (const annotation of sorted) {
    const lineIndex = (annotation.symbolLine ?? 1) - 1;
    const existing = findLeadingJsDoc(lines, lineIndex);
    if (existing) {
      const blockText = lines.slice(existing.start, existing.end + 1).join("");
      const existingTags = [...blockText.matchAll(/@specops\s+([A-Za-z0-9_.:-]+)/g)].map(
        (match) => match[1]
      );
      if (existingTags.includes(annotation.entityId)) continue;
      if (existingTags.length > 0) {
        throw new Error(
          `${annotation.symbolName} already has a different @specops annotation: ${existingTags.join(", ")}`
        );
      }
      lines.splice(existing.end, 0, ` * @specops ${annotation.entityId}\n`);
      changed = true;
      continue;
    }

    lines.splice(
      lineIndex,
      0,
      "/**\n",
      ` * @specops ${annotation.entityId}\n`,
      " */\n"
    );
    changed = true;
  }

  return { content: lines.join(""), changed };
}

function findLeadingJsDoc(
  lines: string[],
  declarationLineIndex: number
): { start: number; end: number } | null {
  let index = declarationLineIndex - 1;
  while (index >= 0 && lines[index]?.trim() === "") index -= 1;
  if (index < 0 || !lines[index]?.includes("*/")) return null;

  const end = index;
  while (index >= 0) {
    if (lines[index]?.includes("/**")) return { start: index, end };
    index -= 1;
  }

  return null;
}
```

Export from `packages/source-bootstrap/src/index.ts`:

```ts
export * from "./annotate.js";
```

- [ ] **Step 3: Run annotation tests**

Run:

```bash
pnpm --filter @specops/source-bootstrap test -- annotate --run
```

Expected: PASS.

- [ ] **Step 4: Add API bootstrap test for source annotation**

Extend the existing `"bootstraps source-only projects..."` test in `apps/api/src/__tests__/routes.test.ts` with:

```ts
    await expect(readFile(path.join(project.repoPath, "src", "domain.ts"), "utf8"))
      .resolves.toContain("@specops domain.decision");
    await expect(readFile(path.join(project.repoPath, "src", "service.ts"), "utf8"))
      .resolves.toContain("@specops interface.decision-service");

    const sourceLinksResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/source-links`
    });
    expect(sourceLinksResponse.statusCode).toBe(200);
    expect(sourceLinksResponse.json()).toContainEqual(
      expect.objectContaining({
        entityId: "domain.decision",
        symbolName: "Decision"
      })
    );
```

Add a new conflict test:

```ts
  it("refuses source bootstrap when a candidate symbol has a conflicting specops annotation", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/** @specops domain.other */\n" +
        "export interface Decision { id: string }\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    await expect(fileExists(path.join(project.specopsPath, "domain", "decision.md"))).resolves.toBe(false);
  });
```

- [ ] **Step 5: Wire annotation writes into bootstrap service**

In `apps/api/src/services/source-bootstrap-service.ts`, import:

```ts
import { applySourceSpecAnnotations } from "@specops/source-bootstrap";
```

Before generated markdown writes, group generated evidence by source file and edit source files:

```ts
const sourceSnapshots: Array<{ path: string; original: string }> = [];
try {
  for (const [sourceFile, annotations] of groupAnnotationsBySourceFile(generatedFiles)) {
    const targetPath = await assertSafePath("Source annotation path is outside repoPath", () =>
      assertRealPathInsideDirectory(repoPath, path.join(repoPath, sourceFile))
    );
    const original = await readFile(targetPath, "utf8");
    const result = applySourceSpecAnnotations({
      content: original,
      annotations
    });
    if (!result.changed) continue;
    sourceSnapshots.push({ path: targetPath, original });
    await writeFile(targetPath, result.content, { flag: "w" });
  }

  // existing markdown write and indexing flow
} catch (error) {
  await Promise.all(sourceSnapshots.map((snapshot) => writeFile(snapshot.path, snapshot.original)));
  throw error;
}
```

Add helper:

```ts
function groupAnnotationsBySourceFile(generatedFiles: BootstrapGeneratedSpecFile[]) {
  const byFile = new Map<string, Array<{ entityId: string; symbolName: string; symbolLine: number | null }>>();
  for (const file of generatedFiles) {
    for (const evidence of file.evidence) {
      const current = byFile.get(evidence.sourceFile) ?? [];
      current.push({
        entityId: file.entityId,
        symbolName: evidence.symbolName,
        symbolLine: evidence.line
      });
      byFile.set(evidence.sourceFile, current);
    }
  }
  return byFile;
}
```

Map annotation helper errors about conflicting tags to `ConflictError`.

- [ ] **Step 6: Run bootstrap tests**

Run:

```bash
pnpm --filter @specops/source-bootstrap test -- annotate generate --run
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: PASS.

- [ ] **Step 7: Commit bootstrap annotation work**

```bash
git add packages/source-bootstrap/src/annotate.ts packages/source-bootstrap/src/annotate.test.ts packages/source-bootstrap/src/index.ts apps/api/src/services/source-bootstrap-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: annotate bootstrapped source symbols"
```

---

### Task 5: Web Entity Detail Source Tabs

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/source-link-tabs.tsx`
- Create: `apps/web/src/components/source-link-tabs.test.tsx`
- Modify: `apps/web/src/components/entity-detail.tsx`
- Test: `apps/web/src/components/entity-detail.test.tsx` or existing route tests if component tests are not present.

- [ ] **Step 1: Add query helper**

In `apps/web/src/api/queries.ts`, import `SourceSpecLinkDto` and add:

```ts
sourceLinks: (projectId: string, entityId: string) =>
  ["projects", projectId, "entities", entityId, "source-links"] as const,
```

Add fetcher:

```ts
export function entitySourceLinksQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.sourceLinks(projectId, entityId),
    queryFn: () =>
      apiGet<SourceSpecLinkDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/source-links`
      )
  });
}
```

- [ ] **Step 2: Add source tab component tests**

Create `apps/web/src/components/source-link-tabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SourceLinkTabs } from "./source-link-tabs.js";

describe("SourceLinkTabs", () => {
  it("renders spec tab first and switches to source excerpt tabs", async () => {
    const user = userEvent.setup();
    render(
      <SourceLinkTabs
        specTitle="Decision"
        sourceLinks={[
          {
            id: "link-1",
            projectId: "project-1",
            sourceFileId: "file-1",
            filePath: "src/decision-model.ts",
            entityId: "domain.decision",
            symbolName: "Decision",
            symbolKind: "interface",
            symbolLine: 4,
            annotationLine: 2,
            contentHash: "abc",
            createdAt: "2026-05-10T00:00:00.000Z",
            excerpt: {
              status: "available",
              startLine: 1,
              endLine: 4,
              text: "/**\n * @specops domain.decision\n */\nexport interface Decision {}\n"
            }
          }
        ]}
        specPanel={<div>Markdown editor</div>}
      />
    );

    expect(screen.getByRole("tab", { name: "Spec: Decision" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Markdown editor")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "decision-model.ts" }));

    expect(screen.getByText("src/decision-model.ts")).toBeInTheDocument();
    expect(screen.getByText(/@specops domain.decision/)).toBeInTheDocument();
    expect(screen.getByText("Decision")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement `SourceLinkTabs`**

Create `apps/web/src/components/source-link-tabs.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from "react";
import type { SourceSpecLinkDto } from "@specops/contracts";

type SourceLinkTabsProps = {
  specTitle: string;
  sourceLinks: SourceSpecLinkDto[];
  specPanel: ReactNode;
};

export function SourceLinkTabs({ specTitle, sourceLinks, specPanel }: SourceLinkTabsProps) {
  const [activeTab, setActiveTab] = useState("spec");
  const visibleLinks = sourceLinks.slice(0, 4);
  const overflowCount = Math.max(0, sourceLinks.length - visibleLinks.length);
  const activeLink = useMemo(
    () => visibleLinks.find((link) => link.id === activeTab) ?? null,
    [activeTab, visibleLinks]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "spec"}
          className={tabClass(activeTab === "spec")}
          onClick={() => setActiveTab("spec")}
        >
          Spec: {specTitle}
        </button>
        {visibleLinks.map((link) => (
          <button
            key={link.id}
            type="button"
            role="tab"
            aria-selected={activeTab === link.id}
            className={tabClass(activeTab === link.id)}
            onClick={() => setActiveTab(link.id)}
          >
            {basename(link.filePath)}
          </button>
        ))}
        {overflowCount > 0 ? (
          <span className="shrink-0 px-2 py-1 text-xs text-slate-500">+{overflowCount}</span>
        ) : null}
      </div>
      {activeLink ? <SourceLinkPanel link={activeLink} /> : specPanel}
    </div>
  );
}

function SourceLinkPanel({ link }: { link: SourceSpecLinkDto }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white p-3 text-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-mono text-slate-900">{link.filePath}</span>
        <span>{link.symbolKind}</span>
        <span>{link.symbolName}</span>
        {link.annotationLine ? <span>annotation line {link.annotationLine}</span> : null}
        {link.symbolLine ? <span>symbol line {link.symbolLine}</span> : null}
      </div>
      {link.excerpt?.status === "available" ? (
        <pre className="overflow-auto rounded border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
          <code>{withLineNumbers(link.excerpt.text, link.excerpt.startLine)}</code>
        </pre>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {link.excerpt?.message ?? "Source excerpt unavailable."}
        </div>
      )}
    </div>
  );
}

function tabClass(active: boolean) {
  return [
    "shrink-0 border-b-2 px-3 py-2 text-xs font-medium",
    active
      ? "border-slate-950 text-slate-950"
      : "border-transparent text-slate-500 hover:text-slate-900"
  ].join(" ");
}

function basename(filePath: string) {
  return filePath.split("/").at(-1) ?? filePath;
}

function withLineNumbers(text: string, startLine: number) {
  return text
    .split(/\r?\n/)
    .map((line, index) => `${String(startLine + index).padStart(4, " ")}  ${line}`)
    .join("\n");
}
```

- [ ] **Step 4: Wire tabs into `EntityDetail`**

In `apps/web/src/components/entity-detail.tsx`, import:

```ts
import { entitySourceLinksQuery } from "../api/queries.js";
import { SourceLinkTabs } from "./source-link-tabs.js";
```

Add query after entity query:

```ts
const sourceLinks = useQuery({
  ...entitySourceLinksQuery(projectId, entityId),
  enabled: Boolean(entityId)
});
```

Replace the direct `MarkdownEditor` with:

```tsx
        <SourceLinkTabs
          specTitle={entity.data.title}
          sourceLinks={sourceLinks.data ?? []}
          specPanel={
            <MarkdownEditor
              value={editorMarkdown}
              height="100%"
              minHeight="0px"
              className="min-h-0 flex-1"
              onChange={(value) => {
                setSaveError(null);
                onDraftChange(value);
              }}
            />
          }
        />
```

Show source-link query errors without blocking editing:

```tsx
      {sourceLinks.error ? (
        <p className="text-sm text-red-700">{sourceLinks.error.message}</p>
      ) : null}
```

- [ ] **Step 5: Run web tests**

Run:

```bash
pnpm --filter web test -- src/components/source-link-tabs.test.tsx src/components/entity-detail.test.tsx
```

If there is no `entity-detail.test.tsx`, run:

```bash
pnpm --filter web test -- src/components/source-link-tabs.test.tsx src/routes/project-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit web tabs**

```bash
git add apps/web/src/api/queries.ts apps/web/src/components/source-link-tabs.tsx apps/web/src/components/source-link-tabs.test.tsx apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "feat: show source evidence tabs"
```

If one of the test files listed in `git add` does not exist, omit it from the command.

---

### Task 6: Final Integration Verification

**Files:**
- Modify only if verification exposes issues.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS. Note that plain `pnpm test` skips DB-backed API tests unless `TEST_DATABASE_URL` is set.

- [ ] **Step 3: Run DB-backed API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: PASS, including source annotation and bootstrap tests.

- [ ] **Step 4: Run web build**

Run:

```bash
pnpm --filter web build
```

Expected: PASS. A Vite chunk-size warning is acceptable if the build exits 0.

- [ ] **Step 5: Manual smoke test**

With Postgres running, create a temp source-only project through the API or an existing local script, then:

1. Add `src/decision.ts` with `export interface Decision { id: string }`.
2. Run `POST /api/projects/:id/bootstrap-from-source`.
3. Confirm `src/decision.ts` now contains `@specops domain.decision`.
4. Run `GET /api/projects/:id/entities/domain.decision/source-links`.
5. Confirm the response includes `src/decision.ts`, symbol `Decision`, and an available excerpt.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
git log --oneline --max-count=8
```

Expected: only intentional commits on the feature branch. Any unrelated `sample/specops` changes from before this work must remain uncommitted unless the user explicitly includes them.
