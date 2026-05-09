# SpecOps Milestone 2 Agent Task Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic preview-first agent task generation from indexed specs, with editable save-to-markdown behavior.

**Architecture:** Add shared request/response contracts, implement a pure `@specops/taskgen` generator, then add Fastify orchestration routes that gather one-hop graph context and write canonical `agent_task` markdown. Finish with a compact React preview/editor panel in the existing entity detail workflow.

**Tech Stack:** TypeScript, pnpm workspace, Zod, Fastify, Drizzle/PostgreSQL, React, TanStack Query, CodeMirror, Vitest, YAML.

---

## File Structure

- Create: `packages/contracts/src/agent-tasks.ts` - Zod schemas and DTO types for preview and save requests.
- Modify: `packages/contracts/src/index.ts` - export agent task contracts.
- Create: `packages/taskgen/src/types.ts` - generator input/output and warning types.
- Create: `packages/taskgen/src/id.ts` - deterministic task ID and file path helpers.
- Create: `packages/taskgen/src/sections.ts` - markdown section extraction helpers.
- Create: `packages/taskgen/src/generate.ts` - deterministic markdown generation.
- Modify: `packages/taskgen/src/index.ts` - public package exports.
- Modify: `packages/taskgen/package.json` - add `yaml` dependency.
- Create: `packages/taskgen/src/__tests__/id.test.ts` - task ID and path tests.
- Create: `packages/taskgen/src/__tests__/generate.test.ts` - generator output tests.
- Create: `apps/api/src/services/agent-task-service.ts` - API orchestration for preview and save.
- Create: `apps/api/src/routes/agent-tasks.ts` - Fastify routes for preview and save.
- Modify: `apps/api/src/server.ts` - register agent task routes.
- Modify: `apps/api/package.json` - add `@specops/taskgen` and `yaml` dependencies.
- Modify: `apps/api/src/__tests__/routes.test.ts` - DB-backed route coverage for preview/save.
- Modify: `apps/web/src/api/queries.ts` - add preview/save client helpers.
- Create: `apps/web/src/components/agent-task-preview.tsx` - editable preview panel and controls.
- Create: `apps/web/src/components/agent-task-preview-state.ts` - small pure helpers for initial UI state.
- Create: `apps/web/src/components/agent-task-preview-state.test.ts` - pure UI helper tests.
- Modify: `apps/web/src/components/entity-detail.tsx` - add generate task action and preview panel.

## Task 1: Shared Agent Task Contracts

**Files:**
- Create: `packages/contracts/src/agent-tasks.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/agent-tasks.test.ts`

- [ ] **Step 1: Write contract tests**

Create `packages/contracts/src/agent-tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  agentTaskPreviewRequestSchema,
  saveAgentTaskRequestSchema
} from "./agent-tasks.js";

describe("agent task contracts", () => {
  it("defaults preview targetAgent to codex", () => {
    expect(
      agentTaskPreviewRequestSchema.parse({
        sourceEntityId: "uc.generate-agent-task"
      })
    ).toEqual({
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });
  });

  it("accepts an edited task save request", () => {
    expect(
      saveAgentTaskRequestSchema.parse({
        taskId: "task.uc-generate-agent-task",
        filePath: "agent-tasks/task.uc-generate-agent-task.md",
        markdown:
          "---\n" +
          "id: task.uc-generate-agent-task\n" +
          "type: agent_task\n" +
          "title: Generate Agent Task\n" +
          "status: ready\n" +
          "source_entity: uc.generate-agent-task\n" +
          "---\n\n" +
          "# Task: Generate Agent Task\n"
      })
    ).toMatchObject({
      taskId: "task.uc-generate-agent-task",
      filePath: "agent-tasks/task.uc-generate-agent-task.md"
    });
  });
});
```

- [ ] **Step 2: Run contract tests to verify they fail**

Run:

```bash
pnpm --filter @specops/contracts test -- src/agent-tasks.test.ts
```

Expected: FAIL because `./agent-tasks.js` does not exist.

- [ ] **Step 3: Add agent task contract schemas**

Create `packages/contracts/src/agent-tasks.ts`:

```ts
import { z } from "zod";

import { specEntitySchema } from "./entities.js";

export const agentTaskWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  entityId: z.string().nullable().optional()
});

export const agentTaskPreviewRequestSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetAgent: z.string().min(1).default("codex"),
  taskId: z.string().min(1).optional(),
  title: z.string().min(1).optional()
});

export const agentTaskPreviewResponseSchema = z.object({
  markdown: z.string(),
  taskId: z.string(),
  title: z.string(),
  filePath: z.string(),
  sourceSpecIds: z.array(z.string()),
  contextSpecIds: z.array(z.string()),
  warnings: z.array(agentTaskWarningSchema)
});

export const saveAgentTaskRequestSchema = z.object({
  markdown: z.string().min(1),
  taskId: z.string().min(1),
  filePath: z.string().min(1)
});

export const saveAgentTaskResponseSchema = specEntitySchema;

export type AgentTaskWarningDto = z.infer<typeof agentTaskWarningSchema>;
export type AgentTaskPreviewRequest = z.infer<typeof agentTaskPreviewRequestSchema>;
export type AgentTaskPreviewResponse = z.infer<typeof agentTaskPreviewResponseSchema>;
export type SaveAgentTaskRequest = z.infer<typeof saveAgentTaskRequestSchema>;
export type SaveAgentTaskResponse = z.infer<typeof saveAgentTaskResponseSchema>;
```

- [ ] **Step 4: Export contracts**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./entities.js";
export * from "./indexing.js";
export * from "./projects.js";
export * from "./validation.js";
```

- [ ] **Step 5: Run contract tests**

Run:

```bash
pnpm --filter @specops/contracts test -- src/agent-tasks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit contracts**

Run:

```bash
git add packages/contracts/src/agent-tasks.ts packages/contracts/src/agent-tasks.test.ts packages/contracts/src/index.ts
git commit -m "feat: add agent task contracts"
```

