# Change Impact Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a spec-first Change Impact Preview page that combines graph impact, grouped specs, grouped source evidence, relevant validation messages, related agent tasks, and task generation.

**Architecture:** Add shared DTO contracts first, then implement a backend composition service that reuses `impact-service` traversal and gathers secondary indexed data. The web app adds a dedicated route that reuses `ImpactGraph`, renders a tabbed preview panel, and calls the existing agent task preview/save flow with impacted context IDs.

**Tech Stack:** TypeScript, Zod contracts, Fastify routes, Drizzle/PostgreSQL, React, TanStack Router, TanStack Query, Vitest, happy-dom, Tailwind CSS, lucide-react.

---

## File Structure

- Create `packages/contracts/src/change-impact.ts`: Zod schemas and DTO types for the preview endpoint.
- Modify `packages/contracts/src/index.ts`: export the new contracts.
- Modify `packages/contracts/src/agent-tasks.ts`: add `impactedContextEntityIds?: string[]` to task preview input.
- Create `apps/api/src/services/change-impact-preview-service.ts`: compose impact traversal, validation messages, related tasks, groups, overview, and task seed.
- Create `apps/api/src/__tests__/change-impact-preview-service.test.ts`: pure service tests for grouping, filtering, ordering, and task seed behavior.
- Modify `apps/api/src/routes/entities.ts`: register the preview endpoint under existing entity routes.
- Modify `apps/api/src/services/agent-task-service.ts`: include explicit impacted context IDs in deterministic task preview context.
- Modify `apps/api/src/__tests__/routes.test.ts`: add DB-backed route coverage for the preview endpoint.
- Modify `apps/web/src/api/queries.ts`: add query key, API query, and existing preview task type support.
- Create `apps/web/src/components/change-impact-preview-panel.tsx`: tabbed right-side preview panel.
- Create `apps/web/src/components/change-impact-preview-panel.test.tsx`: component coverage for tab content and empty states.
- Create `apps/web/src/routes/change-impact.tsx`: route page with toolbar, graph, panel, and task preview/save flow.
- Create `apps/web/src/routes/change-impact.test.tsx`: page coverage for rendering, controls, graph selection, and task CTA.
- Modify `apps/web/src/app.tsx`: register `/projects/$projectId/change-impact/$entityId`.
- Modify `apps/web/src/components/entity-detail.tsx`: add `Preview Change Impact` action.
- Modify `apps/web/src/components/entity-detail.test.tsx`: verify the new action link.

---

### Task 1: Shared Contracts

**Files:**
- Create: `packages/contracts/src/change-impact.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/agent-tasks.ts`

- [ ] **Step 1: Extend the agent task preview request contract**

In `packages/contracts/src/agent-tasks.ts`, change `agentTaskPreviewRequestSchema` to include deterministic impact context IDs:

```ts
export const agentTaskPreviewRequestSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetAgent: z.string().min(1).default("codex"),
  taskId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  impactedContextEntityIds: z.array(z.string().min(1)).default([])
});
```

- [ ] **Step 2: Create the change impact contract file**

Create `packages/contracts/src/change-impact.ts`:

```ts
import { z } from "zod";

import { agentTaskPreviewRequestSchema } from "./agent-tasks.js";
import {
  entityImpactQuerySchema,
  entityImpactResponseSchema,
  impactEntitySummarySchema,
  impactPathSchema,
  impactSourceEvidenceSchema
} from "./impact.js";
import { validationMessageSchema } from "./validation.js";

export const changeImpactDirectionSchema = z.enum(["root", "upstream", "downstream"]);

export const changeImpactSpecSummarySchema = impactEntitySummarySchema.extend({
  direction: changeImpactDirectionSchema,
  distance: z.number().int().nonnegative()
});

export const changeImpactSpecGroupSchema = z.object({
  direction: changeImpactDirectionSchema,
  type: z.string(),
  specs: z.array(changeImpactSpecSummarySchema)
});

export const changeImpactSourceSymbolSchema = impactSourceEvidenceSchema;

export const changeImpactSourceGroupSchema = z.object({
  filePath: z.string(),
  symbols: z.array(changeImpactSourceSymbolSchema)
});

export const changeImpactRelatedTaskSchema = impactEntitySummarySchema.extend({
  linkTypes: z.array(z.string())
});

export const changeImpactSectionWarningSchema = z.object({
  section: z.enum(["validation", "tasks", "source"]),
  message: z.string().min(1)
});

export const changeImpactOverviewSchema = z.object({
  impactedSpecCount: z.number().int().nonnegative(),
  upstreamSpecCount: z.number().int().nonnegative(),
  downstreamSpecCount: z.number().int().nonnegative(),
  sourceFileCount: z.number().int().nonnegative(),
  sourceSymbolCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  relatedTaskCount: z.number().int().nonnegative(),
  shortestPaths: z.array(impactPathSchema)
});

export const changeImpactPreviewResponseSchema = z.object({
  rootEntity: impactEntitySummarySchema,
  impact: entityImpactResponseSchema,
  overview: changeImpactOverviewSchema,
  impactedSpecs: z.array(changeImpactSpecGroupSchema),
  sourceGroups: z.array(changeImpactSourceGroupSchema),
  validationMessages: z.array(validationMessageSchema),
  relatedTasks: z.array(changeImpactRelatedTaskSchema),
  taskSeed: agentTaskPreviewRequestSchema,
  sectionWarnings: z.array(changeImpactSectionWarningSchema)
});

export const changeImpactPreviewQuerySchema = entityImpactQuerySchema;

export type ChangeImpactPreviewQuery = z.infer<typeof changeImpactPreviewQuerySchema>;
export type ChangeImpactSpecSummaryDto = z.infer<typeof changeImpactSpecSummarySchema>;
export type ChangeImpactSpecGroupDto = z.infer<typeof changeImpactSpecGroupSchema>;
export type ChangeImpactSourceGroupDto = z.infer<typeof changeImpactSourceGroupSchema>;
export type ChangeImpactRelatedTaskDto = z.infer<typeof changeImpactRelatedTaskSchema>;
export type ChangeImpactPreviewResponseDto = z.infer<typeof changeImpactPreviewResponseSchema>;
```

