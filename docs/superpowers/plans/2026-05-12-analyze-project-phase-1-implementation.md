# Analyze Project Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 `Analyze project` workflow: a persisted run that initializes, indexes, generates source and AI proposals, then hands off to one review screen.

**Architecture:** Add a narrow analyze-run model and service instead of a generic job engine. The API starts an in-process async run and persists all progress in PostgreSQL; the web app polls the run and reuses existing proposal endpoints for review and acceptance. AI source selection is deterministic and based on indexed source facts.

**Tech Stack:** TypeScript, Fastify, Drizzle/PostgreSQL, Zod contracts, React, TanStack Router, TanStack Query, Vitest, Tailwind CSS.

---

## File Map

- Create `packages/contracts/src/analyze-runs.ts`: Zod schemas and DTO types for analyze runs, steps, selection summaries, and active-run conflicts.
- Modify `packages/contracts/src/index.ts`: export analyze-run contracts.
- Modify `packages/contracts/src/*.test.ts`: add contract tests in `packages/contracts/src/analyze-runs.test.ts`.
- Modify `packages/db/src/schema.ts`: add `analyzeRuns`.
- Modify `packages/db/src/schema.typecheck.ts`: include the new table in type smoke tests.
- Modify `packages/db/migrations/0000_initial.sql`: add idempotent `analyze_runs` table and indexes.
- Modify `packages/db/src/migrations.test.ts`: assert migration creates analyze-run storage.
- Create `apps/api/src/services/analyze-source-selection.ts`: deterministic source selector.
- Create `apps/api/src/services/analyze-run-service.ts`: persistence and orchestration.
- Create `apps/api/src/routes/analyze-runs.ts`: start/fetch endpoints.
- Modify `apps/api/src/server.ts`: register analyze-run routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: API integration coverage.
- Create `apps/api/src/__tests__/analyze-source-selection.test.ts`: selector unit coverage.
- Modify `apps/web/src/api/queries.ts`: query keys and API helpers.
- Modify `apps/web/src/api/queries.test.ts`: query helper tests.
- Modify `apps/web/src/components/project-actions.tsx`: primary `Analyze project` CTA.
- Modify `apps/web/src/components/project-actions.test.tsx`: CTA rendering tests.
- Create `apps/web/src/routes/analyze-run-detail.tsx`: progress screen.
- Create `apps/web/src/routes/analyze-run-review.tsx`: unified review screen.
- Create `apps/web/src/routes/analyze-runs.test.tsx`: route/component tests.
- Modify `apps/web/src/app.tsx`: register progress and review routes.

## Task 1: Contracts And Database Storage

**Files:**
- Create: `packages/contracts/src/analyze-runs.ts`
- Create: `packages/contracts/src/analyze-runs.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.typecheck.ts`
- Modify: `packages/db/migrations/0000_initial.sql`
- Modify: `packages/db/src/migrations.test.ts`

- [ ] **Step 1: Write contract tests**

Create `packages/contracts/src/analyze-runs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  activeAnalyzeRunConflictSchema,
  analyzeRunDetailSchema,
  analyzeRunSelectionSummarySchema
} from "./analyze-runs.js";

describe("analyze run contracts", () => {
  it("parses analyze run details", () => {
    const parsed = analyzeRunDetailSchema.parse({
      id: "run-1",
      projectId: "project-1",
      status: "running",
      currentStep: "ai_prefill",
      steps: [
        {
          name: "index",
          status: "succeeded",
          startedAt: "2026-05-12T10:00:00.000Z",
          finishedAt: "2026-05-12T10:00:02.000Z",
          message: null,
          counts: { sourceFileCount: 4 }
        }
      ],
      selection: {
        selectedSourceFileIds: ["source-1"],
        selectedPaths: ["apps/api/src/routes/projects.ts"],
        eligibleHighSignalFileCount: 3,
        skippedHighSignalFileCount: 2,
        categories: [{ category: "entrypoints_routes", count: 1 }],
        diagnostics: [{ level: "info", message: "Partial AI coverage." }]
      },
      sourceProposalCount: 2,
      aiProposalCount: 1,
      indexRunId: "index-run-1",
      errorMessage: null,
      createdAt: "2026-05-12T09:59:59.000Z",
      startedAt: "2026-05-12T10:00:00.000Z",
      finishedAt: null
    });

    expect(parsed.status).toBe("running");
    expect(parsed.steps[0]?.counts.sourceFileCount).toBe(4);
    expect(parsed.selection?.skippedHighSignalFileCount).toBe(2);
  });

  it("allows empty selection diagnostics", () => {
    const parsed = analyzeRunSelectionSummarySchema.parse({
      selectedSourceFileIds: [],
      selectedPaths: [],
      eligibleHighSignalFileCount: 0,
      skippedHighSignalFileCount: 0,
      categories: [],
      diagnostics: [{ level: "warning", message: "No indexed source files were available." }]
    });

    expect(parsed.selectedPaths).toEqual([]);
    expect(parsed.diagnostics[0]?.level).toBe("warning");
  });

  it("parses active run conflict payloads", () => {
    expect(
      activeAnalyzeRunConflictSchema.parse({
        activeRunId: "run-1"
      })
    ).toEqual({ activeRunId: "run-1" });
  });
});
```

- [ ] **Step 2: Run contract test and verify it fails**

Run:

```sh
pnpm --filter @specops/contracts test -- analyze-runs.test.ts
```

Expected: FAIL because `./analyze-runs.js` does not exist.

- [ ] **Step 3: Add analyze-run contracts**

Create `packages/contracts/src/analyze-runs.ts`:

```ts
import { z } from "zod";

export const analyzeRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const analyzeRunStepNameSchema = z.enum([
  "initialize",
  "index",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill"
]);

export const analyzeRunStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "skipped",
  "failed"
]);

export const analyzeRunDiagnosticSchema = z.object({
  level: z.enum(["info", "warning"]),
  message: z.string().min(1)
});

export const analyzeRunSelectionCategorySchema = z.object({
  category: z.enum([
    "entrypoints_routes",
    "services_modules",
    "domain_models",
    "frontend_views",
    "tests_config"
  ]),
  count: z.number().int().min(0)
});

export const analyzeRunSelectionSummarySchema = z.object({
  selectedSourceFileIds: z.array(z.string().min(1)),
  selectedPaths: z.array(z.string().min(1)),
  eligibleHighSignalFileCount: z.number().int().min(0),
  skippedHighSignalFileCount: z.number().int().min(0),
  categories: z.array(analyzeRunSelectionCategorySchema),
  diagnostics: z.array(analyzeRunDiagnosticSchema)
});

export const analyzeRunStepSchema = z.object({
  name: analyzeRunStepNameSchema,
  status: analyzeRunStepStatusSchema,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  message: z.string().nullable(),
  counts: z.record(z.string(), z.number())
});

export const analyzeRunDetailSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: analyzeRunStatusSchema,
  currentStep: analyzeRunStepNameSchema.nullable(),
  steps: z.array(analyzeRunStepSchema),
  selection: analyzeRunSelectionSummarySchema.nullable(),
  sourceProposalCount: z.number().int().min(0),
  aiProposalCount: z.number().int().min(0),
  indexRunId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable()
});

export const activeAnalyzeRunConflictSchema = z.object({
  activeRunId: z.string().min(1)
});

export type AnalyzeRunStatus = z.infer<typeof analyzeRunStatusSchema>;
export type AnalyzeRunStepName = z.infer<typeof analyzeRunStepNameSchema>;
export type AnalyzeRunStepStatus = z.infer<typeof analyzeRunStepStatusSchema>;
export type AnalyzeRunDiagnostic = z.infer<typeof analyzeRunDiagnosticSchema>;
export type AnalyzeRunSelectionSummary = z.infer<typeof analyzeRunSelectionSummarySchema>;
export type AnalyzeRunStepDto = z.infer<typeof analyzeRunStepSchema>;
export type AnalyzeRunDetailDto = z.infer<typeof analyzeRunDetailSchema>;
export type ActiveAnalyzeRunConflictDto = z.infer<typeof activeAnalyzeRunConflictSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./analyze-runs.js";
```

