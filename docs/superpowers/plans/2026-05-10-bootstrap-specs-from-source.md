# Bootstrap Specs From Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-click deterministic source bootstrap workflow that writes initial `domain_entity` and `interface` markdown specs from exported TypeScript/JavaScript source symbols, then indexes them.

**Architecture:** Put deterministic source-to-markdown generation in a focused `@specops/source-bootstrap` package. Add an API service and route that validate one-time bootstrap rules, run the existing scanner, write generated markdown, run the existing indexer, and then mark `project.yaml`. Add a small web mutation and project-detail action button.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Fastify, Drizzle/PostgreSQL, React, TanStack Query, YAML.

---

## File Structure

- Create `packages/source-bootstrap/`: pure deterministic generator package with no DB, Fastify, or React dependency.
- Modify `tsconfig.base.json`: add `@specops/source-bootstrap` path alias.
- Modify `apps/api/package.json`: add `@specops/source-bootstrap` workspace dependency.
- Create `apps/api/src/services/source-bootstrap-service.ts`: API orchestration for one-click bootstrap.
- Modify `apps/api/src/routes/projects.ts`: register `POST /projects/:projectId/bootstrap-from-source`.
- Modify `apps/api/src/__tests__/routes.test.ts`: DB-backed route coverage.
- Modify `apps/web/src/api/queries.ts`: add bootstrap query function.
- Create `apps/web/src/components/project-actions.tsx`: testable action-button component.
- Create `apps/web/src/components/project-actions.test.tsx`: button rendering/disabled coverage.
- Modify `apps/web/src/routes/project-detail.tsx`: wire bootstrap mutation and action component.

Keep the existing uncommitted `packages/markdown/src/__tests__/sample-project.test.ts` change out of commits for this feature unless the user explicitly asks to include it.

---

### Task 1: Source Bootstrap Generator Package

**Files:**
- Create: `packages/source-bootstrap/package.json`
- Create: `packages/source-bootstrap/tsconfig.json`
- Create: `packages/source-bootstrap/src/index.ts`
- Create: `packages/source-bootstrap/src/generate.ts`
- Create: `packages/source-bootstrap/src/generate.test.ts`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Write the failing generator tests**

Create `packages/source-bootstrap/package.json`:

```json
{
  "name": "@specops/source-bootstrap",
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
    "@specops/repo-scanner": "workspace:*",
    "yaml": "^2.8.4"
  }
}
```

Create `packages/source-bootstrap/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../repo-scanner" }]
}
```