- [ ] **Step 3: Export the new contracts**

In `packages/contracts/src/index.ts`, add:

```ts
export * from "./change-impact.js";
```

- [ ] **Step 4: Run focused contract typecheck**

Run:

```bash
pnpm --filter @specops/contracts typecheck
```

Expected: exits with code `0`.

- [ ] **Step 5: Commit contracts**

```bash
git add packages/contracts/src/agent-tasks.ts packages/contracts/src/change-impact.ts packages/contracts/src/index.ts
git commit -m "feat: add change impact preview contracts"
```

---

### Task 2: Backend Preview Composition

**Files:**
- Create: `apps/api/src/services/change-impact-preview-service.ts`
- Create: `apps/api/src/__tests__/change-impact-preview-service.test.ts`
- Modify: `apps/api/src/routes/entities.ts`

- [ ] **Step 1: Write failing pure service tests**

Create `apps/api/src/__tests__/change-impact-preview-service.test.ts` with these cases:

```ts
import type {
  EntityImpactResponseDto,
  ValidationMessageDto
} from "@specops/contracts";
import { describe, expect, it } from "vitest";

import { buildChangeImpactPreview } from "../services/change-impact-preview-service.js";

describe("buildChangeImpactPreview", () => {
  it("groups impacted specs, source evidence, warnings, tasks, and task seed deterministically", () => {
    const preview = buildChangeImpactPreview({
      impact: impactResponse(),
      validationMessages: [
        validation("warning", "source_spec_missing_entity", "src/domain.ts", null),
        validation("error", "missing_link", null, "domain.policy"),
        validation("info", "unrelated", "src/other.ts", "domain.other")
      ],
      relatedTaskLinks: [
        taskLink("task.domain-decision", "domain.decision", "generated_from"),
        taskLink("task.domain-decision", "domain.policy", "uses")
      ],
      taskEntities: [
        entity("task.domain-decision", "Decision Task", "agent_task"),
        entity("task.unrelated", "Other Task", "agent_task")
      ],
      sectionWarnings: []
    });

    expect(preview.overview).toMatchObject({
      impactedSpecCount: 3,
      upstreamSpecCount: 1,
      downstreamSpecCount: 1,
      sourceFileCount: 1,
      sourceSymbolCount: 1,
      warningCount: 2,
      relatedTaskCount: 1
    });
    expect(preview.impactedSpecs.map((group) => `${group.direction}:${group.type}`)).toEqual([
      "root:domain_entity",
      "upstream:domain_entity",
      "downstream:domain_entity"
    ]);
    expect(preview.sourceGroups).toEqual([
      {
        filePath: "src/domain.ts",
        symbols: [
          {
            entityId: "domain.decision",
            filePath: "src/domain.ts",
            sourceFileId: "source-file-1",
            symbolName: "Decision",
            symbolKind: "interface",
            symbolLine: 3,
            annotationLine: 2
          }
        ]
      }
    ]);
    expect(preview.validationMessages.map((message) => message.code)).toEqual([
      "missing_link",
      "source_spec_missing_entity"
    ]);
    expect(preview.relatedTasks).toEqual([
      expect.objectContaining({
        entityId: "task.domain-decision",
        linkTypes: ["generated_from", "uses"]
      })
    ]);
    expect(preview.taskSeed).toEqual({
      sourceEntityId: "domain.decision",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.outcome", "domain.policy"]
    });
  });
});

function impactResponse(): EntityImpactResponseDto {
  return {
    rootEntity: entity("domain.decision", "Decision", "domain_entity"),
    nodes: [
      { id: "spec:domain.decision", kind: "spec", label: "Decision", ...entity("domain.decision", "Decision", "domain_entity") },
      { id: "spec:domain.policy", kind: "spec", label: "Policy", ...entity("domain.policy", "Policy", "domain_entity") },
      { id: "spec:domain.outcome", kind: "spec", label: "Outcome", ...entity("domain.outcome", "Outcome", "domain_entity") },
      {
        id: "source:src/domain.ts:source-file-1:Decision:3:2:domain.decision",
        kind: "source",
        label: "Decision",
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 3,
        annotationLine: 2
      }
    ],
    edges: [],
    upstreamPaths: [
      {
        direction: "upstream",
        entityIds: ["domain.policy", "domain.decision"],
        steps: [
          entity("domain.policy", "Policy", "domain_entity"),
          entity("domain.decision", "Decision", "domain_entity")
        ],
        linkTypes: ["uses"]
      }
    ],
    downstreamPaths: [
      {
        direction: "downstream",
        entityIds: ["domain.decision", "domain.outcome"],
        steps: [
          entity("domain.decision", "Decision", "domain_entity"),
          entity("domain.outcome", "Outcome", "domain_entity")
        ],
        linkTypes: ["produces"]
      }
    ],
    sourceEvidence: [
      {
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        sourceFileId: "source-file-1",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 3,
        annotationLine: 2
      }
    ],
    truncated: { isTruncated: false, reason: null, nodeCount: 4, edgeCount: 2, sourceEvidenceCount: 1 }
  };
}

function entity(entityId: string, title: string, type: string) {
  return { entityId, type, title, status: "draft", filePath: `${entityId.replace(".", "/")}.md` };
}

function validation(
  level: ValidationMessageDto["level"],
  code: string,
  filePath: string | null,
  entityId: string | null
): ValidationMessageDto {
  return {
    id: code,
    projectId: "project-1",
    indexRunId: null,
    filePath,
    entityId,
    level,
    code,
    message: code,
    createdAt: "2026-05-10T00:00:00.000Z"
  };
}

function taskLink(fromEntityId: string, toEntityId: string, linkType: string) {
  return { fromEntityId, toEntityId, linkType };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter api test -- change-impact-preview-service
```