Keep the existing exports; add this line near the other feature exports.

- [ ] **Step 4: Run contract tests**

Run:

```sh
pnpm --filter @specops/contracts test -- analyze-runs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write database migration/schema tests**

Add this test to `packages/db/src/migrations.test.ts`:

```ts
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
```

- [ ] **Step 6: Run database test and verify it fails**

Run:

```sh
pnpm --filter @specops/db test -- migrations.test.ts
```

Expected: FAIL because `analyze_runs` is not in the migration.

- [ ] **Step 7: Add Drizzle table and SQL migration**

In `packages/db/src/schema.ts`, add this table after `aiProposals`:

```ts
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
    sourceProposalCount: integer("source_proposal_count").notNull().default(0),
    aiProposalCount: integer("ai_proposal_count").notNull().default(0),
    indexRunId: uuid("index_run_id").references(() => indexRuns.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (table) => ({
    projectIdx: index("analyze_runs_project_id_idx").on(table.projectId),
    projectStatusIdx: index("analyze_runs_project_status_idx").on(table.projectId, table.status),
    projectCreatedAtIdx: index("analyze_runs_project_created_at_idx").on(table.projectId, table.createdAt)
  })
);
```

In `packages/db/src/schema.typecheck.ts`, include `analyzeRuns` in the imported table list and add:

```ts
type AnalyzeRun = InferSelectModel<typeof analyzeRuns>;
const analyzeRun = null as unknown as AnalyzeRun;
analyzeRun.status satisfies string;
```

In `packages/db/migrations/0000_initial.sql`, append:

```sql
CREATE TABLE IF NOT EXISTS analyze_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  current_step text,
  steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  selection_json jsonb,
  source_proposal_count integer NOT NULL DEFAULT 0,
  ai_proposal_count integer NOT NULL DEFAULT 0,
  index_run_id uuid REFERENCES index_runs(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS analyze_runs_project_id_idx ON analyze_runs(project_id);
CREATE INDEX IF NOT EXISTS analyze_runs_project_status_idx ON analyze_runs(project_id, status);
CREATE INDEX IF NOT EXISTS analyze_runs_project_created_at_idx ON analyze_runs(project_id, created_at);
```

- [ ] **Step 8: Run database tests and typecheck**

Run:

```sh
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter @specops/db typecheck
```

Expected: both PASS.

- [ ] **Step 9: Commit contracts and storage**

Run:

```sh
git add packages/contracts/src/analyze-runs.ts packages/contracts/src/analyze-runs.test.ts packages/contracts/src/index.ts packages/db/src/schema.ts packages/db/src/schema.typecheck.ts packages/db/migrations/0000_initial.sql packages/db/src/migrations.test.ts
git commit -m "feat: add analyze run contracts and storage"
```

## Task 2: Deterministic AI Source Selector

**Files:**
- Create: `apps/api/src/services/analyze-source-selection.ts`
- Create: `apps/api/src/__tests__/analyze-source-selection.test.ts`

- [ ] **Step 1: Write selector tests**

Create `apps/api/src/__tests__/analyze-source-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { selectAnalyzeSourceFiles, type AnalyzeSourceCandidate } from "../services/analyze-source-selection.js";

describe("selectAnalyzeSourceFiles", () => {
  it("selects a balanced high-signal subset within file and byte limits", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("route", "apps/api/src/routes/projects.ts", 10_000, 1, 3, 8),
        file("service", "apps/api/src/services/project-service.ts", 11_000, 2, 6, 10),
        file("domain", "packages/domain/src/types.ts", 3_000, 0, 5, 5),
        file("test", "apps/api/src/__tests__/routes.test.ts", 30_000, 0, 0, 0),
        file("config", "apps/api/src/config.ts", 4_000, 0, 1, 2)
      ],
      maxFiles: 3,
      maxTotalBytes: 30_000
    });

    expect(result.selectedPaths).toEqual([
      "apps/api/src/routes/projects.ts",
      "apps/api/src/services/project-service.ts",
      "packages/domain/src/types.ts"
    ]);
    expect(result.selectedSourceFileIds).toEqual(["route", "service", "domain"]);
    expect(result.skippedHighSignalFileCount).toBe(0);
    expect(result.categories).toEqual([
      { category: "entrypoints_routes", count: 1 },
      { category: "services_modules", count: 1 },
      { category: "domain_models", count: 1 }
    ]);
  });

  it("reports partial coverage when useful files exceed limits", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("route-a", "apps/api/src/routes/a.ts", 10_000, 1, 2, 3),
        file("route-b", "apps/api/src/routes/b.ts", 10_000, 1, 2, 3),
        file("service-a", "apps/api/src/services/a-service.ts", 10_000, 1, 4, 4),
        file("domain-a", "packages/domain/src/a.ts", 10_000, 0, 3, 3)
      ],
      maxFiles: 2,
      maxTotalBytes: 20_000
    });

    expect(result.selectedPaths).toHaveLength(2);
    expect(result.eligibleHighSignalFileCount).toBe(4);
    expect(result.skippedHighSignalFileCount).toBe(2);
    expect(result.diagnostics).toContainEqual({
      level: "info",
      message: "AI source selection is partial: selected 2 of 4 high-signal files."
    });
  });

  it("returns a warning when no useful files fit", () => {
    const result = selectAnalyzeSourceFiles({
      files: [file("huge", "apps/api/src/routes/huge.ts", 70_000, 1, 2, 3)],
      maxFiles: 5,
      maxTotalBytes: 60_000
    });

    expect(result.selectedSourceFileIds).toEqual([]);
    expect(result.diagnostics).toEqual([
      { level: "warning", message: "No indexed source files fit within AI Prefill limits." }
    ]);
  });
});

function file(
  id: string,
  path: string,
  sizeBytes: number,
  importCount: number,
  exportCount: number,
  symbolCount: number
): AnalyzeSourceCandidate {
  return {
    id,
    path,
    kind: path.includes(".test.") ? "test" : path.includes("config") ? "config" : "source",
    sizeBytes,
    importCount,
    exportCount,
    symbolCount
  };
}
```

- [ ] **Step 2: Run selector tests and verify they fail**

Run:

```sh
pnpm --filter api test -- analyze-source-selection.test.ts
```

Expected: FAIL because the selector file does not exist.

- [ ] **Step 3: Implement selector**

Create `apps/api/src/services/analyze-source-selection.ts`:

```ts
import type { AnalyzeRunDiagnostic, AnalyzeRunSelectionSummary } from "@specops/contracts";

type SelectionCategory = AnalyzeRunSelectionSummary["categories"][number]["category"];

export type AnalyzeSourceCandidate = {
  id: string;
  path: string;
  kind: string;
  sizeBytes: number;
  importCount: number;
  exportCount: number;
  symbolCount: number;
};

type SelectAnalyzeSourceFilesInput = {
  files: AnalyzeSourceCandidate[];
  maxFiles: number;
  maxTotalBytes: number;
};

type ScoredCandidate = AnalyzeSourceCandidate & {
  category: SelectionCategory;
  score: number;
};

const categoryOrder: SelectionCategory[] = [
  "entrypoints_routes",
  "services_modules",
  "domain_models",
  "frontend_views",
  "tests_config"
];