## Task 2: Deterministic Task ID Helpers

**Files:**
- Create: `packages/taskgen/src/id.ts`
- Modify: `packages/taskgen/src/index.ts`
- Test: `packages/taskgen/src/__tests__/id.test.ts`

- [ ] **Step 1: Write ID helper tests**

Create `packages/taskgen/src/__tests__/id.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { defaultAgentTaskFilePath, defaultAgentTaskId, safeTaskFileName, slugifyTaskIdPart } from "../id.js";

describe("agent task id helpers", () => {
  it("derives task ids from source entity ids", () => {
    expect(defaultAgentTaskId("uc.generate-agent-task")).toBe("task.uc-generate-agent-task");
    expect(defaultAgentTaskId("interface.spec-entity-service")).toBe(
      "task.interface-spec-entity-service"
    );
  });

  it("normalizes unexpected punctuation", () => {
    expect(slugifyTaskIdPart("Domain Customer_Profile")).toBe("domain-customer-profile");
  });

  it("derives file paths under agent-tasks", () => {
    expect(defaultAgentTaskFilePath("task.uc-generate-agent-task")).toBe(
      "agent-tasks/task.uc-generate-agent-task.md"
    );
  });

  it("removes path separators from editable task ids before deriving file names", () => {
    expect(safeTaskFileName("task.uc/generate")).toBe("task.uc-generate");
  });
});
```

- [ ] **Step 2: Run ID tests to verify they fail**

Run:

```bash
pnpm --filter @specops/taskgen test -- src/__tests__/id.test.ts
```

Expected: FAIL because `../id.js` does not exist.

- [ ] **Step 3: Implement ID helpers**

Create `packages/taskgen/src/id.ts`:

```ts
export function defaultAgentTaskId(sourceEntityId: string): string {
  return `task.${slugifyTaskIdPart(sourceEntityId)}`;
}

export function defaultAgentTaskFilePath(taskId: string): string {
  return `agent-tasks/${safeTaskFileName(taskId)}.md`;
}

export function safeTaskFileName(taskId: string): string {
  return taskId
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function slugifyTaskIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
```

- [ ] **Step 4: Export ID helpers**

Modify `packages/taskgen/src/index.ts`:

```ts
export * from "./id.js";
```

- [ ] **Step 5: Run ID tests**

Run:

```bash
pnpm --filter @specops/taskgen test -- src/__tests__/id.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit ID helpers**

Run:

```bash
git add packages/taskgen/src/id.ts packages/taskgen/src/index.ts packages/taskgen/src/__tests__/id.test.ts
git commit -m "feat: add task id helpers"
```

## Task 3: Pure Task Generator

**Files:**
- Modify: `packages/taskgen/package.json`
- Create: `packages/taskgen/src/types.ts`
- Create: `packages/taskgen/src/sections.ts`
- Create: `packages/taskgen/src/generate.ts`
- Modify: `packages/taskgen/src/index.ts`
- Test: `packages/taskgen/src/__tests__/generate.test.ts`

- [ ] **Step 1: Add generator dependency**

Modify `packages/taskgen/package.json`:

```json
{
  "name": "@specops/taskgen",
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
    "yaml": "^2.6.1"
  },
  "devDependencies": {}
}
```

Run:

```bash
pnpm install
```

Expected: lockfile updates with `yaml` available to `@specops/taskgen`.

- [ ] **Step 2: Write generator tests**

Create `packages/taskgen/src/__tests__/generate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { generateAgentTaskMarkdown } from "../generate.js";
import type { TaskgenEntity, TaskgenLink } from "../types.js";

const source: TaskgenEntity = {
  entityId: "uc.generate-agent-task",
  type: "use_case",
  title: "Generate Agent Task",
  status: "draft",
  filePath: "use-cases/uc.generate-agent-task.md",
  frontmatter: {},
  bodyMarkdown:
    "# Generate Agent Task\n\n" +
    "## Goal\n\n" +
    "Generate a focused implementation prompt.\n\n" +
    "## Validation\n\n" +
    "- Keep generated tasks traceable.\n",
  bodyText: "Generate a focused implementation prompt. Keep generated tasks traceable."
};

const context: TaskgenEntity[] = [
  {
    entityId: "domain.spec-entity",
    type: "domain_entity",
    title: "Spec Entity",
    status: "draft",
    filePath: "domain/spec-entity.md",
    frontmatter: {},
    bodyMarkdown: "# Spec Entity\n\n## Definition\n\nA spec entity is one markdown document.\n",
    bodyText: "A spec entity is one markdown document."
  },
  {
    entityId: "interface.spec-entity-service",
    type: "interface",
    title: "Spec Entity Service",
    status: "draft",
    filePath: "interfaces/spec-entity-service.md",
    frontmatter: {},
    bodyMarkdown: "# Spec Entity Service\n\n## Responsibility\n\nReads and writes spec entities.\n",
    bodyText: "Reads and writes spec entities."
  }
];

const links: TaskgenLink[] = [
  {
    fromEntityId: "uc.generate-agent-task",
    toEntityId: "domain.spec-entity",
    linkType: "domain",
    source: "frontmatter"
  },
  {
    fromEntityId: "interface.spec-entity-service",
    toEntityId: "uc.generate-agent-task",
    linkType: "use_cases",
    source: "frontmatter"
  }
];