Expected: FAIL because `change-impact-preview-service.ts` does not exist.

- [ ] **Step 3: Implement pure builder and DB service**

Create `apps/api/src/services/change-impact-preview-service.ts`:

```ts
import type {
  ChangeImpactPreviewResponseDto,
  EntityImpactQuery,
  EntityImpactResponseDto,
  ImpactEntitySummaryDto,
  ValidationMessageDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { specEntities, specLinks, validationMessages } from "@specops/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { createImpactService } from "./impact-service.js";

type RelatedTaskLink = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
};

type SectionWarning = ChangeImpactPreviewResponseDto["sectionWarnings"][number];

export function createChangeImpactPreviewService(db: Db) {
  const impactService = createImpactService(db);

  return {
    async getChangeImpactPreview(input: {
      projectId: string;
      entityId: string;
      query: EntityImpactQuery;
    }): Promise<ChangeImpactPreviewResponseDto> {
      const impact = await impactService.getEntityImpact({
        projectId: input.projectId,
        entityId: input.entityId,
        depth: input.query.depth,
        direction: input.query.direction,
        includeSource: input.query.includeSource
      });
      const impactedEntityIds = specEntityIdsFromImpact(impact);
      const sourceFilePaths = [...new Set(impact.sourceEvidence.map((evidence) => evidence.filePath))];
      const [validationRows, relatedTaskLinks] = await Promise.all([
        db
          .select()
          .from(validationMessages)
          .where(eq(validationMessages.projectId, input.projectId))
          .orderBy(
            asc(validationMessages.level),
            asc(validationMessages.entityId),
            asc(validationMessages.filePath),
            asc(validationMessages.message)
          ),
        getRelatedTaskLinks(db, input.projectId, impactedEntityIds)
      ]);
      const taskEntityIds = [...new Set(relatedTaskLinks.map((link) => link.fromEntityId))].sort();
      const taskEntities =
        taskEntityIds.length > 0
          ? await db
              .select()
              .from(specEntities)
              .where(
                and(
                  eq(specEntities.projectId, input.projectId),
                  eq(specEntities.type, "agent_task"),
                  inArray(specEntities.entityId, taskEntityIds)
                )
              )
              .orderBy(asc(specEntities.entityId))
          : [];

      return buildChangeImpactPreview({
        impact,
        validationMessages: validationRows.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          indexRunId: row.indexRunId,
          filePath: row.filePath,
          entityId: row.entityId,
          level: row.level as ValidationMessageDto["level"],
          code: row.code,
          message: row.message,
          createdAt: row.createdAt.toISOString()
        })),
        relatedTaskLinks,
        taskEntities: taskEntities.map((row) => ({
          entityId: row.entityId,
          type: row.type,
          title: row.title,
          status: row.status,
          filePath: row.filePath
        })),
        sectionWarnings: sourceFilePaths.length === 0 ? [] : []
      });
    }
  };
}

export function buildChangeImpactPreview(input: {
  impact: EntityImpactResponseDto;
  validationMessages: ValidationMessageDto[];
  relatedTaskLinks: RelatedTaskLink[];
  taskEntities: ImpactEntitySummaryDto[];
  sectionWarnings: SectionWarning[];
}): ChangeImpactPreviewResponseDto {
  const impactedIds = specEntityIdsFromImpact(input.impact);
  const sourceFilePaths = new Set(input.impact.sourceEvidence.map((evidence) => evidence.filePath));
  const validation = input.validationMessages
    .filter(
      (message) =>
        (message.entityId !== null && impactedIds.includes(message.entityId)) ||
        (message.filePath !== null && sourceFilePaths.has(message.filePath))
    )
    .sort(compareValidationMessages);
  const relatedTasks = buildRelatedTasks(input.relatedTaskLinks, input.taskEntities);
  const impactedSpecs = buildSpecGroups(input.impact);
  const sourceGroups = buildSourceGroups(input.impact);

  return {
    rootEntity: input.impact.rootEntity,
    impact: input.impact,
    overview: {
      impactedSpecCount: impactedIds.length,
      upstreamSpecCount: countDirection(impactedSpecs, "upstream"),
      downstreamSpecCount: countDirection(impactedSpecs, "downstream"),
      sourceFileCount: sourceGroups.length,
      sourceSymbolCount: input.impact.sourceEvidence.length,
      warningCount: validation.length,
      relatedTaskCount: relatedTasks.length,
      shortestPaths: shortestPaths(input.impact)
    },
    impactedSpecs,
    sourceGroups,
    validationMessages: validation,
    relatedTasks,
    taskSeed: {
      sourceEntityId: input.impact.rootEntity.entityId,
      targetAgent: "codex",
      impactedContextEntityIds: impactedIds.filter((entityId) => entityId !== input.impact.rootEntity.entityId)
    },
    sectionWarnings: input.sectionWarnings
  };
}
```

Add helper functions in the same file:

```ts
async function getRelatedTaskLinks(db: Db, projectId: string, impactedEntityIds: string[]) {
  if (impactedEntityIds.length === 0) return [];

  return db
    .select({
      fromEntityId: specLinks.fromEntityId,
      toEntityId: specLinks.toEntityId,
      linkType: specLinks.linkType
    })
    .from(specLinks)
    .where(
      and(
        eq(specLinks.projectId, projectId),
        inArray(specLinks.toEntityId, impactedEntityIds),
        inArray(specLinks.linkType, ["generated_from", "uses"])
      )
    )
    .orderBy(asc(specLinks.fromEntityId), asc(specLinks.linkType), asc(specLinks.toEntityId));
}
```

Implement the local grouping helpers used above:

```ts
function specEntityIdsFromImpact(impact: EntityImpactResponseDto) {
  return impact.nodes
    .filter((node) => node.kind === "spec")
    .map((node) => node.entityId)
    .sort((left, right) => left.localeCompare(right));
}

function buildSpecGroups(impact: EntityImpactResponseDto) {
  const specNodes = impact.nodes.filter((node) => node.kind === "spec");
  const upstream = distanceByEntity(impact.upstreamPaths);
  const downstream = distanceByEntity(impact.downstreamPaths);
  const rows = specNodes.map((node) => {
    const direction =
      node.entityId === impact.rootEntity.entityId
        ? "root"
        : upstream.has(node.entityId)
          ? "upstream"
          : "downstream";
    return {
      entityId: node.entityId,
      type: node.type,
      title: node.title,
      status: node.status,
      filePath: node.filePath,
      direction,
      distance:
        direction === "root"
          ? 0
          : direction === "upstream"
            ? upstream.get(node.entityId) ?? 0
            : downstream.get(node.entityId) ?? 0
    } as const;
  });
  const groups = new Map<string, typeof rows>();

  for (const row of rows.sort(compareSpecRows)) {
    const key = `${row.direction}:${row.type}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()].map(([key, specs]) => {
    const [direction, type] = key.split(":");
    return { direction: direction as "root" | "upstream" | "downstream", type, specs };
  });
}

function buildSourceGroups(impact: EntityImpactResponseDto) {
  const groups = new Map<string, typeof impact.sourceEvidence>();

  for (const evidence of [...impact.sourceEvidence].sort(compareSourceEvidence)) {
    groups.set(evidence.filePath, [...(groups.get(evidence.filePath) ?? []), evidence]);
  }

  return [...groups.entries()].map(([filePath, symbols]) => ({ filePath, symbols }));
}

function buildRelatedTasks(links: RelatedTaskLink[], tasks: ImpactEntitySummaryDto[]) {
  const tasksById = new Map(tasks.map((task) => [task.entityId, task]));
  const linkTypesByTask = new Map<string, Set<string>>();

  for (const link of links) {
    if (!tasksById.has(link.fromEntityId)) continue;
    linkTypesByTask.set(link.fromEntityId, linkTypesByTask.get(link.fromEntityId) ?? new Set());
    linkTypesByTask.get(link.fromEntityId)!.add(link.linkType);
  }

  return [...linkTypesByTask.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityId, linkTypes]) => ({ ...tasksById.get(entityId)!, linkTypes: [...linkTypes].sort() }));
}
```

Complete the helper set:

```ts
function distanceByEntity(paths: EntityImpactResponseDto["upstreamPaths"]) {
  const result = new Map<string, number>();

  for (const path of paths) {
    path.entityIds.forEach((entityId, index) => {
      const distance = path.direction === "upstream" ? path.entityIds.length - index - 1 : index;
      if (distance === 0) return;
      const current = result.get(entityId);
      if (current === undefined || distance < current) {
        result.set(entityId, distance);
      }
    });
  }

  return result;
}

function shortestPaths(impact: EntityImpactResponseDto) {
  return [...impact.upstreamPaths, ...impact.downstreamPaths]
    .sort((left, right) => left.entityIds.length - right.entityIds.length || left.entityIds.join("|").localeCompare(right.entityIds.join("|")))
    .slice(0, 5);
}

function countDirection(groups: ReturnType<typeof buildSpecGroups>, direction: "upstream" | "downstream") {
  return groups.filter((group) => group.direction === direction).reduce((sum, group) => sum + group.specs.length, 0);
}

function compareSpecRows(a: { direction: string; type: string; distance: number; entityId: string }, b: { direction: string; type: string; distance: number; entityId: string }) {
  const directionOrder = { root: 0, upstream: 1, downstream: 2 } as Record<string, number>;
  return directionOrder[a.direction] - directionOrder[b.direction] || a.type.localeCompare(b.type) || a.distance - b.distance || a.entityId.localeCompare(b.entityId);
}

function compareSourceEvidence(a: EntityImpactResponseDto["sourceEvidence"][number], b: EntityImpactResponseDto["sourceEvidence"][number]) {
  return a.filePath.localeCompare(b.filePath) || a.symbolName.localeCompare(b.symbolName) || a.entityId.localeCompare(b.entityId);
}