Create `packages/source-bootstrap/src/generate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { generateBootstrapSpecFiles, slugifySourceSymbol } from "./generate.js";
import type { ScanRepositoryResult } from "@specops/repo-scanner";

describe("generateBootstrapSpecFiles", () => {
  it("generates domain and interface specs from exported source symbols", () => {
    const files = generateBootstrapSpecFiles(scanResult());

    expect(files.map((file) => file.path)).toEqual([
      "domain/decision-link.md",
      "domain/decision.md",
      "domain/workspace.md",
      "interfaces/decision-service.md",
      "interfaces/reminder-scheduler.md"
    ]);
    expect(files.find((file) => file.path === "domain/decision.md")?.entityId).toBe(
      "domain.decision"
    );
    expect(files.find((file) => file.path === "domain/decision.md")?.content).toContain(
      "type: domain_entity"
    );
    expect(files.find((file) => file.path === "interfaces/decision-service.md")?.entityId).toBe(
      "interface.decision-service"
    );
    expect(files.find((file) => file.path === "interfaces/decision-service.md")?.content).toContain(
      "## Responsibility"
    );
  });

  it("skips non-exported symbols, test files, config files, and default exports", () => {
    const files = generateBootstrapSpecFiles({
      files: [
        {
          path: "src/internal.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 10,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "default", exportKind: "default", sourceSpecifier: null }],
          symbols: [
            { name: "Internal", symbolKind: "interface", isExported: false, line: 1, metadata: {} }
          ]
        },
        {
          path: "src/domain.test.ts",
          language: "typescript",
          kind: "test",
          sizeBytes: 10,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "Decision", exportKind: "type", sourceSpecifier: null }],
          symbols: [
            { name: "Decision", symbolKind: "interface", isExported: true, line: 1, metadata: {} }
          ]
        }
      ],
      warnings: []
    });

    expect(files).toEqual([]);
  });

  it("merges duplicate candidates into one spec with combined evidence", () => {
    const files = generateBootstrapSpecFiles({
      files: [
        sourceFile("src/domain.ts", [
          { name: "Decision", symbolKind: "interface", isExported: true, line: 1, metadata: {} }
        ]),
        sourceFile("src/model.ts", [
          { name: "Decision", symbolKind: "type_alias", isExported: true, line: 2, metadata: {} }
        ])
      ],
      warnings: []
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain("`src/domain.ts` exports `Decision` as an interface.");
    expect(files[0]?.content).toContain("`src/model.ts` exports `Decision` as a type alias.");
  });

  it("slugifies source symbols stably", () => {
    expect(slugifySourceSymbol("DecisionService")).toBe("decision-service");
    expect(slugifySourceSymbol("workspace_record")).toBe("workspace-record");
    expect(slugifySourceSymbol("HTTPClient")).toBe("http-client");
  });
});

function scanResult(): ScanRepositoryResult {
  return {
    files: [
      sourceFile("src/domain.ts", [
        { name: "Workspace", symbolKind: "interface", isExported: true, line: 1, metadata: {} },
        { name: "Decision", symbolKind: "interface", isExported: true, line: 7, metadata: {} },
        { name: "DecisionLink", symbolKind: "type_alias", isExported: true, line: 14, metadata: {} },
        { name: "internalHelper", symbolKind: "function", isExported: false, line: 20, metadata: {} }
      ]),
      sourceFile("src/services/decision-service.ts", [
        { name: "DecisionService", symbolKind: "class", isExported: true, line: 4, metadata: {} }
      ]),
      sourceFile("src/services/reminder-scheduler.ts", [
        { name: "ReminderScheduler", symbolKind: "class", isExported: true, line: 5, metadata: {} }
      ])
    ],
    warnings: []
  };
}

function sourceFile(path: string, symbols: ScanRepositoryResult["files"][number]["symbols"]) {
  return {
    path,
    language: "typescript" as const,
    kind: "source" as const,
    sizeBytes: 100,
    contentHash: `${path}-hash`,
    imports: [],
    exports: symbols
      .filter((symbol) => symbol.isExported)
      .map((symbol) => ({
        exportedName: symbol.name,
        exportKind: symbol.symbolKind === "type_alias" || symbol.symbolKind === "interface" ? "type" as const : "named" as const,
        sourceSpecifier: null
      })),
    symbols
  };
}
```

Create `packages/source-bootstrap/src/index.ts`:

```ts
export {
  generateBootstrapSpecFiles,
  slugifySourceSymbol
} from "./generate.js";
export type {
  BootstrapGeneratedSpecFile,
  BootstrapSourceEvidence
} from "./generate.js";
```

Modify `tsconfig.base.json` path aliases:

```json
"@specops/source-bootstrap": ["packages/source-bootstrap/src/index.ts"]
```

- [ ] **Step 2: Run the generator test to verify it fails**

Run:

```sh
pnpm --filter @specops/source-bootstrap test -- generate --run
```

Expected: FAIL because `packages/source-bootstrap/src/generate.ts` does not exist.

- [ ] **Step 3: Implement the generator**

Create `packages/source-bootstrap/src/generate.ts`:

```ts
import { stringify } from "yaml";
import type { ScanRepositoryResult, SourceFileFact, SourceSymbolFact } from "@specops/repo-scanner";

export type BootstrapSourceEvidence = {
  sourceFile: string;
  symbolName: string;
  symbolKind: string;
  exported: boolean;
  line: number | null;
};

export type BootstrapGeneratedSpecFile = {
  entityId: string;
  type: "domain_entity" | "interface";
  title: string;
  path: string;
  content: string;
  evidence: BootstrapSourceEvidence[];
};

type Candidate = {
  key: string;
  entityId: string;
  type: "domain_entity" | "interface";
  title: string;
  path: string;
  evidence: BootstrapSourceEvidence[];
};

const interfaceSuffixes = [
  "Service",
  "Scheduler",
  "Client",
  "Repository",
  "Controller",
  "Router",
  "Handler"
];

const domainSymbolKinds = new Set(["interface", "type_alias", "class", "enum"]);

export function generateBootstrapSpecFiles(
  scan: ScanRepositoryResult
): BootstrapGeneratedSpecFile[] {
  const candidates = new Map<string, Candidate>();

  for (const sourceFile of scan.files) {
    if (sourceFile.kind === "test" || sourceFile.kind === "config") continue;

    for (const symbol of sourceFile.symbols) {
      if (!isEligibleSymbol(sourceFile, symbol)) continue;
      const type = classifySymbol(symbol.name);
      if (!type) continue;

      const slug = slugifySourceSymbol(symbol.name);
      const entityId = type === "interface" ? `interface.${slug}` : `domain.${slug}`;
      const candidatePath = type === "interface" ? `interfaces/${slug}.md` : `domain/${slug}.md`;
      const evidence: BootstrapSourceEvidence = {
        sourceFile: sourceFile.path,
        symbolName: symbol.name,
        symbolKind: symbol.symbolKind,
        exported: symbol.isExported,
        line: symbol.line
      };
      const existing = candidates.get(entityId);

      if (existing) {
        existing.evidence.push(evidence);
        continue;
      }

      candidates.set(entityId, {
        key: entityId,
        entityId,
        type,
        title: symbol.name,
        path: candidatePath,
        evidence: [evidence]
      });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((candidate) => ({
      entityId: candidate.entityId,
      type: candidate.type,
      title: candidate.title,
      path: candidate.path,
      evidence: candidate.evidence.sort(compareEvidence),
      content: renderMarkdown({
        ...candidate,
        evidence: candidate.evidence.sort(compareEvidence)
      })
    }));
}

export function slugifySourceSymbol(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function isEligibleSymbol(sourceFile: SourceFileFact, symbol: SourceSymbolFact): boolean {
  if (!symbol.isExported) return false;
  if (!symbol.name || symbol.name === "default") return false;
  if (!domainSymbolKinds.has(symbol.symbolKind) && !isInterfaceLikeName(symbol.name)) return false;
  return sourceFile.exports.some((sourceExport) => sourceExport.exportedName === symbol.name);
}

function classifySymbol(name: string): "domain_entity" | "interface" | null {
  if (isInterfaceLikeName(name)) return "interface";
  return "domain_entity";
}

function isInterfaceLikeName(name: string): boolean {
  return interfaceSuffixes.some((suffix) => name.endsWith(suffix));
}

function renderMarkdown(candidate: Candidate): string {
  const frontmatter = stringify(
    {
      id: candidate.entityId,
      type: candidate.type,
      title: candidate.title,
      status: "draft",
      links: {},
      source_bootstrap: {
        source_files: [...new Set(candidate.evidence.map((item) => item.sourceFile))],
        symbols: candidate.evidence.map((item) => ({
          name: item.symbolName,
          kind: item.symbolKind,
          exported: item.exported,
          file: item.sourceFile,
          line: item.line
        }))
      }
    },
    { lineWidth: 0 }
  ).trimEnd();
  const sectionHeading = candidate.type === "interface" ? "Responsibility" : "Definition";
  const evidenceLines = candidate.evidence
    .map((item) => `- \`${item.sourceFile}\` exports \`${item.symbolName}\` as ${article(item.symbolKind)} ${humanizeKind(item.symbolKind)}.`)
    .join("\n");

  return `---
${frontmatter}
---

# ${candidate.title}

## ${sectionHeading}

Initial spec generated from exported source symbol \`${candidate.title}\`.

## Source Evidence

${evidenceLines}

## Notes

- Review and expand this spec before using it as implementation guidance.
`;
}

function compareEvidence(a: BootstrapSourceEvidence, b: BootstrapSourceEvidence): number {
  return a.sourceFile.localeCompare(b.sourceFile) || a.symbolName.localeCompare(b.symbolName);
}