describe("generateAgentTaskMarkdown", () => {
  it("generates deterministic task markdown with graph traceability", () => {
    const result = generateAgentTaskMarkdown({
      source,
      context,
      links,
      targetAgent: "codex",
      validationCommands: ["pnpm typecheck", "pnpm test"]
    });

    expect(result.taskId).toBe("task.uc-generate-agent-task");
    expect(result.filePath).toBe("agent-tasks/task.uc-generate-agent-task.md");
    expect(result.sourceSpecIds).toEqual(["uc.generate-agent-task"]);
    expect(result.contextSpecIds).toEqual([
      "domain.spec-entity",
      "interface.spec-entity-service"
    ]);
    expect(result.markdown).toContain("type: agent_task");
    expect(result.markdown).toContain("target_agent: codex");
    expect(result.markdown).toContain("source_entity: uc.generate-agent-task");
    expect(result.markdown).toContain("generated_from:");
    expect(result.markdown).toContain("- uc.generate-agent-task");
    expect(result.markdown).toContain("uses:");
    expect(result.markdown).toContain("- domain.spec-entity");
    expect(result.markdown).toContain("- interface.spec-entity-service");
    expect(result.markdown).toContain("### Domain Entities");
    expect(result.markdown).toContain("A spec entity is one markdown document.");
    expect(result.markdown).toContain("### Interfaces");
    expect(result.markdown).toContain("Reads and writes spec entities.");
    expect(result.markdown).toContain("pnpm typecheck");
    expect(result.markdown).toContain("pnpm test");
  });

  it("uses editable guidance when source sections are missing", () => {
    const result = generateAgentTaskMarkdown({
      source: {
        ...source,
        bodyMarkdown: "# Generate Agent Task\n",
        bodyText: "Generate Agent Task"
      },
      context: [],
      links: [],
      targetAgent: "codex",
      validationCommands: []
    });

    expect(result.warnings).toContainEqual({
      code: "missing_source_sections",
      message: "Source spec does not include Goal, Requirements, or Acceptance Criteria sections.",
      entityId: "uc.generate-agent-task"
    });
    expect(result.markdown).toContain("- Add concrete implementation requirements before saving.");
    expect(result.markdown).toContain("pnpm typecheck");
    expect(result.markdown).toContain("pnpm test");
  });
});
```

- [ ] **Step 3: Run generator tests to verify they fail**

Run:

```bash
pnpm --filter @specops/taskgen test -- src/__tests__/generate.test.ts
```

Expected: FAIL because `../generate.js` and `../types.js` do not exist.

- [ ] **Step 4: Add generator types**

Create `packages/taskgen/src/types.ts`:

```ts
export type TaskgenEntity = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
};

export type TaskgenLink = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type AgentTaskGenerationWarning = {
  code: string;
  message: string;
  entityId?: string | null;
};

export type GenerateAgentTaskInput = {
  source: TaskgenEntity;
  context: TaskgenEntity[];
  links: TaskgenLink[];
  targetAgent: string;
  taskId?: string;
  title?: string;
  validationCommands: string[];
};

export type GenerateAgentTaskResult = {
  markdown: string;
  taskId: string;
  title: string;
  filePath: string;
  sourceSpecIds: string[];
  contextSpecIds: string[];
  warnings: AgentTaskGenerationWarning[];
};
```

- [ ] **Step 5: Add section extraction helpers**

Create `packages/taskgen/src/sections.ts`:

```ts
export type MarkdownSection = {
  title: string;
  content: string;
};

export function extractMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
      }

      currentTitle = heading[1].trim();
      currentLines = [];
      continue;
    }

    if (currentTitle) {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
  }

  return sections;
}

export function findSection(markdown: string, names: string[]): string | null {
  const normalizedNames = new Set(names.map(normalizeSectionName));
  const section = extractMarkdownSections(markdown).find((candidate) =>
    normalizedNames.has(normalizeSectionName(candidate.title))
  );

  return section?.content ? section.content : null;
}

export function firstNonEmptySection(markdown: string, names: string[]): string | null {
  return findSection(markdown, names);
}

function normalizeSectionName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}
```

- [ ] **Step 6: Implement generator**

Create `packages/taskgen/src/generate.ts`:

```ts
import { stringify } from "yaml";

import { defaultAgentTaskFilePath, defaultAgentTaskId } from "./id.js";
import { firstNonEmptySection } from "./sections.js";
import type {
  AgentTaskGenerationWarning,
  GenerateAgentTaskInput,
  GenerateAgentTaskResult,
  TaskgenEntity
} from "./types.js";

const fallbackValidationCommands = ["pnpm typecheck", "pnpm test"];

const typeGroupOrder = [
  ["use_case", "Use Cases"],
  ["domain_entity", "Domain Entities"],
  ["data_model", "Data Models"],
  ["interface", "Interfaces"],
  ["ui_view", "UI Views"],
  ["adr", "ADRs"],
  ["source_file", "Source Files"]
] as const;

export function generateAgentTaskMarkdown(
  input: GenerateAgentTaskInput
): GenerateAgentTaskResult {
  const taskId = input.taskId ?? defaultAgentTaskId(input.source.entityId);
  const title = input.title ?? input.source.title;
  const context = dedupeEntities(input.context).sort(compareEntities);
  const contextSpecIds = context.map((entity) => entity.entityId);
  const validationCommands =
    input.validationCommands.length > 0 ? input.validationCommands : fallbackValidationCommands;
  const warnings: AgentTaskGenerationWarning[] = [];
  const sourceGoal = firstNonEmptySection(input.source.bodyMarkdown, [
    "Goal",
    "Objective",
    "Purpose"
  ]);
  const sourceRequirements = firstNonEmptySection(input.source.bodyMarkdown, [
    "Requirements",
    "Main Flow",
    "Validation"
  ]);
  const acceptanceCriteria = firstNonEmptySection(input.source.bodyMarkdown, [
    "Acceptance Criteria",
    "Validation",
    "Postconditions"
  ]);

  if (!sourceGoal && !sourceRequirements && !acceptanceCriteria) {
    warnings.push({
      code: "missing_source_sections",
      message: "Source spec does not include Goal, Requirements, or Acceptance Criteria sections.",
      entityId: input.source.entityId
    });
  }

  const frontmatter = stringify({
    id: taskId,
    type: "agent_task",
    title,
    status: "ready",
    target_agent: input.targetAgent,
    source_entity: input.source.entityId,
    links: {
      generated_from: [input.source.entityId],
      uses: contextSpecIds
    }
  }).trim();

  const markdown = [
    "---",
    frontmatter,
    "---",
    "",
    `# Task: ${title}`,
    "",
    "## Objective",
    "",
    sourceGoal ?? `Implement the behavior described by \`${input.source.entityId}\`.`,
    "",
    "## Source Specs",
    "",
    `- \`${input.source.entityId}\` - ${input.source.title}`,
    "",
    "## Context",
    "",
    renderContext(context),
    "",
    "## Requirements",
    "",
    sourceRequirements ?? "- Add concrete implementation requirements before saving.",
    "- Preserve the behavior described by the source specs.",
    "",
    "## Acceptance Criteria",
    "",
    acceptanceCriteria ?? "- Add acceptance criteria before saving when the source spec does not provide them.",
    "",
    "## Expected Files",
    "",
    "- Add expected files or modules before saving when known.",
    "",
    "## Do Not Change",
    "",
    "- Add out-of-scope files, behaviors, or modules before saving when relevant.",
    "",
    "## Validation Commands",
    "",
    "```bash",
    ...validationCommands,
    "```",
    ""
  ].join("\n");

  return {
    markdown,
    taskId,
    title,
    filePath: defaultAgentTaskFilePath(taskId),
    sourceSpecIds: [input.source.entityId],
    contextSpecIds,
    warnings
  };
}

