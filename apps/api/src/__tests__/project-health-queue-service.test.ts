import { readFile } from "node:fs/promises";
import path from "node:path";

import { healthQueueResponseSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  createDb,
  indexRuns,
  projectConceptMemberships,
  projectConceptVersions,
  projectConcepts,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  projects,
  sourceSpecAnnotations,
  specEntities,
  specLinks,
} from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { NotFoundError } from "../lib/http-errors.js";
import {
  buildHealthQueueSummary,
  compareHealthQueueItems,
  createProjectHealthQueueService,
  healthQueueItemId,
  isUsefulSourceNode,
} from "../services/project-health-queue-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describe("project health queue helpers", () => {
  it("builds deterministic item ids", () => {
    expect(healthQueueItemId("spec_missing_source_evidence", "uc.checkout")).toBe(
      "spec_missing_source_evidence:uc.checkout",
    );
  });

  it("counts summary totals by family, severity, and kind", () => {
    expect(
      buildHealthQueueSummary([
        healthItem({ family: "spec", kind: "spec_readiness_failed", severity: "blocker" }),
        healthItem({ family: "source", kind: "source_without_spec", severity: "review" }),
        healthItem({ family: "source", kind: "source_without_spec", severity: "context" }),
      ]),
    ).toEqual({
      total: 3,
      byFamily: { spec: 1, source: 2, concept: 0 },
      bySeverity: { blocker: 1, review: 1, context: 1 },
      byKind: {
        spec_readiness_failed: 1,
        source_without_spec: 2,
      },
    });
  });

  it("sorts blocker spec items before review source items", () => {
    const sorted = [
      healthItem({
        id: "source_without_spec:apps/web/src/Checkout.tsx",
        family: "source",
        kind: "source_without_spec",
        severity: "review",
        title: "Source without spec",
      }),
      healthItem({
        id: "spec_readiness_failed:uc.checkout",
        family: "spec",
        kind: "spec_readiness_failed",
        severity: "blocker",
        title: "Spec readiness failed",
      }),
    ].sort(compareHealthQueueItems);

    expect(sorted.map((item) => item.id)).toEqual([
      "spec_readiness_failed:uc.checkout",
      "source_without_spec:apps/web/src/Checkout.tsx",
    ]);
  });

  it("filters out test, config, external, unresolved, and unknown source nodes", () => {
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/routes/checkout.ts", classification: "route" })),
    ).toBe(true);
    expect(
      isUsefulSourceNode(sourceNode({ nodeType: "symbol", path: "apps/web/src/routes/checkout.ts" })),
    ).toBe(true);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/routes/checkout.test.ts", classification: "source" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/vite.config.ts", classification: "source" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/setup.ts", classification: "config" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ nodeType: "external_dependency", path: "react", classification: "source" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ nodeType: "unresolved_import", path: "apps/web/src/missing.ts" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/unknown.ts", classification: "unknown" })),
    ).toBe(false);
    expect(isUsefulSourceNode(sourceNode({ path: null, classification: "source" }))).toBe(false);
  });

  it("filters out generated source nodes", () => {
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/generated/client.ts", classification: "source" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/client.generated.ts", classification: "source" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/__generated__/client.ts", classification: "source" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/client.ts", classification: "generated" })),
    ).toBe(false);
    expect(
      isUsefulSourceNode(sourceNode({ path: "apps/web/src/client.ts", classification: "source", generated: true })),
    ).toBe(false);
  });
});

