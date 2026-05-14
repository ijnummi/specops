import { describe, expect, it } from "vitest";

import {
  systemMapAreaSchema,
  systemMapResponseSchema,
  systemMapSnapshotSchema,
} from "./system-map.js";

const timestamp = "2026-05-14T10:00:00.000Z";

describe("system map contracts", () => {
  it("parses a system map snapshot", () => {
    const parsed = systemMapSnapshotSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      analyzeRunId: "00000000-0000-4000-8000-000000000003",
      status: "ready",
      summary: "Backend routes, services, frontend views, tests, config, and packages were mapped.",
      coverage: {
        sourceFileCount: 8,
        mappedSourceFileCount: 7,
        unmappedSourceFileCount: 1,
        areaCounts: {
          backend_routes: 1,
          backend_services: 1,
          frontend_routes: 1,
          frontend_components: 1,
          data_models: 1,
          tests: 1,
          config: 1,
          packages: 1,
          unknown: 0,
        },
      },
      diagnostics: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(parsed.status).toBe("ready");
    expect(parsed.coverage.areaCounts.backend_routes).toBe(1);
  });

  it("parses an area with source evidence and related drafts", () => {
    const parsed = systemMapAreaSchema.parse({
      id: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000001",
      areaType: "backend_routes",
      name: "API routes",
      summary: "Fastify route registration files define the project API surface.",
      confidence: 0.9,
      evidence: [
        {
          sourceFileId: "00000000-0000-4000-8000-000000000020",
          sourceFilePath: "apps/api/src/routes/projects.ts",
          symbolName: "registerProjectRoutes",
          symbolKind: "function",
          startLine: 12,
          relationship: "defines",
        },
      ],
      keyFiles: ["apps/api/src/routes/projects.ts"],
      keySymbols: ["registerProjectRoutes"],
      relatedProposalIds: ["00000000-0000-4000-8000-000000000030"],
      diagnostics: [],
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(parsed.areaType).toBe("backend_routes");
    expect(parsed.relatedProposalIds).toHaveLength(1);
  });

  it("parses the response payload", () => {
    const parsed = systemMapResponseSchema.parse({
      snapshot: {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        analyzeRunId: "00000000-0000-4000-8000-000000000003",
        status: "limited",
        summary: "No supported source files were available for mapping.",
        coverage: {
          sourceFileCount: 0,
          mappedSourceFileCount: 0,
          unmappedSourceFileCount: 0,
          areaCounts: {},
        },
        diagnostics: [
          {
            level: "warning",
            code: "no_supported_source",
            message: "No indexed source files were available for the system map.",
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      areas: [],
    });

    expect(parsed.snapshot.status).toBe("limited");
    expect(parsed.areas).toEqual([]);
  });
});