function renderContext(entities: TaskgenEntity[]): string {
  const renderedGroups: string[] = [];
  const grouped = new Map<string, TaskgenEntity[]>();

  for (const entity of entities) {
    const items = grouped.get(entity.type) ?? [];
    items.push(entity);
    grouped.set(entity.type, items);
  }

  for (const [type, heading] of typeGroupOrder) {
    const items = grouped.get(type) ?? [];
    if (items.length > 0) {
      renderedGroups.push(renderContextGroup(heading, items));
      grouped.delete(type);
    }
  }

  const remaining = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [type, items] of remaining) {
    renderedGroups.push(renderContextGroup(labelForType(type), items));
  }

  return renderedGroups.join("\n\n") || "- No linked context specs were found.";
}

function renderContextGroup(heading: string, entities: TaskgenEntity[]): string {
  return [
    `### ${heading}`,
    "",
    ...entities.flatMap((entity) => [
      `- \`${entity.entityId}\` - ${entity.title}`,
      indentContextSnippet(entity)
    ])
  ].join("\n");
}

function indentContextSnippet(entity: TaskgenEntity): string {
  const snippet =
    firstNonEmptySection(entity.bodyMarkdown, ["Goal", "Definition", "Responsibility", "Purpose"]) ??
    entity.bodyText;
  const normalized = snippet.trim();

  if (!normalized) {
    return "  - Add details before saving if this context is needed.";
  }

  return normalized
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 6)
    .map((line) => `  ${line}`)
    .join("\n");
}

function dedupeEntities(entities: TaskgenEntity[]): TaskgenEntity[] {
  const seen = new Set<string>();
  const deduped: TaskgenEntity[] = [];

  for (const entity of entities) {
    if (seen.has(entity.entityId)) {
      continue;
    }

    seen.add(entity.entityId);
    deduped.push(entity);
  }

  return deduped;
}

function compareEntities(left: TaskgenEntity, right: TaskgenEntity): number {
  const leftType = typeRank(left.type);
  const rightType = typeRank(right.type);

  if (leftType !== rightType) {
    return leftType - rightType;
  }

  return left.entityId.localeCompare(right.entityId);
}

function typeRank(type: string): number {
  const index = typeGroupOrder.findIndex(([candidate]) => candidate === type);
  return index === -1 ? typeGroupOrder.length : index;
}

function labelForType(type: string): string {
  return type
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
```

- [ ] **Step 7: Export generator modules**

Modify `packages/taskgen/src/index.ts`:

```ts
export * from "./generate.js";
export * from "./id.js";
export * from "./sections.js";
export * from "./types.js";
```

- [ ] **Step 8: Run generator tests**

Run:

```bash
pnpm --filter @specops/taskgen test -- src/__tests__/generate.test.ts src/__tests__/id.test.ts
```

Expected: PASS.

- [ ] **Step 9: Typecheck taskgen**

Run:

```bash
pnpm --filter @specops/taskgen typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit generator**

Run:

```bash
git add packages/taskgen/package.json pnpm-lock.yaml packages/taskgen/src
git commit -m "feat: generate deterministic agent tasks"
```

## Task 4: API Agent Task Service

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/services/agent-task-service.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add API dependencies**

Modify `apps/api/package.json` dependencies to include `@specops/taskgen` and `yaml`:

```json
"@specops/taskgen": "workspace:*",
"yaml": "^2.6.1"
```

Run:

```bash
pnpm install
```

Expected: `apps/api` can import `@specops/taskgen` and `yaml`.

- [ ] **Step 2: Add route tests for preview and save service behavior**

Append these tests inside the existing `describeWithDb("database-backed routes", () => {` block in `apps/api/src/__tests__/routes.test.ts`, before `createProjectViaApi()`:

```ts
  it("previews an agent task with one-hop context", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "links:\n" +
        "  uses:\n" +
        "    - domain.spec-entity\n" +
        "---\n\n" +
        "# Generate Agent Task\n\n" +
        "## Goal\n\n" +
        "Generate a focused implementation prompt.\n"
    );
    await writeFile(
      path.join(project.specopsPath, "domain", "domain.spec-entity.md"),
      "---\n" +
        "id: domain.spec-entity\n" +
        "type: domain_entity\n" +
        "title: Spec Entity\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Spec Entity\n\n" +
        "## Definition\n\n" +
        "A spec entity is one indexed markdown document.\n"
    );
    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-tasks/preview`,
      payload: {
        sourceEntityId: "uc.generate-agent-task",
        targetAgent: "codex"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      taskId: "task.uc-generate-agent-task",
      title: "Generate Agent Task",
      filePath: "agent-tasks/task.uc-generate-agent-task.md",
      sourceSpecIds: ["uc.generate-agent-task"],
      contextSpecIds: ["domain.spec-entity"]
    });
    expect(response.json().markdown).toContain("source_entity: uc.generate-agent-task");
    expect(response.json().markdown).toContain("domain.spec-entity");
  });

  it("saves an edited agent task and rejects duplicate saves", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "use-cases", "uc.generate-agent-task.md"),
      "---\n" +
        "id: uc.generate-agent-task\n" +
        "type: use_case\n" +
        "title: Generate Agent Task\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Generate Agent Task\n"
    );
    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-tasks/preview`,
      payload: {
        sourceEntityId: "uc.generate-agent-task",
        targetAgent: "codex"
      }
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json() as {
      markdown: string;
      taskId: string;
      filePath: string;
    };

    const saveResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-tasks`,
      payload: preview
    });

    expect(saveResponse.statusCode).toBe(201);
    expect(saveResponse.json()).toMatchObject({
      entityId: "task.uc-generate-agent-task",
      type: "agent_task",
      filePath: "agent-tasks/task.uc-generate-agent-task.md"
    });
    await expect(
      readFile(path.join(project.specopsPath, "agent-tasks", "task.uc-generate-agent-task.md"), "utf8")
    ).resolves.toContain("type: agent_task");

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/agent-tasks`,
      payload: preview
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toMatchObject({
      error: { message: "Agent task markdown file already exists" }
    });
  });
```