export function selectAnalyzeSourceFiles(
  input: SelectAnalyzeSourceFilesInput
): AnalyzeRunSelectionSummary {
  const scored = input.files
    .map(scoreCandidate)
    .filter((candidate) => candidate.score > 0)
    .sort(compareCandidates);
  const selected: ScoredCandidate[] = [];
  let selectedBytes = 0;

  for (const category of categoryOrder.slice(0, 3)) {
    const candidate = scored.find(
      (item) =>
        item.category === category &&
        !selected.some((selectedItem) => selectedItem.id === item.id) &&
        canSelect(item, selected.length, selectedBytes, input)
    );
    if (candidate) {
      selected.push(candidate);
      selectedBytes += candidate.sizeBytes;
    }
  }

  for (const candidate of scored) {
    if (selected.some((item) => item.id === candidate.id)) continue;
    if (!canSelect(candidate, selected.length, selectedBytes, input)) continue;
    selected.push(candidate);
    selectedBytes += candidate.sizeBytes;
  }

  selected.sort((left, right) => left.path.localeCompare(right.path));

  const diagnostics: AnalyzeRunDiagnostic[] = [];
  const skippedHighSignalFileCount = Math.max(0, scored.length - selected.length);
  if (selected.length === 0) {
    diagnostics.push({
      level: "warning",
      message: "No indexed source files fit within AI Prefill limits."
    });
  } else if (skippedHighSignalFileCount > 0) {
    diagnostics.push({
      level: "info",
      message: `AI source selection is partial: selected ${selected.length} of ${scored.length} high-signal files.`
    });
  }

  return {
    selectedSourceFileIds: selected.map((file) => file.id),
    selectedPaths: selected.map((file) => file.path),
    eligibleHighSignalFileCount: scored.length,
    skippedHighSignalFileCount,
    categories: categoryOrder
      .map((category) => ({
        category,
        count: selected.filter((file) => file.category === category).length
      }))
      .filter((item) => item.count > 0),
    diagnostics
  };
}

function scoreCandidate(candidate: AnalyzeSourceCandidate): ScoredCandidate {
  const path = candidate.path.toLowerCase();
  const category = categorizePath(path, candidate.kind);
  const categoryScore = {
    entrypoints_routes: 100,
    services_modules: 80,
    domain_models: 70,
    frontend_views: 55,
    tests_config: 10
  }[category];
  const score =
    categoryScore + candidate.exportCount * 4 + candidate.symbolCount * 2 + candidate.importCount;

  return { ...candidate, category, score };
}

function categorizePath(path: string, kind: string): SelectionCategory {
  if (
    path.includes("/routes/") ||
    path.includes("/controllers/") ||
    path.includes("/api/") ||
    path.endsWith("/index.ts") ||
    path.endsWith("/index.tsx") ||
    kind === "entrypoint"
  ) {
    return "entrypoints_routes";
  }
  if (
    path.includes("/services/") ||
    path.includes("/modules/") ||
    path.includes("-service.") ||
    path.includes(".service.")
  ) {
    return "services_modules";
  }
  if (
    path.includes("/domain/") ||
    path.includes("/models/") ||
    path.includes("/schema") ||
    path.includes("/types.")
  ) {
    return "domain_models";
  }
  if (
    path.includes("/routes/") ||
    path.includes("/pages/") ||
    path.includes("/components/") ||
    path.endsWith(".tsx")
  ) {
    return "frontend_views";
  }
  return "tests_config";
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate) {
  const byScore = right.score - left.score;
  return byScore === 0 ? left.path.localeCompare(right.path) : byScore;
}

function canSelect(
  candidate: AnalyzeSourceCandidate,
  selectedCount: number,
  selectedBytes: number,
  input: SelectAnalyzeSourceFilesInput
) {
  return selectedCount < input.maxFiles && selectedBytes + candidate.sizeBytes <= input.maxTotalBytes;
}
```

- [ ] **Step 4: Run selector tests**

Run:

```sh
pnpm --filter api test -- analyze-source-selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit selector**

Run:

```sh
git add apps/api/src/services/analyze-source-selection.ts apps/api/src/__tests__/analyze-source-selection.test.ts
git commit -m "feat: select analyze ai source files"
```

## Task 3: Analyze Run Service

**Files:**
- Create: `apps/api/src/services/analyze-run-service.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add service-oriented route test scaffolding**

In `apps/api/src/__tests__/routes.test.ts`, extend the db imports:

```ts
import { analyzeRuns } from "@specops/db";
```

Add this integration test inside `describeWithDb("database-backed routes", ...)` after the existing project setup tests:

```ts
  it("persists analyze run progress when analysis succeeds", async () => {
    app = buildServer(testDatabaseUrl!, {
      aiPrefillProviderFactory: () => ({
        name: "ollama",
        async generate() {
          return {
            provider: "ollama",
            model: "qwen2.5-coder:7b",
            text: JSON.stringify({
              proposals: [
                {
                  entityId: "uc.manage-projects",
                  type: "use_case",
                  title: "Manage projects",
                  summary: "Users can create and inspect projects.",
                  confidence: 0.82,
                  sourceFiles: ["src/routes/projects.ts"],
                  claims: [
                    {
                      text: "Project routes expose project management behavior.",
                      sourceFiles: ["src/routes/projects.ts"]
                    }
                  ],
                  proposedLinks: []
                }
              ]
            })
          };
        }
      })
    });
    const project = await createProjectViaApi({
      files: {
        "src/routes/projects.ts":
          "export function listProjects() { return []; }\\nexport function createProject() { return {}; }\\n",
        "src/services/project-service.ts": "export class ProjectService { list() { return []; } }\\n"
      }
    });

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs`
    });

    expect(startResponse.statusCode).toBe(201);
    const started = startResponse.json() as { id: string; status: string };
    await waitForAnalyzeRun(started.id, "succeeded");

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/analyze-runs/${started.id}`
    });
    const detail = getResponse.json() as { status: string; sourceProposalCount: number; aiProposalCount: number };

    expect(getResponse.statusCode).toBe(200);
    expect(detail.status).toBe("succeeded");
    expect(detail.sourceProposalCount).toBeGreaterThan(0);
    expect(detail.aiProposalCount).toBe(1);
  });
