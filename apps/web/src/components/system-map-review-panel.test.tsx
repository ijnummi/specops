import { renderToStaticMarkup } from "react-dom/server";
import type { SystemMapResponseDto } from "@specops/contracts";
import { describe, expect, it, vi } from "vitest";

import { SystemMapReviewPanel } from "./system-map-review-panel.js";

describe("SystemMapReviewPanel", () => {
  it("renders map areas, evidence, diagnostics, and related draft counts", () => {
    const html = renderToStaticMarkup(
      <SystemMapReviewPanel
        map={systemMapFixture()}
      />
    );

    expect(html).toContain("Mapped 2 source files into 2 system areas.");
    expect(html).toContain("Backend routes");
    expect(html).toContain("2 drafts");
    expect(html).toContain("apps/api/src/routes/projects.ts");
    expect(html).toContain("registerProjectRoutes");
  });

  it("uses controlled area selection when provided", () => {
    const html = renderToStaticMarkup(
      <SystemMapReviewPanel
        map={systemMapFixture()}
        selectedAreaId="88888888-8888-4888-8888-888888888888"
        onSelectArea={vi.fn()}
      />
    );

    expect(html).toContain("Tests cover API behavior.");
    expect(html).toContain("No exported symbols were found for this area.");
    expect(html).not.toContain("Route files define the API surface.");
  });
});

function systemMapFixture(): SystemMapResponseDto {
  return {
    snapshot: {
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      analyzeRunId: "33333333-3333-4333-8333-333333333333",
      status: "ready" as const,
      summary: "Mapped 2 source files into 2 system areas.",
      coverage: {
        sourceFileCount: 2,
        mappedSourceFileCount: 2,
        unmappedSourceFileCount: 0,
        areaCounts: { backend_routes: 1, tests: 1 }
      },
      diagnostics: [],
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z"
    },
    areas: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        snapshotId: "11111111-1111-4111-8111-111111111111",
        areaType: "backend_routes" as const,
        name: "Backend routes",
        summary: "Route files define the API surface.",
        confidence: 0.8,
        evidence: [
          {
            sourceFileId: "55555555-5555-4555-8555-555555555555",
            sourceFilePath: "apps/api/src/routes/projects.ts",
            symbolName: "registerProjectRoutes",
            symbolKind: "function",
            startLine: 4,
            relationship: "defines"
          }
        ],
        keyFiles: ["apps/api/src/routes/projects.ts"],
        keySymbols: ["registerProjectRoutes"],
        relatedProposalIds: [
          "66666666-6666-4666-8666-666666666666",
          "77777777-7777-4777-8777-777777777777"
        ],
        diagnostics: [],
        sortOrder: 0,
        createdAt: "2026-05-14T10:00:00.000Z",
        updatedAt: "2026-05-14T10:00:00.000Z"
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        snapshotId: "11111111-1111-4111-8111-111111111111",
        areaType: "tests" as const,
        name: "Tests",
        summary: "Tests cover API behavior.",
        confidence: 0.7,
        evidence: [],
        keyFiles: ["apps/api/src/routes/projects.test.ts"],
        keySymbols: [],
        relatedProposalIds: [],
        diagnostics: [
          {
            level: "info" as const,
            code: "limited_symbols",
            message: "No exported symbols were found for this area."
          }
        ],
        sortOrder: 1,
        createdAt: "2026-05-14T10:00:00.000Z",
        updatedAt: "2026-05-14T10:00:00.000Z"
      }
    ]
  };
}