function humanizeKind(value: string): string {
  return value.replace(/_/g, " ");
}

function article(value: string): "a" | "an" {
  return /^[aeiou]/i.test(humanizeKind(value)) ? "an" : "a";
}
```

- [ ] **Step 4: Run the generator tests to verify they pass**

Run:

```sh
pnpm --filter @specops/source-bootstrap test -- generate --run
```

Expected: PASS, with 4 tests passing.

- [ ] **Step 5: Typecheck the new package**

Run:

```sh
pnpm --filter @specops/source-bootstrap typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit generator package**

```sh
git add tsconfig.base.json packages/source-bootstrap
git commit -m "feat: add source bootstrap generator"
```

---

### Task 2: API Source Bootstrap Service

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json`
- Create: `apps/api/src/services/source-bootstrap-service.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add API dependency on the generator package**

Modify `apps/api/package.json` dependencies:

```json
"@specops/source-bootstrap": "workspace:*"
```

Modify `apps/api/tsconfig.json` references:

```json
{ "path": "../../packages/source-bootstrap" }
```

- [ ] **Step 2: Write failing API route tests for successful bootstrap and refusal cases**

Add these tests inside `describeWithDb("database-backed routes", () => { ... })` before the source-scan tests:

```ts
  it("bootstraps source-only projects into canonical markdown specs and indexes them", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      projectId: project.id,
      status: "succeeded",
      entityCount: 5
    });

    await expect(readFile(path.join(project.specopsPath, "domain", "decision.md"), "utf8")).resolves.toContain(
      "id: domain.decision"
    );
    await expect(readFile(path.join(project.specopsPath, "domain", "workspace.md"), "utf8")).resolves.toContain(
      "id: domain.workspace"
    );
    await expect(readFile(path.join(project.specopsPath, "interfaces", "decision-service.md"), "utf8")).resolves.toContain(
      "id: interface.decision-service"
    );
    await expect(readFile(path.join(project.specopsPath, "project.yaml"), "utf8")).resolves.toContain(
      "source_bootstrap:"
    );

    const entitiesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities`
    });
    const entities = entitiesResponse.json() as Array<{ entityId: string }>;
    expect(entities.map((entity) => entity.entityId)).toEqual(
      expect.arrayContaining([
        "domain.decision",
        "domain.workspace",
        "interface.decision-service"
      ])
    );
  });

  it("refuses source bootstrap when non-template specs already exist", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "existing.md"),
      "---\nid: domain.existing\ntype: domain_entity\ntitle: Existing\nstatus: draft\n---\n\n# Existing\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Source bootstrap requires an empty specops folder");
  });

  it("refuses source bootstrap when it has already completed", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    await mkdir(project.specopsPath, { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "project.yaml"),
      "id: sample\nsource_bootstrap:\n  completed_at: \"2026-05-10T00:00:00.000Z\"\n  scanner: typescript\n  generated_entity_count: 1\n"
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe("Source bootstrap has already completed");
  });

  it("refuses source bootstrap when no supported source files are found", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("No supported source files found");
  });

  it("refuses source bootstrap when no eligible exported symbols are found", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(path.join(project.repoPath, "src", "helpers.ts"), "function internalOnly() { return 1; }\n");

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/bootstrap-from-source`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("No eligible exported source symbols found");
  });
```

Add this helper near the bottom of `routes.test.ts`, inside the DB-backed describe block so it can use test temp roots:

```ts
  async function writeSampleSourceProject(repoPath: string) {
    await mkdir(path.join(repoPath, "src", "services"), { recursive: true });
    await writeFile(
      path.join(repoPath, "src", "domain.ts"),
      "export interface Workspace { id: string; name: string; }\n" +
        "export interface Decision { id: string; title: string; }\n" +
        "export type DecisionLink = { fromId: string; toId: string };\n"
    );
    await writeFile(
      path.join(repoPath, "src", "services", "decision-service.ts"),
      "import type { Decision, Workspace } from '../domain';\n" +
        "export class DecisionService {\n" +
        "  list(_workspace: Workspace): Decision[] { return []; }\n" +
        "}\n"
    );
    await writeFile(
      path.join(repoPath, "src", "services", "reminder-scheduler.ts"),
      "export class ReminderScheduler { schedule() { return null; } }\n"
    );
  }
```

- [ ] **Step 3: Run API tests to verify they fail**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: FAIL with 404 for `POST /api/projects/:projectId/bootstrap-from-source`.

- [ ] **Step 4: Implement the bootstrap service**

Create `apps/api/src/services/source-bootstrap-service.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IndexRunDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { discoverMarkdownFiles, parseSpecMarkdown } from "@specops/markdown";
import { scanRepository } from "@specops/repo-scanner";
import { generateBootstrapSpecFiles } from "@specops/source-bootstrap";
import { parse, stringify } from "yaml";

import { BadRequestError, ConflictError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";

type ProjectYaml = Record<string, unknown>;

export function createSourceBootstrapService(db: Db) {
  return {
    async bootstrapProject(projectId: string): Promise<IndexRunDto> {
      const project = await createProjectService(db).getProject(projectId);
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
      const writtenPaths: string[] = [];

      assertInsideDirectory(repoPath, specopsPath);
      await assertRealPathInsideDirectory(repoPath, repoPath);
      await assertExistingParentInsideDirectory(repoPath, specopsPath);
      await mkdir(specopsPath, { recursive: true });
      const realSpecopsPath = await assertRealPathInsideDirectory(repoPath, specopsPath);

      const projectYamlPath = path.join(realSpecopsPath, "project.yaml");
      const projectYaml = await readProjectYaml(projectYamlPath);
      if (hasCompletedSourceBootstrap(projectYaml)) {
        throw new ConflictError("Source bootstrap has already completed");
      }

      await assertNoExistingEntitySpecs(realSpecopsPath);

      const scan = await scanRepository({ repoPath });
      if (scan.files.length === 0) {
        throw new BadRequestError("No supported source files found");
      }

      const generatedFiles = generateBootstrapSpecFiles(scan);
      if (generatedFiles.length === 0) {
        throw new BadRequestError("No eligible exported source symbols found");
      }

      try {
        for (const file of generatedFiles) {
          const targetPath = assertInsideDirectory(realSpecopsPath, path.join(realSpecopsPath, file.path));
          await mkdir(path.dirname(targetPath), { recursive: true });
          await writeFile(targetPath, file.content, { flag: "wx" });
          writtenPaths.push(targetPath);
        }
      } catch (error) {
        await Promise.all(writtenPaths.map((writtenPath) => rm(writtenPath, { force: true })));
        if (isFileExistsError(error)) {
          throw new ConflictError("Generated bootstrap file already exists");
        }
        throw error;
      }

      const result = await createIndexerService(db).indexProject(projectId);
      await writeProjectYaml(projectYamlPath, {
        ...projectYaml,
        source_bootstrap: {
          completed_at: new Date().toISOString(),
          scanner: "typescript",
          generated_entity_count: generatedFiles.length
        }
      });

      return result;
    }
  };
}

async function assertNoExistingEntitySpecs(specopsPath: string) {
  const markdownPaths = await discoverMarkdownFiles(specopsPath);
  for (const relativePath of markdownPaths) {
    const content = await readFile(path.join(specopsPath, relativePath), "utf8");
    const parsed = parseSpecMarkdown(relativePath, content);
    if (parsed.entity) {
      throw new ConflictError("Source bootstrap requires an empty specops folder", {
        filePath: relativePath,
        entityId: parsed.entity.entityId
      });
    }
  }
}

async function readProjectYaml(projectYamlPath: string): Promise<ProjectYaml> {
  try {
    const raw = await readFile(projectYamlPath, "utf8");
    const parsed = parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }
}

async function writeProjectYaml(projectYamlPath: string, value: ProjectYaml) {
  await writeFile(projectYamlPath, `${stringify(value, { lineWidth: 0 }).trimEnd()}\n`, { flag: "w" });
}

function hasCompletedSourceBootstrap(projectYaml: ProjectYaml): boolean {
  const marker = projectYaml.source_bootstrap;
  return isRecord(marker) && typeof marker.completed_at === "string" && marker.completed_at.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isFileExistsError(error: unknown): boolean {
  return isRecord(error) && error.code === "EEXIST";
}
```

- [ ] **Step 5: Run API tests again to confirm route is still missing**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: still FAIL with 404 for the new endpoint. The service now exists but is not registered.

---

### Task 3: API Route Wiring

**Files:**
- Modify: `apps/api/src/routes/projects.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Register the route**

Modify `apps/api/src/routes/projects.ts` imports:

```ts
import { createSourceBootstrapService } from "../services/source-bootstrap-service.js";
```

Create the service inside `registerProjectRoutes`:

```ts
const sourceBootstrapService = createSourceBootstrapService(db);
```

Add the route after `init-specops` and before `index`:

```ts
  app.post("/projects/:projectId/bootstrap-from-source", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return sourceBootstrapService.bootstrapProject(projectId);
  });