```

Add helper:

```ts
  async function waitForAnalyzeRun(runId: string, status: "succeeded" | "failed") {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const [run] = await pool.query("select status from analyze_runs where id = $1", [runId])
        .then((result) => result.rows as Array<{ status: string }>);
      if (run?.status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Analyze run ${runId} did not reach ${status}`);
  }
```

If `createProjectViaApi` does not accept a `files` helper input, add a new local helper instead of changing unrelated tests:

```ts
  async function createSourceProjectViaApi(files: Record<string, string>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-analyze-"));
    tempRoots.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Analyze Project",
        slug: `analyze-project-${Date.now()}`,
        repoPath: root,
        specopsPath: path.join(root, ".specops")
      }
    });
    const project = response.json() as { id: string; repoPath: string; specopsPath: string };
    projectIds.push(project.id);
    return project;
  }
```

Use `createSourceProjectViaApi` in the test if needed.

- [ ] **Step 2: Run route test and verify it fails**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "persists analyze run progress"
```

Expected: FAIL because the analyze route/service does not exist.

- [ ] **Step 3: Implement analyze-run service**

Create `apps/api/src/services/analyze-run-service.ts`:

```ts
import type {
  AnalyzeRunDetailDto,
  AnalyzeRunSelectionSummary,
  AnalyzeRunStepDto,
  AnalyzeRunStepName
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { analyzeRuns, sourceFiles, sourceExports, sourceImports, sourceSymbols } from "@specops/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { ApiConfig } from "../config.js";
import { ConflictError, NotFoundError } from "../lib/http-errors.js";
import type { AiPrefillProviderFactory } from "./ai-prefill-service.js";
import { createAiPrefillService } from "./ai-prefill-service.js";
import { selectAnalyzeSourceFiles, type AnalyzeSourceCandidate } from "./analyze-source-selection.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";
import { createProposalService } from "./proposal-service.js";
import { createSpecopsInitializerService } from "./specops-initializer.js";

type AnalyzeRunOptions = {
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

const stepNames: AnalyzeRunStepName[] = [
  "initialize",
  "index",
  "source_proposals",
  "select_ai_sources",
  "ai_prefill"
];

export function createAnalyzeRunService(db: Db, options: AnalyzeRunOptions) {
  async function startAnalyzeRun(projectId: string): Promise<AnalyzeRunDetailDto> {
    await createProjectService(db).getProject(projectId);
    const active = await findActiveRun(projectId);
    if (active) {
      throw new ConflictError("Analyze run is already active", { activeRunId: active.id });
    }

    const [row] = await db
      .insert(analyzeRuns)
      .values({
        projectId,
        status: "queued",
        stepsJson: initialSteps()
      })
      .returning();

    if (!row) throw new Error("Failed to create analyze run");

    void executeAnalyzeRun(row.id).catch(() => undefined);
    return mapAnalyzeRun(row);
  }

  async function getAnalyzeRun(projectId: string, runId: string): Promise<AnalyzeRunDetailDto> {
    const [row] = await db
      .select()
      .from(analyzeRuns)
      .where(and(eq(analyzeRuns.projectId, projectId), eq(analyzeRuns.id, runId)))
      .limit(1);

    if (!row) throw new NotFoundError("Analyze run not found", { projectId, runId });
    return mapAnalyzeRun(row);
  }

  async function executeAnalyzeRun(runId: string): Promise<void> {
    const [run] = await db.select().from(analyzeRuns).where(eq(analyzeRuns.id, runId)).limit(1);
    if (!run) return;

    await db
      .update(analyzeRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(analyzeRuns.id, runId));

    try {
      await runStep(runId, "initialize", async () => {
        await createSpecopsInitializerService(db).initializeProjectSpecops(run.projectId);
        return {};
      });

      const indexRun = await runStep(runId, "index", async () => {
        const result = await createIndexerService(db).indexProject(run.projectId);
        await db.update(analyzeRuns).set({ indexRunId: result.id }).where(eq(analyzeRuns.id, runId));
        return {
          entityCount: result.entityCount,
          sourceFileCount: result.sourceFileCount ?? 0,
          sourceSymbolCount: result.sourceSymbolCount ?? 0
        };
      });

      await runStep(runId, "source_proposals", async () => {
        try {
          const proposals = await createProposalService(db).generateSourceImportProposals(run.projectId);
          await db
            .update(analyzeRuns)
            .set({ sourceProposalCount: proposals.length })
            .where(eq(analyzeRuns.id, runId));
          return { proposalCount: proposals.length };
        } catch (error) {
          if (isNoEligibleSourceProposalError(error)) {
            return { proposalCount: 0 };
          }
          throw error;
        }
      });

      const selection = await runStep(runId, "select_ai_sources", async () => {
        const selectionResult = await selectSourcesForProject(run.projectId, options.aiPrefillConfig);
        await db
          .update(analyzeRuns)
          .set({ selectionJson: selectionResult })
          .where(eq(analyzeRuns.id, runId));
        return {
          selectedSourceFileCount: selectionResult.selectedSourceFileIds.length,
          eligibleHighSignalFileCount: selectionResult.eligibleHighSignalFileCount
        };
      });

      const detail = await getAnalyzeRun(run.projectId, runId);
      const selectedIds = detail.selection?.selectedSourceFileIds ?? [];
      if (selectedIds.length === 0) {
        await markStep(runId, "ai_prefill", "skipped", "No AI source files selected.", {});
      } else {
        await runStep(runId, "ai_prefill", async () => {
          const result = await createAiPrefillService(db, {
            config: options.aiPrefillConfig,
            providerFactory: options.aiPrefillProviderFactory
          }).generateAiPrefillProposals(run.projectId, {
            provider: "ollama",
            model: "qwen2.5-coder:7b",
            sourceFileIds: selectedIds,
            temperature: 0.1
          });
          await db
            .update(analyzeRuns)
            .set({ aiProposalCount: result.proposals.length })
            .where(eq(analyzeRuns.id, runId));
          return { proposalCount: result.proposals.length };
        });
      }

      await db
        .update(analyzeRuns)
        .set({ status: "succeeded", currentStep: null, finishedAt: new Date() })
        .where(eq(analyzeRuns.id, runId));
    } catch (error) {
      await db
        .update(analyzeRuns)
        .set({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Analyze run failed",
          finishedAt: new Date()
        })
        .where(eq(analyzeRuns.id, runId));
    }
  }

  async function findActiveRun(projectId: string) {
    const [row] = await db
      .select()
      .from(analyzeRuns)
      .where(and(eq(analyzeRuns.projectId, projectId), inArray(analyzeRuns.status, ["queued", "running"])))
      .orderBy(desc(analyzeRuns.createdAt), desc(analyzeRuns.id))
      .limit(1);
    return row ?? null;
  }

  async function runStep(
    runId: string,
    name: AnalyzeRunStepName,
    callback: () => Promise<Record<string, number>>
  ) {
    await markStep(runId, name, "running", null, {});
    try {
      const counts = await callback();
      await markStep(runId, name, "succeeded", null, counts);
      return counts;
    } catch (error) {
      await markStep(runId, name, "failed", error instanceof Error ? error.message : "Step failed", {});
      throw error;
    }
  }

  async function markStep(
    runId: string,
    name: AnalyzeRunStepName,
    status: AnalyzeRunStepDto["status"],
    message: string | null,
    counts: Record<string, number>
  ) {
    const detail = await getRunById(runId);
    const now = new Date().toISOString();
    const steps = readSteps(detail.stepsJson).map((step) =>
      step.name === name
        ? {
            ...step,
            status,
            message,
            counts,
            startedAt: step.startedAt ?? now,
            finishedAt: status === "running" ? null : now
          }
        : step
    );
    await db
      .update(analyzeRuns)
      .set({ currentStep: name, stepsJson: steps })
      .where(eq(analyzeRuns.id, runId));
  }

  async function getRunById(runId: string) {
    const [row] = await db.select().from(analyzeRuns).where(eq(analyzeRuns.id, runId)).limit(1);
    if (!row) throw new NotFoundError("Analyze run not found", { runId });
    return row;
  }

  async function selectSourcesForProject(
    projectId: string,
    config: ApiConfig["aiPrefill"]
  ): Promise<AnalyzeRunSelectionSummary> {
    const rows = await db
      .select({
        id: sourceFiles.id,
        path: sourceFiles.path,
        kind: sourceFiles.kind,
        sizeBytes: sourceFiles.sizeBytes,
        importCount: sql<number>`count(distinct ${sourceImports.id})::int`,
        exportCount: sql<number>`count(distinct ${sourceExports.id})::int`,
        symbolCount: sql<number>`count(distinct ${sourceSymbols.id})::int`
      })
      .from(sourceFiles)
      .leftJoin(sourceImports, eq(sourceImports.sourceFileId, sourceFiles.id))
      .leftJoin(sourceExports, eq(sourceExports.sourceFileId, sourceFiles.id))
      .leftJoin(sourceSymbols, eq(sourceSymbols.sourceFileId, sourceFiles.id))
      .where(eq(sourceFiles.projectId, projectId))
      .groupBy(sourceFiles.id)
      .orderBy(sourceFiles.path);

    return selectAnalyzeSourceFiles({
      files: rows as AnalyzeSourceCandidate[],
      maxFiles: config.maxFiles,
      maxTotalBytes: config.maxTotalBytes
    });
  }

  return { startAnalyzeRun, getAnalyzeRun };
}

function initialSteps(): AnalyzeRunStepDto[] {
  return stepNames.map((name) => ({
    name,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    message: null,
    counts: {}
  }));
}

function mapAnalyzeRun(row: typeof analyzeRuns.$inferSelect): AnalyzeRunDetailDto {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as AnalyzeRunDetailDto["status"],
    currentStep: row.currentStep as AnalyzeRunDetailDto["currentStep"],
    steps: readSteps(row.stepsJson),
    selection: readSelection(row.selectionJson),
    sourceProposalCount: row.sourceProposalCount,
    aiProposalCount: row.aiProposalCount,
    indexRunId: row.indexRunId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null
  };
}

function readSteps(value: unknown): AnalyzeRunStepDto[] {
  return Array.isArray(value) ? (value as AnalyzeRunStepDto[]) : initialSteps();
}

function readSelection(value: unknown): AnalyzeRunSelectionSummary | null {
  return value && typeof value === "object" ? (value as AnalyzeRunSelectionSummary) : null;
}

function isNoEligibleSourceProposalError(error: unknown) {
  return error instanceof Error && error.message.includes("No eligible exported source symbols found");
}
```

If TypeScript reports the `indexRun` or `selection` temporary variable is unused, remove that variable assignment while keeping the awaited call.

- [ ] **Step 4: Run focused typecheck**

Run:

```sh
pnpm --filter api typecheck
```

Expected: PASS after resolving exact Drizzle generic type details.

- [ ] **Step 5: Commit analyze service**

Run:

```sh
git add apps/api/src/services/analyze-run-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: orchestrate analyze runs"
```

## Task 4: Analyze Run API Routes

**Files:**
- Create: `apps/api/src/routes/analyze-runs.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add API route tests**

Add a test for active-run conflicts in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("rejects starting a second active analyze run", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createSourceProjectViaApi({
      "src/index.ts": "export function run() { return true; }\\n"
    });
    const db = createDb(testDatabaseUrl!);
    dbs.push(db);
    const [run] = await db
      .insert(analyzeRuns)
      .values({
        projectId: project.id,
        status: "running",
        currentStep: "index",
        stepsJson: []
      })
      .returning();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/analyze-runs`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.details).toEqual({ activeRunId: run!.id });
  });
```

- [ ] **Step 2: Run conflict test and verify it fails**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "rejects starting a second active analyze run"
```

Expected: FAIL because the route is not registered.

- [ ] **Step 3: Add route file**

Create `apps/api/src/routes/analyze-runs.ts`:

```ts
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import { createAnalyzeRunService } from "../services/analyze-run-service.js";
import type { AiPrefillProviderFactory } from "../services/ai-prefill-service.js";

type RouteOptions = {
  db: Db;
  aiPrefillConfig: ApiConfig["aiPrefill"];
  aiPrefillProviderFactory?: AiPrefillProviderFactory;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const analyzeRunParamsSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1)
});

export const registerAnalyzeRunRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db, aiPrefillConfig, aiPrefillProviderFactory }
) => {
  const service = createAnalyzeRunService(db, { aiPrefillConfig, aiPrefillProviderFactory });

  app.post("/projects/:projectId/analyze-runs", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const run = await service.startAnalyzeRun(projectId);
    return reply.code(201).send(run);
  });

  app.get("/projects/:projectId/analyze-runs/:runId", async (request) => {
    const { projectId, runId } = analyzeRunParamsSchema.parse(request.params);
    return service.getAnalyzeRun(projectId, runId);
  });
};
```

Modify `apps/api/src/server.ts`:

```ts
import { registerAnalyzeRunRoutes } from "./routes/analyze-runs.js";
```

Register before proposal routes or near other project-scoped routes:

```ts
  app.register(registerAnalyzeRunRoutes, {
    prefix: "/api",
    db,
    aiPrefillConfig,
    aiPrefillProviderFactory: options.aiPrefillProviderFactory
  });
