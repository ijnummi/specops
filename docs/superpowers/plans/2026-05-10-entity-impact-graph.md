# Entity Impact Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated entity impact route that shows spec graph impact plus annotated source evidence for a selected SpecOps entity.

**Architecture:** Add shared contracts first, then implement a deterministic API impact service over indexed `spec_entities`, `spec_links`, and `source_spec_links`. The web app consumes the impact response through TanStack Query and renders a dedicated route with an `@xyflow/react` graph, a persistent impact brief, and a bottom trace panel.

**Tech Stack:** TypeScript, pnpm, Fastify, Zod, Drizzle ORM, PostgreSQL, React, TanStack Router, TanStack Query, Tailwind CSS, `@xyflow/react`, Vitest, Playwright/browser verification.

---

## File Structure

Create or modify these files:

- Create `packages/contracts/src/impact.ts`: Zod schemas and TypeScript types for impact query values and response DTOs.
- Modify `packages/contracts/src/index.ts`: export impact contracts.
- Create `packages/contracts/src/impact.test.ts`: schema defaults and response validation tests.
- Create `apps/api/src/services/impact-service.ts`: deterministic breadth-first traversal and DTO mapping.
- Create `apps/api/src/__tests__/impact-service.test.ts`: service-level traversal tests using lightweight in-memory input through exported pure helpers.
- Modify `apps/api/src/routes/entities.ts`: register the impact route under the existing entity routes.
- Modify `apps/api/src/server.ts`: no new plugin if impact route is inside `entities.ts`; only update if route is split out.
- Modify `apps/api/src/__tests__/routes.test.ts`: database-backed route test for the impact endpoint.
- Modify `apps/web/package.json`: add `@xyflow/react`.
- Modify `apps/web/src/api/queries.ts`: add impact query key and API call.
- Modify `apps/web/src/app.tsx`: add `/projects/$projectId/impact/$entityId` route with query parsing.
- Create `apps/web/src/routes/impact.tsx`: page container and query state.
- Create `apps/web/src/components/impact-graph.tsx`: graph canvas.
- Create `apps/web/src/components/impact-brief.tsx`: persistent right-side brief.
- Create `apps/web/src/components/impact-trace-panel.tsx`: bottom trace and source evidence panel.
- Create `apps/web/src/routes/impact.test.tsx`: route/component behavior test using mocked API data.
- Modify `apps/web/src/components/entity-detail.tsx`: add an Impact link action near Save/Generate Task.
- Modify `apps/web/src/styles.css`: import `@xyflow/react/dist/style.css` or add a local CSS import from the graph component if Vite handles it cleanly.

Do not edit unrelated uncommitted files. The current worktree may already contain user changes; each task must stage only the files listed in that task.

---

### Task 1: Add Impact Contracts

**Files:**
- Create: `packages/contracts/src/impact.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/impact.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `packages/contracts/src/impact.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  entityImpactQuerySchema,
  entityImpactResponseSchema
} from "./impact.js";

describe("entityImpactQuerySchema", () => {
  it("defaults to one-hop bidirectional source-inclusive impact", () => {
    expect(entityImpactQuerySchema.parse({})).toEqual({
      depth: "1",
      direction: "both",
      includeSource: true
    });
  });

  it("coerces includeSource from query-string booleans", () => {
    expect(entityImpactQuerySchema.parse({ includeSource: "false" }).includeSource).toBe(false);
    expect(entityImpactQuerySchema.parse({ includeSource: "true" }).includeSource).toBe(true);
  });
});

