# Spec Readiness Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, read-only readiness checks for every indexed spec entity and surface the results in entity detail, project overview, a readiness queue, and agent task previews.

**Architecture:** Add shared readiness contracts, an API service that computes readiness from indexed entities/links/validation/source evidence/health data, and small React components that consume the new endpoints. The rule engine should be explicit functions in one API service, with no markdown writes and no database schema changes.

**Tech Stack:** TypeScript, Fastify, Drizzle, Zod, React, TanStack Query, TanStack Router, Vitest.

---

## File Structure

- Create `apps/api/src/routes/readiness.ts`: Fastify routes for project and entity readiness.
- Create `apps/api/src/services/spec-readiness-service.ts`: readiness data loading, deterministic checks, status derivation, and queue sorting.
- Create `apps/api/src/__tests__/spec-readiness-service.test.ts`: pure readiness rule and queue-order tests.
- Modify `apps/api/src/server.ts`: register readiness routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: API endpoint coverage with database-backed fixtures.
- Create `packages/contracts/src/readiness.ts`: readiness enums and DTO schemas.
- Create `packages/contracts/src/readiness.test.ts`: contract parser tests.
- Modify `packages/contracts/src/index.ts`: export readiness contracts.
- Modify `packages/contracts/src/agent-tasks.ts`: allow readiness warnings to use existing warning shape; no new request fields.
- Modify `apps/api/src/services/agent-task-service.ts`: append readiness warnings to task previews.
- Modify `apps/api/src/__tests__/routes.test.ts`: task preview readiness warning coverage.
- Modify `apps/web/src/api/queries.ts`: readiness query keys and query helpers.
- Create `apps/web/src/components/readiness-panel.tsx`: entity-level readiness panel.
- Create `apps/web/src/components/readiness-panel.test.tsx`: entity panel rendering tests.
- Create `apps/web/src/routes/readiness.tsx`: project readiness queue route.
- Create `apps/web/src/routes/readiness.test.tsx`: queue rendering tests.
- Modify `apps/web/src/app.tsx`: register `/projects/$projectId/readiness`.
- Modify `apps/web/src/components/entity-detail.tsx`: load and render readiness panel, invalidate readiness after writes.
- Modify `apps/web/src/components/entity-detail.test.tsx`: entity detail readiness rendering/invalidation coverage.
- Modify `apps/web/src/components/project-overview-dashboard.tsx`: show readiness counts and link to queue.
- Modify `apps/web/src/components/project-overview-dashboard.test.tsx`: dashboard readiness coverage.
- Modify `apps/web/src/components/agent-task-preview.tsx`: render readiness warning codes consistently with existing warnings.

## Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/readiness.ts`
- Create: `packages/contracts/src/readiness.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  entityReadinessSchema,
  projectReadinessSchema,
  specReadinessCheckSchema,
  specReadinessStatusSchema
} from "./readiness.js";

describe("spec readiness contracts", () => {
  it("parses readiness statuses and check severities", () => {
    expect(specReadinessStatusSchema.parse("ready")).toBe("ready");
    expect(specReadinessStatusSchema.parse("needs_context")).toBe("needs_context");
    expect(specReadinessStatusSchema.parse("needs_review")).toBe("needs_review");
    expect(specReadinessStatusSchema.parse("blocked")).toBe("blocked");

    const check = specReadinessCheckSchema.parse({
      id: "use_case_acceptance_criteria_missing",
      severity: "context",
      label: "Acceptance criteria missing",
      detail: "Use case does not include an acceptance criteria section.",
      suggestedFix: "Add a ## Acceptance Criteria section.",
      relatedEntityId: null,
      filePath: "use-cases/order.md"
    });

    expect(check.severity).toBe("context");
  });

  it("parses project and entity readiness payloads", () => {
    const topCheck = {
      id: "broken_outgoing_link",
      severity: "blocker",
      label: "Broken outgoing link",
      detail: "Spec links to domain.missing, which is not indexed.",
      suggestedFix: "Create domain.missing or remove the link.",
      relatedEntityId: "domain.missing",
      filePath: "domain/customer.md"
    } as const;

    const project = projectReadinessSchema.parse({
      summary: { ready: 1, needsContext: 2, needsReview: 3, blocked: 4 },
      queue: [
        {
          entityId: "domain.customer",
          title: "Customer",
          type: "domain_entity",
          status: "draft",
          filePath: "domain/customer.md",
          readiness: "blocked",
          highestSeverity: "blocker",
          failedCheckCount: 1,
          topChecks: [topCheck]
        }
      ]
    });

    const entity = entityReadinessSchema.parse({
      entityId: "domain.customer",
      title: "Customer",
      type: "domain_entity",
      status: "draft",
      filePath: "domain/customer.md",
      readiness: "blocked",
      checks: [topCheck]
    });

    expect(project.summary.blocked).toBe(4);
    expect(entity.checks[0]?.id).toBe("broken_outgoing_link");
  });

  it("rejects unknown statuses and severities", () => {
    expect(() => specReadinessStatusSchema.parse("almost_ready")).toThrow();
    expect(() =>
      specReadinessCheckSchema.parse({
        id: "bad",
        severity: "critical",
        label: "Bad",
        detail: "Bad",
        suggestedFix: "Fix it.",
        relatedEntityId: null,
        filePath: null
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```sh
pnpm --filter @specops/contracts test -- readiness
```

Expected: fail because `packages/contracts/src/readiness.ts` does not exist.

- [ ] **Step 3: Add readiness contracts**

Create `packages/contracts/src/readiness.ts`:

```ts
import { z } from "zod";

export const specReadinessStatusSchema = z.enum([
  "ready",
  "needs_context",
  "needs_review",
  "blocked"
]);

export const specReadinessCheckSeveritySchema = z.enum(["blocker", "review", "context"]);

export const specReadinessCheckSchema = z.object({
  id: z.string().min(1),
  severity: specReadinessCheckSeveritySchema,
  label: z.string().min(1),
  detail: z.string().min(1),
  suggestedFix: z.string().min(1),
  relatedEntityId: z.string().nullable(),
  filePath: z.string().nullable()
});

export const projectReadinessQueueItemSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1),
  readiness: specReadinessStatusSchema,
  highestSeverity: specReadinessCheckSeveritySchema.nullable(),
  failedCheckCount: z.number().int().nonnegative(),
  topChecks: z.array(specReadinessCheckSchema)
});

export const projectReadinessSchema = z.object({
  summary: z.object({
    ready: z.number().int().nonnegative(),
    needsContext: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative()
  }),
  queue: z.array(projectReadinessQueueItemSchema)
});

export const entityReadinessSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  filePath: z.string().min(1),
  readiness: specReadinessStatusSchema,
  checks: z.array(specReadinessCheckSchema)
});