describeWithDb("createProjectHealthQueueService", () => {
  const projectIds: string[] = [];
  let db: Db;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }

    await migrateTestDatabase(testDatabaseUrl);
    db = createDb(testDatabaseUrl);
  });

  afterEach(async () => {
    for (const projectId of projectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("throws NotFoundError for an unknown project", async () => {
    await expect(
      createProjectHealthQueueService(db).getProjectHealthQueue("00000000-0000-4000-8000-000000000999"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createProjectHealthQueueService(db).getProjectHealthQueue("00000000-0000-4000-8000-000000000999"),
    ).rejects.toMatchObject({ message: "Project not found" });
  });

  it("reports specs missing source evidence", async () => {
    const project = await createProjectFixture(db, projectIds);
    await createSpecFixture(db, project.id, {
      entityId: "uc.checkout",
      type: "use_case",
      title: "Checkout use case",
    });

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(itemKinds(response.items)).toContain("spec_missing_source_evidence");
    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "spec_missing_source_evidence:uc.checkout",
        family: "spec",
        severity: "review",
        primaryTarget: expect.objectContaining({ kind: "spec", entityId: "uc.checkout" }),
      }),
    );
    expect(healthQueueResponseSchema.parse(response)).toEqual(response);
  });

  it("reports orphaned specs", async () => {
    const project = await createProjectFixture(db, projectIds);
    await createSpecFixture(db, project.id, {
      entityId: "domain.orphaned",
      type: "domain_entity",
      title: "Orphaned domain",
      status: "draft",
    });
    await createSpecFixture(db, project.id, {
      entityId: "domain.linked",
      type: "domain_entity",
      title: "Linked domain",
      status: "draft",
    });
    await createSpecFixture(db, project.id, {
      entityId: "domain.target",
      type: "domain_entity",
      title: "Target domain",
      status: "draft",
    });
    await db.insert(specLinks).values({
      projectId: project.id,
      fromEntityId: "domain.linked",
      toEntityId: "domain.target",
      linkType: "relates_to",
      source: "test",
    });

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "spec_orphaned:domain.orphaned",
        kind: "spec_orphaned",
        primaryTarget: expect.objectContaining({ kind: "spec", entityId: "domain.orphaned" }),
      }),
    );
    expect(response.items).not.toContainEqual(
      expect.objectContaining({ id: "spec_orphaned:domain.linked" }),
    );
  });

  it("does not report missing source evidence when active annotation exists", async () => {
    const project = await createProjectFixture(db, projectIds);
    await createSpecFixture(db, project.id, {
      entityId: "uc.checkout",
      type: "use_case",
      title: "Checkout use case",
    });
    await db.insert(sourceSpecAnnotations).values({
      projectId: project.id,
      sourceFilePath: "apps/web/src/checkout.ts",
      entityId: "uc.checkout",
      specFilePath: "spec/use-cases/checkout.md",
      relationshipType: "implements",
      provenance: "test",
      status: "active",
    });

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.items).not.toContainEqual(
      expect.objectContaining({
        kind: "spec_missing_source_evidence",
        primaryTarget: expect.objectContaining({ kind: "spec", entityId: "uc.checkout" }),
      }),
    );
  });

  it("reports useful source graph nodes without spec support", async () => {
    const project = await createProjectFixture(db, projectIds);
    const { graphVersion } = await createGraphFixture(db, project.id, "ready");
    const [fileNode, coveredNode, testNode] = await db
      .insert(projectGraphNodes)
      .values([
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/routes/checkout.ts",
          label: "checkout.ts",
          path: "apps/web/src/routes/checkout.ts",
          metadataJson: { classification: "route" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/routes/cart.ts",
          label: "cart.ts",
          path: "apps/web/src/routes/cart.ts",
          metadataJson: { classification: "route" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/routes/cart.test.ts",
          label: "cart.test.ts",
          path: "apps/web/src/routes/cart.test.ts",
          metadataJson: { classification: "test" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "spec_entity:uc.cart",
          nodeType: "spec_entity",
          label: "Cart",
          path: "spec/use-cases/cart.md",
          entityId: "uc.cart",
        }),
      ])
      .returning();
    await db.insert(projectGraphEdges).values({
      projectId: project.id,
      graphVersionId: graphVersion.id,
      fromNodeId: coveredNode!.id,
      toNodeId: testNode!.id,
      edgeType: "supports_spec",
      provenance: "annotation",
    });

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "source_without_spec:apps/web/src/routes/checkout.ts",
        kind: "source_without_spec",
        family: "source",
        primaryTarget: {
          kind: "source",
          graphNodeId: fileNode!.id,
          nodeKey: "file:apps/web/src/routes/checkout.ts",
          nodeType: "file",
          path: "apps/web/src/routes/checkout.ts",
          symbolName: null,
        },
      }),
    );
    expect(response.items).not.toContainEqual(
      expect.objectContaining({ id: "source_without_spec:apps/web/src/routes/cart.ts" }),
    );
    expect(response.items).not.toContainEqual(
      expect.objectContaining({ id: "source_without_spec:apps/web/src/routes/cart.test.ts" }),
    );
  });

  it("reports source areas instead of individual source nodes when 3 uncovered useful nodes share a directory", async () => {
    const project = await createProjectFixture(db, projectIds);
    const { graphVersion } = await createGraphFixture(db, project.id, "ready");
    await db
      .insert(projectGraphNodes)
      .values([
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/routes/checkout.ts",
          label: "checkout.ts",
          path: "apps/web/src/routes/checkout.ts",
          metadataJson: { classification: "route" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/routes/cart.ts",
          label: "cart.ts",
          path: "apps/web/src/routes/cart.ts",
          metadataJson: { classification: "route" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/routes/profile.ts",
          label: "profile.ts",
          path: "apps/web/src/routes/profile.ts",
          metadataJson: { classification: "route" },
        }),
      ])
      .returning();

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "source_area_without_spec:apps/web/src/routes",
        kind: "source_area_without_spec",
        family: "source",
        primaryTarget: {
          kind: "source",
          graphNodeId: null,
          nodeKey: "apps/web/src/routes",
          nodeType: "module",
          path: "apps/web/src/routes",
          symbolName: null,
        },
        evidence: expect.arrayContaining([
          expect.objectContaining({ filePath: "apps/web/src/routes/checkout.ts" }),
          expect.objectContaining({ filePath: "apps/web/src/routes/cart.ts" }),
          expect.objectContaining({ filePath: "apps/web/src/routes/profile.ts" }),
        ]),
      }),
    );
    expect(response.items).not.toContainEqual(
      expect.objectContaining({ id: "source_without_spec:apps/web/src/routes/checkout.ts" }),
    );
  });

  it("reports concepts without spec coverage and low confidence concepts and memberships", async () => {
    const project = await createProjectFixture(db, projectIds);
    const { graphVersion } = await createGraphFixture(db, project.id, "ready");
    const [checkoutNode, billingNode, specNode] = await db
      .insert(projectGraphNodes)
      .values([
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/checkout.ts",
          label: "checkout.ts",
          path: "apps/web/src/checkout.ts",
          metadataJson: { classification: "source" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "file:apps/web/src/billing.ts",
          label: "billing.ts",
          path: "apps/web/src/billing.ts",
          metadataJson: { classification: "source" },
        }),
        graphNode(project.id, graphVersion.id, {
          nodeKey: "spec_entity:uc.billing",
          nodeType: "spec_entity",
          label: "Billing",
          path: "spec/use-cases/billing.md",
          entityId: "uc.billing",
        }),
      ])
      .returning();
    await db.insert(projectGraphEdges).values({
      projectId: project.id,
      graphVersionId: graphVersion.id,
      fromNodeId: billingNode!.id,
      toNodeId: specNode!.id,
      edgeType: "supports_spec",
      provenance: "annotation",
    });
    const { conceptVersion } = await createConceptGraphFixture(db, project.id, graphVersion.id, "ready");
    const [checkoutConcept, billingConcept] = await db
      .insert(projectConcepts)
      .values([
        concept(project.id, conceptVersion.id, {
          conceptKey: "workflow:checkout",
          conceptType: "workflow",
          name: "Checkout",
          confidence: 0.52,
        }),
        concept(project.id, conceptVersion.id, {
          conceptKey: "workflow:billing",
          conceptType: "workflow",
          name: "Billing",
          confidence: 0.91,
        }),
      ])
      .returning();
    await db.insert(projectConceptMemberships).values([
      membership(project.id, conceptVersion.id, graphVersion.id, checkoutConcept!.id, checkoutNode!.id, 0.58),
      membership(project.id, conceptVersion.id, graphVersion.id, billingConcept!.id, billingNode!.id, 0.57),
    ]);

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "concept_without_spec:workflow:checkout",
        kind: "concept_without_spec",
        primaryTarget: expect.objectContaining({
          kind: "concept",
          conceptId: checkoutConcept!.id,
          conceptKey: "workflow:checkout",
        }),
      }),
    );
    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "concept_low_confidence:workflow:checkout",
        kind: "concept_low_confidence",
      }),
    );
    expect(response.items).toContainEqual(
      expect.objectContaining({
        id: "concept_membership_low_confidence:workflow:billing",
        kind: "concept_membership_low_confidence",
      }),
    );
    expect(response.items).not.toContainEqual(
      expect.objectContaining({ id: "concept_without_spec:workflow:billing" }),
    );
  });

  it("reports no_index_run when no index run exists", async () => {
    const project = await createProjectFixture(db, projectIds);

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.sourceState.latestIndexRunId).toBeNull();
    expect(response.sourceState.latestIndexRunStatus).toBeNull();
    expect(response.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "warning", code: "no_index_run" }),
      ]),
    );
  });

  it("reports limited graph and concept diagnostics", async () => {
    const project = await createProjectFixture(db, projectIds);
    const { graphVersion } = await createGraphFixture(db, project.id, "limited");
    const { conceptVersion } = await createConceptGraphFixture(db, project.id, graphVersion.id, "limited");

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.sourceState).toMatchObject({
      latestProjectGraphVersionId: graphVersion.id,
      latestProjectGraphStatus: "limited",
      latestConceptGraphVersionId: conceptVersion.id,
      latestConceptGraphStatus: "limited",
      hasProjectGraph: true,
      hasConceptGraph: true,
    });
    expect(response.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "warning", code: "limited_project_graph" }),
        expect.objectContaining({ level: "warning", code: "limited_concept_graph" }),
      ]),
    );
  });

  it("returns diagnostics instead of failing when graph and concept data are missing", async () => {
    const project = await createProjectFixture(db, projectIds);
    const [run] = await db
      .insert(indexRuns)
      .values({
        projectId: project.id,
        status: "completed",
        startedAt: new Date("2026-01-01T10:00:00.000Z"),
        finishedAt: new Date("2026-01-01T10:05:00.000Z"),
      })
      .returning();

    const response = await createProjectHealthQueueService(db).getProjectHealthQueue(project.id);

    expect(response.sourceState).toMatchObject({
      latestIndexRunId: run!.id,
      latestIndexRunStatus: "succeeded",
      latestProjectGraphVersionId: null,
      latestConceptGraphVersionId: null,
      hasProjectGraph: false,
      hasConceptGraph: false,
    });
    expect(response.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "warning", code: "no_project_graph" }),
        expect.objectContaining({ level: "warning", code: "no_concept_graph" }),
      ]),
    );
    expect(healthQueueResponseSchema.parse(response)).toEqual(response);
  });
});