describe("entityImpactResponseSchema", () => {
  it("accepts graph-ready and trace-ready impact responses", () => {
    const parsed = entityImpactResponseSchema.parse({
      rootEntity: {
        entityId: "domain.decision",
        type: "domain_entity",
        title: "Decision",
        status: "draft",
        filePath: "domain/decision.md"
      },
      nodes: [
        {
          id: "spec:domain.decision",
          kind: "spec",
          label: "Decision",
          entityId: "domain.decision",
          type: "domain_entity",
          status: "draft",
          title: "Decision",
          filePath: "domain/decision.md"
        },
        {
          id: "source:src/domain.ts:Decision:domain.decision",
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
      edges: [
        {
          id: "source-evidence:src/domain.ts:Decision:domain.decision",
          from: "spec:domain.decision",
          to: "source:src/domain.ts:Decision:domain.decision",
          kind: "source_evidence",
          label: "@specops",
          entityId: "domain.decision",
          filePath: "src/domain.ts",
          symbolName: "Decision"
        }
      ],
      upstreamPaths: [],
      downstreamPaths: [],
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
      truncated: {
        isTruncated: false,
        reason: null,
        nodeCount: 2,
        edgeCount: 1,
        sourceEvidenceCount: 1
      }
    });

    expect(parsed.rootEntity.entityId).toBe("domain.decision");
    expect(parsed.nodes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- impact --run
```

Expected: FAIL because `packages/contracts/src/impact.ts` does not exist.

- [ ] **Step 3: Add the impact contracts**

Create `packages/contracts/src/impact.ts`:

```ts
import { z } from "zod";

export const impactDepthSchema = z.enum(["1", "2", "all"]);
export const impactDirectionSchema = z.enum(["both", "upstream", "downstream"]);

const queryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => (typeof value === "boolean" ? value : value === "true"));

export const entityImpactQuerySchema = z.object({
  depth: impactDepthSchema.default("1"),
  direction: impactDirectionSchema.default("both"),
  includeSource: queryBooleanSchema.default(true)
});

export const impactEntitySummarySchema = z.object({
  entityId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  filePath: z.string()
});

export const impactSpecNodeSchema = z.object({
  id: z.string(),
  kind: z.literal("spec"),
  label: z.string(),
  entityId: z.string(),
  type: z.string(),
  status: z.string(),
  title: z.string(),
  filePath: z.string()
});

export const impactSourceNodeSchema = z.object({
  id: z.string(),
  kind: z.literal("source"),
  label: z.string(),
  entityId: z.string(),
  filePath: z.string(),
  symbolName: z.string(),
  symbolKind: z.string(),
  symbolLine: z.number().nullable(),
  annotationLine: z.number().nullable()
});

export const impactNodeSchema = z.discriminatedUnion("kind", [
  impactSpecNodeSchema,
  impactSourceNodeSchema
]);

export const impactSpecEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.literal("spec_link"),
  label: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  linkType: z.string(),
  source: z.string()
});

export const impactSourceEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.literal("source_evidence"),
  label: z.string(),
  entityId: z.string(),
  filePath: z.string(),
  symbolName: z.string()
});

export const impactEdgeSchema = z.discriminatedUnion("kind", [
  impactSpecEdgeSchema,
  impactSourceEdgeSchema
]);

export const impactPathStepSchema = z.object({
  entityId: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string()
});

export const impactPathSchema = z.object({
  direction: z.enum(["upstream", "downstream"]),
  entityIds: z.array(z.string()),
  steps: z.array(impactPathStepSchema),
  linkTypes: z.array(z.string())
});

export const impactSourceEvidenceSchema = z.object({
  entityId: z.string(),
  filePath: z.string(),
  sourceFileId: z.string(),
  symbolName: z.string(),
  symbolKind: z.string(),
  symbolLine: z.number().nullable(),
  annotationLine: z.number().nullable()
});

export const impactTruncationSchema = z.object({
  isTruncated: z.boolean(),
  reason: z.string().nullable(),
  nodeCount: z.number(),
  edgeCount: z.number(),
  sourceEvidenceCount: z.number()
});

export const entityImpactResponseSchema = z.object({
  rootEntity: impactEntitySummarySchema,
  nodes: z.array(impactNodeSchema),
  edges: z.array(impactEdgeSchema),
  upstreamPaths: z.array(impactPathSchema),
  downstreamPaths: z.array(impactPathSchema),
  sourceEvidence: z.array(impactSourceEvidenceSchema),
  truncated: impactTruncationSchema
});

export type ImpactDepth = z.infer<typeof impactDepthSchema>;
export type ImpactDirection = z.infer<typeof impactDirectionSchema>;
export type EntityImpactQuery = z.infer<typeof entityImpactQuerySchema>;
export type ImpactEntitySummaryDto = z.infer<typeof impactEntitySummarySchema>;
export type ImpactNodeDto = z.infer<typeof impactNodeSchema>;
export type ImpactEdgeDto = z.infer<typeof impactEdgeSchema>;
export type ImpactPathDto = z.infer<typeof impactPathSchema>;
export type ImpactSourceEvidenceDto = z.infer<typeof impactSourceEvidenceSchema>;
export type EntityImpactResponseDto = z.infer<typeof entityImpactResponseSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./entities.js";
export * from "./impact.js";
export * from "./indexing.js";
export * from "./projects.js";
export * from "./source.js";
export * from "./validation.js";
```

- [ ] **Step 4: Run the contract test and verify it passes**

Run:

```bash
pnpm --filter @specops/contracts test -- impact --run
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

Run:

```bash
git add packages/contracts/src/impact.ts packages/contracts/src/impact.test.ts packages/contracts/src/index.ts
git commit -m "feat: add impact contracts"
```

---

### Task 2: Add Pure Impact Traversal Tests

**Files:**
- Create: `apps/api/src/services/impact-service.ts`
- Test: `apps/api/src/__tests__/impact-service.test.ts`

- [ ] **Step 1: Write failing traversal tests**

Create `apps/api/src/__tests__/impact-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildEntityImpact } from "../services/impact-service.js";

describe("buildEntityImpact", () => {
  it("returns one-hop upstream, downstream, and source evidence by default", () => {
    const impact = buildEntityImpact({
      rootEntityId: "domain.decision",
      depth: "1",
      direction: "both",
      includeSource: true,
      entities: [
        entity("uc.create-decision", "Create Decision", "use_case"),
        entity("domain.decision", "Decision", "domain_entity"),
        entity("interface.decision-service", "Decision Service", "interface"),
        entity("ui.decision-list", "Decision List", "ui_view")
      ],
      links: [
        link("uc.create-decision", "domain.decision", "uses"),
        link("domain.decision", "interface.decision-service", "documents"),
        link("interface.decision-service", "ui.decision-list", "exposes")
      ],
      sourceEvidence: [
        evidence("domain.decision", "src/domain.ts", "Decision"),
        evidence("ui.decision-list", "src/ui.tsx", "DecisionList")
      ]
    });

    expect(impact.nodes.map((node) => node.id)).toEqual([
      "spec:domain.decision",
      "spec:interface.decision-service",
      "spec:uc.create-decision",
      "source:src/domain.ts:Decision:domain.decision"
    ]);
    expect(impact.downstreamPaths.map((path) => path.entityIds)).toEqual([
      ["domain.decision", "interface.decision-service"]
    ]);
    expect(impact.upstreamPaths.map((path) => path.entityIds)).toEqual([
      ["uc.create-decision", "domain.decision"]
    ]);
    expect(impact.sourceEvidence.map((item) => item.symbolName)).toEqual(["Decision"]);
    expect(impact.truncated.isTruncated).toBe(false);
  });

  it("supports two-hop traversal and direction filters", () => {
    const impact = buildEntityImpact({
      rootEntityId: "domain.decision",
      depth: "2",
      direction: "downstream",
      includeSource: false,
      entities: [
        entity("domain.decision", "Decision", "domain_entity"),
        entity("interface.decision-service", "Decision Service", "interface"),
        entity("ui.decision-list", "Decision List", "ui_view")
      ],
      links: [
        link("domain.decision", "interface.decision-service", "documents"),
        link("interface.decision-service", "ui.decision-list", "exposes")
      ],
      sourceEvidence: [evidence("domain.decision", "src/domain.ts", "Decision")]
    });

    expect(impact.nodes.map((node) => node.id)).toEqual([
      "spec:domain.decision",
      "spec:interface.decision-service",
      "spec:ui.decision-list"
    ]);
    expect(impact.upstreamPaths).toEqual([]);
    expect(impact.downstreamPaths.map((path) => path.entityIds)).toEqual([
      ["domain.decision", "interface.decision-service"],
      ["domain.decision", "interface.decision-service", "ui.decision-list"]
    ]);
    expect(impact.sourceEvidence).toEqual([]);
  });

  it("handles cycles and truncates all-depth traversal", () => {
    const impact = buildEntityImpact({
      rootEntityId: "a",
      depth: "all",
      direction: "downstream",
      includeSource: false,
      limits: { maxSpecNodes: 2, maxSpecEdges: 2, maxSourceEvidence: 300 },
      entities: [entity("a", "A"), entity("b", "B"), entity("c", "C")],
      links: [link("a", "b", "uses"), link("b", "c", "uses"), link("c", "a", "uses")],
      sourceEvidence: []
    });

    expect(impact.nodes.map((node) => node.id)).toEqual(["spec:a", "spec:b"]);
    expect(impact.truncated).toMatchObject({
      isTruncated: true,
      reason: "spec_node_limit",
      nodeCount: 2
    });
  });
});

function entity(entityId: string, title: string, type = "domain_entity") {
  return {
    entityId,
    type,
    title,
    status: "draft",
    filePath: `${entityId}.md`
  };
}

function link(fromEntityId: string, toEntityId: string, linkType: string) {
  return {
    id: `${fromEntityId}-${toEntityId}-${linkType}`,
    fromEntityId,
    toEntityId,
    linkType,
    source: "frontmatter"
  };
}

function evidence(entityId: string, filePath: string, symbolName: string) {
  return {
    entityId,
    filePath,
    sourceFileId: `${filePath}-id`,
    symbolName,
    symbolKind: "interface",
    symbolLine: 3,
    annotationLine: 2
  };
}
```

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
pnpm --filter api test -- impact-service --run
```

Expected: FAIL because `buildEntityImpact` is not implemented.

- [ ] **Step 3: Add pure traversal types and exported helper**

Create `apps/api/src/services/impact-service.ts` with this first implementation:

```ts
import type {
  EntityImpactResponseDto,
  ImpactDepth,
  ImpactDirection,
  ImpactSourceEvidenceDto
} from "@specops/contracts";

export type ImpactEntityInput = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
};

export type ImpactLinkInput = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type BuildEntityImpactInput = {
  rootEntityId: string;
  depth: ImpactDepth;
  direction: ImpactDirection;
  includeSource: boolean;
  entities: ImpactEntityInput[];
  links: ImpactLinkInput[];
  sourceEvidence: ImpactSourceEvidenceDto[];
  limits?: ImpactLimits;
};

type ImpactLimits = {
  maxSpecNodes: number;
  maxSpecEdges: number;
  maxSourceEvidence: number;
};

const defaultLimits: ImpactLimits = {
  maxSpecNodes: 150,
  maxSpecEdges: 400,
  maxSourceEvidence: 300
};

type Direction = "upstream" | "downstream";

export function buildEntityImpact(input: BuildEntityImpactInput): EntityImpactResponseDto {
  const limits = input.limits ?? defaultLimits;
  const entityById = new Map(input.entities.map((entity) => [entity.entityId, entity]));
  const rootEntity = entityById.get(input.rootEntityId);

  if (!rootEntity) {
    throw new Error(`Root entity not found: ${input.rootEntityId}`);
  }

  const directions: Direction[] =
    input.direction === "both" ? ["upstream", "downstream"] : [input.direction];
  const includedEntityIds = new Set<string>([input.rootEntityId]);
  const includedLinkKeys = new Set<string>();
  const upstreamPaths: EntityImpactResponseDto["upstreamPaths"] = [];
  const downstreamPaths: EntityImpactResponseDto["downstreamPaths"] = [];
  let truncatedReason: string | null = null;

  for (const direction of directions) {
    const paths = traverseDirection({
      direction,
      rootEntityId: input.rootEntityId,
      depth: input.depth,
      links: input.links,
      entityById,
      limits,
      includedEntityIds,
      includedLinkKeys
    });

    if (paths.truncatedReason && !truncatedReason) {
      truncatedReason = paths.truncatedReason;
    }

    if (direction === "upstream") {
      upstreamPaths.push(...paths.paths);
    } else {
      downstreamPaths.push(...paths.paths);
    }
  }

  const sortedEntities = [...includedEntityIds]
    .map((entityId) => entityById.get(entityId))
    .filter((entity): entity is ImpactEntityInput => Boolean(entity))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));

  let sourceEvidence = input.includeSource
    ? input.sourceEvidence
        .filter((evidence) => includedEntityIds.has(evidence.entityId))
        .sort(compareSourceEvidence)
    : [];

  if (sourceEvidence.length > limits.maxSourceEvidence) {
    sourceEvidence = sourceEvidence.slice(0, limits.maxSourceEvidence);
    truncatedReason ??= "source_evidence_limit";
  }

  const specNodes = sortedEntities.map((entity) => ({
    id: specNodeId(entity.entityId),
    kind: "spec" as const,
    label: entity.title,
    ...entity
  }));

  const sourceNodes = sourceEvidence.map((evidence) => ({
    id: sourceNodeId(evidence),
    kind: "source" as const,
    label: evidence.symbolName,
    entityId: evidence.entityId,
    filePath: evidence.filePath,
    symbolName: evidence.symbolName,
    symbolKind: evidence.symbolKind,
    symbolLine: evidence.symbolLine,
    annotationLine: evidence.annotationLine
  }));

  const specEdges = input.links
    .filter((link) => includedLinkKeys.has(linkKey(link)))
    .sort(compareLinks)
    .map((link) => ({
      id: `spec-link:${link.id}`,
      from: specNodeId(link.fromEntityId),
      to: specNodeId(link.toEntityId),
      kind: "spec_link" as const,
      label: link.linkType,
      fromEntityId: link.fromEntityId,
      toEntityId: link.toEntityId,
      linkType: link.linkType,
      source: link.source
    }));

  const sourceEdges = sourceEvidence.map((evidence) => ({
    id: `source-evidence:${evidence.filePath}:${evidence.symbolName}:${evidence.entityId}`,
    from: specNodeId(evidence.entityId),
    to: sourceNodeId(evidence),
    kind: "source_evidence" as const,
    label: "@specops",
    entityId: evidence.entityId,
    filePath: evidence.filePath,
    symbolName: evidence.symbolName
  }));

  return {
    rootEntity,
    nodes: [...specNodes, ...sourceNodes],
    edges: [...specEdges, ...sourceEdges],
    upstreamPaths,
    downstreamPaths,
    sourceEvidence,
    truncated: {
      isTruncated: Boolean(truncatedReason),
      reason: truncatedReason,
      nodeCount: specNodes.length + sourceNodes.length,
      edgeCount: specEdges.length + sourceEdges.length,
      sourceEvidenceCount: sourceEvidence.length
    }
  };
}