export type SpecReadinessStatus = z.infer<typeof specReadinessStatusSchema>;
export type SpecReadinessCheckSeverity = z.infer<typeof specReadinessCheckSeveritySchema>;
export type SpecReadinessCheckDto = z.infer<typeof specReadinessCheckSchema>;
export type ProjectReadinessQueueItemDto = z.infer<typeof projectReadinessQueueItemSchema>;
export type ProjectReadinessDto = z.infer<typeof projectReadinessSchema>;
export type EntityReadinessDto = z.infer<typeof entityReadinessSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./change-impact.js";
export * from "./entities.js";
export * from "./impact.js";
export * from "./indexing.js";
export * from "./proposals.js";
export * from "./projects.js";
export * from "./readiness.js";
export * from "./source.js";
export * from "./validation.js";
```

- [ ] **Step 4: Run contract tests**

Run:

```sh
pnpm --filter @specops/contracts test -- readiness
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/readiness.ts packages/contracts/src/readiness.test.ts packages/contracts/src/index.ts
git commit -m "feat: add readiness contracts"
```

## Task 2: Backend Readiness Service

**Files:**
- Create: `apps/api/src/services/spec-readiness-service.ts`
- Create: `apps/api/src/__tests__/spec-readiness-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/src/__tests__/spec-readiness-service.test.ts`:

```ts
import type { SpecReadinessCheckDto } from "@specops/contracts";
import { describe, expect, it } from "vitest";

import {
  buildEntityReadiness,
  buildProjectReadiness,
  type ReadinessEntityInput,
  type ReadinessLinkInput
} from "../services/spec-readiness-service.js";

describe("spec readiness rules", () => {
  it("blocks entities with validation errors and broken outgoing links", () => {
    const entity = readinessEntity({
      entityId: "domain.customer",
      type: "domain_entity",
      bodyText: "Customer describes a person or organization that buys products from the system."
    });

    const result = buildEntityReadiness({
      entity,
      allEntities: [entity],
      outgoingLinks: [{ fromEntityId: "domain.customer", toEntityId: "domain.missing", linkType: "uses" }],
      incomingLinks: [],
      sourceEvidenceEntityIds: new Set(),
      validationMessages: [
        {
          id: "validation-1",
          projectId: "project-1",
          indexRunId: "run-1",
          level: "error",
          code: "missing_required_field",
          message: "Missing title.",
          entityId: "domain.customer",
          filePath: "domain/customer.md",
          createdAt: "2026-05-11T10:00:00.000Z"
        }
      ],
      staleTaskEntityIds: new Set(),
      hasSourceInventory: false
    });

    expect(result.readiness).toBe("blocked");
    expect(result.checks.map((check) => check.id)).toEqual([
      "entity_validation_error",
      "broken_outgoing_link"
    ]);
  });

  it("marks use cases without acceptance criteria as needing context", () => {
    const entity = readinessEntity({
      entityId: "uc.checkout",
      type: "use_case",
      bodyText: "# Checkout\n\n## Goal\n\nLet customers buy products from the shop with clear payment and order confirmation steps."
    });

    const result = buildEntityReadiness({
      entity,
      allEntities: [entity, readinessEntity({ entityId: "domain.order", type: "domain_entity" })],
      outgoingLinks: [{ fromEntityId: "uc.checkout", toEntityId: "domain.order", linkType: "uses" }],
      incomingLinks: [],
      sourceEvidenceEntityIds: new Set(),
      validationMessages: [],
      staleTaskEntityIds: new Set(),
      hasSourceInventory: false
    });

    expect(result.readiness).toBe("needs_context");
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "use_case_acceptance_criteria_missing" }));
  });

  it("marks agent tasks with missing source entities as blocked and stale tasks as needing review", () => {
    const missingSourceTask = readinessEntity({
      entityId: "task.checkout",
      type: "agent_task",
      frontmatter: { source_entity: "uc.missing" },
      bodyText: "# Task\n\nRun pnpm typecheck and pnpm test after implementing checkout behavior in the app."
    });
    const staleTask = readinessEntity({
      entityId: "task.order",
      type: "agent_task",
      frontmatter: { source_entity: "domain.order" },
      bodyText: "# Task\n\n## Validation commands\n\npnpm typecheck\npnpm test"
    });
    const source = readinessEntity({ entityId: "domain.order", type: "domain_entity" });

    const missingSourceResult = buildEntityReadiness({
      entity: missingSourceTask,
      allEntities: [missingSourceTask, staleTask, source],
      outgoingLinks: [],
      incomingLinks: [],
      sourceEvidenceEntityIds: new Set(),
      validationMessages: [],
      staleTaskEntityIds: new Set(["task.order"]),
      hasSourceInventory: false
    });
    const staleResult = buildEntityReadiness({
      entity: staleTask,
      allEntities: [missingSourceTask, staleTask, source],
      outgoingLinks: [],
      incomingLinks: [],
      sourceEvidenceEntityIds: new Set(),
      validationMessages: [],
      staleTaskEntityIds: new Set(["task.order"]),
      hasSourceInventory: false
    });

    expect(missingSourceResult.readiness).toBe("blocked");
    expect(missingSourceResult.checks).toContainEqual(expect.objectContaining({ id: "agent_task_source_missing" }));
    expect(staleResult.readiness).toBe("needs_review");
    expect(staleResult.checks).toContainEqual(expect.objectContaining({ id: "agent_task_stale" }));
  });

  it("sorts the project queue by severity, type, and entity id", () => {
    const project = buildProjectReadiness([
      entityReadiness("domain.zeta", "Zeta", "domain_entity", "needs_context", contextCheck()),
      entityReadiness("task.alpha", "Alpha task", "agent_task", "blocked", blockerCheck()),
      entityReadiness("uc.beta", "Beta", "use_case", "needs_review", reviewCheck()),
      entityReadiness("domain.ready", "Ready", "domain_entity", "ready")
    ]);

    expect(project.summary).toEqual({ ready: 1, needsContext: 1, needsReview: 1, blocked: 1 });
    expect(project.queue.map((item) => item.entityId)).toEqual([
      "task.alpha",
      "uc.beta",
      "domain.zeta"
    ]);
  });
});

function readinessEntity(overrides: Partial<ReadinessEntityInput>): ReadinessEntityInput {
  return {
    entityId: "domain.example",
    title: "Example",
    type: "domain_entity",
    status: "draft",
    filePath: "domain/example.md",
    frontmatter: {
      id: overrides.entityId ?? "domain.example",
      type: overrides.type ?? "domain_entity",
      title: overrides.title ?? "Example",
      status: overrides.status ?? "draft",
      ...(overrides.frontmatter ?? {})
    },
    bodyText:
      "This spec contains enough meaningful body text to pass the baseline meaningful body check.",
    ...overrides
  };
}

function entityReadiness(
  entityId: string,
  title: string,
  type: string,
  readiness: "ready" | "needs_context" | "needs_review" | "blocked",
  ...checks: SpecReadinessCheckDto[]
) {
  return {
    entityId,
    title,
    type,
    status: "draft",
    filePath: `${type}/${entityId}.md`,
    readiness,
    checks
  };
}