```

- [ ] **Step 4: Run focused API tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "analyze run"
```

Expected: PASS for analyze-run tests.

- [ ] **Step 5: Commit API routes**

Run:

```sh
git add apps/api/src/routes/analyze-runs.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose analyze run api"
```

## Task 5: Web API Helpers And Project CTA

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/api/queries.test.ts`
- Modify: `apps/web/src/components/project-actions.tsx`
- Modify: `apps/web/src/components/project-actions.test.tsx`
- Modify: `apps/web/src/routes/project-detail.tsx`

- [ ] **Step 1: Write web query tests**

Modify import in `apps/web/src/api/queries.test.ts`:

```ts
import {
  analyzeRunQuery,
  generateAiPrefillProposals,
  proposalsQuery,
  sourceFilesQuery,
  startAnalyzeRun
} from "./queries.js";
```

Add tests:

```ts
  it("starts analyze runs", async () => {
    mocks.apiSend.mockResolvedValueOnce({ id: "run-1" });

    await startAnalyzeRun("project-1");

    expect(mocks.apiSend).toHaveBeenCalledWith(
      "POST",
      "/api/projects/project-1/analyze-runs"
    );
  });

  it("fetches analyze run details", async () => {
    mocks.apiGet.mockResolvedValueOnce({ id: "run-1" });
    const query = analyzeRunQuery("project-1", "run-1");

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/analyze-runs/run-1"
    );
  });
```

- [ ] **Step 2: Run query tests and verify they fail**

Run:

```sh
pnpm --filter web test -- queries.test.ts
```

Expected: FAIL because helper exports do not exist.

- [ ] **Step 3: Add web query helpers**

Modify imports in `apps/web/src/api/queries.ts`:

```ts
  AnalyzeRunDetailDto,
```

Add query keys:

```ts
  analyzeRun: (projectId: string, runId: string) =>
    ["projects", projectId, "analyze-runs", runId] as const,