function compareValidationMessages(a: ValidationMessageDto, b: ValidationMessageDto) {
  const levelOrder = { error: 0, warning: 1, info: 2 };
  return levelOrder[a.level] - levelOrder[b.level] || (a.entityId ?? "").localeCompare(b.entityId ?? "") || (a.filePath ?? "").localeCompare(b.filePath ?? "") || a.message.localeCompare(b.message);
}
```

- [ ] **Step 4: Register the API route**

In `apps/api/src/routes/entities.ts`, import the schema and service:

```ts
import {
  changeImpactPreviewQuerySchema,
  createEntityRequestSchema,
  entityImpactQuerySchema,
  type ProjectDto,
  updateEntityMarkdownRequestSchema,
  type SpecEntityDto,
  type SpecLinkDto
} from "@specops/contracts";
```

Add:

```ts
import { createChangeImpactPreviewService } from "../services/change-impact-preview-service.js";
```

Inside `registerEntityRoutes`, create the service:

```ts
const changeImpactPreviewService = createChangeImpactPreviewService(db);
```

Register the endpoint after the existing impact route:

```ts
app.get("/projects/:projectId/entities/:entityId/change-impact-preview", async (request) => {
  const { projectId, entityId } = entityParamsSchema.parse(request.params);
  const query = changeImpactPreviewQuerySchema.parse(request.query);

  return changeImpactPreviewService.getChangeImpactPreview({ projectId, entityId, query });
});
```

- [ ] **Step 5: Run focused backend tests**

Run:

```bash
pnpm --filter api test -- change-impact-preview-service
```

Expected: PASS.

- [ ] **Step 6: Commit backend preview composition**

```bash
git add apps/api/src/services/change-impact-preview-service.ts apps/api/src/__tests__/change-impact-preview-service.test.ts apps/api/src/routes/entities.ts
git commit -m "feat: compose change impact preview"
```

---

### Task 3: Agent Task Preview Context

**Files:**
- Modify: `apps/api/src/services/agent-task-service.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write a failing test for explicit impacted context**

In `apps/api/src/__tests__/routes.test.ts`, add this DB-backed test inside `describeWithDb("database-backed routes", () => { ... })`, near the existing agent task tests:

```ts
it("includes explicit impacted context when previewing an agent task", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
  await writeFile(
    path.join(project.specopsPath, "domain", "decision.md"),
    [
      "---",
      "id: domain.decision",
      "type: domain_entity",
      "title: Decision",
      "status: draft",
      "links:",
      "  uses:",
      "    - domain.policy",
      "---",
      "",
      "# Decision",
      "",
      "## Definition",
      "",
      "A decision made in a workspace.",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(project.specopsPath, "domain", "policy.md"),
    "---\nid: domain.policy\ntype: domain_entity\ntitle: Policy\nstatus: draft\nlinks: {}\n---\n\n# Policy\n"
  );
  await writeFile(
    path.join(project.specopsPath, "domain", "outcome.md"),
    "---\nid: domain.outcome\ntype: domain_entity\ntitle: Outcome\nstatus: draft\nlinks: {}\n---\n\n# Outcome\n"
  );
  await createIndexerService(createTestDb()).indexProject(project.id);

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/agent-tasks/preview`,
    payload: {
      sourceEntityId: "domain.decision",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.policy", "domain.outcome"]
    }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    sourceSpecIds: ["domain.decision"],
    contextSpecIds: expect.arrayContaining(["domain.policy", "domain.outcome"])
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter api test -- agent-task
```

Expected: FAIL because `previewAgentTask` ignores `impactedContextEntityIds`.

- [ ] **Step 3: Merge impacted context IDs with one-hop context**

In `apps/api/src/services/agent-task-service.ts`, replace the current `contextIds` calculation with:

```ts
const oneHopContextIds = [
  ...new Set(links.flatMap((link) => [link.fromEntityId, link.toEntityId]))
].filter((entityId) => entityId !== source.entityId);
const contextIds = [
  ...new Set([...oneHopContextIds, ...input.impactedContextEntityIds])
]
  .filter((entityId) => entityId !== source.entityId)
  .sort((left, right) => left.localeCompare(right));
```

- [ ] **Step 4: Run focused API tests**

Run:

```bash
pnpm --filter api test -- agent-task
```

Expected: PASS.

- [ ] **Step 5: Commit task context support**

```bash
git add packages/contracts/src/agent-tasks.ts apps/api/src/services/agent-task-service.ts apps/api/src
git commit -m "feat: pass impact context into task previews"
```

---

### Task 4: Web Query And Preview Panel

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/change-impact-preview-panel.tsx`
- Create: `apps/web/src/components/change-impact-preview-panel.test.tsx`

- [ ] **Step 1: Add the web query helper**

In `apps/web/src/api/queries.ts`, import the new DTOs:

```ts
  ChangeImpactPreviewQuery,
  ChangeImpactPreviewResponseDto,
```

Add a query key:

```ts
changeImpactPreview: (projectId: string, entityId: string, input: ChangeImpactPreviewQuery) =>
  ["projects", projectId, "entities", entityId, "change-impact-preview", input] as const,
```

Add the query function:

```ts
export function changeImpactPreviewQuery(
  projectId: string,
  entityId: string,
  input: ChangeImpactPreviewQuery
) {
  const search = new URLSearchParams({
    depth: input.depth,
    direction: input.direction,
    includeSource: String(input.includeSource)
  });

  return queryOptions({
    queryKey: queryKeys.changeImpactPreview(projectId, entityId, input),
    queryFn: () =>
      apiGet<ChangeImpactPreviewResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/change-impact-preview?${search.toString()}`
      )
  });
}
```

- [ ] **Step 2: Write failing panel tests**

Create `apps/web/src/components/change-impact-preview-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ChangeImpactPreviewResponseDto } from "@specops/contracts";
import { describe, expect, it } from "vitest";

import { ChangeImpactPreviewPanel } from "./change-impact-preview-panel.js";

describe("ChangeImpactPreviewPanel", () => {
  it("renders overview counts and tab content", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChangeImpactPreviewPanel
          preview={preview()}
          selectedNodeId="spec:domain.decision"
          onGenerateTask={() => undefined}
          isGeneratingTask={false}
        />
      );
    });

    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("Impacted specs");
    expect(container.textContent).toContain("Source files");
    expect(container.textContent).toContain("Warnings");
    expect(container.textContent).toContain("Related tasks");
    expect(container.textContent).toContain("domain.policy");
    expect(container.textContent).toContain("src/domain.ts");
    expect(container.textContent).toContain("source_spec_missing_entity");

    root.unmount();
  });
});

