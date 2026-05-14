import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  conceptDetailResponseSchema,
  conceptGraphLatestResponseSchema,
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  createDb,
  projectConceptVersions,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  projects,
} from "@specops/db";
import type { AiPrefillProvider } from "@specops/ai-prefill";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ApiConfig } from "../config.js";
import { createConceptGraphService } from "../services/concept-graph-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createConceptGraphService", () => {
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

  it("builds and persists a ready concept graph from provider output", async () => {
    const { project, graphNode } = await createProjectGraphFixture();
    const provider = conceptProvider({
      concepts: [
        {
          key: "workflow:checkout",
          type: "workflow",
          name: "Checkout",
          summary: "Checkout order flow.",
          confidence: 0.87,
          evidenceSummary: "Route file drives checkout.",
          memberships: [
            {
              graphNodeId: graphNode.id,
              role: "primary",
              confidence: 0.92,
              rationale: "Checkout route is the workflow entrypoint.",
            },
          ],
        },
      ],
      relationships: [],
    });

    const built = await createConceptGraphService(db, {
      config: testAiConfig(),
      providerFactory: () => provider,
    }).buildConceptGraph(project.id, {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 50,
      maxGraphEdges: 100,
    });

    expect(conceptGraphLatestResponseSchema.parse(built)).toEqual(built);
    expect(provider.generateConceptGraph).toHaveBeenCalledOnce();
    expect(built.version.status).toBe("ready");
    expect(built.concepts).toMatchObject([
      {
        conceptKey: "workflow:checkout",
        name: "Checkout",
      },
    ]);
    expect(built.membershipCounts.primary).toBe(1);
    expect(built.version.coverage.graphNodeCoverageCount).toBe(1);
  });

  it("persists unsupported no-membership concepts as limited with diagnostics", async () => {
    const { project } = await createProjectGraphFixture();
    const provider = conceptProvider({
      concepts: [
        {
          key: "workflow:checkout",
          type: "workflow",
          name: "Checkout",
          summary: "Checkout order flow.",
          confidence: 0.87,
          evidenceSummary: "No supported evidence.",
          memberships: [],
        },
      ],
      relationships: [],
    });

    const built = await createConceptGraphService(db, {
      config: testAiConfig(),
      providerFactory: () => provider,
    }).buildConceptGraph(project.id, {
      provider: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.1,
      maxGraphNodes: 50,
      maxGraphEdges: 100,
    });

    expect(conceptGraphLatestResponseSchema.parse(built)).toEqual(built);
    expect(built.version.status).toBe("limited");
    expect(built.concepts).toEqual([]);
    expect(built.version.coverage.rejectedConceptCount).toBe(1);
    expect(built.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          code: "concept_without_membership",
        }),
      ]),
    );
  });

  it("returns the latest concept graph and supersedes previous ready or limited versions", async () => {
    const { project, graphNode } = await createProjectGraphFixture();
    const service = createConceptGraphService(db, {
      config: testAiConfig(),
      providerFactory: () =>
        conceptProvider({
          concepts: [
            {
              key: `workflow:${crypto.randomUUID()}`,
              type: "workflow",
              name: "Checkout",
              summary: "Checkout order flow.",
              confidence: 0.87,
              evidenceSummary: "Route file drives checkout.",
              memberships: [
                {
                  graphNodeId: graphNode.id,
                  role: "primary",
                  confidence: 0.92,
                  rationale: "Checkout route is the workflow entrypoint.",
                },
              ],
            },
          ],
          relationships: [],
        }),
    });

    const first = await service.buildConceptGraph(project.id, buildInput());
    const second = await service.buildConceptGraph(project.id, buildInput());
    const latest = await service.getLatestConceptGraph(project.id);

    expect(latest.version.id).toBe(second.version.id);
    expect(first.version.id).not.toBe(second.version.id);
    const [firstVersion] = await db
      .select()
      .from(projectConceptVersions)
      .where(
        and(
          eq(projectConceptVersions.projectId, project.id),
          eq(projectConceptVersions.id, first.version.id),
        ),
      );
    expect(firstVersion?.status).toBe("superseded");
  });

  it("returns concept detail with graph node DTOs and grouped relationships", async () => {
    const { project, graphNode, supportGraphNode } = await createProjectGraphFixture();
    const service = createConceptGraphService(db, {
      config: testAiConfig(),
      providerFactory: () =>
        conceptProvider({
          concepts: [
            {
              key: "workflow:checkout",
              type: "workflow",
              name: "Checkout",
              summary: "Checkout order flow.",
              confidence: 0.87,
              evidenceSummary: "Route file drives checkout.",
              memberships: [
                {
                  graphNodeId: graphNode.id,
                  role: "primary",
                  confidence: 0.92,
                  rationale: "Checkout route is the workflow entrypoint.",
                },
              ],
            },
            {
              key: "subsystem:payments",
              type: "subsystem",
              name: "Payments",
              summary: "Payment integration.",
              confidence: 0.74,
              evidenceSummary: "Payment client supports checkout.",
              memberships: [
                {
                  graphNodeId: supportGraphNode.id,
                  role: "supporting",
                  confidence: 0.76,
                  rationale: "Payment file supports checkout.",
                },
              ],
            },
          ],
          relationships: [
            {
              fromConceptKey: "workflow:checkout",
              toConceptKey: "subsystem:payments",
              relationshipType: "uses",
              confidence: 0.7,
              rationale: "Checkout uses payments.",
            },
          ],
        }),
    });
    const built = await service.buildConceptGraph(project.id, buildInput());
    const checkout = built.concepts.find((concept) => concept.conceptKey === "workflow:checkout")!;

    const detail = await service.getConceptDetail(project.id, checkout.id);

    expect(conceptDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(detail.concept.id).toBe(checkout.id);
    expect(detail.memberships).toHaveLength(1);
    expect(detail.graphNodes).toMatchObject([
      {
        id: graphNode.id,
        sourceRef: { path: "apps/web/src/checkout.tsx" },
        metadata: { classification: "route" },
      },
    ]);
    expect(detail.outgoingRelationships.uses).toHaveLength(1);
    expect(detail.incomingRelationships).toEqual({});
    expect(detail.relatedConcepts).toEqual([
      expect.objectContaining({ conceptKey: "subsystem:payments" }),
    ]);
  });

  it("fails with BadRequestError when no latest project graph exists", async () => {
    const project = await createProjectFixture();

    await expect(
      createConceptGraphService(db, {
        config: testAiConfig(),
        providerFactory: () => conceptProvider({ concepts: [], relationships: [] }),
      }).buildConceptGraph(project.id, buildInput()),
    ).rejects.toMatchObject({
      name: "BadRequestError",
      message: "Project graph is required before concept consolidation",
      details: { projectId: project.id },
    });
  });

  async function createProjectGraphFixture() {
    const project = await createProjectFixture();
    const [graphVersion] = await db
      .insert(projectGraphVersions)
      .values({
        projectId: project.id,
        indexRunId: null,
        status: "ready",
        summary: "Project graph ready.",
        coverageJson: {
          nodeCounts: { file: 2 },
          edgeCounts: { imports: 1 },
          sourceFileCount: 2,
          specEntityCount: 0,
          unresolvedImportCount: 0,
          heuristicEdgeCount: 0,
        },
        diagnosticsJson: [],
      })
      .returning();
    const [graphNode, supportGraphNode] = await db
      .insert(projectGraphNodes)
      .values([
        {
          projectId: project.id,
          graphVersionId: graphVersion!.id,
          nodeKey: "file:apps/web/src/checkout.tsx",
          nodeType: "file",
          label: "checkout.tsx",
          path: "apps/web/src/checkout.tsx",
          symbolName: null,
          entityId: null,
          sourceRefJson: { path: "apps/web/src/checkout.tsx" },
          metadataJson: { classification: "route" },
          confidence: 1,
        },
        {
          projectId: project.id,
          graphVersionId: graphVersion!.id,
          nodeKey: "file:apps/web/src/payments.ts",
          nodeType: "file",
          label: "payments.ts",
          path: "apps/web/src/payments.ts",
          symbolName: null,
          entityId: null,
          sourceRefJson: { path: "apps/web/src/payments.ts" },
          metadataJson: { classification: "source" },
          confidence: 1,
        },
      ])
      .returning();
    await db.insert(projectGraphEdges).values({
      projectId: project.id,
      graphVersionId: graphVersion!.id,
      fromNodeId: graphNode!.id,
      toNodeId: supportGraphNode!.id,
      edgeType: "imports",
      provenance: "scanner_import",
      sourceRefJson: { specifier: "./payments" },
      metadataJson: {},
      confidence: 1,
    });

    return { project, graphVersion: graphVersion!, graphNode: graphNode!, supportGraphNode: supportGraphNode! };
  }

  async function createProjectFixture() {
    const [project] = await db
      .insert(projects)
      .values({
        name: `Concept graph ${crypto.randomUUID()}`,
        slug: `concept-graph-${crypto.randomUUID()}`,
        repoPath: `/tmp/specops-concept-${crypto.randomUUID()}`,
        specopsPath: ".specops",
      })
      .returning();
    projectIds.push(project!.id);
    return project!;
  }
});

function buildInput() {
  return {
    provider: "openai" as const,
    model: "gpt-4.1-mini",
    temperature: 0.1,
    maxGraphNodes: 50,
    maxGraphEdges: 100,
  };
}

function conceptProvider(output: unknown): AiPrefillProvider {
  return {
    generateSpecProposals: vi.fn(async () => {
      throw new Error("generateSpecProposals should not be called");
    }),
    generateConceptGraph: vi.fn(async (input) => ({
      provider: "openai" as const,
      model: input.model,
      text: JSON.stringify(output),
    })),
  };
}

function testAiConfig(
  overrides: Partial<ApiConfig["aiPrefill"]> = {},
): ApiConfig["aiPrefill"] {
  return {
    ollamaBaseUrl: "http://127.0.0.1:11434",
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiApiKey: "test-openai-key",
    timeoutMs: 60_000,
    maxFiles: 5,
    maxTotalBytes: 60_000,
    ...overrides,
  };
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