```

Add helpers:

```ts
export function analyzeRunQuery(projectId: string, runId: string) {
  return queryOptions({
    queryKey: queryKeys.analyzeRun(projectId, runId),
    queryFn: () =>
      apiGet<AnalyzeRunDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/analyze-runs/${encodeURIComponent(runId)}`
      )
  });
}

export function startAnalyzeRun(projectId: string) {
  return apiSend<AnalyzeRunDetailDto>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/analyze-runs`
  );
}
```

- [ ] **Step 4: Update project action tests first**

In `apps/web/src/components/project-actions.test.tsx`, update props passed to `ProjectActions`:

```tsx
        isAnalyzing={false}
        onAnalyze={() => undefined}
```

Update expectations:

```ts
    expect(html).toContain("Analyze project");
    expect(html).toContain("Import from source");
    expect(html).toContain("AI Prefill");
```

Add:

```ts
  it("shows an active spinner while analyzing", () => {
    const html = renderToStaticMarkup(
      <ProjectActions
        projectId="project-1"
        isAnalyzing={true}
        isInitializing={false}
        isIndexing={false}
        isProjectActionPending={true}
        onAnalyze={() => undefined}
        onInitialize={() => undefined}
        onReindex={() => undefined}
      />
    );

    expect(html).toContain("Analyze project");
    expect(html).toContain("animate-spin");
  });
```

- [ ] **Step 5: Implement project CTA**

Modify `apps/web/src/components/project-actions.tsx`:

```ts
import { BrainCircuit, ... } from "lucide-react";
```

Extend props:

```ts
  isAnalyzing: boolean;
  onAnalyze: () => void;
```

Add the primary button before secondary actions:

```tsx
      <button
        type="button"
        className="button-primary"
        disabled={isProjectActionPending}
        onClick={onAnalyze}
      >
        {isAnalyzing ? (
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <BrainCircuit className="h-4 w-4" aria-hidden="true" />
        )}
        Analyze project
      </button>
```

Change the existing `Re-index` button class to `button-secondary` so `Analyze project` is visually primary.

Modify `apps/web/src/routes/project-detail.tsx`:

```ts
  startAnalyzeRun,
```

Add mutation:

```ts
  const analyzeMutation = useMutation({
    mutationFn: () => startAnalyzeRun(projectId),
    onSuccess: (run) =>
      navigate({
        to: "/projects/$projectId/analyze-runs/$runId",
        params: { projectId, runId: run.id }
      })
  });
```

Update pending flag:

```ts
  const isProjectActionPending =
    analyzeMutation.isPending || initializeMutation.isPending || indexMutation.isPending;
```

Pass props:

```tsx
          isAnalyzing={analyzeMutation.isPending}
          onAnalyze={() => analyzeMutation.mutate()}
```

Render error:

```tsx
      {analyzeMutation.error ? (
        <p className="mt-3 text-sm text-red-700">{analyzeMutation.error.message}</p>
      ) : null}
```

- [ ] **Step 6: Run web query and action tests**

Run:

```sh
pnpm --filter web test -- queries.test.ts project-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit web API and CTA**

Run:

```sh
git add apps/web/src/api/queries.ts apps/web/src/api/queries.test.ts apps/web/src/components/project-actions.tsx apps/web/src/components/project-actions.test.tsx apps/web/src/routes/project-detail.tsx
git commit -m "feat: add analyze project cta"
```

## Task 6: Analyze Progress Screen

**Files:**
- Create: `apps/web/src/routes/analyze-run-detail.tsx`
- Create: `apps/web/src/routes/analyze-runs.test.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Write progress screen tests**

Create `apps/web/src/routes/analyze-runs.test.tsx` with the same mock style as `diff-reviews.test.tsx`. Include:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn()
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params: Record<string, string> }) => (
    <a href={to.replace("$projectId", params.projectId).replace("$runId", params.runId)}>{children}</a>
  )
}));

vi.mock("../api/queries.js", () => ({
  analyzeRunQuery: (projectId: string, runId: string) => ({
    queryKey: ["projects", projectId, "analyze-runs", runId]
  })
}));

import { AnalyzeRunDetailPage } from "./analyze-run-detail.js";

describe("AnalyzeRunDetailPage", () => {
  it("renders running step progress", () => {
    mocks.useQuery.mockReturnValue({
      data: runDetail({ status: "running", currentStep: "index" }),
      isLoading: false,
      error: null
    });

    const html = renderToStaticMarkup(
      <AnalyzeRunDetailPage projectId="project-1" runId="run-1" />
    );

    expect(html).toContain("Analyze project");
    expect(html).toContain("index");
    expect(html).toContain("running");
  });

  it("links to review when succeeded", () => {
    mocks.useQuery.mockReturnValue({
      data: runDetail({ status: "succeeded", currentStep: null }),
      isLoading: false,
      error: null
    });

    const html = renderToStaticMarkup(
      <AnalyzeRunDetailPage projectId="project-1" runId="run-1" />
    );

    expect(html).toContain("Review generated drafts");
    expect(html).toContain("/projects/project-1/analyze-runs/run-1/review");
  });
});

function runDetail(input: { status: "running" | "succeeded"; currentStep: string | null }) {
  return {
    id: "run-1",
    projectId: "project-1",
    status: input.status,
    currentStep: input.currentStep,
    steps: [
      { name: "initialize", status: "succeeded", startedAt: "2026-05-12T10:00:00.000Z", finishedAt: "2026-05-12T10:00:01.000Z", message: null, counts: {} },
      { name: "index", status: input.status === "running" ? "running" : "succeeded", startedAt: "2026-05-12T10:00:01.000Z", finishedAt: null, message: null, counts: { sourceFileCount: 4 } }
    ],
    selection: {
      selectedSourceFileIds: ["source-1"],
      selectedPaths: ["src/index.ts"],
      eligibleHighSignalFileCount: 3,
      skippedHighSignalFileCount: 2,
      categories: [{ category: "entrypoints_routes", count: 1 }],
      diagnostics: [{ level: "info", message: "AI source selection is partial: selected 1 of 3 high-signal files." }]
    },
    sourceProposalCount: 2,
    aiProposalCount: 1,
    indexRunId: "index-run-1",
    errorMessage: null,
    createdAt: "2026-05-12T09:59:59.000Z",
    startedAt: "2026-05-12T10:00:00.000Z",
    finishedAt: input.status === "succeeded" ? "2026-05-12T10:00:05.000Z" : null
  };
}
```

- [ ] **Step 2: Run progress tests and verify they fail**

Run:

```sh
pnpm --filter web test -- analyze-runs.test.tsx
```

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement progress screen**

Create `apps/web/src/routes/analyze-run-detail.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Circle, CircleAlert, Loader2 } from "lucide-react";

import { analyzeRunQuery } from "../api/queries.js";

export function AnalyzeRunDetailPage({ projectId, runId }: { projectId: string; runId: string }) {
  const run = useQuery({
    ...analyzeRunQuery(projectId, runId),
    refetchInterval: (query) =>
      query.state.data?.status === "queued" || query.state.data?.status === "running" ? 1000 : false
  });

  if (run.error) {
    return <main className="p-4 text-sm text-red-700">{run.error.message}</main>;
  }

  if (run.isLoading || !run.data) {
    return <main className="p-4 text-sm text-slate-600">Loading analyze run...</main>;
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Analyze project</h1>
          <p className="text-sm text-slate-600">{run.data.status}</p>
        </div>
        <Link to="/projects/$projectId" params={{ projectId }} search={{ q: undefined }} className="button-secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to project
        </Link>
      </div>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="section-heading">Progress</h2>
        <div className="mt-3 grid gap-2">
          {run.data.steps.map((step) => (
            <div key={step.name} className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <StepIcon status={step.status} />
                <span className="truncate font-medium text-slate-900">{step.name}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{step.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="section-heading">Generated drafts</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Metric label="Source proposals" value={run.data.sourceProposalCount} />
          <Metric label="AI proposals" value={run.data.aiProposalCount} />
          <Metric label="AI source files" value={run.data.selection?.selectedSourceFileIds.length ?? 0} />
        </div>
        {run.data.selection?.diagnostics.map((diagnostic) => (
          <p key={diagnostic.message} className="mt-3 text-sm text-amber-700">{diagnostic.message}</p>
        ))}
      </section>

      {run.data.errorMessage ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {run.data.errorMessage}
        </div>
      ) : null}

      {run.data.status === "succeeded" || run.data.sourceProposalCount + run.data.aiProposalCount > 0 ? (
        <Link
          to="/projects/$projectId/analyze-runs/$runId/review"
          params={{ projectId, runId }}
          className="button-primary w-fit"
        >
          Review generated drafts
        </Link>
      ) : null}
    </main>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden="true" />;
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  if (status === "failed") return <CircleAlert className="h-4 w-4 text-red-600" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-slate-400" aria-hidden="true" />;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Register progress route**

Modify `apps/web/src/app.tsx`:

```ts
import { AnalyzeRunDetailPage } from "./routes/analyze-run-detail.js";
```

Add route:

```tsx
const analyzeRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/analyze-runs/$runId",
  component: () => {
    const { projectId, runId } = analyzeRunDetailRoute.useParams();
    return <AnalyzeRunDetailPage projectId={projectId} runId={runId} />;
  }
});
```

Add `analyzeRunDetailRoute` to `routeTree`.

- [ ] **Step 5: Run progress tests**

Run:

```sh
pnpm --filter web test -- analyze-runs.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit progress UI**

Run:

```sh
git add apps/web/src/routes/analyze-run-detail.tsx apps/web/src/routes/analyze-runs.test.tsx apps/web/src/app.tsx
git commit -m "feat: show analyze run progress"
```

## Task 7: Unified Analyze Review Screen

