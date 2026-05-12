import { describe, expect, it } from "vitest";

import { renderAnalyzeReviewAssemblyMarkdown } from "./analyze-review-renderer.js";

describe("renderAnalyzeReviewAssemblyMarkdown", () => {
  it("renders deterministic markdown with facts, hypotheses, evidence, and frontmatter", () => {
    const markdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: "use-case.review-drafts",
      entityType: "use_case",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      claims: [
        {
          text: "Users can accept reviewed assemblies.",
          kind: "fact",
          evidence: [
            {
              sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
              symbolName: "registerAnalyzeReviewAssemblyRoutes",
              startLine: 20,
              endLine: 80
            }
          ]
        },
        {
          text: "The review model may later feed refresh workflows.",
          kind: "hypothesis",
          evidence: []
        }
      ],
      proposedLinks: [
        {
          linkType: "relates_to",
          targetEntityId: "interface.proposal-service",
          rationale: "Assemblies are built from proposal inputs."
        }
      ]
    });

    expect(markdown).toContain("id: use-case.review-drafts");
    expect(markdown).toContain("type: use_case");
    expect(markdown).toContain("# Review drafts");
    expect(markdown).toContain("## Reviewed Facts");
    expect(markdown).toContain("Users can accept reviewed assemblies.");
    expect(markdown).toContain("apps/api/src/routes/analyze-review-assemblies.ts:20-80");
    expect(markdown).toContain("## Hypotheses and Unknowns");
    expect(markdown).toContain("The review model may later feed refresh workflows.");
    expect(markdown).toContain("## Proposed Links");
  });
});