- [ ] **Step 3: Run API tests to verify they fail**

Run with a test database:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: FAIL with 404 responses for `/agent-tasks/preview` or `/agent-tasks`.

- [ ] **Step 4: Implement agent task service**

Create `apps/api/src/services/agent-task-service.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  ProjectDto,
  SaveAgentTaskRequest,
  SaveAgentTaskResponse,
  SpecEntityDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { specEntities, specLinks } from "@specops/db";
import { parseSpecMarkdown } from "@specops/markdown";
import { generateAgentTaskMarkdown } from "@specops/taskgen";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { parse } from "yaml";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createIndexerService } from "./indexer-service.js";
import { createProjectService } from "./project-service.js";

const fallbackValidationCommands = ["pnpm typecheck", "pnpm test"];

export function createAgentTaskService(db: Db) {
  const projectService = createProjectService(db);
  const indexerService = createIndexerService(db);

  async function previewAgentTask(
    projectId: string,
    input: AgentTaskPreviewRequest
  ): Promise<AgentTaskPreviewResponse> {
    const project = await projectService.getProject(projectId);
    const source = await getEntity(projectId, input.sourceEntityId);
    const links = await getOneHopLinks(projectId, source.entityId);
    const contextIds = [...new Set(links.flatMap((link) => [link.fromEntityId, link.toEntityId]))].filter(
      (entityId) => entityId !== source.entityId
    );
    const context = contextIds.length > 0 ? await getEntities(projectId, contextIds) : [];
    const validationCommands = await readValidationCommands(project);

    return generateAgentTaskMarkdown({
      source: toTaskgenEntity(source),
      context: context.map(toTaskgenEntity),
      links: links.map((link) => ({
        fromEntityId: link.fromEntityId,
        toEntityId: link.toEntityId,
        linkType: link.linkType,
        source: link.source
      })),
      targetAgent: input.targetAgent,
      taskId: input.taskId,
      title: input.title,
      validationCommands
    });
  }

  async function saveAgentTask(
    projectId: string,
    input: SaveAgentTaskRequest
  ): Promise<SaveAgentTaskResponse> {
    const project = await projectService.getProject(projectId);
    validateAgentTaskMarkdown(input.markdown, input.taskId, input.filePath);
    const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
    await assertRealPathInsideDirectory(project.repoPath, specopsPath);
    const agentTasksPath = assertInsideDirectory(specopsPath, path.join(specopsPath, "agent-tasks"));
    await mkdir(agentTasksPath, { recursive: true });
    await assertExistingParentInsideDirectory(specopsPath, agentTasksPath);
    const targetPath = assertInsideDirectory(specopsPath, path.join(specopsPath, input.filePath));
    const targetParent = path.dirname(targetPath);

    if (!input.filePath.startsWith("agent-tasks/")) {
      throw new BadRequestError("Agent task file path must be under agent-tasks", {
        filePath: input.filePath
      });
    }

    await assertExistingParentInsideDirectory(specopsPath, targetParent);

    try {
      await writeFile(targetPath, input.markdown, { flag: "wx" });
    } catch (error) {
      if (isFileExistsError(error)) {
        throw new ConflictError("Agent task markdown file already exists", {
          filePath: input.filePath
        });
      }

      throw error;
    }

    await indexerService.indexProject(projectId);
    return getEntity(projectId, input.taskId);
  }

  async function getEntity(projectId: string, entityId: string): Promise<SpecEntityDto> {
    const [row] = await db
      .select()
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, entityId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError("Entity not found", { projectId, entityId });
    }

    return mapEntity(row);
  }

  async function getEntities(projectId: string, entityIds: string[]): Promise<SpecEntityDto[]> {
    const rows = await db
      .select()
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), inArray(specEntities.entityId, entityIds)))
      .orderBy(asc(specEntities.entityId));
    const byId = new Map(rows.map((row) => [row.entityId, mapEntity(row)]));

    return entityIds.flatMap((entityId) => {
      const entity = byId.get(entityId);
      return entity ? [entity] : [];
    });
  }

  async function getOneHopLinks(projectId: string, entityId: string) {
    return db
      .select()
      .from(specLinks)
      .where(
        and(
          eq(specLinks.projectId, projectId),
          or(eq(specLinks.fromEntityId, entityId), eq(specLinks.toEntityId, entityId))
        )
      )
      .orderBy(asc(specLinks.linkType), asc(specLinks.fromEntityId), asc(specLinks.toEntityId));
  }

  return {
    previewAgentTask,
    saveAgentTask
  };
}

async function readValidationCommands(project: ProjectDto): Promise<string[]> {
  const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
  const projectYamlPath = assertInsideDirectory(specopsPath, path.join(specopsPath, "project.yaml"));

  try {
    const content = await readFile(projectYamlPath, "utf8");
    const parsed = parse(content) as unknown;
    if (!isRecord(parsed)) {
      return fallbackValidationCommands;
    }

    const defaults = parsed.agent_task_defaults;
    if (!isRecord(defaults) || !Array.isArray(defaults.validation_commands)) {
      return fallbackValidationCommands;
    }

    const commands = defaults.validation_commands.filter(
      (command): command is string => typeof command === "string" && command.trim().length > 0
    );

    return commands.length > 0 ? commands : fallbackValidationCommands;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return fallbackValidationCommands;
    }

    throw error;
  }
}

function validateAgentTaskMarkdown(markdown: string, expectedTaskId: string, filePath: string) {
  const parsed = parseSpecMarkdown(filePath, markdown);

  if (parsed.messages.some((message) => message.level === "error") || !parsed.entity) {
    throw new BadRequestError("Invalid agent task markdown", { messages: parsed.messages });
  }

  if (parsed.entity.entityId !== expectedTaskId) {
    throw new BadRequestError("Agent task id mismatch", {
      expectedTaskId,
      receivedEntityId: parsed.entity.entityId
    });
  }

  if (parsed.entity.type !== "agent_task") {
    throw new BadRequestError("Agent task markdown must use type agent_task", {
      receivedType: parsed.entity.type
    });
  }

  if (typeof parsed.entity.frontmatter.source_entity !== "string") {
    throw new BadRequestError("Agent task markdown must include source_entity");
  }
}

function mapEntity(row: typeof specEntities.$inferSelect): SpecEntityDto {
  return {
    id: row.id,
    projectId: row.projectId,
    entityId: row.entityId,
    type: row.type,
    title: row.title,
    status: row.status,
    filePath: row.filePath,
    frontmatter: row.frontmatterJson as Record<string, unknown>,
    bodyMarkdown: row.bodyMarkdown,
    bodyText: row.bodyText,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toTaskgenEntity(entity: SpecEntityDto) {
  return {
    entityId: entity.entityId,
    type: entity.type,
    title: entity.title,
    status: entity.status,
    filePath: entity.filePath,
    frontmatter: entity.frontmatter,
    bodyMarkdown: entity.bodyMarkdown,
    bodyText: entity.bodyText
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isFileNotFoundError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
```