function healthItem(overrides: Partial<import("@specops/contracts").HealthQueueItemDto>) {
  return {
    id: "spec_readiness_failed:uc.checkout",
    family: "spec",
    kind: "spec_readiness_failed",
    severity: "review",
    title: "Spec readiness failed",
    detail: "Spec readiness failed.",
    primaryTarget: {
      kind: "spec",
      entityId: "uc.checkout",
      title: "Checkout",
      type: "use_case",
      status: "draft",
      filePath: "spec/use-cases/checkout.md",
    },
    evidence: [],
    actions: [{ kind: "open_spec", label: "Open spec", entityId: "uc.checkout" }],
    diagnostics: [],
    ...overrides,
  } as import("@specops/contracts").HealthQueueItemDto;
}

function sourceNode(overrides: {
  nodeType?: string;
  path?: string | null;
  classification?: string;
  generated?: boolean;
}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    nodeKey: "file:apps/web/src/routes/checkout.ts",
    nodeType: overrides.nodeType ?? "file",
    label: "checkout.ts",
    path: overrides.path === undefined ? "apps/web/src/routes/checkout.ts" : overrides.path,
    symbolName: null,
    metadataJson: { classification: overrides.classification, generated: overrides.generated },
  };
}

async function createProjectFixture(db: Db, projectIds: string[]) {
  const suffix = `${Date.now()}-${projectIds.length}`;
  const [project] = await db
    .insert(projects)
    .values({
      name: `Health Queue ${suffix}`,
      slug: `health-queue-${suffix}`,
      repoPath: `/tmp/specops-health-queue-${suffix}`,
      specopsPath: `/tmp/specops-health-queue-${suffix}/spec`,
    })
    .returning();

  projectIds.push(project!.id);
  return project!;
}

