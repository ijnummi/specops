import { describe, expect, it } from "vitest";

import { normalizeProviderResponse } from "../normalize.js";

describe("normalizeProviderResponse", () => {
  it("accepts provider JSON with one valid candidate", () => {
    const result = normalizeProviderResponse({
      text: JSON.stringify({
        proposals: [
          {
            entityId: "uc.manage-projects",
            type: "use_case",
            title: "Manage projects",
            summary: "Users can create and review project records.",
            sourceFiles: ["apps/api/src/routes/projects.ts"],
            claims: [
              {
                text: "The route exposes project listing behavior.",
                sourceFiles: ["apps/api/src/routes/projects.ts"]
              }
            ],
            proposedLinks: [
              {
                linkType: "implemented_by",
                targetEntityId: "interface.project-service",
                rationale: "The project service backs this use case."
              }
            ],
            confidence: 0.82
          }
        ]
      }),
      selectedSourceFiles: ["apps/api/src/routes/projects.ts"],
      existingEntityIds: new Set(["interface.project-service"])
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toEqual([
      {
        entityId: "uc.manage-projects",
        type: "use_case",
        title: "Manage projects",
        summary: "Users can create and review project records.",
        sourceFiles: ["apps/api/src/routes/projects.ts"],
        claims: [
          {
            text: "The route exposes project listing behavior.",
            sourceFiles: ["apps/api/src/routes/projects.ts"]
          }
        ],
        proposedLinks: [
          {
            linkType: "implemented_by",
            targetEntityId: "interface.project-service",
            targetExists: true,
            rationale: "The project service backs this use case."
          }
        ],
        confidence: 0.82
      }
    ]);
  });

  it("rejects invalid candidates with warning diagnostics while preserving valid candidates", () => {
    const result = normalizeProviderResponse({
      text: JSON.stringify({
        proposals: [
          {
            entityId: "uc.manage-projects",
            type: "use_case",
            title: "Manage projects",
            summary: "Users can create and review project records.",
            sourceFiles: ["apps/api/src/routes/projects.ts", "not-selected.ts"],
            claims: [
              {
                text: "The route exposes project listing behavior.",
                sourceFiles: ["apps/api/src/routes/projects.ts", "not-selected.ts"]
              }
            ],
            proposedLinks: [],
            confidence: null
          },
          {
            entityId: "",
            type: "use_case",
            title: "Invalid",
            summary: "Missing id.",
            sourceFiles: ["apps/api/src/routes/projects.ts"],
            claims: [{ text: "Claim", sourceFiles: ["apps/api/src/routes/projects.ts"] }]
          },
          {
            entityId: "uc.no-evidence",
            type: "use_case",
            title: "No evidence",
            summary: "All evidence points to unselected files.",
            sourceFiles: ["not-selected.ts"],
            claims: [{ text: "Claim", sourceFiles: ["not-selected.ts"] }]
          }
        ]
      }),
      selectedSourceFiles: ["apps/api/src/routes/projects.ts"],
      existingEntityIds: new Set()
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sourceFiles).toEqual(["apps/api/src/routes/projects.ts"]);
    expect(result.candidates[0]?.claims).toEqual([
      {
        text: "The route exposes project listing behavior.",
        sourceFiles: ["apps/api/src/routes/projects.ts"]
      }
    ]);
    expect(result.diagnostics).toEqual([
      { level: "warning", message: "Rejected proposal 2: invalid shape" },
      { level: "warning", message: "Rejected proposal 3: no selected source evidence" }
    ]);
  });

  it("sets targetExists based on existingEntityIds", () => {
    const result = normalizeProviderResponse({
      text: JSON.stringify({
        proposals: [
          {
            entityId: "uc.manage-projects",
            type: "use_case",
            title: "Manage projects",
            summary: "Users can create and review project records.",
            sourceFiles: ["apps/api/src/routes/projects.ts"],
            claims: [
              {
                text: "The route exposes project listing behavior.",
                sourceFiles: ["apps/api/src/routes/projects.ts"]
              }
            ],
            proposedLinks: [
              {
                linkType: "implemented_by",
                targetEntityId: "interface.project-service",
                targetExists: false,
                rationale: "Existing target."
              },
              {
                linkType: "relates_to",
                targetEntityId: "uc.missing",
                targetExists: true,
                rationale: "Missing target."
              }
            ]
          }
        ]
      }),
      selectedSourceFiles: ["apps/api/src/routes/projects.ts"],
      existingEntityIds: new Set(["interface.project-service"])
    });

    expect(result.candidates[0]?.proposedLinks.map((link) => link.targetExists)).toEqual([
      true,
      false
    ]);
  });

  it("throws a clear error for non-JSON responses", () => {
    expect(() =>
      normalizeProviderResponse({
        text: "Sure, here is a proposal.",
        selectedSourceFiles: ["apps/api/src/routes/projects.ts"],
        existingEntityIds: new Set()
      })
    ).toThrow("AI provider returned invalid JSON");
  });
});