- [ ] **Step 5: Run typecheck for API service**

Run:

```bash
pnpm --filter api typecheck
```

Expected: PASS after imports and Drizzle query types compile.

- [ ] **Step 6: Commit API service**

Run:

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/services/agent-task-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add agent task service"
```

## Task 5: API Routes

**Files:**
- Create: `apps/api/src/routes/agent-tasks.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add agent task routes**

Create `apps/api/src/routes/agent-tasks.ts`:

```ts
import {
  agentTaskPreviewRequestSchema,
  saveAgentTaskRequestSchema
} from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAgentTaskService } from "../services/agent-task-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const registerAgentTaskRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const agentTaskService = createAgentTaskService(db);

  app.post("/projects/:projectId/agent-tasks/preview", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = agentTaskPreviewRequestSchema.parse(request.body);
    return agentTaskService.previewAgentTask(projectId, input);
  });

  app.post("/projects/:projectId/agent-tasks", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = saveAgentTaskRequestSchema.parse(request.body);
    const entity = await agentTaskService.saveAgentTask(projectId, input);
    return reply.code(201).send(entity);
  });
};
```

- [ ] **Step 2: Register routes in server**

Modify `apps/api/src/server.ts`:

```ts
import cors from "@fastify/cors";
import { createDb } from "@specops/db";
import Fastify from "fastify";
import { ZodError } from "zod";

import { isHttpError } from "./lib/http-errors.js";
import { registerAgentTaskRoutes } from "./routes/agent-tasks.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerIndexRunRoutes } from "./routes/index-runs.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerValidationRoutes } from "./routes/validation.js";

export function buildServer(databaseUrl: string) {
  const app = Fastify({ logger: true });
  const db = createDb(databaseUrl);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "bad_request",
          message: "Invalid request",
          details: error.flatten()
        }
      });
      return;
    }

    if (isHttpError(error)) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      });
      return;
    }

    const statusCode = readStatusCode(error);
    reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "internal_error" : "bad_request",
        message: error instanceof Error ? error.message : "Unexpected error"
      }
    });
  });

  app.addHook("onClose", async () => {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.register(registerProjectRoutes, { prefix: "/api", db });
  app.register(registerEntityRoutes, { prefix: "/api", db });
  app.register(registerAgentTaskRoutes, { prefix: "/api", db });
  app.register(registerSearchRoutes, { prefix: "/api", db });
  app.register(registerValidationRoutes, { prefix: "/api", db });
  app.register(registerIndexRunRoutes, { prefix: "/api", db });

  return app;
}

function readStatusCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return 500;
}
```

- [ ] **Step 3: Run route tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: PASS for the new preview and save tests.

- [ ] **Step 4: Commit routes**

Run:

```bash
git add apps/api/src/routes/agent-tasks.ts apps/api/src/server.ts
git commit -m "feat: expose agent task routes"
```

## Task 6: Web Client Helpers

**Files:**
- Modify: `apps/web/src/api/queries.ts`

- [ ] **Step 1: Add API client types and functions**

Modify imports at the top of `apps/web/src/api/queries.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import type {
  AgentTaskPreviewRequest,
  AgentTaskPreviewResponse,
  CreateEntityRequest,
  CreateProjectRequest,
  IndexRunDto,
  ProjectDto,
  SaveAgentTaskRequest,
  SaveAgentTaskResponse,
  SpecEntityDto,
  SpecLinkDto,
  ValidationMessageDto
} from "@specops/contracts";
```

