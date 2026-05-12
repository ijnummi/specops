import { describe, expect, it } from "vitest";

import {
  selectAnalyzeSourceFiles,
  type AnalyzeSourceCandidate
} from "../services/analyze-source-selection.js";

describe("selectAnalyzeSourceFiles", () => {
  it("selects a balanced high-signal subset within file and byte limits", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("route", "apps/api/src/routes/projects.ts", 10_000, 1, 3, 8),
        file("service", "apps/api/src/services/project-service.ts", 11_000, 2, 6, 10),
        file("domain", "packages/domain/src/types.ts", 3_000, 0, 5, 5),
        file("test", "apps/api/src/__tests__/routes.test.ts", 30_000, 0, 0, 0),
        file("config", "apps/api/src/config.ts", 4_000, 0, 1, 2)
      ],
      maxFiles: 3,
      maxTotalBytes: 30_000
    });

    expect(result.selectedPaths).toEqual([
      "apps/api/src/routes/projects.ts",
      "apps/api/src/services/project-service.ts",
      "packages/domain/src/types.ts"
    ]);
    expect(result.selectedSourceFileIds).toEqual(["route", "service", "domain"]);
    expect(result.skippedHighSignalFileCount).toBe(0);
    expect(result.categories).toEqual([
      { category: "entrypoints_routes", count: 1 },
      { category: "services_modules", count: 1 },
      { category: "domain_models", count: 1 }
    ]);
  });

  it("reports partial coverage when useful files exceed limits", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("route-a", "apps/api/src/routes/a.ts", 10_000, 1, 2, 3),
        file("route-b", "apps/api/src/routes/b.ts", 10_000, 1, 2, 3),
        file("service-a", "apps/api/src/services/a-service.ts", 10_000, 1, 4, 4),
        file("domain-a", "packages/domain/src/a.ts", 10_000, 0, 3, 3)
      ],
      maxFiles: 2,
      maxTotalBytes: 20_000
    });

    expect(result.selectedPaths).toHaveLength(2);
    expect(result.eligibleHighSignalFileCount).toBe(4);
    expect(result.skippedHighSignalFileCount).toBe(2);
    expect(result.categories).toEqual([
      { category: "entrypoints_routes", count: 1 },
      { category: "services_modules", count: 1 }
    ]);
    expect(result.diagnostics).toContainEqual({
      level: "info",
      message: "AI source selection is partial: selected 2 of 4 high-signal files."
    });
  });

  it("prefers a fitting balanced reserved-bucket subset under byte pressure", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("route-large", "apps/api/src/routes/large.ts", 25_000, 10, 10, 10),
        file("route-small", "apps/api/src/routes/small.ts", 5_000, 1, 1, 1),
        file("service", "apps/api/src/services/project-service.ts", 10_000, 1, 4, 4),
        file("domain", "packages/domain/src/types.ts", 10_000, 0, 4, 4)
      ],
      maxFiles: 3,
      maxTotalBytes: 25_000
    });

    expect(result.selectedSourceFileIds).toEqual(["route-small", "service", "domain"]);
    expect(result.selectedPaths).toEqual([
      "apps/api/src/routes/small.ts",
      "apps/api/src/services/project-service.ts",
      "packages/domain/src/types.ts"
    ]);
    expect(result.categories).toEqual([
      { category: "entrypoints_routes", count: 1 },
      { category: "services_modules", count: 1 },
      { category: "domain_models", count: 1 }
    ]);
  });

  it("uses tests and config as weak fallback when high-signal files do not fit", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("huge-route", "apps/api/src/routes/huge.ts", 70_000, 1, 2, 3),
        file("config", "apps/api/src/config.ts", 4_000, 0, 1, 2),
        file("test", "apps/api/src/__tests__/routes.test.ts", 5_000, 0, 0, 0)
      ],
      maxFiles: 2,
      maxTotalBytes: 10_000
    });

    expect(result.selectedSourceFileIds).toEqual(["test", "config"]);
    expect(result.eligibleHighSignalFileCount).toBe(1);
    expect(result.skippedHighSignalFileCount).toBe(1);
    expect(result.categories).toEqual([{ category: "tests_config", count: 2 }]);
    expect(result.diagnostics).toContainEqual({
      level: "info",
      message: "AI source selection is partial: selected 0 of 1 high-signal files."
    });
  });

  it("uses tests and config as weak context when budget remains", () => {
    const result = selectAnalyzeSourceFiles({
      files: [
        file("route", "apps/api/src/routes/projects.ts", 10_000, 1, 3, 8),
        file("config", "apps/api/src/config.ts", 4_000, 0, 1, 2)
      ],
      maxFiles: 2,
      maxTotalBytes: 20_000
    });

    expect(result.selectedSourceFileIds).toEqual(["config", "route"]);
    expect(result.eligibleHighSignalFileCount).toBe(1);
    expect(result.skippedHighSignalFileCount).toBe(0);
    expect(result.categories).toEqual([
      { category: "entrypoints_routes", count: 1 },
      { category: "tests_config", count: 1 }
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns a warning when no useful files fit", () => {
    const result = selectAnalyzeSourceFiles({
      files: [file("huge", "apps/api/src/routes/huge.ts", 70_000, 1, 2, 3)],
      maxFiles: 5,
      maxTotalBytes: 60_000
    });

    expect(result.selectedSourceFileIds).toEqual([]);
    expect(result.diagnostics).toEqual([
      { level: "warning", message: "No indexed source files fit within AI Prefill limits." }
    ]);
  });
});

function file(
  id: string,
  path: string,
  sizeBytes: number,
  importCount: number,
  exportCount: number,
  symbolCount: number
): AnalyzeSourceCandidate {
  return {
    id,
    path,
    kind: path.includes(".test.") ? "test" : path.includes("config") ? "config" : "source",
    sizeBytes,
    importCount,
    exportCount,
    symbolCount
  };
}