function traverseDirection(input: {
  direction: Direction;
  rootEntityId: string;
  depth: ImpactDepth;
  links: ImpactLinkInput[];
  entityById: Map<string, ImpactEntityInput>;
  limits: ImpactLimits;
  includedEntityIds: Set<string>;
  includedLinkKeys: Set<string>;
}): { paths: EntityImpactResponseDto["upstreamPaths"]; truncatedReason: string | null } {
  const maxDepth = input.depth === "all" ? Number.POSITIVE_INFINITY : Number(input.depth);
  const queue = [{ entityId: input.rootEntityId, pathEntityIds: [input.rootEntityId], linkTypes: [] as string[] }];
  const visited = new Set<string>([`${input.direction}:${input.rootEntityId}:0`]);
  const paths: EntityImpactResponseDto["upstreamPaths"] = [];
  let truncatedReason: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = current.pathEntityIds.length - 1;

    if (currentDepth >= maxDepth) {
      continue;
    }

    const nextLinks = input.links
      .filter((link) =>
        input.direction === "downstream"
          ? link.fromEntityId === current.entityId
          : link.toEntityId === current.entityId
      )
      .sort(compareLinks);

    for (const link of nextLinks) {
      const nextEntityId =
        input.direction === "downstream" ? link.toEntityId : link.fromEntityId;
      const nextEntity = input.entityById.get(nextEntityId);
      if (!nextEntity) {
        continue;
      }

      if (!input.includedEntityIds.has(nextEntityId)) {
        if (input.includedEntityIds.size >= input.limits.maxSpecNodes) {
          truncatedReason = "spec_node_limit";
          continue;
        }
        input.includedEntityIds.add(nextEntityId);
      }

      if (!input.includedLinkKeys.has(linkKey(link))) {
        if (input.includedLinkKeys.size >= input.limits.maxSpecEdges) {
          truncatedReason ??= "spec_edge_limit";
          continue;
        }
        input.includedLinkKeys.add(linkKey(link));
      }

      const nextPathEntityIds =
        input.direction === "downstream"
          ? [...current.pathEntityIds, nextEntityId]
          : [nextEntityId, ...current.pathEntityIds];
      const nextLinkTypes =
        input.direction === "downstream"
          ? [...current.linkTypes, link.linkType]
          : [link.linkType, ...current.linkTypes];

      paths.push({
        direction: input.direction,
        entityIds: nextPathEntityIds,
        steps: nextPathEntityIds.map((entityId) => {
          const entity = input.entityById.get(entityId)!;
          return {
            entityId: entity.entityId,
            title: entity.title,
            type: entity.type,
            status: entity.status
          };
        }),
        linkTypes: nextLinkTypes
      });

      if (!current.pathEntityIds.includes(nextEntityId)) {
        const visitKey = `${input.direction}:${nextEntityId}:${currentDepth + 1}`;
        if (!visited.has(visitKey)) {
          visited.add(visitKey);
          queue.push({
            entityId: nextEntityId,
            pathEntityIds:
              input.direction === "downstream"
                ? [...current.pathEntityIds, nextEntityId]
                : [nextEntityId, ...current.pathEntityIds],
            linkTypes: nextLinkTypes
          });
        }
      }
    }
  }

  return { paths, truncatedReason };
}