function preview(): ChangeImpactPreviewResponseDto {
  return {
    rootEntity: { entityId: "domain.decision", type: "domain_entity", title: "Decision", status: "draft", filePath: "domain/decision.md" },
    impact: {
      rootEntity: { entityId: "domain.decision", type: "domain_entity", title: "Decision", status: "draft", filePath: "domain/decision.md" },
      nodes: [],
      edges: [],
      upstreamPaths: [],
      downstreamPaths: [],
      sourceEvidence: [],
      truncated: { isTruncated: false, reason: null, nodeCount: 0, edgeCount: 0, sourceEvidenceCount: 0 }
    },
    overview: { impactedSpecCount: 2, upstreamSpecCount: 1, downstreamSpecCount: 0, sourceFileCount: 1, sourceSymbolCount: 1, warningCount: 1, relatedTaskCount: 1, shortestPaths: [] },
    impactedSpecs: [{ direction: "upstream", type: "domain_entity", specs: [{ entityId: "domain.policy", type: "domain_entity", title: "Policy", status: "draft", filePath: "domain/policy.md", direction: "upstream", distance: 1 }] }],
    sourceGroups: [{ filePath: "src/domain.ts", symbols: [{ entityId: "domain.decision", filePath: "src/domain.ts", sourceFileId: "source-1", symbolName: "Decision", symbolKind: "interface", symbolLine: 3, annotationLine: 2 }] }],
    validationMessages: [{ id: "warning-1", projectId: "project-1", indexRunId: null, filePath: "src/domain.ts", entityId: null, level: "warning", code: "source_spec_missing_entity", message: "Missing entity", createdAt: "2026-05-10T00:00:00.000Z" }],
    relatedTasks: [{ entityId: "task.domain-decision", type: "agent_task", title: "Decision Task", status: "ready", filePath: "agent-tasks/domain-decision.md", linkTypes: ["generated_from"] }],
    taskSeed: { sourceEntityId: "domain.decision", targetAgent: "codex", impactedContextEntityIds: ["domain.policy"] },
    sectionWarnings: []
  };
}
```

- [ ] **Step 3: Run panel test to verify it fails**

Run:

```bash
pnpm --filter web test -- change-impact-preview-panel
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement the panel**

Create `apps/web/src/components/change-impact-preview-panel.tsx`:

```tsx
import { useState } from "react";
import type { ChangeImpactPreviewResponseDto } from "@specops/contracts";
import { Bot } from "lucide-react";

type Tab = "overview" | "specs" | "source" | "warnings" | "tasks";

type Props = {
  preview: ChangeImpactPreviewResponseDto;
  selectedNodeId: string | null;
  onGenerateTask: () => void;
  isGeneratingTask: boolean;
};

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "specs", label: "Specs" },
  { id: "source", label: "Source" },
  { id: "warnings", label: "Warnings" },
  { id: "tasks", label: "Tasks" }
];

export function ChangeImpactPreviewPanel({
  preview,
  selectedNodeId,
  onGenerateTask,
  isGeneratingTask
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white" data-testid="change-impact-preview-panel">
      <div className="border-b border-slate-200 p-3">
        <h2 className="text-sm font-semibold text-slate-950">Change Impact Preview</h2>
        <p className="mt-1 truncate text-xs text-slate-500">{preview.rootEntity.entityId}</p>
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 p-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === tab ? "button-primary h-8" : "button-secondary h-8"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-sm text-slate-700">
        {tab === "overview" ? <Overview preview={preview} selectedNodeId={selectedNodeId} /> : null}
        {tab === "specs" ? <Specs preview={preview} /> : null}
        {tab === "source" ? <Source preview={preview} /> : null}
        {tab === "warnings" ? <Warnings preview={preview} /> : null}
        {tab === "tasks" ? <Tasks preview={preview} /> : null}
      </div>
      <div className="border-t border-slate-200 p-3">
        <button type="button" className="button-primary w-full justify-center" disabled={isGeneratingTask} onClick={onGenerateTask}>
          <Bot className="h-4 w-4" aria-hidden="true" />
          Generate task from impact
        </button>
      </div>
    </aside>
  );
}
```

Add local render helpers in the same file:

```tsx
function Overview({ preview, selectedNodeId }: { preview: ChangeImpactPreviewResponseDto; selectedNodeId: string | null }) {
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-2">
        <Metric label="Impacted specs" value={preview.overview.impactedSpecCount} />
        <Metric label="Source files" value={preview.overview.sourceFileCount} />
        <Metric label="Warnings" value={preview.overview.warningCount} />
        <Metric label="Related tasks" value={preview.overview.relatedTaskCount} />
      </dl>
      <p className="text-xs text-slate-500">Selection: {selectedNodeId ?? "root"}</p>
      {preview.overview.shortestPaths.length === 0 ? <p>No linked paths found.</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 p-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function Specs({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.impactedSpecs.length === 0) return <p>No linked specs found.</p>;
  return (
    <div className="grid gap-3">
      {preview.impactedSpecs.map((group) => (
        <section key={`${group.direction}:${group.type}`}>
          <h3 className="text-xs font-semibold uppercase text-slate-500">{group.direction} / {group.type}</h3>
          <ul className="mt-2 grid gap-2">
            {group.specs.map((spec) => <li key={spec.entityId} className="rounded border border-slate-200 p-2">{spec.entityId}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Source({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.sourceGroups.length === 0) return <p>No source evidence found.</p>;
  return (
    <ul className="grid gap-2">
      {preview.sourceGroups.map((group) => (
        <li key={group.filePath} className="rounded border border-slate-200 p-2">
          <p className="font-medium text-slate-900">{group.filePath}</p>
          <p className="text-xs text-slate-500">{group.symbols.map((symbol) => symbol.symbolName).join(", ")}</p>
        </li>
      ))}
    </ul>
  );
}

function Warnings({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.validationMessages.length === 0) return <p>No warnings for this impact set.</p>;
  return <ul className="grid gap-2">{preview.validationMessages.map((message) => <li key={message.id} className="rounded border border-amber-200 bg-amber-50 p-2">{message.code}: {message.message}</li>)}</ul>;
}

function Tasks({ preview }: { preview: ChangeImpactPreviewResponseDto }) {
  if (preview.relatedTasks.length === 0) return <p>No related tasks found.</p>;
  return <ul className="grid gap-2">{preview.relatedTasks.map((task) => <li key={task.entityId} className="rounded border border-slate-200 p-2">{task.entityId}</li>)}</ul>;
}
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
pnpm --filter web test -- change-impact-preview-panel
```