**Files:**
- Create: `apps/web/src/routes/analyze-run-review.tsx`
- Modify: `apps/web/src/routes/analyze-runs.test.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Add review screen tests**

Append tests to `apps/web/src/routes/analyze-runs.test.tsx`. Extend mocks:

```ts
const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() }))
}));
```

Mock `useMutation`:

```ts
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient
```

Mock query exports used by review:

```ts
  acceptProposals: vi.fn(),
  patchProposal: vi.fn(),
  proposalQuery: (projectId: string, proposalId: string) => ({
    queryKey: ["projects", projectId, "proposals", proposalId]
  }),
  proposalsQuery: (projectId: string, input: unknown) => ({
    queryKey: ["projects", projectId, "proposals", input]
  }),
```

Add:

```tsx
import { AnalyzeRunReviewPage } from "./analyze-run-review.js";

  it("renders mixed proposal types in analyze review", () => {
    mocks.useMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
    mocks.useQuery
      .mockReturnValueOnce({ data: [sourceProposal(), aiProposal()], isLoading: false, error: null })
      .mockReturnValueOnce({ data: sourceProposalDetail(), isLoading: false, error: null });

    const html = renderToStaticMarkup(
      <AnalyzeRunReviewPage projectId="project-1" runId="run-1" />
    );

    expect(html).toContain("Analyze Review");
    expect(html).toContain("DecisionService");
    expect(html).toContain("Manage projects");
    expect(html).toContain("Source evidence");
  });

function sourceProposal() {
  return {
    id: "proposal-source",
    projectId: "project-1",
    proposalType: "source_spec_entity",
    status: "pending",
    title: "DecisionService",
    entityId: "interface.decision-service",
    entityType: "interface",
    filePath: "interfaces/decision-service.md",
    confidence: 0.8,
    conflict: { status: "none" },
    createdAt: "2026-05-12T10:00:00.000Z",
    reviewedAt: null
  };
}

function aiProposal() {
  return {
    ...sourceProposal(),
    id: "proposal-ai",
    proposalType: "ai_spec_entity",
    title: "Manage projects",
    entityId: "uc.manage-projects",
    entityType: "use_case",
    filePath: "use-cases/uc.manage-projects.md"
  };
}

function sourceProposalDetail() {
  return {
    ...sourceProposal(),
    payload: {
      entityId: "interface.decision-service",
      type: "interface",
      title: "DecisionService",
      status: "draft",
      filePath: "interfaces/decision-service.md",
      generatedMarkdown: "# DecisionService",
      markdown: "# DecisionService",
      sourceFiles: ["src/decision-service.ts"],
      symbols: []
    },
    evidence: {
      scanner: "typescript",
      sourceFiles: [
        {
          file: "src/decision-service.ts",
          symbolName: "DecisionService",
          symbolKind: "class",
          exported: true,
          line: 1
        }
      ]
    }
  };
}
```

- [ ] **Step 2: Run review tests and verify they fail**

Run:

```sh
pnpm --filter web test -- analyze-runs.test.tsx
```

Expected: FAIL because `AnalyzeRunReviewPage` does not exist.

- [ ] **Step 3: Implement review screen**

Create `apps/web/src/routes/analyze-run-review.tsx`. Reuse the state and mutation pattern from `source-import.tsx`, but query all proposals:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Save, XCircle } from "lucide-react";
import type { ProposalDetailDto, ProposalStatus, ProposalSummaryDto, ProposalType } from "@specops/contracts";

import {
  acceptProposals,
  patchProposal,
  proposalQuery,
  proposalsQuery,
  queryKeys
} from "../api/queries.js";

type ProposalMarkdownDraft = { markdown: string; savedMarkdown: string };
type ProposalStatusFilter = "pending" | "accepted" | "rejected" | "obsolete";
type ProposalTypeFilter = "all" | ProposalType;

const statusFilters = ["pending", "accepted", "rejected", "obsolete"] satisfies ProposalStatusFilter[];
const typeFilters = ["all", "source_spec_entity", "ai_spec_entity"] satisfies ProposalTypeFilter[];

export function AnalyzeRunReviewPage({ projectId, runId }: { projectId: string; runId: string }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ProposalStatusFilter>("pending");
  const [typeFilter, setTypeFilter] = useState<ProposalTypeFilter>("all");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [checkedProposalIds, setCheckedProposalIds] = useState<Set<string>>(() => new Set());
  const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, ProposalMarkdownDraft>>({});

  const proposals = useQuery(proposalsQuery(projectId));
  const allProposals = useMemo(() => proposals.data ?? [], [proposals.data]);
  const visibleProposals = useMemo(
    () =>
      allProposals.filter(
        (proposal) =>
          matchesStatusFilter(proposal.status, statusFilter) &&
          (typeFilter === "all" || proposal.proposalType === typeFilter)
      ),
    [allProposals, statusFilter, typeFilter]
  );
  const effectiveSelectedProposalId = selectedProposalId ?? visibleProposals[0]?.id ?? null;
  const selectedDetail = useQuery({
    ...proposalQuery(projectId, effectiveSelectedProposalId ?? ""),
    enabled: effectiveSelectedProposalId !== null
  });
  const selectedDraft = effectiveSelectedProposalId ? markdownDrafts[effectiveSelectedProposalId] : undefined;
  const editorMarkdown = selectedDraft?.markdown ?? selectedDetail.data?.payload.markdown ?? "";
  const isMarkdownDirty = selectedDraft ? selectedDraft.markdown !== selectedDraft.savedMarkdown : false;
  const hasDirtyDraft = Object.values(markdownDrafts).some((draft) => draft.markdown !== draft.savedMarkdown);
  const selectedProposalIsPending = selectedDetail.data?.status === "pending";

  useEffect(() => {
    setCheckedProposalIds((current) => {
      const pendingIds = new Set(allProposals.filter((proposal) => proposal.status === "pending").map((proposal) => proposal.id));
      return new Set([...current].filter((proposalId) => pendingIds.has(proposalId)));
    });
  }, [allProposals]);

  const invalidateReview = async (proposalId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) }),
      proposalId ? queryClient.invalidateQueries({ queryKey: queryKeys.proposal(projectId, proposalId) }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReadiness(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
    ]);
  };

  const acceptMutation = useMutation({
    mutationFn: () => acceptProposals(projectId, { proposalIds: [...checkedProposalIds] }),
    onSuccess: async () => {
      setCheckedProposalIds(new Set());
      setMarkdownDrafts({});
      await invalidateReview(effectiveSelectedProposalId);
    }
  });
  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => patchProposal(projectId, proposalId, { status: "rejected" }),
    onSuccess: async (_updated, proposalId) => {
      setCheckedProposalIds((current) => {
        const next = new Set(current);
        next.delete(proposalId);
        return next;
      });
      await invalidateReview(proposalId);
    }
  });
  const saveMutation = useMutation({
    mutationFn: ({ proposalId, markdown }: { proposalId: string; markdown: string }) =>
      patchProposal(projectId, proposalId, { markdown }),
    onSuccess: async (updated) => {
      setMarkdownDrafts((current) => ({
        ...current,
        [updated.id]: { markdown: updated.payload.markdown, savedMarkdown: updated.payload.markdown }
      }));
      await invalidateReview(updated.id);
    }
  });

  const isBusy = acceptMutation.isPending || rejectMutation.isPending || saveMutation.isPending;

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Analyze Review</h1>
          <p className="text-sm text-slate-600">Review generated source and AI draft proposals.</p>
        </div>
        <Link to="/projects/$projectId/analyze-runs/$runId" params={{ projectId, runId }} className="button-secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to analyze run
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-y border-slate-200 bg-slate-50 px-3 py-2">
        <FilterButtons values={statusFilters} value={statusFilter} onChange={setStatusFilter} />
        <FilterButtons values={typeFilters} value={typeFilter} onChange={setTypeFilter} />
        <button
          type="button"
          className="button-primary"
          disabled={checkedProposalIds.size === 0 || hasDirtyDraft || isBusy}
          onClick={() => acceptMutation.mutate()}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Accept selected
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-2">
          {proposals.error ? (
            <p className="p-3 text-sm text-red-700">{proposals.error.message}</p>
          ) : proposals.isLoading ? (
            <p className="p-3 text-sm text-slate-500">Loading proposals...</p>
          ) : visibleProposals.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No proposals match the current filters.</p>
          ) : (
            visibleProposals.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                checked={checkedProposalIds.has(proposal.id)}
                selected={proposal.id === effectiveSelectedProposalId}
                onCheckedChange={() =>
                  setCheckedProposalIds((current) => {
                    const next = new Set(current);
                    next.has(proposal.id) ? next.delete(proposal.id) : next.add(proposal.id);
                    return next;
                  })
                }
                onSelect={() => setSelectedProposalId(proposal.id)}
              />
            ))
          )}
        </aside>
        <section className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <ProposalDetail
            detail={selectedDetail.data}
            editorMarkdown={editorMarkdown}
            isLoading={selectedDetail.isLoading}
            error={selectedDetail.error}
            isMarkdownDirty={isMarkdownDirty}
            selectedProposalIsPending={selectedProposalIsPending}
            isBusy={isBusy}
            onReject={(proposalId) => rejectMutation.mutate(proposalId)}
            onSave={(proposalId) => saveMutation.mutate({ proposalId, markdown: editorMarkdown })}
            onMarkdownChange={(proposalId, markdown, savedMarkdown) =>
              setMarkdownDrafts((current) => ({
                ...current,
                [proposalId]: { markdown, savedMarkdown }
              }))
            }
          />
        </section>
      </div>
    </main>
  );
}
```

