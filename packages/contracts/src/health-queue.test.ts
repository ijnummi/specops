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

  it("parses a complete health queue response", () => {
    const parsed = healthQueueResponseSchema.parse({
      generatedAt: timestamp,
      sourceState: {
        latestIndexRunId: "00000000-0000-4000-8000-000000000001",
        latestIndexRunStatus: "completed",
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
});