function specNodeId(entityId: string) {
  return `spec:${entityId}`;
}

function sourceNodeId(evidence: ImpactSourceEvidenceDto) {
  return `source:${evidence.filePath}:${evidence.symbolName}:${evidence.entityId}`;
}

function linkKey(link: Pick<ImpactLinkInput, "id">) {
  return link.id;
}

function compareLinks(left: ImpactLinkInput, right: ImpactLinkInput) {
  return (
    left.fromEntityId.localeCompare(right.fromEntityId) ||
    left.toEntityId.localeCompare(right.toEntityId) ||
    left.linkType.localeCompare(right.linkType) ||
    left.source.localeCompare(right.source) ||
    left.id.localeCompare(right.id)
  );
}

function compareSourceEvidence(left: ImpactSourceEvidenceDto, right: ImpactSourceEvidenceDto) {
  return (
    left.entityId.localeCompare(right.entityId) ||
    left.filePath.localeCompare(right.filePath) ||
    left.symbolName.localeCompare(right.symbolName)
  );
}
```

- [ ] **Step 4: Run the service test and verify it passes**

Run:

```bash
pnpm --filter api test -- impact-service --run
```

Expected: PASS.

- [ ] **Step 5: Commit traversal helper**

Run:

```bash
git add apps/api/src/services/impact-service.ts apps/api/src/__tests__/impact-service.test.ts
git commit -m "feat: add impact traversal"
```

---

### Task 3: Add Database-Backed Impact Service And Route

**Files:**
- Modify: `apps/api/src/services/impact-service.ts`
- Modify: `apps/api/src/routes/entities.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing route test**

Add this test inside `describeWithDb("database-backed routes", () => { ... })` in `apps/api/src/__tests__/routes.test.ts` near the source-link route tests:

```ts
  it("returns entity impact with spec links and source evidence", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await mkdir(path.join(project.specopsPath, "domain"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "interfaces"), { recursive: true });
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    await mkdir(path.join(project.repoPath, "src"), { recursive: true });
    await writeFile(
      path.join(project.specopsPath, "domain", "decision.md"),
      "---\n" +
        "id: domain.decision\n" +
        "type: domain_entity\n" +
        "title: Decision\n" +
        "status: draft\n" +
        "links:\n" +
        "  interfaces:\n" +
        "    - interface.decision-service\n" +
        "---\n\n" +
        "# Decision\n"
    );
    await writeFile(
      path.join(project.specopsPath, "interfaces", "decision-service.md"),
      "---\n" +
        "id: interface.decision-service\n" +
        "type: interface\n" +
        "title: Decision Service\n" +
        "status: draft\n" +
        "---\n\n" +
        "# Decision Service\n"
    );
    await writeFile(
      path.join(project.specopsPath, "use-cases", "create-decision.md"),
      "---\n" +
        "id: uc.create-decision\n" +
        "type: use_case\n" +
        "title: Create Decision\n" +
        "status: draft\n" +
        "links:\n" +
        "  domain:\n" +
        "    - domain.decision\n" +
        "---\n\n" +
        "# Create Decision\n"
    );
    await writeFile(
      path.join(project.repoPath, "src", "decision.ts"),
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision {}\n"
    );

    const indexResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/index`
    });
    expect(indexResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/entities/domain.decision/impact?depth=1&direction=both&includeSource=true`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rootEntity: {
        entityId: "domain.decision",
        title: "Decision"
      },
      truncated: {
        isTruncated: false
      }
    });
    expect(response.json().nodes).toContainEqual(
      expect.objectContaining({ id: "spec:domain.decision", kind: "spec" })
    );
    expect(response.json().nodes).toContainEqual(
      expect.objectContaining({
        kind: "source",
        entityId: "domain.decision",
        filePath: "src/decision.ts",
        symbolName: "Decision"
      })
    );
    expect(response.json().upstreamPaths.map((path: { entityIds: string[] }) => path.entityIds)).toEqual([
      ["uc.create-decision", "domain.decision"]
    ]);
    expect(response.json().downstreamPaths.map((path: { entityIds: string[] }) => path.entityIds)).toEqual([
      ["domain.decision", "interface.decision-service"]
    ]);
  });
```

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: FAIL with 404 for the impact endpoint if the test database is available. If `TEST_DATABASE_URL` is not available, record that database-backed route verification was skipped by the existing test guard.

- [ ] **Step 3: Add database reads to the impact service**

Modify `apps/api/src/services/impact-service.ts` by adding imports at the top:

```ts
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@specops/db";
import { sourceSpecLinks, specEntities, specLinks } from "@specops/db";

import { NotFoundError } from "../lib/http-errors.js";
import { createProjectService } from "./project-service.js";
```

Then add the service factory before the pure helper exports:

```ts
export function createImpactService(db: Db) {
  const projectService = createProjectService(db);

  return {
    async getEntityImpact(input: {
      projectId: string;
      entityId: string;
      depth: ImpactDepth;
      direction: ImpactDirection;
      includeSource: boolean;
    }): Promise<EntityImpactResponseDto> {
      await projectService.getProject(input.projectId);

      const entityRows = await db
        .select()
        .from(specEntities)
        .where(eq(specEntities.projectId, input.projectId))
        .orderBy(asc(specEntities.entityId));

      const root = entityRows.find((entity) => entity.entityId === input.entityId);
      if (!root) {
        throw new NotFoundError("Entity not found", {
          projectId: input.projectId,
          entityId: input.entityId
        });
      }

      const linkRows = await db
        .select()
        .from(specLinks)
        .where(eq(specLinks.projectId, input.projectId))
        .orderBy(
          asc(specLinks.fromEntityId),
          asc(specLinks.toEntityId),
          asc(specLinks.linkType),
          asc(specLinks.source)
        );

      const sourceRows = input.includeSource
        ? await db
            .select()
            .from(sourceSpecLinks)
            .where(eq(sourceSpecLinks.projectId, input.projectId))
            .orderBy(
              asc(sourceSpecLinks.entityId),
              asc(sourceSpecLinks.filePath),
              asc(sourceSpecLinks.symbolName)
            )
        : [];

      return buildEntityImpact({
        rootEntityId: input.entityId,
        depth: input.depth,
        direction: input.direction,
        includeSource: input.includeSource,
        entities: entityRows.map((entity) => ({
          entityId: entity.entityId,
          type: entity.type,
          title: entity.title,
          status: entity.status,
          filePath: entity.filePath
        })),
        links: linkRows.map((link) => ({
          id: link.id,
          fromEntityId: link.fromEntityId,
          toEntityId: link.toEntityId,
          linkType: link.linkType,
          source: link.source
        })),
        sourceEvidence: sourceRows.map((link) => ({
          entityId: link.entityId,
          filePath: link.filePath,
          sourceFileId: link.sourceFileId,
          symbolName: link.symbolName,
          symbolKind: link.symbolKind,
          symbolLine: link.symbolLine,
          annotationLine: link.annotationLine
        }))
      });
    }
  };
}
```

Remove unused imports if TypeScript reports any.

- [ ] **Step 4: Register the route**

Modify `apps/api/src/routes/entities.ts`.

Add imports:

```ts
import { entityImpactQuerySchema } from "@specops/contracts";
import { createImpactService } from "../services/impact-service.js";
```

Inside `registerEntityRoutes`, create the service:

```ts
  const impactService = createImpactService(db);
```

Add this route after `GET /projects/:projectId/entities/:entityId/source-links`:

```ts
  app.get("/projects/:projectId/entities/:entityId/impact", async (request) => {
    const { projectId, entityId } = entityParamsSchema.parse(request.params);
    const query = entityImpactQuerySchema.parse(request.query);

    return impactService.getEntityImpact({
      projectId,
      entityId,
      depth: query.depth,
      direction: query.direction,
      includeSource: query.includeSource
    });
  });
```

- [ ] **Step 5: Run route and service tests**

Run:

```bash
pnpm --filter api test -- impact-service --run
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: PASS for `impact-service`. Expected: PASS for `routes` when the test database is running and migrated.

- [ ] **Step 6: Commit API route**

Run:

```bash
git add apps/api/src/services/impact-service.ts apps/api/src/routes/entities.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: expose entity impact API"
```

---

### Task 4: Add Web API Client And Impact Route Shell

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/routes/impact.tsx`
- Test: `apps/web/src/routes/impact.test.tsx`

- [ ] **Step 1: Write a failing route shell test**

Create `apps/web/src/routes/impact.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EntityImpactResponseDto } from "@specops/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImpactPage } from "./impact.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    const suffix = search?.depth ? `?depth=${search.depth}` : "";
    return <a href={`/projects/${params?.projectId}/entities/${params?.entityId}${suffix}`}>{children}</a>;
  },
  useNavigate: () => vi.fn()
}));

vi.mock("../api/queries.js", async () => {
  const actual = await vi.importActual<typeof import("../api/queries.js")>("../api/queries.js");
  return {
    ...actual,
    entityImpactQuery: () => ({
      queryKey: ["impact-test"],
      queryFn: async () => impactResponse()
    })
  };
});

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ImpactPage", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    for (const container of containers.splice(0)) {
      container.remove();
    }
  });

  it("renders impact controls, counts, and navigation", async () => {
    const { container } = await renderImpactPage();

    expect(container.textContent).toContain("Decision");
    expect(container.textContent).toContain("Depth");
    expect(container.textContent).toContain("Direction");
    expect(container.textContent).toContain("Source evidence");
    expect(container.textContent).toContain("Upstream");
    expect(container.textContent).toContain("Downstream");
    expect(container.textContent).toContain("src/domain.ts");
    expect(container.innerHTML).toContain("/projects/project-1/entities/domain.decision");
  });
});

async function renderImpactPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ImpactPage
          projectId="project-1"
          entityId="domain.decision"
          depth="1"
          direction="both"
          includeSource={true}
        />
      </QueryClientProvider>
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  return { container, root };
}

function impactResponse(): EntityImpactResponseDto {
  return {
    rootEntity: {
      entityId: "domain.decision",
      type: "domain_entity",
      title: "Decision",
      status: "draft",
      filePath: "domain/decision.md"
    },
    nodes: [
      {
        id: "spec:domain.decision",
        kind: "spec",
        label: "Decision",
        entityId: "domain.decision",
        type: "domain_entity",
        status: "draft",
        title: "Decision",
        filePath: "domain/decision.md"
      },
      {
        id: "source:src/domain.ts:Decision:domain.decision",
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
    edges: [
      {
        id: "source-evidence:src/domain.ts:Decision:domain.decision",
        from: "spec:domain.decision",
        to: "source:src/domain.ts:Decision:domain.decision",
        kind: "source_evidence",
        label: "@specops",
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        symbolName: "Decision"
      }
    ],
    upstreamPaths: [],
    downstreamPaths: [],
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
    truncated: {
      isTruncated: false,
      reason: null,
      nodeCount: 2,
      edgeCount: 1,
      sourceEvidenceCount: 1
    }
  };
}
```

- [ ] **Step 2: Run the web route test and verify it fails**

Run:

```bash
pnpm --filter web test -- src/routes/impact.test.tsx
```

Expected: FAIL because `apps/web/src/routes/impact.tsx` does not exist.

- [ ] **Step 3: Add query helper**

Modify `apps/web/src/api/queries.ts`.

Add imports:

```ts
  EntityImpactQuery,
  EntityImpactResponseDto,
```

Add query key:

```ts
  entityImpact: (projectId: string, entityId: string, input: EntityImpactQuery) =>
    ["projects", projectId, "entities", entityId, "impact", input] as const,
```

Add query function:

```ts
export function entityImpactQuery(
  projectId: string,
  entityId: string,
  input: EntityImpactQuery
) {
  const search = new URLSearchParams({
    depth: input.depth,
    direction: input.direction,
    includeSource: String(input.includeSource)
  });

  return queryOptions({
    queryKey: queryKeys.entityImpact(projectId, entityId, input),
    queryFn: () =>
      apiGet<EntityImpactResponseDto>(
        `/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(
          entityId
        )}/impact?${search.toString()}`
      )
  });
}
```

