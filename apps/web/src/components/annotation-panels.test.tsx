// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import type { SourceSpecAnnotationDto } from "@specops/contracts";
import { describe, expect, it } from "vitest";

import { AnnotationSummaryPanel } from "./annotation-panels.js";

describe("AnnotationSummaryPanel", () => {
  it("groups annotations by relationship type in model order", () => {
    const html = renderToStaticMarkup(
      <AnnotationSummaryPanel
        annotations={[
          annotation({
            id: "tests-1",
            relationshipType: "tests",
            sourceFilePath: "tests/decision.test.ts"
          }),
          annotation({
            id: "implements-1",
            relationshipType: "implements",
            sourceFilePath: "src/decision.ts"
          }),
          annotation({
            id: "references-1",
            relationshipType: "references",
            sourceFilePath: "docs/decision.md"
          }),
          annotation({
            id: "uses-1",
            relationshipType: "uses",
            sourceFilePath: "src/workflow.ts"
          }),
          annotation({
            id: "defines-1",
            relationshipType: "defines",
            sourceFilePath: "src/types.ts"
          })
        ]}
      />
    );

    expect(html.indexOf("Implements")).toBeLessThan(html.indexOf("Uses"));
    expect(html.indexOf("Uses")).toBeLessThan(html.indexOf("Defines"));
    expect(html.indexOf("Defines")).toBeLessThan(html.indexOf("Tests"));
    expect(html.indexOf("Tests")).toBeLessThan(html.indexOf("References"));
  });

  it("shows stale metadata", () => {
    const html = renderToStaticMarkup(
      <AnnotationSummaryPanel annotations={[annotation({ status: "stale" })]} />
    );

    expect(html).toContain("Stale");
  });

  it("shows claim-backed metadata", () => {
    const html = renderToStaticMarkup(
      <AnnotationSummaryPanel
        annotations={[
          annotation({
            claimId: "00000000-0000-4000-8000-000000000002",
            claimEvidenceId: "00000000-0000-4000-8000-000000000003"
          })
        ]}
      />
    );

    expect(html).toContain("Claim-backed");
  });

  it("shows confidence display", () => {
    const html = renderToStaticMarkup(
      <AnnotationSummaryPanel annotations={[annotation({ confidence: 0.73 })]} />
    );

    expect(html).toContain("73%");
  });

  it("shows a clear empty state", () => {
    const html = renderToStaticMarkup(<AnnotationSummaryPanel annotations={[]} />);

    expect(html).toContain("No source/spec annotations yet.");
  });
});

function annotation(input: Partial<SourceSpecAnnotationDto> = {}): SourceSpecAnnotationDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000010",
    sourceFileId: "00000000-0000-4000-8000-000000000011",
    sourceFilePath: "src/domain/decision-model.ts",
    entityId: "domain.decision",
    specFilePath: "domain/decision.md",
    claimId: null,
    relationshipType: "implements",
    confidence: 1,
    provenance: "scanner",
    status: "active",
    analyzeRunId: null,
    proposalId: null,
    assemblyId: null,
    claimEvidenceId: null,
    indexRunId: null,
    symbolName: "createDecisionModel",
    symbolKind: "function",
    startLine: 14,
    endLine: 16,
    annotationLine: 13,
    sourceContentHash: "source-content-hash",
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
    ...input
  };
}
