# Sample Milestone 3 Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `sample/` so it remains the Team Decision Log sample and also acts as a Milestone 3 source scanner trial fixture.

**Architecture:** Keep `sample/specops` as the markdown source of truth. Add a compact TypeScript skeleton under `sample/src` that mirrors the sample specs and gives the scanner source, test, config, and entrypoint files with imports, exports, and symbols. Add scanner tests that exercise `sample/` directly.

**Tech Stack:** TypeScript source files, Vitest, `@specops/repo-scanner`, existing pnpm workspace.

---

## File Structure

- Create: `sample/src/domain.ts` - decision-log domain types and small constants.
- Create: `sample/src/services/decision-service.ts` - in-memory decision service with named exports and relative imports.
- Create: `sample/src/services/search-service.ts` - decision search/index helpers with source symbols.
- Create: `sample/src/services/reminder-scheduler.ts` - review reminder scheduler helpers.
- Create: `sample/src/index.ts` - sample entrypoint that re-exports domain and services.
- Create: `sample/src/__tests__/decision-service.test.ts` - test-shaped TypeScript file for scanner `test` classification.
- Create: `sample/tsconfig.json` - config file for scanner `config` classification.
- Modify: `packages/repo-scanner/src/__tests__/scan.test.ts` - assert scanning `sample/` produces useful Milestone 3 inventory.

## Task 1: Add Sample Source Skeleton

**Files:**
- Create: `sample/src/domain.ts`
- Create: `sample/src/services/decision-service.ts`
- Create: `sample/src/services/search-service.ts`
- Create: `sample/src/services/reminder-scheduler.ts`
- Create: `sample/src/index.ts`
- Create: `sample/src/__tests__/decision-service.test.ts`
- Create: `sample/tsconfig.json`

- [ ] **Step 1: Create sample domain types**

Create `sample/src/domain.ts`:

```ts
export type DecisionStatus = "proposed" | "accepted" | "superseded" | "archived";

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  decisionPath: string;
};

export type DecisionLink = {
  fromDecisionId: string;
  toDecisionId: string;
  linkType: "depends_on" | "supersedes" | "related";
  source: "frontmatter" | "author";
};

export type Decision = {
  id: string;
  workspaceId: string;
  title: string;
  status: DecisionStatus;
  contextMarkdown: string;
  decisionMarkdown: string;
  consequencesMarkdown: string;
  links: DecisionLink[];
  reviewAfter?: string;
  updatedAt: string;
};

export type ReviewReminder = {
  id: string;
  decisionId: string;
  dueAt: string;
  reason: string;
  status: "open" | "done" | "dismissed";
};

export const activeDecisionStatuses: DecisionStatus[] = ["proposed", "accepted"];
```

- [ ] **Step 2: Create decision service**

Create `sample/src/services/decision-service.ts`:

```ts
import type { Decision, DecisionLink, DecisionStatus, Workspace } from "../domain";

export type CreateDecisionInput = {
  title: string;
  contextMarkdown: string;
  decisionMarkdown: string;
  consequencesMarkdown?: string;
  status?: DecisionStatus;
};

export class DecisionService {
  private readonly decisions = new Map<string, Decision>();

  constructor(private readonly workspace: Workspace) {}

  createDecision(input: CreateDecisionInput): Decision {
    const decision: Decision = {
      id: toDecisionId(input.title),
      workspaceId: this.workspace.id,
      title: input.title,
      status: input.status ?? "proposed",
      contextMarkdown: input.contextMarkdown,
      decisionMarkdown: input.decisionMarkdown,
      consequencesMarkdown: input.consequencesMarkdown ?? "",
      links: [],
      updatedAt: new Date().toISOString(),
    };

    this.decisions.set(decision.id, decision);
    return decision;
  }

  listDecisions(): Decision[] {
    return [...this.decisions.values()].sort((left, right) => left.title.localeCompare(right.title));
  }

  linkDecision(sourceId: string, targetId: string, linkType: DecisionLink["linkType"]): DecisionLink {
    const source = this.requireDecision(sourceId);
    this.requireDecision(targetId);

    const link: DecisionLink = {
      fromDecisionId: sourceId,
      toDecisionId: targetId,
      linkType,
      source: "author",
    };

    source.links = [...source.links, link];
    return link;
  }

  private requireDecision(decisionId: string): Decision {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Unknown decision: ${decisionId}`);
    }
    return decision;
  }
}