async function createSpecFixture(
  db: Db,
  projectId: string,
  overrides: Partial<typeof specEntities.$inferInsert>,
) {
  const [spec] = await db
    .insert(specEntities)
    .values({
      projectId,
      entityId: "uc.checkout",
      type: "use_case",
      title: "Checkout",
      status: "draft",
      filePath: "spec/use-cases/checkout.md",
      frontmatterJson: {},
      bodyMarkdown: "Checkout details.",
      bodyText: "Checkout details.",
      contentHash: "checkout",
      ...overrides,
    })
    .returning();

  return spec!;
}

async function createGraphFixture(db: Db, projectId: string, status: "ready" | "limited") {
  const [indexRun] = await db
    .insert(indexRuns)
    .values({
      projectId,
      status: "completed",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      finishedAt: new Date("2026-01-01T10:05:00.000Z"),
    })
    .returning();
  const [graphVersion] = await db
    .insert(projectGraphVersions)
    .values({
      projectId,
      indexRunId: indexRun!.id,
      status,
      summary: "Test graph.",
      coverageJson: {},
      diagnosticsJson: [],
    })
    .returning();

  return { indexRun: indexRun!, graphVersion: graphVersion! };
}

async function createConceptGraphFixture(
  db: Db,
  projectId: string,
  projectGraphVersionId: string,
  status: "ready" | "limited",
) {
  const [conceptVersion] = await db
    .insert(projectConceptVersions)
    .values({
      projectId,
      projectGraphVersionId,
      status,
      provider: "test",
      model: "test",
      promptVersion: "test",
      summary: "Test concepts.",
      coverageJson: {},
      diagnosticsJson: [],
    })
    .returning();

  return { conceptVersion: conceptVersion! };
}