function blockerCheck(): SpecReadinessCheckDto {
  return {
    id: "blocker",
    severity: "blocker",
    label: "Blocked",
    detail: "Blocked.",
    suggestedFix: "Fix the blocking issue.",
    relatedEntityId: null,
    filePath: null
  };
}

function reviewCheck(): SpecReadinessCheckDto {
  return {
    id: "review",
    severity: "review",
    label: "Review",
    detail: "Review.",
    suggestedFix: "Review the spec.",
    relatedEntityId: null,
    filePath: null
  };
}

function contextCheck(): SpecReadinessCheckDto {
  return {
    id: "context",
    severity: "context",
    label: "Context",
    detail: "Context missing.",
    suggestedFix: "Add planning context.",
    relatedEntityId: null,
    filePath: null
  };
}
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```sh
pnpm --filter api test -- spec-readiness-service
```

Expected: fail because `spec-readiness-service.ts` does not exist.

- [ ] **Step 3: Implement readiness service**

Create `apps/api/src/services/spec-readiness-service.ts` with these public exports and helper structure:

```ts
import type {
  EntityReadinessDto,
  ProjectReadinessDto,
  SpecReadinessCheckDto,
  SpecReadinessStatus,
  ValidationMessageDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  projects,
  sourceFiles,
  sourceSpecLinks,
  specEntities,
  specLinks,
  validationMessages
} from "@specops/db";
import { and, asc, eq } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";
import { createProjectHealthService } from "./project-health-service.js";

export type ReadinessEntityInput = {
  entityId: string;
  title: string;
  type: string;
  status: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  bodyText: string;
};

export type ReadinessLinkInput = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
};

type BuildEntityReadinessInput = {
  entity: ReadinessEntityInput;
  allEntities: ReadinessEntityInput[];
  outgoingLinks: ReadinessLinkInput[];
  incomingLinks: ReadinessLinkInput[];
  sourceEvidenceEntityIds: Set<string>;
  validationMessages: ValidationMessageDto[];
  staleTaskEntityIds: Set<string>;
  hasSourceInventory: boolean;
};

const STATUS_RANK: Record<SpecReadinessStatus, number> = {
  blocked: 0,
  needs_review: 1,
  needs_context: 2,
  ready: 3
};

const SEVERITY_TO_STATUS = {
  blocker: "blocked",
  review: "needs_review",
  context: "needs_context"
} as const;

export function createSpecReadinessService(db: Db) {
  const projectHealthService = createProjectHealthService(db);

  async function getProjectReadiness(projectId: string): Promise<ProjectReadinessDto> {
    await assertProjectExists(projectId);
    const readiness = await loadReadiness(projectId);
    return buildProjectReadiness(readiness);
  }

  async function getEntityReadiness(
    projectId: string,
    entityId: string
  ): Promise<EntityReadinessDto> {
    await assertProjectExists(projectId);
    const readiness = await loadReadiness(projectId);
    const entity = readiness.find((item) => item.entityId === entityId);

    if (!entity) {
      throw new NotFoundError("Entity not found", { projectId, entityId });
    }

    return entity;
  }

  async function assertProjectExists(projectId: string) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }
  }

  async function loadReadiness(projectId: string): Promise<EntityReadinessDto[]> {
    const [entityRows, linkRows, validationRows, sourceEvidenceRows, sourceFileRows] = await Promise.all([
      db.select().from(specEntities).where(eq(specEntities.projectId, projectId)).orderBy(asc(specEntities.entityId)),
      db.select().from(specLinks).where(eq(specLinks.projectId, projectId)),
      db.select().from(validationMessages).where(eq(validationMessages.projectId, projectId)),
      db.select({ entityId: sourceSpecLinks.entityId }).from(sourceSpecLinks).where(eq(sourceSpecLinks.projectId, projectId)),
      db.select({ id: sourceFiles.id }).from(sourceFiles).where(eq(sourceFiles.projectId, projectId)).limit(1)
    ]);

    const staleTaskEntityIds = await loadStaleTaskIds(projectId);
    const entities = entityRows.map((row): ReadinessEntityInput => ({
      entityId: row.entityId,
      title: row.title,
      type: row.type,
      status: row.status,
      filePath: row.filePath,
      frontmatter: readRecord(row.frontmatterJson),
      bodyText: row.bodyText
    }));
    const links = linkRows.map((row): ReadinessLinkInput => ({
      fromEntityId: row.fromEntityId,
      toEntityId: row.toEntityId,
      linkType: row.linkType
    }));
    const sourceEvidenceEntityIds = new Set(sourceEvidenceRows.map((row) => row.entityId));
    const hasSourceInventory = sourceFileRows.length > 0;
    const validationDtos = validationRows.map((row): ValidationMessageDto => ({
      id: row.id,
      projectId: row.projectId,
      indexRunId: row.indexRunId,
      level: row.level,
      code: row.code,
      message: row.message,
      entityId: row.entityId,
      filePath: row.filePath,
      createdAt: row.createdAt.toISOString()
    }));

    return entities.map((entity) =>
      buildEntityReadiness({
        entity,
        allEntities: entities,
        outgoingLinks: links.filter((link) => link.fromEntityId === entity.entityId),
        incomingLinks: links.filter((link) => link.toEntityId === entity.entityId),
        sourceEvidenceEntityIds,
        validationMessages: validationDtos.filter((message) => message.entityId === entity.entityId),
        staleTaskEntityIds,
        hasSourceInventory
      })
    );
  }

  async function loadStaleTaskIds(projectId: string): Promise<Set<string>> {
    try {
      const health = await projectHealthService.getProjectHealth(projectId);
      return new Set(health.staleTasks.samples.map((task) => task.entityId));
    } catch {
      return new Set();
    }
  }

  return { getProjectReadiness, getEntityReadiness };
}
```

Add the pure rule functions below the service. Keep each check small and named:

```ts
export function buildEntityReadiness(input: BuildEntityReadinessInput): EntityReadinessDto {
  const checks = [
    ...allEntityChecks(input),
    ...typeSpecificChecks(input)
  ];

  return {
    entityId: input.entity.entityId,
    title: input.entity.title,
    type: input.entity.type,
    status: input.entity.status,
    filePath: input.entity.filePath,
    readiness: statusFromChecks(checks),
    checks
  };
}

export function buildProjectReadiness(entities: EntityReadinessDto[]): ProjectReadinessDto {
  const summary = { ready: 0, needsContext: 0, needsReview: 0, blocked: 0 };

  for (const entity of entities) {
    if (entity.readiness === "ready") summary.ready += 1;
    if (entity.readiness === "needs_context") summary.needsContext += 1;
    if (entity.readiness === "needs_review") summary.needsReview += 1;
    if (entity.readiness === "blocked") summary.blocked += 1;
  }

  return {
    summary,
    queue: entities
      .filter((entity) => entity.readiness !== "ready")
      .map((entity) => ({
        entityId: entity.entityId,
        title: entity.title,
        type: entity.type,
        status: entity.status,
        filePath: entity.filePath,
        readiness: entity.readiness,
        highestSeverity: entity.checks[0]?.severity ?? null,
        failedCheckCount: entity.checks.length,
        topChecks: entity.checks.slice(0, 3)
      }))
      .sort((left, right) => {
        const severity = STATUS_RANK[left.readiness] - STATUS_RANK[right.readiness];
        if (severity !== 0) return severity;
        const type = left.type.localeCompare(right.type);
        return type !== 0 ? type : left.entityId.localeCompare(right.entityId);
      })
  };
}
```

