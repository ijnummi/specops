import { describe, expect, it } from "vitest";

import {
  healthQueueActionSchema,
  healthQueueEvidenceSchema,
  healthQueuePrimaryTargetSchema,
  healthQueueResponseSchema
} from "./health-queue.js";

const timestamp = "2026-05-14T12:00:00.000Z";

describe("health queue contracts", () => {
  it("parses targets, evidence, and navigation actions", () => {
    expect(
      healthQueuePrimaryTargetSchema.parse({
        kind: "spec",
        entityId: "uc.checkout",
        title: "Checkout",
        type: "use_case",
        status: "draft",
        filePath: "specs/use-cases/checkout.md"
      })
    ).toMatchObject({ kind: "spec", entityId: "uc.checkout" });

    expect(
      healthQueueEvidenceSchema.parse({
        kind: "readiness_check",
        label: "Missing source evidence",
        detail: "No active source/spec annotation supports this spec.",
        entityId: "uc.checkout",
        filePath: "specs/use-cases/checkout.md"
      })
    ).toMatchObject({ kind: "readiness_check" });

    expect(
      healthQueueActionSchema.parse({
        kind: "open_impact",
        label: "Open impact",
        entityId: "uc.checkout"
      })
    ).toMatchObject({ kind: "open_impact", entityId: "uc.checkout" });
  });

  it("parses source and concept primary targets", () => {
    expect(
      healthQueuePrimaryTargetSchema.parse({
        kind: "source",
        graphNodeId: "00000000-0000-4000-8000-000000000004",
        nodeKey: "src/routes/checkout.ts",
        nodeType: "file",
        path: "src/routes/checkout.ts",
        symbolName: null
      })
    ).toMatchObject({
      kind: "source",
      graphNodeId: "00000000-0000-4000-8000-000000000004",
      path: "src/routes/checkout.ts"
    });

    expect(
      healthQueuePrimaryTargetSchema.parse({
        kind: "concept",
        conceptId: "00000000-0000-4000-8000-000000000005",
        conceptKey: "checkout_flow",
        conceptType: "workflow",
        name: "Checkout flow"
      })
    ).toMatchObject({
      kind: "concept",
      conceptId: "00000000-0000-4000-8000-000000000005",
      conceptKey: "checkout_flow"
    });
  });

  it("parses graph and analyze-run navigation descriptors", () => {
    expect(
      healthQueueActionSchema.parse({
        kind: "open_project_graph",
        label: "Open graph",
        q: "checkout"
      })
    ).toMatchObject({ kind: "open_project_graph", q: "checkout" });

    expect(
      healthQueueActionSchema.parse({
        kind: "open_analyze_run",
        label: "Open analyze run"
      })
    ).toMatchObject({ kind: "open_analyze_run" });
  });

  it("rejects invalid UUIDs in graph and concept evidence", () => {
    expect(() =>
      healthQueueEvidenceSchema.parse({
        kind: "graph_node",
        label: "Checkout route",
        detail: "Route node",
        graphNodeId: "not-a-uuid"
      })
    ).toThrow();

    expect(() =>
      healthQueueEvidenceSchema.parse({
        kind: "concept",
        label: "Checkout flow",
        detail: "Workflow concept",
        conceptId: "not-a-uuid"
      })
    ).toThrow();
  });

  it("rejects invalid UUIDs in graph and concept actions", () => {
    expect(() =>
      healthQueueActionSchema.parse({
        kind: "open_graph_node",
        label: "Open graph node",
        graphNodeId: "not-a-uuid"
      })
    ).toThrow();

    expect(() =>
      healthQueueActionSchema.parse({
        kind: "open_concept",
        label: "Open concept",
        conceptId: "not-a-uuid"
      })
    ).toThrow();
  });

  it("parses a complete health queue response", () => {
    const parsed = healthQueueResponseSchema.parse({
      generatedAt: timestamp,
      sourceState: {
        latestIndexRunId: "00000000-0000-4000-8000-000000000001",
        latestIndexRunStatus: "succeeded",
        latestProjectGraphVersionId: "00000000-0000-4000-8000-000000000002",
        latestProjectGraphStatus: "ready",
        latestConceptGraphVersionId: "00000000-0000-4000-8000-000000000003",
        latestConceptGraphStatus: "ready",
        hasProjectGraph: true,
        hasConceptGraph: true
      },
      summary: {
        total: 1,
        byFamily: { spec: 1, source: 0, concept: 0 },
        bySeverity: { blocker: 0, review: 1, context: 0 },
        byKind: { spec_missing_source_evidence: 1 }
      },
      diagnostics: [],
      items: [
        {
          id: "spec_missing_source_evidence:uc.checkout",
          family: "spec",
          kind: "spec_missing_source_evidence",
          severity: "review",
          title: "Spec is missing source evidence",
          detail: "Checkout has no active source/spec annotation.",
          primaryTarget: {
            kind: "spec",
            entityId: "uc.checkout",
            title: "Checkout",
            type: "use_case",
            status: "draft",
            filePath: "specs/use-cases/checkout.md"
          },
          evidence: [
            {
              kind: "spec_entity",
              label: "Checkout",
              detail: "use_case / draft",
              entityId: "uc.checkout",
              filePath: "specs/use-cases/checkout.md"
            }
          ],
          actions: [
            { kind: "open_spec", label: "Open spec", entityId: "uc.checkout" }
          ],
          diagnostics: []
        }
      ]
    });

    expect(parsed.summary.total).toBe(1);
    expect(parsed.items[0]?.primaryTarget.kind).toBe("spec");
  });

  it("rejects invalid source-state statuses", () => {
    expect(() =>
      healthQueueResponseSchema.parse({
        generatedAt: timestamp,
        sourceState: {
          latestIndexRunId: "00000000-0000-4000-8000-000000000001",
          latestIndexRunStatus: "completed",
          latestProjectGraphVersionId: "00000000-0000-4000-8000-000000000002",
          latestProjectGraphStatus: "done",
          latestConceptGraphVersionId: "00000000-0000-4000-8000-000000000003",
          latestConceptGraphStatus: "done",
          hasProjectGraph: true,
          hasConceptGraph: true
        },
        summary: {
          total: 0,
          byFamily: { spec: 0, source: 0, concept: 0 },
          bySeverity: { blocker: 0, review: 0, context: 0 },
          byKind: {}
        },
        diagnostics: [],
        items: []
      })
    ).toThrow();
  });

  it("rejects unknown summary kind keys", () => {
    expect(() =>
      healthQueueResponseSchema.parse({
        generatedAt: timestamp,
        sourceState: {
          latestIndexRunId: null,
          latestIndexRunStatus: null,
          latestProjectGraphVersionId: null,
          latestProjectGraphStatus: null,
          latestConceptGraphVersionId: null,
          latestConceptGraphStatus: null,
          hasProjectGraph: false,
          hasConceptGraph: false
        },
        summary: {
          total: 1,
          byFamily: { spec: 1, source: 0, concept: 0 },
          bySeverity: { blocker: 0, review: 1, context: 0 },
          byKind: { unknown_kind: 1 }
        },
        diagnostics: [],
        items: []
      })
    ).toThrow();
  });
});