Expected: PASS.

- [ ] **Step 6: Commit web query and panel**

```bash
git add apps/web/src/api/queries.ts apps/web/src/components/change-impact-preview-panel.tsx apps/web/src/components/change-impact-preview-panel.test.tsx
git commit -m "feat: add change impact preview panel"
```

---

### Task 5: Change Impact Route And Entity Entry Point

**Files:**
- Create: `apps/web/src/routes/change-impact.tsx`
- Create: `apps/web/src/routes/change-impact.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/entity-detail.tsx`
- Modify: `apps/web/src/components/entity-detail.test.tsx`

- [ ] **Step 1: Write failing route test**

Create `apps/web/src/routes/change-impact.test.tsx` using the structure from `apps/web/src/routes/impact.test.tsx`. Mock `changeImpactPreviewQuery`, `previewAgentTask`, and `saveAgentTask`. Assert:

```ts
expect(container.textContent).toContain("Change Impact Preview");
expect(container.textContent).toContain("Generate task from impact");
expect(container.querySelector('[data-testid="impact-graph"]')).not.toBeNull();
expect(container.querySelector('[data-testid="change-impact-preview-panel"]')).not.toBeNull();
expect(linkHref(container, "Open spec")).toBe("/projects/project-1/entities/domain.decision");
```

- [ ] **Step 2: Run route test to verify it fails**

Run:

```bash
pnpm --filter web test -- change-impact
```

Expected: FAIL because `apps/web/src/routes/change-impact.tsx` does not exist.

- [ ] **Step 3: Implement the route page**

Create `apps/web/src/routes/change-impact.tsx` by adapting `ImpactPage` and replacing the query/panel:

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { AgentTaskPreviewResponse, ChangeImpactPreviewQuery, ImpactDepth, ImpactDirection, ImpactNodeDto } from "@specops/contracts";
import { ArrowLeft, FileText } from "lucide-react";

import { changeImpactPreviewQuery, previewAgentTask, saveAgentTask } from "../api/queries.js";
import { AgentTaskPreview } from "../components/agent-task-preview.js";
import { ChangeImpactPreviewPanel } from "../components/change-impact-preview-panel.js";
import { ImpactGraph } from "../components/impact-graph.js";
import { ImpactTracePanel } from "../components/impact-trace-panel.js";
import type { ImpactSearchDepth } from "./impact.js";
```

Use this component signature:

```tsx
export function ChangeImpactPage({
  projectId,
  entityId,
  depth,
  direction,
  includeSource
}: {
  projectId: string;
  entityId: string;
  depth: ImpactSearchDepth;
  direction: ImpactDirection;
  includeSource: boolean;
}) {
  const navigate = useNavigate();
  const apiDepth = impactDepthForApi(depth);
  const queryInput: ChangeImpactPreviewQuery = { depth: apiDepth, direction, includeSource };
  const preview = useQuery(changeImpactPreviewQuery(projectId, entityId, queryInput));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [taskPreview, setTaskPreview] = useState<AgentTaskPreviewResponse | null>(null);
  const [taskPreviewOriginalMarkdown, setTaskPreviewOriginalMarkdown] = useState("");
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
  const selectedNode = useMemo<ImpactNodeDto | null>(
    () =>
      preview.data?.impact.nodes.find((node) => node.id === selectedNodeId) ??
      preview.data?.impact.nodes.find((node) => node.id === `spec:${preview.data.rootEntity.entityId}`) ??
      null,
    [preview.data, selectedNodeId]
  );
```

Add preview/save mutations:

```tsx
  const previewTaskMutation = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("Impact preview is not loaded");
      return previewAgentTask(projectId, preview.data.taskSeed);
    },
    onSuccess: (result) => {
      setTaskPreview(result);
      setTaskPreviewOriginalMarkdown(result.markdown);
      setTaskSaveError(null);
    }
  });

  const saveTaskMutation = useMutation({
    mutationFn: (result: AgentTaskPreviewResponse) =>
      saveAgentTask(projectId, {
        markdown: result.markdown,
        taskId: result.taskId,
        filePath: result.filePath
      }),
    onSuccess: () => {
      setTaskPreview(null);
      setTaskPreviewOriginalMarkdown("");
      setTaskSaveError(null);
    },
    onError: (error) => setTaskSaveError(error instanceof Error ? error.message : "Failed to save agent task")
  });
```

Render the route with the same toolbar controls as `ImpactPage`, changing navigation target to `/projects/$projectId/change-impact/$entityId` in `updateSearch`. The loaded state should render:

```tsx
<div className="grid flex-none gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
  <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
    <ImpactGraph
      impact={preview.data.impact}
      selectedNodeId={selectedNode?.id ?? null}
      onSelectNode={(node) => setSelectedNodeId(node.id)}
    />
    <ImpactTracePanel impact={preview.data.impact} />
  </section>
  <ChangeImpactPreviewPanel
    preview={preview.data}
    selectedNodeId={selectedNode?.id ?? null}
    onGenerateTask={() => previewTaskMutation.mutate()}
    isGeneratingTask={previewTaskMutation.isPending}
  />