Implement checks with these required IDs:

```ts
function allEntityChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  const checks: SpecReadinessCheckDto[] = [];
  const entityIds = new Set(input.allEntities.map((entity) => entity.entityId));

  for (const message of input.validationMessages.filter((message) => message.level === "error")) {
    checks.push(check("entity_validation_error", "blocker", "Validation error", message.message, "Fix the validation error and re-index the project.", input.entity.entityId, message.filePath));
  }

  for (const link of input.outgoingLinks.filter((link) => !entityIds.has(link.toEntityId))) {
    checks.push(check("broken_outgoing_link", "blocker", "Broken outgoing link", `${input.entity.entityId} links to missing entity ${link.toEntityId}.`, "Create the linked spec entity or remove the link.", link.toEntityId, input.entity.filePath));
  }

  if (input.entity.bodyText.trim().length < 80) {
    checks.push(check("body_too_short", "context", "Body is too short", "Spec body has fewer than 80 characters of indexed text.", "Add enough goal, behavior, or context text for planning.", null, input.entity.filePath));
  }

  return checks;
}

function typeSpecificChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  if (input.entity.type === "use_case") return useCaseChecks(input);
  if (input.entity.type === "domain_entity" || input.entity.type === "data_model") return modelChecks(input);
  if (input.entity.type === "interface") return interfaceChecks(input);
  if (input.entity.type === "ui_view") return uiViewChecks(input);
  if (input.entity.type === "agent_task") return agentTaskChecks(input);
  return [];
}
```

Use helper logic:

```ts
function useCaseChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  const checks: SpecReadinessCheckDto[] = [];
  if (!hasHeading(input.entity.bodyText, ["acceptance criteria"])) {
    checks.push(check("use_case_acceptance_criteria_missing", "context", "Acceptance criteria missing", "Use case does not include an acceptance criteria section.", "Add a ## Acceptance Criteria section with verifiable outcomes.", null, input.entity.filePath));
  }
  if (!hasHeading(input.entity.bodyText, ["goal", "objective", "problem", "intent"])) {
    checks.push(check("use_case_goal_missing", "context", "Goal missing", "Use case does not include a goal, objective, problem, or intent section.", "Add a short section that states the user or system goal.", null, input.entity.filePath));
  }
  if (!hasPlanningLink(input)) {
    checks.push(check("use_case_planning_link_missing", "context", "Planning link missing", "Use case has no outgoing link to planning context or source-backed specs.", "Link this use case to a domain entity, interface, UI view, data model, or source-backed entity.", null, input.entity.filePath));
  }
  return checks;
}

function modelChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  if (input.incomingLinks.length === 0 && input.outgoingLinks.length === 0 && input.allEntities.length > 1) {
    return [check("model_isolated", "context", "Spec is isolated", "Model spec has no incoming or outgoing spec links.", "Link it to a use case, interface, or related model.", null, input.entity.filePath)];
  }
  return [];
}

function interfaceChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  const checks: SpecReadinessCheckDto[] = [];
  if (input.incomingLinks.length === 0 && input.outgoingLinks.length === 0 && !input.sourceEvidenceEntityIds.has(input.entity.entityId)) {
    checks.push(check("interface_context_missing", "context", "Interface context missing", "Interface has no linked specs or source evidence.", "Link it to a use case, model, or source annotation.", null, input.entity.filePath));
  }
  if (input.hasSourceInventory && !input.sourceEvidenceEntityIds.has(input.entity.entityId)) {
    checks.push(check("interface_source_evidence_missing", "context", "Source evidence missing", "Source inventory exists but this interface has no source evidence.", "Add source evidence or link it to an implementation-facing spec.", null, input.entity.filePath));
  }
  return checks;
}

function uiViewChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  const checks: SpecReadinessCheckDto[] = [];
  if (!hasLinkToType(input, ["use_case", "interface"])) {
    checks.push(check("ui_view_context_missing", "context", "UI context missing", "UI view is not linked to a use case or interface.", "Link this UI view to the behavior it supports.", null, input.entity.filePath));
  }
  if (!hasHeading(input.entity.bodyText, ["behavior", "states", "interactions", "acceptance criteria"])) {
    checks.push(check("ui_view_behavior_missing", "context", "UI behavior missing", "UI view lacks behavior, state, interaction, or acceptance criteria notes.", "Add expected behavior, UI states, or interaction notes.", null, input.entity.filePath));
  }
  return checks;
}

function agentTaskChecks(input: BuildEntityReadinessInput): SpecReadinessCheckDto[] {
  const checks: SpecReadinessCheckDto[] = [];
  const sourceEntityId = readString(input.entity.frontmatter.source_entity) ?? input.outgoingLinks.find((link) => link.linkType === "generated_from")?.toEntityId ?? null;
  const entityIds = new Set(input.allEntities.map((entity) => entity.entityId));
  if (!sourceEntityId) {
    checks.push(check("agent_task_source_missing", "blocker", "Source entity missing", "Agent task does not declare source_entity or generated_from context.", "Add source_entity frontmatter or a generated_from link.", null, input.entity.filePath));
  } else if (!entityIds.has(sourceEntityId)) {
    checks.push(check("agent_task_source_missing", "blocker", "Source entity missing", `Agent task references missing source entity ${sourceEntityId}.`, "Restore the source spec or update the task source.", sourceEntityId, input.entity.filePath));
  }
  if (!/validation commands|pnpm typecheck|pnpm test|npm test|vitest/i.test(input.entity.bodyText)) {
    checks.push(check("agent_task_validation_missing", "context", "Validation commands missing", "Agent task does not include validation commands.", "Add validation commands such as pnpm typecheck and pnpm test.", null, input.entity.filePath));
  }
  if (input.staleTaskEntityIds.has(input.entity.entityId)) {
    checks.push(check("agent_task_stale", "review", "Task may be stale", "Project health reports this generated task as stale.", "Regenerate or review the task before implementation.", input.entity.entityId, input.entity.filePath));
  }
  return checks;
}
```

Finish helpers:

```ts
function statusFromChecks(checks: SpecReadinessCheckDto[]): SpecReadinessStatus {
  if (checks.some((item) => item.severity === "blocker")) return "blocked";
  if (checks.some((item) => item.severity === "review")) return "needs_review";
  if (checks.some((item) => item.severity === "context")) return "needs_context";
  return "ready";
}

function check(
  id: string,
  severity: SpecReadinessCheckDto["severity"],
  label: string,
  detail: string,
  suggestedFix: string,
  relatedEntityId: string | null,
  filePath: string | null
): SpecReadinessCheckDto {
  return { id, severity, label, detail, suggestedFix, relatedEntityId, filePath };
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasHeading(bodyText: string, headings: string[]): boolean {
  const normalized = bodyText.toLowerCase();
  return headings.some((heading) => new RegExp(`(^|\\n)#+\\s+${escapeRegExp(heading)}\\b`, "i").test(normalized));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPlanningLink(input: BuildEntityReadinessInput): boolean {
  return input.outgoingLinks.some((link) => {
    const target = input.allEntities.find((entity) => entity.entityId === link.toEntityId);
    return target && ["domain_entity", "interface", "ui_view", "data_model"].includes(target.type);
  }) || input.outgoingLinks.some((link) => input.sourceEvidenceEntityIds.has(link.toEntityId));
}

function hasLinkToType(input: BuildEntityReadinessInput, types: string[]): boolean {
  const linkedIds = new Set([...input.incomingLinks.map((link) => link.fromEntityId), ...input.outgoingLinks.map((link) => link.toEntityId)]);
  return input.allEntities.some((entity) => linkedIds.has(entity.entityId) && types.includes(entity.type));
}
```

- [ ] **Step 4: Run service tests**

Run:

```sh
pnpm --filter api test -- spec-readiness-service
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/services/spec-readiness-service.ts apps/api/src/__tests__/spec-readiness-service.test.ts
git commit -m "feat: compute spec readiness"
```

## Task 3: Backend Routes

**Files:**
- Create: `apps/api/src/routes/readiness.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Append two database-backed route tests near the existing entity route tests in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("returns project readiness summary and queue", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "use-cases", "checkout.md"), `---
id: uc.checkout
type: use_case
title: Checkout
status: draft
links:
  domain:
    - domain.order
---

# Checkout

## Goal

Let customers buy products and receive order confirmation.
`);
    await writeFile(path.join(project.specopsPath, "domain", "order.md"), `---
id: domain.order
type: domain_entity
title: Order
status: draft
---

# Order

Order records customer checkout intent and payment confirmation details.
`);
    await createIndexerService(db).indexProject(project.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/readiness`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        needsContext: expect.any(Number)
      },
      queue: expect.arrayContaining([
        expect.objectContaining({
          entityId: "uc.checkout",
          readiness: "needs_context",
          topChecks: expect.arrayContaining([
            expect.objectContaining({ id: "use_case_acceptance_criteria_missing" })
          ])
        })
      ])
    });
  });

  it("returns entity readiness and not found for missing entities", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "domain", "customer.md"), `---
id: domain.customer
type: domain_entity
title: Customer
status: draft
---

# Customer

Customer represents a person or organization that uses the product and owns orders.
`);
    await createIndexerService(db).indexProject(project.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.customer/readiness`
    });
    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.missing/readiness`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entityId: "domain.customer",
      readiness: expect.any(String),
      checks: expect.any(Array)
    });
    expect(missingResponse.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes
```

Expected: fail with 404 for readiness endpoints.

- [ ] **Step 3: Add readiness routes**

Create `apps/api/src/routes/readiness.ts`:

```ts
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createSpecReadinessService } from "../services/spec-readiness-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const entityParamsSchema = z.object({
  projectId: z.string().min(1),
  entityId: z.string().min(1)
});

export const registerReadinessRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const readinessService = createSpecReadinessService(db);

  app.get("/projects/:projectId/readiness", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return readinessService.getProjectReadiness(projectId);
  });

  app.get("/projects/:projectId/entities/:entityId/readiness", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    return readinessService.getEntityReadiness(projectId, entityId);
  });
};
```

Modify `apps/api/src/server.ts`:

```ts
import { registerReadinessRoutes } from "./routes/readiness.js";
```

Register after project health and before entity routes:

```ts
  app.register(registerProjectHealthRoutes, { prefix: "/api", db });
  app.register(registerReadinessRoutes, { prefix: "/api", db });
  app.register(registerEntityRoutes, { prefix: "/api", db });
```

- [ ] **Step 4: Run route tests**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes
```

Expected: pass, or skip locally if `TEST_DATABASE_URL` is not configured. If skipped, run the service test and record the skip in the final handoff.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/routes/readiness.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose spec readiness API"
```

## Task 4: Task Preview Readiness Warnings

**Files:**
- Modify: `apps/api/src/services/agent-task-service.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`
- Modify: `apps/web/src/components/agent-task-preview.tsx`

- [ ] **Step 1: Write failing task preview test**

Add a database-backed test near existing agent task preview tests in `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("includes readiness warnings in generated task previews", async () => {
    app = buildServer(testDatabaseUrl!);
    const db = createTestDb();
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await writeFile(path.join(project.specopsPath, "use-cases", "checkout.md"), `---
id: uc.checkout
type: use_case
title: Checkout
status: draft
---

# Checkout

## Goal

Let customers buy products and receive confirmation.
`);
    await createIndexerService(db).indexProject(project.id);

    const preview = await createAgentTaskService(db).previewAgentTask(project.id, {
      sourceEntityId: "uc.checkout",
      targetAgent: "codex",
      impactedContextEntityIds: []
    });

    expect(preview.warnings).toContainEqual(
      expect.objectContaining({
        code: "readiness:use_case_acceptance_criteria_missing",
        entityId: "uc.checkout"
      })
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes
```

Expected: fail because task preview does not append readiness warnings.

- [ ] **Step 3: Add readiness warnings to task preview service**

In `apps/api/src/services/agent-task-service.ts`, instantiate readiness service beside existing service dependencies:

```ts
import { createSpecReadinessService } from "./spec-readiness-service.js";
```

Inside `createAgentTaskService`:

```ts
  const readinessService = createSpecReadinessService(db);
```

After the existing deterministic preview response is built, load source and context readiness:

```ts
    const readinessWarnings = await buildReadinessWarnings({
      projectId,
      entityIds: [input.sourceEntityId, ...preview.contextSpecIds],
      readinessService
    });

    return {
      ...preview,
      warnings: [...preview.warnings, ...readinessWarnings]
    };
```

Add helper in the same file:

```ts
async function buildReadinessWarnings(input: {
  projectId: string;
  entityIds: string[];
  readinessService: ReturnType<typeof createSpecReadinessService>;
}): Promise<AgentTaskWarningDto[]> {
  const uniqueEntityIds = [...new Set(input.entityIds)];
  const warnings: AgentTaskWarningDto[] = [];

  for (const entityId of uniqueEntityIds) {
    const readiness = await input.readinessService.getEntityReadiness(input.projectId, entityId);
    for (const check of readiness.checks) {
      warnings.push({
        code: `readiness:${check.id}`,
        message: `${readiness.title}: ${check.detail} Suggested fix: ${check.suggestedFix}`,
        entityId: readiness.entityId
      });
    }
  }

  return warnings;
}
```