Add query key and mutations:

```ts
export const queryKeys = {
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  entities: (projectId: string) => ["projects", projectId, "entities"] as const,
  entity: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId] as const,
  outgoingLinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "outgoing-links"] as const,
  backlinks: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "backlinks"] as const,
  validation: (projectId: string) => ["projects", projectId, "validation-messages"] as const,
  indexRuns: (projectId: string) => ["projects", projectId, "index-runs"] as const,
  search: (projectId: string, query: string) => ["projects", projectId, "search", query] as const,
  agentTaskPreview: (projectId: string, sourceEntityId: string) =>
    ["projects", projectId, "agent-tasks", "preview", sourceEntityId] as const
};
```

Append:

```ts
export function previewAgentTask(projectId: string, input: AgentTaskPreviewRequest) {
  return apiSend<AgentTaskPreviewResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-tasks/preview`,
    input
  );
}

export function saveAgentTask(projectId: string, input: SaveAgentTaskRequest) {
  return apiSend<SaveAgentTaskResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/agent-tasks`,
    input
  );
}
```

- [ ] **Step 2: Typecheck web client**

Run:

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit web client helpers**

Run:

```bash
git add apps/web/src/api/queries.ts
git commit -m "feat: add agent task web client"
```

## Task 7: Web Preview State Helpers

**Files:**
- Create: `apps/web/src/components/agent-task-preview-state.ts`
- Test: `apps/web/src/components/agent-task-preview-state.test.ts`

- [ ] **Step 1: Write preview state tests**

Create `apps/web/src/components/agent-task-preview-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  defaultTargetAgent,
  suggestedTaskIdForSource,
  taskPreviewHasChanges
} from "./agent-task-preview-state.js";

describe("agent task preview state helpers", () => {
  it("uses codex as the initial target agent", () => {
    expect(defaultTargetAgent()).toBe("codex");
  });

  it("suggests an editable task id from the source entity id", () => {
    expect(suggestedTaskIdForSource("uc.generate-agent-task")).toBe(
      "task.uc-generate-agent-task"
    );
  });

  it("detects edited preview markdown", () => {
    expect(taskPreviewHasChanges("original", "changed")).toBe(true);
    expect(taskPreviewHasChanges("same", "same")).toBe(false);
  });
});
```

- [ ] **Step 2: Run state tests to verify they fail**

Run:

```bash
pnpm --filter web test -- src/components/agent-task-preview-state.test.ts
```

Expected: FAIL because `agent-task-preview-state.js` does not exist.

- [ ] **Step 3: Add preview state helpers**

Create `apps/web/src/components/agent-task-preview-state.ts`:

```ts
export function defaultTargetAgent(): string {
  return "codex";
}

export function suggestedTaskIdForSource(sourceEntityId: string): string {
  return `task.${sourceEntityId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")}`;
}

export function taskPreviewHasChanges(originalMarkdown: string, currentMarkdown: string): boolean {
  return originalMarkdown !== currentMarkdown;
}
```

- [ ] **Step 4: Run state tests**

Run:

```bash
pnpm --filter web test -- src/components/agent-task-preview-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit state helpers**

Run:

```bash
git add apps/web/src/components/agent-task-preview-state.ts apps/web/src/components/agent-task-preview-state.test.ts
git commit -m "feat: add task preview state helpers"
```

## Task 8: Web Preview Component

**Files:**
- Create: `apps/web/src/components/agent-task-preview.tsx`

- [ ] **Step 1: Add editable preview component**

Create `apps/web/src/components/agent-task-preview.tsx`:

```tsx
import type { AgentTaskPreviewResponse } from "@specops/contracts";
import { Copy, Save, X } from "lucide-react";
import { useMemo, useState } from "react";

import { MarkdownEditor } from "./markdown-editor.js";
import { taskPreviewHasChanges } from "./agent-task-preview-state.js";

type AgentTaskPreviewProps = {
  preview: AgentTaskPreviewResponse;
  originalMarkdown: string;
  isSaving: boolean;
  saveError: string | null;
  onMarkdownChange: (markdown: string) => void;
  onSave: () => void;
  onClose: () => void;
};

export function AgentTaskPreview({
  preview,
  originalMarkdown,
  isSaving,
  saveError,
  onMarkdownChange,
  onSave,
  onClose
}: AgentTaskPreviewProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const hasChanges = useMemo(
    () => taskPreviewHasChanges(originalMarkdown, preview.markdown),
    [originalMarkdown, preview.markdown]
  );

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(preview.markdown);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="overflow-hidden rounded border border-slate-200 bg-white">
      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">Agent Task Preview</h3>
          <p className="truncate text-xs text-slate-500">
            {preview.taskId} / {preview.filePath}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="button-secondary" onClick={copyMarkdown}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy
          </button>
          <button type="button" className="button-primary" disabled={isSaving} onClick={onSave}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save Task
          </button>
          <button type="button" className="button-secondary" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            Close
          </button>
        </div>
      </div>

      {preview.warnings.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <ul className="grid gap-1">
            {preview.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.entityId ?? "project"}`}>
                <span className="font-medium">{warning.code}</span>: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <MarkdownEditor
        value={preview.markdown}
        onChange={(value) => {
          setCopyStatus("idle");
          onMarkdownChange(value);
        }}
      />

      <div className="flex items-center gap-3 border-t border-slate-200 p-3 text-xs text-slate-500">
        <span>{hasChanges ? "Edited preview" : "Generated preview"}</span>
        {copyStatus === "copied" ? <span>Copied</span> : null}
        {copyStatus === "failed" ? <span className="text-red-700">Copy failed</span> : null}
        {saveError ? <span className="text-red-700">{saveError}</span> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck web component**

Run:

```bash
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit preview component**

Run:

```bash
git add apps/web/src/components/agent-task-preview.tsx
git commit -m "feat: add agent task preview component"
```

## Task 9: Wire Preview Into Entity Detail

**Files:**
- Modify: `apps/web/src/components/entity-detail.tsx`

- [ ] **Step 1: Add task metadata controls and generate action to entity detail**

Modify imports in `apps/web/src/components/entity-detail.tsx`:

```tsx
import type { AgentTaskPreviewResponse } from "@specops/contracts";
import { Bot, Save } from "lucide-react";
```

Add query helpers to the existing import from `../api/queries.js`:

```tsx
  previewAgentTask,
  saveAgentTask,
```

Import the preview component and state helper:

```tsx
import { AgentTaskPreview } from "./agent-task-preview.js";
import { defaultTargetAgent, suggestedTaskIdForSource } from "./agent-task-preview-state.js";
```

Inside `EntityDetail`, add state:

```tsx
  const [taskPreview, setTaskPreview] = useState<AgentTaskPreviewResponse | null>(null);
  const [taskPreviewOriginalMarkdown, setTaskPreviewOriginalMarkdown] = useState<string>("");
  const [taskTargetAgent, setTaskTargetAgent] = useState(defaultTargetAgent());
  const [taskId, setTaskId] = useState(() => suggestedTaskIdForSource(entityId));
  const [taskTitle, setTaskTitle] = useState("");
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
```

Reset these fields when the selected entity changes:

```tsx
  useEffect(() => {
    setTaskPreview(null);
    setTaskPreviewOriginalMarkdown("");
    setTaskTargetAgent(defaultTargetAgent());
    setTaskId(suggestedTaskIdForSource(entityId));
    setTaskTitle("");
    setTaskSaveError(null);
  }, [entityId]);
```

Add mutations after the existing markdown save mutation:

```tsx
  const previewTaskMutation = useMutation({
    mutationFn: () =>
      previewAgentTask(projectId, {
        sourceEntityId: entityId,
        targetAgent: taskTargetAgent.trim() || defaultTargetAgent(),
        taskId: taskId.trim() || undefined,
        title: taskTitle.trim() || undefined
      }),
    onSuccess: (preview) => {
      setTaskPreview(preview);
      setTaskPreviewOriginalMarkdown(preview.markdown);
      setTaskId(preview.taskId);
      setTaskTitle(preview.title);
      setTaskSaveError(null);
    }
  });

  const saveTaskMutation = useMutation({
    mutationFn: (preview: AgentTaskPreviewResponse) =>
      saveAgentTask(projectId, {
        markdown: preview.markdown,
        taskId: preview.taskId,
        filePath: preview.filePath
      }),
    onSuccess: async (savedTask) => {
      setTaskPreview(null);
      setTaskPreviewOriginalMarkdown("");
      setTaskSaveError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.entity(projectId, savedTask.entityId) })
      ]);
    },
    onError: (error) => {
      setTaskSaveError(error instanceof Error ? error.message : "Failed to save agent task");
    }
  });
