import { describe, expect, it } from "vitest";

import { parseSpecMarkdown } from "@specops/markdown";

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
          id: "11111111-1111-4111-8111-111111111111",
          evidence: [
            {
              sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
              symbolName: "registerAnalyzeReviewAssemblyRoutes",
              startLine: 20,
              endLine: 80,
              relationshipType: "implements"
            }
          ]
        },
        {
          text: "The review model may later feed refresh workflows.",
          kind: "hypothesis",
          id: "22222222-2222-4222-8222-222222222222",
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
    expect(markdown).toContain("title: Review drafts");
    expect(markdown).toContain("status: draft");
    expect(markdown).toContain("# Review drafts");
    expect(markdown).toContain("## Reviewed Facts");
    expect(markdown).toContain(
      "- Users can accept reviewed assemblies. [^11111111-1111-4111-8111-111111111111-1]"
    );
    expect(markdown).toContain("apps/api/src/routes/analyze-review-assemblies.ts:20-80");
    expect(markdown).toContain("(`registerAnalyzeReviewAssemblyRoutes`)");
    expect(markdown).toContain(
      "[^11111111-1111-4111-8111-111111111111-1]: implements `apps/api/src/routes/analyze-review-assemblies.ts:20-80` (`registerAnalyzeReviewAssemblyRoutes`)"
    );
    expect(markdown).toContain("## Hypotheses and Unknowns");
    expect(markdown).toContain("The review model may later feed refresh workflows.");
    expect(markdown).toContain("## Source Links");
    expect(markdown).toContain("### Implements");
    expect(markdown).toContain(
      "- `apps/api/src/routes/analyze-review-assemblies.ts:20-80` (`registerAnalyzeReviewAssemblyRoutes`)"
    );
    expect(markdown).toContain("## Proposed Links");
    expect(markdown).toContain("relates_to: interface.proposal-service");
    expect(markdown).toContain("Assemblies are built from proposal inputs.");
  });

  it("renders frontmatter that round-trips through spec markdown parsing", () => {
    const title = "Review: drafts #1 [pilot]";
    const markdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: "use-case.review-drafts",
      entityType: "use_case",
      title,
      summary: "Review generated draft inputs before writing specs.",
      claims: [],
      proposedLinks: []
    });

    const parsed = parseSpecMarkdown("use-cases/review-drafts.md", markdown);

    expect(parsed.messages.filter((message) => message.level === "error")).toEqual([]);
    expect(parsed.entity).toMatchObject({
      entityId: "use-case.review-drafts",
      type: "use_case",
      title
    });
  });

  it("uses sanitized claim IDs for evidence footnote IDs", () => {
    const markdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: "use-case.review-drafts",
      entityType: "use_case",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      claims: [
        {
          id: "claim.custom-review",
          text: "Custom claim IDs remain stable in markdown links.",
          kind: "fact",
          evidence: [
            {
              sourceFilePath: "apps/api/src/services/analyze-review-renderer.ts",
              symbolName: "renderAnalyzeReviewAssemblyMarkdown",
              startLine: 1,
              endLine: 80,
              relationshipType: "implements"
            }
          ]
        }
      ],
      proposedLinks: []
    });

    expect(markdown).toContain(
      "- Custom claim IDs remain stable in markdown links. [^claim-custom-review-1]"
    );
    expect(markdown).toContain(
      "[^claim-custom-review-1]: implements `apps/api/src/services/analyze-review-renderer.ts:1-80` (`renderAnalyzeReviewAssemblyMarkdown`)"
    );
    expect(markdown).not.toContain("[^claim-1-1]");
  });

  it("defaults evidence relationship type to references and groups source links by relationship", () => {
    const markdown = renderAnalyzeReviewAssemblyMarkdown({
      entityId: "use-case.review-drafts",
      entityType: "use_case",
      title: "Review drafts",
      summary: "Review generated draft inputs before writing specs.",
      claims: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          text: "Routes accept reviewed assemblies.",
          kind: "fact",
          evidence: [
            {
              sourceFilePath: "apps/api/src/routes/analyze-review-assemblies.ts",
              symbolName: "registerAnalyzeReviewAssemblyRoutes",
              startLine: 20,
              endLine: 80,
              relationshipType: "implements"
            },
            {
              sourceFilePath: "apps/api/src/services/proposal-service.ts",
              symbolName: "createProposalService",
              startLine: null,
              endLine: null
            }
          ]
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          text: "Schemas define accepted review payloads.",
          kind: "fact",
          evidence: [
            {
              sourceFilePath: "packages/contracts/src/analyze-review-assemblies.ts",
              symbolName: "analyzeReviewAcceptResponseSchema",
              startLine: 230,
              endLine: 260,
              relationshipType: "defines"
            }
          ]
        }
      ],
      proposedLinks: []
    });

    expect(markdown).toContain(
      "- Routes accept reviewed assemblies. [^11111111-1111-4111-8111-111111111111-1] [^11111111-1111-4111-8111-111111111111-2]"
    );
    expect(markdown).toContain(
      "- Schemas define accepted review payloads. [^22222222-2222-4222-8222-222222222222-1]"
    );
    expect(markdown).toContain(
      "[^11111111-1111-4111-8111-111111111111-2]: references `apps/api/src/services/proposal-service.ts` (`createProposalService`)"
    );
    expect(markdown.indexOf("### Implements")).toBeLessThan(markdown.indexOf("### Defines"));
    expect(markdown.indexOf("### Defines")).toBeLessThan(markdown.indexOf("### References"));
    expect(markdown).toContain(
      "- `packages/contracts/src/analyze-review-assemblies.ts:230-260` (`analyzeReviewAcceptResponseSchema`)"
    );
    expect(markdown).toContain(
      "- `apps/api/src/services/proposal-service.ts` (`createProposalService`)"
    );
  });
});