If `AgentTaskWarningDto` is not imported in the service, add it from `@specops/contracts`.

- [ ] **Step 4: Run API test**

Run:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes
```

Expected: pass, or skip locally if the DB test URL is unavailable.

- [ ] **Step 5: Run web task preview test**

Run:

```sh
pnpm --filter web test -- agent-task-preview
```

Expected: pass. The existing warning list rendering already supports new warning codes.

- [ ] **Step 6: Commit**

```sh
git add apps/api/src/services/agent-task-service.ts apps/api/src/__tests__/routes.test.ts apps/web/src/components/agent-task-preview.tsx
git commit -m "feat: include readiness warnings in task previews"
```

## Task 5: Web Query Helpers and Entity Panel

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/components/readiness-panel.tsx`
- Create: `apps/web/src/components/readiness-panel.test.tsx`
- Modify: `apps/web/src/components/entity-detail.tsx`
- Modify: `apps/web/src/components/entity-detail.test.tsx`

- [ ] **Step 1: Write failing readiness panel test**

Create `apps/web/src/components/readiness-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom

import type { EntityReadinessDto } from "@specops/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadinessPanel } from "./readiness-panel.js";

describe("ReadinessPanel", () => {
  it("renders ready state", () => {
    const html = renderToStaticMarkup(<ReadinessPanel readiness={readyEntity} />);

    expect(html).toContain("Ready");
    expect(html).toContain("No readiness checks need attention.");
  });

  it("renders failed checks and suggested fixes", () => {
    const html = renderToStaticMarkup(<ReadinessPanel readiness={blockedEntity} />);

    expect(html).toContain("Blocked");
    expect(html).toContain("Broken outgoing link");
    expect(html).toContain("Create the linked spec entity or remove the link.");
  });
});

const readyEntity: EntityReadinessDto = {
  entityId: "domain.order",
  title: "Order",
  type: "domain_entity",
  status: "draft",
  filePath: "domain/order.md",
  readiness: "ready",
  checks: []
};

const blockedEntity: EntityReadinessDto = {
  ...readyEntity,
  readiness: "blocked",
  checks: [
    {
      id: "broken_outgoing_link",
      severity: "blocker",
      label: "Broken outgoing link",
      detail: "Spec links to missing domain.customer.",
      suggestedFix: "Create the linked spec entity or remove the link.",
      relatedEntityId: "domain.customer",
      filePath: "domain/order.md"
    }
  ]
};
```

- [ ] **Step 2: Write failing query/helper integration assertions**

Update `apps/web/src/components/entity-detail.test.tsx` mocks:

```ts
vi.mock("../api/queries.js", () => ({
  backlinksQuery: () => ({ queryKey: ["backlinks"] }),
  entityQuery: () => ({ queryKey: ["entity"] }),
  entityReadinessQuery: () => ({ queryKey: ["entity-readiness"] }),
  entitySourceLinksQuery: () => ({ queryKey: ["source-links"] }),
  outgoingLinksQuery: () => ({ queryKey: ["outgoing-links"] }),
  previewAgentTask: vi.fn(),
  queryKeys: {
    backlinks: (projectId: string, entityId: string) => ["backlinks", projectId, entityId],
    entities: (projectId: string) => ["entities", projectId],
    entity: (projectId: string, entityId: string) => ["entity", projectId, entityId],
    entityReadiness: (projectId: string, entityId: string) => ["entity-readiness", projectId, entityId],
    indexRuns: (projectId: string) => ["index-runs", projectId],
    outgoingLinks: (projectId: string, entityId: string) => ["outgoing-links", projectId, entityId],
    project: (projectId: string) => ["project", projectId],
    projectHealth: (projectId: string) => ["project-health", projectId],
    projectOverview: (projectId: string) => ["project-overview", projectId],
    projectReadiness: (projectId: string) => ["project-readiness", projectId],
    sourceLinks: (projectId: string, entityId: string) => ["source-links", projectId, entityId],
    validation: (projectId: string) => ["validation", projectId]
  },
  saveAgentTask: vi.fn(),
  updateEntityMarkdown: vi.fn(),
  validationMessagesQuery: () => ({ queryKey: ["validation"] })
}));
```

Add assertion to the save invalidation tests:

```ts
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["entity-readiness", "project-1", "domain.decision"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-readiness", "project-1"]
    });
```

- [ ] **Step 3: Run web tests to verify failure**

Run:

```sh
pnpm --filter web test -- readiness-panel entity-detail
```

Expected: fail because the component and query helpers do not exist.

- [ ] **Step 4: Add query helpers**

Modify imports in `apps/web/src/api/queries.ts`:

```ts
  EntityReadinessDto,
  ProjectReadinessDto,
```

Add query keys:

```ts
  projectReadiness: (projectId: string) => ["projects", projectId, "readiness"] as const,
  entityReadiness: (projectId: string, entityId: string) =>
    ["projects", projectId, "entities", entityId, "readiness"] as const,
```

Add query functions:

```ts
export function projectReadinessQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.projectReadiness(projectId),
    queryFn: () =>
      apiGet<ProjectReadinessDto>(`/api/projects/${encodeURIComponent(projectId)}/readiness`)
  });
}

export function entityReadinessQuery(projectId: string, entityId: string) {
  return queryOptions({
    queryKey: queryKeys.entityReadiness(projectId, entityId),
    queryFn: () =>
      apiGet<EntityReadinessDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/readiness`
      )
  });
}
```

- [ ] **Step 5: Add readiness panel**

Create `apps/web/src/components/readiness-panel.tsx`:

```tsx
import type { EntityReadinessDto, SpecReadinessStatus } from "@specops/contracts";
import { AlertTriangle, CheckCircle2, CircleAlert, HelpCircle } from "lucide-react";

type ReadinessPanelProps = {
  readiness: EntityReadinessDto;
};