export function toDecisionId(title: string): string {
  return `decision.${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
```

- [ ] **Step 3: Create search service**

Create `sample/src/services/search-service.ts`:

```ts
import type { Decision } from "../domain";

export type DecisionSearchResult = {
  id: string;
  title: string;
  excerpt: string;
};

export function indexDecisionText(decision: Decision): string {
  return [
    decision.title,
    decision.contextMarkdown,
    decision.decisionMarkdown,
    decision.consequencesMarkdown,
  ].join("\n");
}

export function searchDecisions(decisions: Decision[], query: string): DecisionSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return decisions
    .filter((decision) => indexDecisionText(decision).toLowerCase().includes(normalizedQuery))
    .map((decision) => ({
      id: decision.id,
      title: decision.title,
      excerpt: decision.contextMarkdown.slice(0, 120),
    }));
}
```

- [ ] **Step 4: Create reminder scheduler**

Create `sample/src/services/reminder-scheduler.ts`:

```ts
import type { Decision, ReviewReminder } from "../domain";

export function scheduleReview(decision: Decision, dueAt: string, reason: string): ReviewReminder {
  return {
    id: `reminder.${decision.id}`,
    decisionId: decision.id,
    dueAt,
    reason,
    status: "open",
  };
}

export function findDueReminders(reminders: ReviewReminder[], now: string): ReviewReminder[] {
  const nowTime = Date.parse(now);
  return reminders.filter((reminder) => reminder.status === "open" && Date.parse(reminder.dueAt) <= nowTime);
}
```

- [ ] **Step 5: Create entrypoint and config/test-shaped files**

Create `sample/src/index.ts`:

```ts
export * from "./domain";
export * from "./services/decision-service";
export * from "./services/reminder-scheduler";
export * from "./services/search-service";
```

Create `sample/src/__tests__/decision-service.test.ts`:

```ts
import { DecisionService } from "../services/decision-service";
import type { Workspace } from "../domain";

const workspace: Workspace = {
  id: "workspace.sample",
  name: "Sample Workspace",
  rootPath: ".",
  decisionPath: "specops/decisions",
};

export function createSampleDecisionTitle(): string {
  const service = new DecisionService(workspace);
  return service.createDecision({
    title: "Choose Markdown",
    contextMarkdown: "The team wants reviewable decisions.",
    decisionMarkdown: "Use markdown decision records.",
  }).title;
}
```

Create `sample/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 6: Verify sample source skeleton scans**

Run:

```bash
pnpm --filter @specops/repo-scanner test -- src/__tests__/scan.test.ts
```

Expected: PASS for existing scanner tests. This does not prove the new sample yet; Task 2 adds explicit assertions.

- [ ] **Step 7: Commit sample source skeleton**

```bash
git add sample/src sample/tsconfig.json
git commit -m "feat: add sample source scanner fixture"
```

## Task 2: Assert Sample Scanner Coverage

**Files:**
- Modify: `packages/repo-scanner/src/__tests__/scan.test.ts`

- [ ] **Step 1: Add sample scan assertions**

Append this test to `packages/repo-scanner/src/__tests__/scan.test.ts`:

```ts
it("scans the sample project as a milestone 3 trial fixture", async () => {
  const sampleRoot = resolve(__dirname, "../../../../sample");
  const result = await scanRepository({ rootPath: sampleRoot });
  const byPath = new Map(result.files.map((file) => [file.path, file]));

  expect(byPath.get("src/index.ts")?.kind).toBe("entrypoint");
  expect(byPath.get("src/domain.ts")?.kind).toBe("source");
  expect(byPath.get("src/services/decision-service.ts")?.kind).toBe("source");
  expect(byPath.get("src/__tests__/decision-service.test.ts")?.kind).toBe("test");
  expect(byPath.get("tsconfig.json")?.kind).toBe("config");

  const decisionService = byPath.get("src/services/decision-service.ts");
  expect(decisionService?.imports.map((sourceImport) => sourceImport.specifier)).toContain("../domain");
  expect(decisionService?.exports.map((sourceExport) => sourceExport.exportedName)).toEqual(
    expect.arrayContaining(["DecisionService", "toDecisionId"]),
  );
  expect(decisionService?.symbols.map((symbol) => symbol.name)).toEqual(
    expect.arrayContaining(["DecisionService", "toDecisionId"]),
  );

  expect(result.files.length).toBeGreaterThanOrEqual(7);
  expect(result.warnings).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run:

```bash
pnpm --filter @specops/repo-scanner test -- src/__tests__/scan.test.ts
```

Expected: PASS, with the new sample fixture test included.

- [ ] **Step 3: Run focused markdown sample regression**

Run:

```bash
pnpm --filter @specops/markdown test -- src/__tests__/sample-project.test.ts
```

Expected: PASS, proving the existing sample specs still parse.

- [ ] **Step 4: Commit scanner coverage test**

```bash
git add packages/repo-scanner/src/__tests__/scan.test.ts
git commit -m "test: cover sample milestone 3 scanner trial"
```

## Task 3: Final Verification

**Files:**
- No file edits.

- [ ] **Step 1: Run package checks**

Run:

```bash
pnpm --filter @specops/repo-scanner typecheck
pnpm --filter @specops/repo-scanner test
pnpm --filter @specops/markdown test -- src/__tests__/sample-project.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 2: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree.