</div>
```

Render `AgentTaskPreview` below the graph/panel when `taskPreview` exists, matching the edit/save callbacks from `EntityDetail`.

- [ ] **Step 4: Register the route**

In `apps/web/src/app.tsx`, import:

```ts
import { ChangeImpactPage } from "./routes/change-impact.js";
```

Add the route:

```tsx
const changeImpactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/change-impact/$entityId",
  validateSearch: parseImpactSearch,
  component: () => {
    const { projectId, entityId } = changeImpactRoute.useParams();
    const { depth, direction, includeSource } = changeImpactRoute.useSearch();
    return (
      <ChangeImpactPage
        projectId={projectId}
        entityId={entityId}
        depth={depth}
        direction={direction}
        includeSource={includeSource}
      />
    );
  }
});
```

Update `routeTree`:

```ts
const routeTree = rootRoute.addChildren([
  projectsRoute,
  projectRoute,
  entityRoute,
  impactRoute,
  changeImpactRoute
]);
```

- [ ] **Step 5: Add entity detail entry action**

In `apps/web/src/components/entity-detail.tsx`, add `Sparkles` or `GitPullRequestArrow` to the lucide import and add a link beside `Impact`:

```tsx
<Link
  to="/projects/$projectId/change-impact/$entityId"
  params={{ projectId, entityId }}
  search={{ depth: 1, direction: "both", includeSource: true }}
  className="button-secondary"
  onClick={(event) => {
    if (isDirty && onBeforeSelect && !onBeforeSelect()) {
      event.preventDefault();
    }
  }}
>
  <Sparkles className="h-4 w-4" aria-hidden="true" />
  Preview Change Impact
</Link>
```

- [ ] **Step 6: Run focused web tests**

Run:

```bash
pnpm --filter web test -- change-impact
pnpm --filter web test -- entity-detail
```

Expected: PASS.

- [ ] **Step 7: Commit route and entry point**

```bash
git add apps/web/src/routes/change-impact.tsx apps/web/src/routes/change-impact.test.tsx apps/web/src/app.tsx apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx
git commit -m "feat: add change impact preview route"
```

---

### Task 6: Route Coverage, Full Validation, And Browser Check

**Files:**
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add DB-backed API route coverage**

In `apps/api/src/__tests__/routes.test.ts`, add this database-backed test inside `describeWithDb("database-backed routes", () => { ... })`:

```ts
it("returns change impact preview data for an indexed entity", async () => {
  app = buildServer(testDatabaseUrl!);
  const project = await createProjectViaApi();
  await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
  await mkdir(path.join(project.repoPath, "src"), { recursive: true });
  await writeFile(
    path.join(project.repoPath, "src", "domain.ts"),
    "/**\n * @specops domain.decision\n */\nexport interface Decision { id: string; }\n"
  );
  await writeFile(
    path.join(project.specopsPath, "domain", "decision.md"),
    "---\nid: domain.decision\ntype: domain_entity\ntitle: Decision\nstatus: draft\nlinks:\n  uses:\n    - domain.policy\n---\n\n# Decision\n"
  );
  await writeFile(
    path.join(project.specopsPath, "domain", "policy.md"),
    "---\nid: domain.policy\ntype: domain_entity\ntitle: Policy\nstatus: draft\nlinks: {}\n---\n\n# Policy\n"
  );
  await createIndexerService(createTestDb()).indexProject(project.id);

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/entities/domain.decision/change-impact-preview?depth=1&direction=both&includeSource=true`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    rootEntity: { entityId: "domain.decision" },
    overview: expect.objectContaining({
      impactedSpecCount: 2,
      sourceFileCount: 1
    }),
    sourceGroups: [
      expect.objectContaining({
        filePath: "src/domain.ts"
      })
    ],
    taskSeed: {
      sourceEntityId: "domain.decision",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.policy"]
    }
  });
});
```

- [ ] **Step 2: Run full workspace validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands exit with code `0`. DB-backed API tests that require `TEST_DATABASE_URL` may skip locally when the environment variable is absent.

- [ ] **Step 3: Start the local app**

Run:

```bash
pnpm dev
```

Expected: API on `http://127.0.0.1:4004` and web on `http://127.0.0.1:5176`.

- [ ] **Step 4: Browser verification**

Open:

```text
http://127.0.0.1:5176
```

Verify:

- project detail opens;
- entity detail shows `Preview Change Impact`;
- Change Impact Preview route loads;
- graph is visible and not blank;
- right panel tabs are usable;
- toolbar controls update the URL/query;
- `Generate task from impact` opens an editable task preview;
- desktop and narrow viewport layouts do not overlap.

- [ ] **Step 5: Commit validation fixes when files changed**

Run:

```bash
git status --short
```

If validation changed files, stage the known feature files and commit them:

```bash
git add packages/contracts/src/agent-tasks.ts packages/contracts/src/change-impact.ts packages/contracts/src/index.ts apps/api/src/services/change-impact-preview-service.ts apps/api/src/services/agent-task-service.ts apps/api/src/routes/entities.ts apps/api/src/__tests__/change-impact-preview-service.test.ts apps/api/src/__tests__/routes.test.ts apps/web/src/api/queries.ts apps/web/src/components/change-impact-preview-panel.tsx apps/web/src/components/change-impact-preview-panel.test.tsx apps/web/src/routes/change-impact.tsx apps/web/src/routes/change-impact.test.tsx apps/web/src/app.tsx apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx
git commit -m "fix: stabilize change impact preview"
```

If `git status --short` shows no files from that list, do not create an empty commit.