Add local helper components below it. Keep them simple and copied from existing proposal pages where practical:

```tsx
function FilterButtons<T extends string>({
  values,
  value,
  onChange
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((item) => (
        <button
          key={item}
          type="button"
          className={
            item === value
              ? "rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
              : "rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          }
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function ProposalRow({
  checked,
  onCheckedChange,
  onSelect,
  proposal,
  selected
}: {
  checked: boolean;
  onCheckedChange: () => void;
  onSelect: () => void;
  proposal: ProposalSummaryDto;
  selected: boolean;
}) {
  return (
    <div className={selected ? "entity-row grid-cols-[auto_minmax(0,1fr)] bg-slate-100" : "entity-row grid-cols-[auto_minmax(0,1fr)] hover:bg-slate-50"}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        disabled={proposal.status !== "pending"}
        onChange={onCheckedChange}
        aria-label={`Select ${proposal.title}`}
      />
      <button type="button" className="min-w-0 text-left" onClick={onSelect}>
        <span className="block truncate text-sm font-medium text-slate-900">{proposal.title}</span>
        <span className="block truncate text-xs text-slate-500">{proposal.proposalType}</span>
        <span className="block truncate text-xs text-slate-500">{proposal.filePath}</span>
      </button>
    </div>
  );
}
```

Implement `ProposalDetail` with a `<textarea aria-label="Proposal markdown">` and evidence panels:

```tsx
function ProposalDetail({
  detail,
  editorMarkdown,
  isLoading,
  error,
  isMarkdownDirty,
  selectedProposalIsPending,
  isBusy,
  onReject,
  onSave,
  onMarkdownChange
}: {
  detail: ProposalDetailDto | undefined;
  editorMarkdown: string;
  isLoading: boolean;
  error: Error | null;
  isMarkdownDirty: boolean;
  selectedProposalIsPending: boolean;
  isBusy: boolean;
  onReject: (proposalId: string) => void;
  onSave: (proposalId: string) => void;
  onMarkdownChange: (proposalId: string, markdown: string, savedMarkdown: string) => void;
}) {
  if (error) return <p className="p-4 text-sm text-red-700">{error.message}</p>;
  if (isLoading || !detail) return <p className="p-4 text-sm text-slate-500">Select a proposal to review.</p>;

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-h-0 flex-col border-r border-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{detail.title}</h2>
            <p className="truncate text-sm text-slate-600">{detail.filePath}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="button-secondary" disabled={!selectedProposalIsPending || isBusy} onClick={() => onReject(detail.id)}>
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Reject
            </button>
            <button type="button" className="button-primary" disabled={!selectedProposalIsPending || !isMarkdownDirty || isBusy} onClick={() => onSave(detail.id)}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save
            </button>
          </div>
        </header>
        <textarea
          aria-label="Proposal markdown"
          className="min-h-[420px] flex-1 resize-none border-0 p-3 font-mono text-sm outline-none"
          value={editorMarkdown}
          disabled={!selectedProposalIsPending}
          onChange={(event) => onMarkdownChange(detail.id, event.currentTarget.value, detail.payload.markdown)}
        />
      </div>
      <aside className="min-h-0 overflow-auto p-3">
        {detail.proposalType === "source_spec_entity" ? (
          <>
            <h3 className="section-heading">Source evidence</h3>
            {detail.evidence.sourceFiles.map((sourceFile) => (
              <p key={`${sourceFile.file}:${sourceFile.symbolName}`} className="mt-2 text-xs text-slate-600">
                {sourceFile.file} {sourceFile.symbolName} line {sourceFile.line ?? "n/a"}
              </p>
            ))}
          </>
        ) : (
          <>
            <h3 className="section-heading">AI evidence</h3>
            <p className="mt-2 text-xs text-slate-600">{detail.evidence.provider} / {detail.evidence.model}</p>
            {detail.evidence.claims.map((claim) => (
              <p key={claim.text} className="mt-2 text-xs text-slate-600">{claim.text}</p>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Register review route**

Modify `apps/web/src/app.tsx`:

```ts
import { AnalyzeRunReviewPage } from "./routes/analyze-run-review.js";
```

Add route:

```tsx
const analyzeRunReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/analyze-runs/$runId/review",
  component: () => {
    const { projectId, runId } = analyzeRunReviewRoute.useParams();
    return <AnalyzeRunReviewPage projectId={projectId} runId={runId} />;
  }
});
```

Add `analyzeRunReviewRoute` to `routeTree`.

- [ ] **Step 5: Run review tests**

Run:

```sh
pnpm --filter web test -- analyze-runs.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit review UI**

Run:

```sh
git add apps/web/src/routes/analyze-run-review.tsx apps/web/src/routes/analyze-runs.test.tsx apps/web/src/app.tsx
git commit -m "feat: add analyze review screen"
```

## Task 8: End-To-End Verification And Polish

**Files:**
- Modify files from earlier tasks only if verification finds concrete failures.

- [ ] **Step 1: Run backend-focused checks**

Run:

```sh
pnpm --filter @specops/contracts test -- analyze-runs.test.ts
pnpm --filter @specops/db test -- migrations.test.ts
pnpm --filter api test -- analyze-source-selection.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run web-focused checks**

Run:

```sh
pnpm --filter web test -- queries.test.ts project-actions.test.tsx analyze-runs.test.tsx
```

Expected: all PASS.

- [ ] **Step 3: Run full validation**

Run:

```sh
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all PASS. If database-backed API tests are skipped because `TEST_DATABASE_URL` is unset, run them explicitly with:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "analyze run"
```

- [ ] **Step 4: Manual browser smoke test**

Start services:

```sh
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5176`. Create or open a project with TypeScript source files, click `Analyze project`, confirm the progress screen advances, then open `Review generated drafts`. Verify mixed proposal rows render and proposal detail evidence appears.

- [ ] **Step 5: Commit final fixes**

If Step 1-4 required fixes, commit them:

```sh
git add apps packages
git commit -m "fix: polish analyze project workflow"
```

If no fixes were needed, do not create an empty commit.