```

- [ ] **Step 2: Run API route tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: PASS for the new bootstrap tests and existing route tests.

- [ ] **Step 3: Run API typecheck**

Run:

```sh
pnpm --filter api typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit API bootstrap workflow**

```sh
git add apps/api/package.json apps/api/tsconfig.json apps/api/src/services/source-bootstrap-service.ts apps/api/src/routes/projects.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add source bootstrap API"
```

---

### Task 4: Web API Helper And Project Actions Component

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/project-actions.tsx`
- Create: `apps/web/src/components/project-actions.test.tsx`

- [ ] **Step 1: Add web query helper**

Modify `apps/web/src/api/queries.ts` by adding:

```ts
export function bootstrapFromSource(projectId: string) {
  return apiSend<IndexRunDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/bootstrap-from-source`
  );
}
```

- [ ] **Step 2: Create presentational actions component**

Create `apps/web/src/components/project-actions.tsx`:

```tsx
import { FolderSearch, FolderSync, Play, RotateCw } from "lucide-react";

type ProjectActionsProps = {
  isInitializing: boolean;
  isBootstrapping: boolean;
  isIndexing: boolean;
  onInitialize: () => void;
  onBootstrap: () => void;
  onReindex: () => void;
};

export function ProjectActions({
  isInitializing,
  isBootstrapping,
  isIndexing,
  onInitialize,
  onBootstrap,
  onReindex
}: ProjectActionsProps) {
  return (
    <>
      <button
        type="button"
        className="button-secondary"
        disabled={isInitializing}
        onClick={onInitialize}
      >
        <FolderSync className="h-4 w-4" aria-hidden="true" />
        Init specops
      </button>
      <button
        type="button"
        className="button-secondary"
        disabled={isBootstrapping}
        onClick={onBootstrap}
      >
        {isBootstrapping ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <FolderSearch className="h-4 w-4" aria-hidden="true" />
        )}
        Bootstrap from source
      </button>
      <button
        type="button"
        className="button-primary"
        disabled={isIndexing}
        onClick={onReindex}
      >
        {isIndexing ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
        Re-index
      </button>
    </>
  );
}
```

- [ ] **Step 3: Add component tests**

Create `apps/web/src/components/project-actions.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectActions } from "./project-actions.js";

describe("ProjectActions", () => {
  it("renders init, bootstrap, and re-index actions", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        isInitializing={false}
        isBootstrapping={false}
        isIndexing={false}
        onInitialize={() => undefined}
        onBootstrap={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Init specops");
    expect(html).toContain("Bootstrap from source");
    expect(html).toContain("Re-index");
  });

  it("disables bootstrap while it is pending", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        isInitializing={false}
        isBootstrapping={true}
        isIndexing={false}
        onInitialize={() => undefined}
        onBootstrap={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Bootstrap from source");
    expect(html).toContain("disabled=\"\"");
  });
});
```

- [ ] **Step 4: Run web component test**

Run:

```sh
pnpm --filter web test -- src/components/project-actions.test.tsx
```

Expected: PASS.

---

### Task 5: Wire Bootstrap Button Into Project Detail

**Files:**
- Modify: `apps/web/src/routes/project-detail.tsx`
- Test: `apps/web/src/components/project-actions.test.tsx`

- [ ] **Step 1: Replace inline project action buttons with `ProjectActions`**

Modify imports in `apps/web/src/routes/project-detail.tsx`.

Remove:

```ts
import { FolderSync, Play, RotateCw } from "lucide-react";
```

Add `bootstrapFromSource` to the query imports:

```ts
  bootstrapFromSource,
```

Add the component import:

```ts
import { ProjectActions } from "../components/project-actions.js";
```

Add the mutation after `initializeMutation`:

```ts
  const bootstrapMutation = useMutation({
    mutationFn: () => bootstrapFromSource(projectId),
    onSuccess: invalidateProject
  });
```

Replace the `actions={...}` fragment with:

```tsx
      actions={
        <ProjectActions
          isInitializing={initializeMutation.isPending}
          isBootstrapping={bootstrapMutation.isPending}
          isIndexing={indexMutation.isPending}
          onInitialize={() => initializeMutation.mutate()}
          onBootstrap={() => bootstrapMutation.mutate()}
          onReindex={() => indexMutation.mutate()}
        />
      }
```

Update the mutation error rendering near the bottom of the component to include bootstrap errors:

```tsx
      {initializeMutation.error || bootstrapMutation.error || indexMutation.error ? (
        <p className="mt-3 text-sm text-red-700">
          {initializeMutation.error?.message ??
            bootstrapMutation.error?.message ??
            indexMutation.error?.message}
        </p>
      ) : null}
```

- [ ] **Step 2: Run focused web tests**

Run:

```sh
pnpm --filter web test -- src/components/project-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run web typecheck**

Run:

```sh
pnpm --filter web typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit web bootstrap action**

```sh
git add apps/web/src/api/queries.ts apps/web/src/components/project-actions.tsx apps/web/src/components/project-actions.test.tsx apps/web/src/routes/project-detail.tsx
git commit -m "feat: add source bootstrap action"
```

---

### Task 6: End-To-End Local Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run all focused tests**

Run:

```sh
pnpm --filter @specops/source-bootstrap test -- generate --run
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
pnpm --filter web test -- src/components/project-actions.test.tsx
```

Expected: all commands exit 0.

- [ ] **Step 2: Run full validation**

Run:

```sh
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands exit 0.

- [ ] **Step 3: Manually verify source-only sample bootstrap through API**

Run this from the repository root:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api exec tsx -e '
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { projects } from "@specops/db";
import { createProjectService } from "./src/services/project-service.ts";
import { createSourceBootstrapService } from "./src/services/source-bootstrap-service.ts";

const { Pool } = pg;

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "specops-bootstrap-manual-"));
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(pool) as any;
  const project = await createProjectService(db).createProject({
    name: "Bootstrap Manual",
    slug: `bootstrap-manual-${Date.now()}`,
    repoPath: root,
    specopsPath: path.join(root, "specops")
  });

  try {
    await mkdir(path.join(root, "src", "services"), { recursive: true });
    await writeFile(path.join(root, "src", "domain.ts"), "export interface Decision { id: string; }\\nexport interface Workspace { id: string; }\\n");
    await writeFile(path.join(root, "src", "services", "decision-service.ts"), "export class DecisionService {}\\n");
    const result = await createSourceBootstrapService(db).bootstrapProject(project.id);
    console.log(JSON.stringify({ status: result.status, entityCount: result.entityCount }, null, 2));
    console.log(await readFile(path.join(root, "specops", "domain", "decision.md"), "utf8"));
  } finally {
    await db.delete(projects).where(eq(projects.id, project.id));
    await pool.end();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
'
```

Expected output includes:

```json
{
  "status": "succeeded",
  "entityCount": 3
}
```

and the markdown contains `id: domain.decision`.

- [ ] **Step 4: Inspect git status**

Run:

```sh
git status --short
```

Expected: only intentional changes remain. If `packages/markdown/src/__tests__/sample-project.test.ts` is still modified from the earlier sample-fixture fix, leave it uncommitted unless the user asks to include it.