```

Add controls and the button before Save in the entity header action area:

```tsx
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              <input
                className="input h-9"
                value={taskTargetAgent}
                aria-label="Target agent"
                onChange={(event) => setTaskTargetAgent(event.target.value)}
              />
              <input
                className="input h-9"
                value={taskId}
                aria-label="Task ID"
                onChange={(event) => setTaskId(event.target.value)}
              />
              <input
                className="input h-9"
                value={taskTitle}
                placeholder={entity.data.title}
                aria-label="Task title"
                onChange={(event) => setTaskTitle(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="button-secondary"
              disabled={previewTaskMutation.isPending}
              onClick={() => previewTaskMutation.mutate()}
            >
              <Bot className="h-4 w-4" aria-hidden="true" />
              Generate Task
            </button>
```

Add preview rendering above `LinkPanels`:

```tsx
      {previewTaskMutation.error ? (
        <p className="text-sm text-red-700">{previewTaskMutation.error.message}</p>
      ) : null}

      {taskPreview ? (
        <AgentTaskPreview
          preview={taskPreview}
          originalMarkdown={taskPreviewOriginalMarkdown}
          isSaving={saveTaskMutation.isPending}
          saveError={taskSaveError}
          onMarkdownChange={(markdown) => {
            setTaskSaveError(null);
            setTaskPreview({ ...taskPreview, markdown });
          }}
          onSave={() => saveTaskMutation.mutate(taskPreview)}
          onClose={() => {
            setTaskPreview(null);
            setTaskPreviewOriginalMarkdown("");
            setTaskSaveError(null);
          }}
        />
      ) : null}
```

- [ ] **Step 2: Run web typecheck and tests**

Run:

```bash
pnpm --filter web typecheck
pnpm --filter web test
```

Expected: PASS.

- [ ] **Step 3: Commit web integration**

Run:

```bash
git add apps/web/src/components/agent-task-preview.tsx apps/web/src/components/entity-detail.tsx
git commit -m "feat: wire agent task preview UI"
```

## Task 10: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run workspace typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run workspace tests without DB**

Run:

```bash
pnpm test
```

Expected: PASS. DB-backed API tests may be skipped when `TEST_DATABASE_URL` is absent.

- [ ] **Step 3: Run DB-backed API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test pnpm --filter api test -- src/__tests__/routes.test.ts
```

Expected: PASS with preview and save route tests included. If PostgreSQL is not running, start it with `docker compose up -d postgres` and create the `specops_test` database before rerunning.

- [ ] **Step 4: Build web app**

Run:

```bash
pnpm --filter web build
```

Expected: PASS. Vite may warn that a chunk is larger than 500 kB; that warning already exists and does not block this milestone.

- [ ] **Step 5: Commit verification-only fixes if needed**

If any command exposes a small integration issue, fix the targeted file and commit only the files changed for that verification issue. For example, if the fix is in `apps/api/src/services/agent-task-service.ts`, run:

```bash
git add apps/api/src/services/agent-task-service.ts
git commit -m "fix: stabilize agent task generation"
```

Expected: no commit is created when all verification commands pass without code changes.