- [ ] **Step 4: Add page shell**

Create `apps/web/src/routes/impact.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EntityImpactQuery, ImpactDepth, ImpactDirection } from "@specops/contracts";
import { ArrowLeft, FileText } from "lucide-react";

import { entityImpactQuery } from "../api/queries.js";

type ImpactPageProps = {
  projectId: string;
  entityId: string;
  depth: ImpactDepth;
  direction: ImpactDirection;
  includeSource: boolean;
};

export function ImpactPage({
  projectId,
  entityId,
  depth,
  direction,
  includeSource
}: ImpactPageProps) {
  const navigate = useNavigate();
  const queryInput: EntityImpactQuery = { depth, direction, includeSource };
  const impact = useQuery(entityImpactQuery(projectId, entityId, queryInput));

  function updateSearch(next: Partial<EntityImpactQuery>) {
    navigate({
      to: "/projects/$projectId/impact/$entityId",
      params: { projectId, entityId },
      search: {
        depth: next.depth ?? depth,
        direction: next.direction ?? direction,
        includeSource: String(next.includeSource ?? includeSource)
      }
    });
  }

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-3 flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {impact.data?.rootEntity.title ?? entityId}
          </h1>
          <p className="truncate text-sm text-slate-600">
            Impact view / {impact.data?.rootEntity.entityId ?? entityId}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="field min-w-32">
            <span>Depth</span>
            <select
              className="input h-9 py-1"
              value={depth}
              onChange={(event) => updateSearch({ depth: event.target.value as ImpactDepth })}
            >
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="all">All reachable</option>
            </select>
          </label>
          <label className="field min-w-36">
            <span>Direction</span>
            <select
              className="input h-9 py-1"
              value={direction}
              onChange={(event) =>
                updateSearch({ direction: event.target.value as ImpactDirection })
              }
            >
              <option value="both">Both</option>
              <option value="upstream">Upstream</option>
              <option value="downstream">Downstream</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeSource}
              onChange={(event) => updateSearch({ includeSource: event.target.checked })}
            />
            Source evidence
          </label>
          <Link
            to="/projects/$projectId/entities/$entityId"
            params={{ projectId, entityId }}
            className="button-secondary"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Open Editor
          </Link>
          <Link to="/projects/$projectId" params={{ projectId }} className="button-secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Project
          </Link>
        </div>
      </div>

      {impact.isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Loading impact...
        </div>
      ) : impact.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {impact.error.message}
        </div>
      ) : impact.data ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 text-sm text-slate-500">
              Graph canvas
            </div>
            <div className="border-t border-slate-200 p-3 text-sm text-slate-700">
              <h2 className="section-heading">Trace Details</h2>
              <p className="mt-2">
                Upstream {impact.data.upstreamPaths.length} / Downstream{" "}
                {impact.data.downstreamPaths.length} / Source {impact.data.sourceEvidence.length}
              </p>
              <ul className="mt-2 grid gap-1 text-xs text-slate-600">
                {impact.data.sourceEvidence.map((item) => (
                  <li key={`${item.entityId}-${item.filePath}-${item.symbolName}`}>
                    {item.filePath} / {item.symbolName}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <aside className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3">
            <h2 className="section-heading">Impact Brief</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Upstream</dt>
                <dd className="font-semibold">{impact.data.upstreamPaths.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Downstream</dt>
                <dd className="font-semibold">{impact.data.downstreamPaths.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Source evidence</dt>
                <dd className="font-semibold">{impact.data.sourceEvidence.length}</dd>
              </div>
            </dl>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 5: Register the route**

Modify `apps/web/src/app.tsx`.

Add import:

```ts
import { ImpactPage } from "./routes/impact.js";
```

Add helper near route definitions:

```ts
function parseImpactSearch(search: Record<string, unknown>) {
  return {
    depth: search.depth === "2" || search.depth === "all" ? search.depth : "1",
    direction:
      search.direction === "upstream" || search.direction === "downstream"
        ? search.direction
        : "both",
    includeSource: search.includeSource === "false" ? false : true
  } as const;
}
```

Add route:

```ts
const impactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/impact/$entityId",
  validateSearch: parseImpactSearch,
  component: () => {
    const { projectId, entityId } = impactRoute.useParams();
    const { depth, direction, includeSource } = impactRoute.useSearch();
    return (
      <ImpactPage
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

Update route tree:

```ts
const routeTree = rootRoute.addChildren([projectsRoute, projectRoute, entityRoute, impactRoute]);
```

- [ ] **Step 6: Run web route test**

Run:

```bash
pnpm --filter web test -- src/routes/impact.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit route shell**

Run:

```bash
git add apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/routes/impact.tsx apps/web/src/routes/impact.test.tsx
git commit -m "feat: add impact route shell"
```

---

### Task 5: Add Impact Graph, Brief, And Trace Components

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/impact-graph.tsx`
- Create: `apps/web/src/components/impact-brief.tsx`
- Create: `apps/web/src/components/impact-trace-panel.tsx`
- Modify: `apps/web/src/routes/impact.tsx`
- Test: `apps/web/src/routes/impact.test.tsx`

- [ ] **Step 1: Install graph dependency**

Run:

```bash
pnpm --filter web add @xyflow/react
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Extend route test expectations**

Modify the existing `renders impact controls, counts, and navigation` test in `apps/web/src/routes/impact.test.tsx` to add:

```ts
    expect(container.querySelector('[data-testid="impact-graph"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="impact-brief"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="impact-trace-panel"]')).not.toBeNull();
```

- [ ] **Step 3: Run test and verify it fails**

Run:

```bash
pnpm --filter web test -- src/routes/impact.test.tsx
```

Expected: FAIL because the component test ids do not exist yet.

- [ ] **Step 4: Add graph component**

Create `apps/web/src/components/impact-graph.tsx`:

```tsx
import { useMemo } from "react";
import type { EntityImpactResponseDto, ImpactNodeDto } from "@specops/contracts";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type ImpactGraphProps = {
  impact: EntityImpactResponseDto;
  selectedNodeId: string | null;
  onSelectNode: (node: ImpactNodeDto) => void;
};

export function ImpactGraph({ impact, selectedNodeId, onSelectNode }: ImpactGraphProps) {
  const nodes = useMemo<Node[]>(
    () =>
      impact.nodes.map((node, index) => ({
        id: node.id,
        position: layoutPosition(index, node.kind),
        data: { label: node.label },
        className: nodeClassName(node, selectedNodeId)
      })),
    [impact.nodes, selectedNodeId]
  );

  const edges = useMemo<Edge[]>(
    () =>
      impact.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        animated: edge.kind === "source_evidence"
      })),
    [impact.edges]
  );

  if (impact.nodes.length === 1 && impact.edges.length === 0) {
    return (
      <div
        data-testid="impact-graph"
        className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-500"
      >
        No linked specs or source evidence match the current filters.
      </div>
    );
  }

  return (
    <div data-testid="impact-graph" className="min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_event, node) => {
          const impactNode = impact.nodes.find((candidate) => candidate.id === node.id);
          if (impactNode) {
            onSelectNode(impactNode);
          }
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function layoutPosition(index: number, kind: ImpactNodeDto["kind"]) {
  const column = kind === "source" ? 2 : index % 2;
  const row = Math.floor(index / 2);
  return { x: column * 280, y: row * 120 };
}

function nodeClassName(node: ImpactNodeDto, selectedNodeId: string | null) {
  const base =
    node.kind === "source"
      ? "rounded border border-teal-300 bg-teal-50 px-3 py-2 text-xs text-teal-950"
      : "rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950";
  return node.id === selectedNodeId ? `${base} ring-2 ring-slate-900` : base;
}
```

- [ ] **Step 5: Add brief component**

Create `apps/web/src/components/impact-brief.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { EntityImpactResponseDto, ImpactNodeDto } from "@specops/contracts";

type ImpactBriefProps = {
  projectId: string;
  impact: EntityImpactResponseDto;
  selectedNode: ImpactNodeDto | null;
};

export function ImpactBrief({ projectId, impact, selectedNode }: ImpactBriefProps) {
  return (
    <aside
      data-testid="impact-brief"
      className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3"
    >
      <h2 className="section-heading">Impact Brief</h2>
      {impact.truncated.isTruncated ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Results truncated: {impact.truncated.reason}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm lg:grid-cols-1">
        <Metric label="Upstream" value={impact.upstreamPaths.length} />
        <Metric label="Downstream" value={impact.downstreamPaths.length} />
        <Metric label="Source" value={impact.sourceEvidence.length} />
      </dl>
      <section className="mt-4 border-t border-slate-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-800">Selection</h3>
        {selectedNode ? (
          <div className="mt-2 text-sm text-slate-700">
            <p className="font-medium">{selectedNode.label}</p>
            <p className="mt-1 text-xs text-slate-500">{selectedNode.kind}</p>
            {selectedNode.kind === "spec" ? (
              <Link
                to="/projects/$projectId/entities/$entityId"
                params={{ projectId, entityId: selectedNode.entityId }}
                className="mt-3 inline-flex text-xs font-medium text-slate-800 underline"
              >
                Open spec
              </Link>
            ) : (
              <p className="mt-3 text-xs text-slate-600">{selectedNode.filePath}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Select a graph node for details.</p>
        )}
      </section>
      <section className="mt-4 border-t border-slate-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-800">Top paths</h3>
        <ul className="mt-2 grid gap-2 text-xs text-slate-600">
          {[...impact.upstreamPaths, ...impact.downstreamPaths].slice(0, 5).map((path) => (
            <li key={`${path.direction}-${path.entityIds.join(">")}`} className="rounded bg-slate-50 p-2">
              {path.entityIds.join(" -> ")}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50 p-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 6: Add trace panel**

Create `apps/web/src/components/impact-trace-panel.tsx`:

```tsx
import type { EntityImpactResponseDto, ImpactPathDto } from "@specops/contracts";

export function ImpactTracePanel({ impact }: { impact: EntityImpactResponseDto }) {
  return (
    <section
      data-testid="impact-trace-panel"
      className="max-h-64 shrink-0 overflow-auto border-t border-slate-200 p-3"
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <PathList title="Upstream paths" paths={impact.upstreamPaths} />
        <PathList title="Downstream paths" paths={impact.downstreamPaths} />
        <section>
          <h3 className="text-sm font-semibold text-slate-800">Source evidence</h3>
          {impact.sourceEvidence.length > 0 ? (
            <ul className="mt-2 grid gap-2 text-xs text-slate-600">
              {impact.sourceEvidence.map((item) => (
                <li
                  key={`${item.entityId}-${item.filePath}-${item.symbolName}`}
                  className="rounded border border-slate-100 bg-slate-50 p-2"
                >
                  <span className="font-medium text-slate-800">{item.symbolName}</span>
                  <span className="block truncate">{item.filePath}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No source evidence.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function PathList({ title, paths }: { title: string; paths: ImpactPathDto[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {paths.length > 0 ? (
        <ul className="mt-2 grid gap-2 text-xs text-slate-600">
          {paths.map((path) => (
            <li
              key={`${path.direction}-${path.entityIds.join(">")}`}
              className="rounded border border-slate-100 bg-slate-50 p-2"
            >
              {path.entityIds.join(" -> ")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No paths.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Wire components into impact route**

Modify `apps/web/src/routes/impact.tsx`.

Add imports:

```tsx
import { useMemo, useState } from "react";
import type { ImpactNodeDto } from "@specops/contracts";
import { ImpactBrief } from "../components/impact-brief.js";
import { ImpactGraph } from "../components/impact-graph.js";
import { ImpactTracePanel } from "../components/impact-trace-panel.js";
```

Inside `ImpactPage`, add state after the query:

```tsx
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = useMemo<ImpactNodeDto | null>(
    () => impact.data?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [impact.data?.nodes, selectedNodeId]
  );
```

Replace the populated-state layout with:

```tsx
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
            <ImpactGraph
              impact={impact.data}
              selectedNodeId={selectedNodeId}
              onSelectNode={(node) => setSelectedNodeId(node.id)}
            />
            <ImpactTracePanel impact={impact.data} />
          </section>
          <ImpactBrief projectId={projectId} impact={impact.data} selectedNode={selectedNode} />
        </div>
```

- [ ] **Step 8: Run route test**

Run:

```bash
pnpm --filter web test -- src/routes/impact.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit graph UI**

Run:

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/impact-graph.tsx apps/web/src/components/impact-brief.tsx apps/web/src/components/impact-trace-panel.tsx apps/web/src/routes/impact.tsx apps/web/src/routes/impact.test.tsx
git commit -m "feat: render entity impact graph"
```

---

### Task 6: Link Entity Detail To Impact View

**Files:**
- Modify: `apps/web/src/components/entity-detail.tsx`
- Test: `apps/web/src/components/entity-detail.test.tsx`

- [ ] **Step 1: Add failing test expectation**

Open `apps/web/src/components/entity-detail.test.tsx`. If the file does not already render the header actions, add a focused test with mocked queries. The assertion to add is:

```ts
expect(container.innerHTML).toContain("/projects/project-1/impact/domain.decision");
expect(container.textContent).toContain("Impact");
```

Use the existing entity fixture in that test file. If the file has no reusable fixture, render `EntityDetail` with mocked `entityQuery`, `entitySourceLinksQuery`, `outgoingLinksQuery`, `backlinksQuery`, and `validationMessagesQuery` returning a loaded `domain.decision` entity and empty links.

- [ ] **Step 2: Run the entity detail test and verify it fails**

Run:

```bash
pnpm --filter web test -- src/components/entity-detail.test.tsx
```

Expected: FAIL because there is no Impact link.

- [ ] **Step 3: Add the Impact action**

Modify `apps/web/src/components/entity-detail.tsx`.

Add import:

```tsx
import { Link } from "@tanstack/react-router";
import { Network } from "lucide-react";
```

Keep existing `Bot` and `Save` imports by changing the lucide import to:

```tsx
import { Bot, Network, Save } from "lucide-react";
```

Inside the header button group that currently renders Generate Task and Save, add this link before Generate Task:

```tsx
                <Link
                  to="/projects/$projectId/impact/$entityId"
                  params={{ projectId, entityId }}
                  search={{ depth: "1", direction: "both", includeSource: "true" }}
                  className="button-secondary"
                  onClick={(event) => {
                    if (isDirty && onBeforeSelect && !onBeforeSelect()) {
                      event.preventDefault();
                    }
                  }}
                >
                  <Network className="h-4 w-4" aria-hidden="true" />
                  Impact
                </Link>
```

- [ ] **Step 4: Run entity detail test**

Run:

```bash
pnpm --filter web test -- src/components/entity-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit entity link**

Run:

```bash
git add apps/web/src/components/entity-detail.tsx apps/web/src/components/entity-detail.test.tsx
git commit -m "feat: link specs to impact view"
```

---

### Task 7: Run Focused And Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @specops/contracts test -- impact --run
pnpm --filter api test -- impact-service --run
pnpm --filter web test -- src/routes/impact.test.tsx
pnpm --filter web test -- src/components/entity-detail.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Run database-backed route test when PostgreSQL is available**

Run:

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes --run
```

Expected: PASS. If the database is unavailable, record the skipped verification and the reason.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Run web build**

Run:

```bash
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 5: Browser verification**

Start local services if they are not already running:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5176`, create or open a sample project, index it, select an entity, click Impact, and verify:

- The route is `/projects/:projectId/impact/:entityId`.
- The graph area is nonblank when linked data exists.
- Depth, direction, and source evidence controls update the URL and reload the query.
- The right brief shows counts and selected-node details.
- The bottom trace panel shows upstream paths, downstream paths, and source evidence.
- Open Editor returns to the entity editor.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional changes remain. If unrelated pre-existing files are still modified, leave them unstaged and mention them in the handoff.

- [ ] **Step 7: Commit verification fixes if needed**

If verification required small fixes, stage only the files changed by those fixes and commit:

```bash
git add <exact changed files>
git commit -m "fix: polish impact graph behavior"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Dedicated route: Task 4.
- Configurable depth, direction, and source toggle: Tasks 1, 3, and 4.
- Deterministic spec traversal: Task 2.
- Source evidence attachment: Tasks 2 and 3.
- Graph canvas: Task 5.
- Right impact brief and bottom trace panel: Task 5.
- Entity editor navigation: Task 6.
- API, service, UI, typecheck, build, and browser verification: Tasks 1 through 7.

Type consistency:

- Query values use `ImpactDepth`, `ImpactDirection`, and `EntityImpactQuery` from `packages/contracts/src/impact.ts`.
- API response uses `EntityImpactResponseDto`.
- Node and edge `kind` values are `spec`, `source`, `spec_link`, and `source_evidence`.
- Route query string uses string values for URL search and parses back into contract-compatible values.