function graphNode(
  projectId: string,
  graphVersionId: string,
  overrides: Partial<typeof projectGraphNodes.$inferInsert>,
) {
  return {
    projectId,
    graphVersionId,
    nodeKey: "file:apps/web/src/checkout.ts",
    nodeType: "file",
    label: "checkout.ts",
    path: "apps/web/src/checkout.ts",
    symbolName: null,
    entityId: null,
    sourceRefJson: {},
    metadataJson: {},
    confidence: 1,
    ...overrides,
  };
}

function concept(
  projectId: string,
  conceptVersionId: string,
  overrides: Partial<typeof projectConcepts.$inferInsert>,
) {
  return {
    projectId,
    conceptVersionId,
    conceptKey: "workflow:checkout",
    conceptType: "workflow",
    name: "Checkout",
    summary: "Checkout workflow.",
    confidence: 0.9,
    provenance: "test",
    evidenceSummary: "Test evidence.",
    status: "active",
    metadataJson: {},
    ...overrides,
  };
}

function membership(
  projectId: string,
  conceptVersionId: string,
  projectGraphVersionId: string,
  conceptId: string,
  graphNodeId: string,
  confidence: number,
) {
  return {
    projectId,
    conceptVersionId,
    projectGraphVersionId,
    conceptId,
    graphNodeId,
    role: "primary",
    confidence,
    rationale: "Test membership.",
  };
}

function itemKinds(items: import("@specops/contracts").HealthQueueItemDto[]) {
  return items.map((item) => item.kind);
}

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await readFile(
      path.join(process.cwd(), "../../packages/db/migrations/0000_initial.sql"),
      "utf8",
    );
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function closeDb(db: Db | undefined): Promise<void> {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } } | undefined)?.$client;
  await client?.end();
}

function readTestDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url && process.env.CI) {
    throw new Error("TEST_DATABASE_URL is required for DB-backed API tests in CI");
  }

  return url;
}