export function ReadinessPanel({ readiness }: ReadinessPanelProps) {
  const meta = statusMeta(readiness.readiness);

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <meta.Icon className={`h-4 w-4 ${meta.iconClass}`} aria-hidden="true" />
        <span>{meta.label}</span>
      </h3>
      {readiness.checks.length === 0 ? (
        <p className="text-sm text-slate-500">No readiness checks need attention.</p>
      ) : (
        <ul className="grid gap-2">
          {readiness.checks.map((check) => (
            <li key={`${check.id}-${check.relatedEntityId ?? check.filePath ?? "project"}`} className="text-sm text-slate-700">
              <div className="font-medium">{check.label}</div>
              <div className="text-slate-600">{check.detail}</div>
              <div className="text-xs text-slate-500">{check.suggestedFix}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusMeta(status: SpecReadinessStatus) {
  if (status === "ready") {
    return { label: "Ready", Icon: CheckCircle2, iconClass: "text-emerald-700" };
  }
  if (status === "blocked") {
    return { label: "Blocked", Icon: CircleAlert, iconClass: "text-red-700" };
  }
  if (status === "needs_review") {
    return { label: "Needs Review", Icon: AlertTriangle, iconClass: "text-amber-700" };
  }
  return { label: "Needs Context", Icon: HelpCircle, iconClass: "text-sky-700" };
}
```

- [ ] **Step 6: Render panel in entity detail and invalidate readiness**

Modify imports in `apps/web/src/components/entity-detail.tsx`:

```ts
  entityReadinessQuery,
```

```ts
import { ReadinessPanel } from "./readiness-panel.js";
```

Load readiness:

```ts
  const readiness = useQuery({
    ...entityReadinessQuery(projectId, entityId),
    enabled: Boolean(entityId)
  });
```

Invalidate after entity save:

```ts
        queryClient.invalidateQueries({ queryKey: queryKeys.entityReadiness(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectReadiness(projectId) }),
```

Invalidate after task save:

```ts
        queryClient.invalidateQueries({
          queryKey: queryKeys.entityReadiness(request.projectId, request.sourceEntityId)
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectReadiness(request.projectId) }),
```

Render after `LinkPanels` and before `EntityValidation`:

```tsx
      {readiness.error ? (
        <section className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {readiness.error.message}
        </section>
      ) : readiness.data ? (
        <ReadinessPanel readiness={readiness.data} />
      ) : null}
```

- [ ] **Step 7: Run focused web tests**

Run:

```sh
pnpm --filter web test -- readiness-panel entity-detail
```

Expected: pass.

- [ ] **Step 8: Commit**

```sh
git add apps/web/src/api/queries.ts apps/web/src/components/readiness-panel.tsx apps/web/src/components/readiness-panel.test.tsx apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx
git commit -m "feat: show entity readiness"
```

## Task 6: Project Overview and Readiness Queue

**Files:**
- Create: `apps/web/src/routes/readiness.tsx`
- Create: `apps/web/src/routes/readiness.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/project-overview-dashboard.tsx`
- Modify: `apps/web/src/components/project-overview-dashboard.test.tsx`

- [ ] **Step 1: Write failing queue route test**

Create `apps/web/src/routes/readiness.test.tsx`:

```tsx
// @vitest-environment happy-dom

import type { ProjectReadinessDto } from "@specops/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: readiness, error: null, isLoading: false })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params
  }: {
    children: ReactNode;
    to: string;
    params: Record<string, string>;
  }) => (
    <a href={`${to}:${params.projectId}:${params.entityId ?? ""}`}>
      {children}
    </a>
  )
}));

vi.mock("../api/queries.js", () => ({
  projectReadinessQuery: () => ({ queryKey: ["project-readiness"] })
}));

import { ReadinessPage } from "./readiness.js";

describe("ReadinessPage", () => {
  it("groups non-ready entities by readiness state", () => {
    const html = renderToStaticMarkup(<ReadinessPage projectId="project-1" />);

    expect(html).toContain("Spec Readiness");
    expect(html).toContain("Blocked");
    expect(html).toContain("Needs Review");
    expect(html).toContain("Needs Context");
    expect(html).toContain("Checkout");
    expect(html).toContain("Task");
    expect(html).toContain("Order");
  });
});

const readiness: ProjectReadinessDto = {
  summary: { ready: 1, blocked: 1, needsReview: 1, needsContext: 1 },
  queue: [
    queueItem("task.checkout", "Task", "agent_task", "blocked"),
    queueItem("uc.checkout", "Checkout", "use_case", "needs_review"),
    queueItem("domain.order", "Order", "domain_entity", "needs_context")
  ]
};

function queueItem(
  entityId: string,
  title: string,
  type: string,
  readiness: "blocked" | "needs_review" | "needs_context"
) {
  return {
    entityId,
    title,
    type,
    status: "draft",
    filePath: `${type}/${entityId}.md`,
    readiness,
    highestSeverity:
      readiness === "blocked" ? "blocker" : readiness === "needs_review" ? "review" : "context",
    failedCheckCount: 1,
    topChecks: [
      {
        id: `${readiness}_check`,
        severity:
          readiness === "blocked" ? "blocker" : readiness === "needs_review" ? "review" : "context",
        label: "Readiness check",
        detail: "Needs attention.",
        suggestedFix: "Update the spec.",
        relatedEntityId: null,
        filePath: `${type}/${entityId}.md`
      }
    ]
  } as const;
}
```

- [ ] **Step 2: Write failing dashboard readiness test updates**

In `apps/web/src/components/project-overview-dashboard.test.tsx`, pass a `readiness` prop and assert counts:

```tsx
expect(html).toContain("Spec Readiness");
expect(html).toContain("Blocked");
expect(html).toContain("Needs context");
expect(html).toContain("/projects/$projectId/readiness:project-1::");
```

Add fixture:

```ts
const readiness: ProjectReadinessDto = {
  summary: { ready: 1, needsContext: 2, needsReview: 3, blocked: 4 },
  queue: []
};
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```sh
pnpm --filter web test -- readiness project-overview-dashboard
```

Expected: fail because the route/component prop is missing.

- [ ] **Step 4: Add readiness queue route**

Create `apps/web/src/routes/readiness.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ProjectReadinessDto, ProjectReadinessQueueItemDto } from "@specops/contracts";

import { projectReadinessQuery } from "../api/queries.js";

type ReadinessPageProps = {
  projectId: string;
};

export function ReadinessPage({ projectId }: ReadinessPageProps) {
  const readiness = useQuery(projectReadinessQuery(projectId));

  if (readiness.isLoading) {
    return <div className="p-4 text-sm text-slate-600">Loading readiness...</div>;
  }

  if (readiness.error) {
    return <div className="p-4 text-sm text-red-700">{readiness.error.message}</div>;
  }

  if (!readiness.data) {
    return <div className="p-4 text-sm text-slate-600">Readiness is unavailable.</div>;
  }

  return (
    <main className="h-full overflow-auto bg-slate-100 p-4">
      <div className="mx-auto grid max-w-6xl gap-3">
        <header className="rounded border border-slate-200 bg-white p-3">
          <h1 className="text-base font-semibold text-slate-950">Spec Readiness</h1>
          <ReadinessSummary readiness={readiness.data} />
        </header>
        <ReadinessGroup projectId={projectId} title="Blocked" items={readiness.data.queue.filter((item) => item.readiness === "blocked")} />
        <ReadinessGroup projectId={projectId} title="Needs Review" items={readiness.data.queue.filter((item) => item.readiness === "needs_review")} />
        <ReadinessGroup projectId={projectId} title="Needs Context" items={readiness.data.queue.filter((item) => item.readiness === "needs_context")} />
      </div>
    </main>
  );
}

function ReadinessSummary({ readiness }: { readiness: ProjectReadinessDto }) {
  return (
    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
      <Metric label="Ready" value={readiness.summary.ready} />
      <Metric label="Blocked" value={readiness.summary.blocked} />
      <Metric label="Needs review" value={readiness.summary.needsReview} />
      <Metric label="Needs context" value={readiness.summary.needsContext} />
    </div>
  );
}

function ReadinessGroup({
  projectId,
  title,
  items
}: {
  projectId: string;
  title: string;
  items: ProjectReadinessQueueItemDto[];
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No specs in this group.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-200">
          {items.map((item) => (
            <li key={item.entityId} className="py-2">
              <Link
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: item.entityId }}
                search={{ q: undefined }}
                className="block text-sm text-slate-800 underline-offset-2 hover:underline"
              >
                <span className="font-medium">{item.title}</span>
                <span className="ml-2 text-xs text-slate-500">{item.entityId}</span>
              </Link>
              <p className="mt-1 text-xs text-slate-500">{item.topChecks[0]?.detail ?? "Needs attention."}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 border-l border-slate-200 pl-3 first:border-l-0 first:pl-0">
      <div className="truncate text-lg font-semibold text-slate-950">{value}</div>
      <div className="truncate text-xs text-slate-500">{label}</div>
    </div>
  );
}
```

- [ ] **Step 5: Register route**

Modify `apps/web/src/app.tsx`:

```ts
import { ReadinessPage } from "./routes/readiness.js";
```

Add route:

```tsx
const readinessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/readiness",
  component: () => {
    const { projectId } = readinessRoute.useParams();
    return <ReadinessPage projectId={projectId} />;
  }
});
```

Add to route tree:

```ts
  readinessRoute,
```

- [ ] **Step 6: Add dashboard readiness panel**

Modify `ProjectOverviewDashboardProps`:

```ts
  readiness?: ProjectReadinessDto;
  readinessError?: Error | null;
  isReadinessLoading?: boolean;
```

Add import:

```ts
import type { ProjectHealthDto, ProjectOverviewDto, ProjectReadinessDto } from "@specops/contracts";
```

Add a panel in the dashboard grid:

```tsx
        <Panel title="Spec Readiness" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>
          <ReadinessSummaryPanel
            projectId={projectId}
            readiness={readiness}
            readinessError={readinessError}
            isReadinessLoading={isReadinessLoading}
          />
        </Panel>
```

Add helper:

```tsx
function ReadinessSummaryPanel({
  projectId,
  readiness,
  readinessError,
  isReadinessLoading
}: {
  projectId: string;
  readiness?: ProjectReadinessDto;
  readinessError?: Error | null;
  isReadinessLoading?: boolean;
}) {
  if (isReadinessLoading) return <EmptyState title="Loading readiness" body="Checking spec planning readiness." />;
  if (readinessError) return <EmptyState title="Readiness unavailable" body={readinessError.message} />;
  if (!readiness) return <EmptyState title="Readiness unavailable" body="Readiness data has not loaded." />;

  return (
    <div className="grid gap-3">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-4">
        <Metric label="Ready" value={readiness.summary.ready} />
        <Metric label="Blocked" value={readiness.summary.blocked} tone={readiness.summary.blocked > 0 ? "danger" : "neutral"} />
        <Metric label="Needs review" value={readiness.summary.needsReview} tone={readiness.summary.needsReview > 0 ? "warning" : "neutral"} />
        <Metric label="Needs context" value={readiness.summary.needsContext} />
      </div>
      <Link
        to="/projects/$projectId/readiness"
        params={{ projectId }}
        className="text-xs font-medium text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline"
      >
        Open readiness queue
      </Link>
    </div>
  );
}
```

- [ ] **Step 7: Load project readiness on project detail page**

Modify `apps/web/src/routes/project-detail.tsx` imports:

```ts
  projectReadinessQuery,
```

Add query near overview and health:

```ts
  const readiness = useQuery({
    ...projectReadinessQuery(projectId),
    enabled: entityId === null && !hasActiveQuery
  });
```

Invalidate after index and project mutations:

```ts
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReadiness(projectId) }),
```

Pass to dashboard:

```tsx
          readiness={readiness.data}
          readinessError={readiness.error}
          isReadinessLoading={readiness.isLoading}
```

- [ ] **Step 8: Run web tests**

Run:

```sh
pnpm --filter web test -- readiness project-overview-dashboard project-detail
```

Expected: pass.

- [ ] **Step 9: Commit**

```sh
git add apps/web/src/routes/readiness.tsx apps/web/src/routes/readiness.test.tsx apps/web/src/app.tsx apps/web/src/components/project-overview-dashboard.tsx apps/web/src/components/project-overview-dashboard.test.tsx apps/web/src/routes/project-detail.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "feat: add project readiness queue"
```

## Task 7: Final Verification

**Files:**
- Review all files touched in Tasks 1-6.

- [ ] **Step 1: Run typecheck**

Run:

```sh
pnpm typecheck
```

Expected: pass.

- [ ] **Step 2: Run tests**

Run:

```sh
pnpm test
```

Expected: pass. DB-backed API tests may skip if `TEST_DATABASE_URL` is unset.

- [ ] **Step 3: Run web build**

Run:

```sh
pnpm --filter web build
```

Expected: pass.

- [ ] **Step 4: Optional DB-backed API verification**

Run when PostgreSQL test DB is available:

```sh
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes
```

Expected: pass.

- [ ] **Step 5: Manual browser check**

Start the app:

```sh
pnpm dev
```

Open `http://127.0.0.1:5176`, then verify:

- project overview shows Spec Readiness counts,
- readiness queue opens from the dashboard,
- entity detail shows the readiness panel,
- generating a task from a weak spec shows readiness warnings,
- saving entity markdown or a generated task refreshes readiness.

- [ ] **Step 6: Final commit**

If verification required test-only fixes, commit them:

```sh
git status --short
git add <changed-files>
git commit -m "test: verify spec readiness review"
```

Skip this commit when the worktree is already clean after Task 6.

## Self-Review

Spec coverage:

- Deterministic readiness status for every indexed entity: Tasks 1-3.
- Entity detail panel: Task 5.
- Project overview counts: Task 6.
- Project readiness queue: Task 6.
- Task preview readiness warnings: Task 4.
- No markdown writes, no AI, no configurable rule engine: Tasks 2-4 explicitly keep the feature read-only and rule-based.
- Testing: Each task includes focused tests, with final typecheck/test/build verification in Task 7.

Completeness scan:

- This plan contains no incomplete tasks and no deferred implementation sections.

Type consistency:

- Shared DTO names are `SpecReadinessStatus`, `SpecReadinessCheckDto`, `EntityReadinessDto`, and `ProjectReadinessDto`.
- Query helper names are `projectReadinessQuery` and `entityReadinessQuery`.
- API service name is `createSpecReadinessService`.
