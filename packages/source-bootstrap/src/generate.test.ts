import { describe, expect, it } from "vitest";

import type { ScanRepositoryResult, SourceSymbolFact } from "@specops/repo-scanner";

import { generateBootstrapSpecFiles, slugifySourceSymbol } from "./generate.js";

describe("generateBootstrapSpecFiles", () => {
  it("generates domain and interface specs from exported source symbols", () => {
    const files = generateBootstrapSpecFiles(scanResult());

    expect(files.map((file) => file.path)).toEqual([
      "domain/decision-link.md",
      "domain/decision.md",
      "domain/workspace.md",
      "interfaces/decision-service.md",
      "interfaces/reminder-scheduler.md"
    ]);
    expect(files.find((file) => file.path === "domain/decision.md")?.entityId).toBe(
      "domain.decision"
    );
    expect(files.find((file) => file.path === "domain/decision.md")?.content).toContain(
      "type: domain_entity"
    );
    expect(files.find((file) => file.path === "interfaces/decision-service.md")?.entityId).toBe(
      "interface.decision-service"
    );
    expect(files.find((file) => file.path === "interfaces/decision-service.md")?.content).toContain(
      "## Responsibility"
    );
  });

  it("skips non-exported symbols, test files, config files, and default exports", () => {
    const files = generateBootstrapSpecFiles({
      files: [
        {
          path: "src/internal.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 10,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "default", exportKind: "default", sourceSpecifier: null }],
          symbols: [
            sourceSymbol({
              name: "Internal",
              symbolKind: "interface",
              isExported: false,
              line: 1,
              metadata: {}
            })
          ]
        },
        {
          path: "src/domain.test.ts",
          language: "typescript",
          kind: "test",
          sizeBytes: 10,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "Decision", exportKind: "type", sourceSpecifier: null }],
          symbols: [
            sourceSymbol({
              name: "Decision",
              symbolKind: "interface",
              isExported: true,
              line: 1,
              metadata: {}
            })
          ]
        },
        {
          path: "src/vite.config.ts",
          language: "typescript",
          kind: "config",
          sizeBytes: 10,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "ConfigShape", exportKind: "type", sourceSpecifier: null }],
          symbols: [
            sourceSymbol({
              name: "ConfigShape",
              symbolKind: "interface",
              isExported: true,
              line: 1,
              metadata: {}
            })
          ]
        },
        {
          path: "src/default.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 10,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "default", exportKind: "default", sourceSpecifier: null }],
          symbols: [
            sourceSymbol({
              name: "default",
              symbolKind: "class",
              isExported: true,
              line: 1,
              metadata: {}
            })
          ]
        }
      ],
      warnings: []
    });

    expect(files).toEqual([]);
  });

  it("merges duplicate candidates into one spec with combined evidence", () => {
    const files = generateBootstrapSpecFiles({
      files: [
        sourceFile("src/domain.ts", [
          sourceSymbol({
            name: "Decision",
            symbolKind: "interface",
            isExported: true,
            line: 1,
            metadata: {}
          })
        ]),
        sourceFile("src/model.ts", [
          sourceSymbol({
            name: "Decision",
            symbolKind: "type_alias",
            isExported: true,
            line: 2,
            metadata: {}
          })
        ])
      ],
      warnings: []
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain("`src/domain.ts` exports `Decision` as an interface.");
    expect(files[0]?.content).toContain("`src/model.ts` exports `Decision` as a type alias.");
  });

  it("generates specs for locally aliased exports using the source symbol name", () => {
    const files = generateBootstrapSpecFiles({
      files: [
        {
          path: "src/public-domain.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 100,
          contentHash: "hash",
          imports: [],
          exports: [{ exportedName: "PublicDecision", exportKind: "type", sourceSpecifier: null }],
          symbols: [
            sourceSymbol({
              name: "Decision",
              symbolKind: "interface",
              isExported: true,
              line: 1,
              metadata: {}
            })
          ]
        }
      ],
      warnings: []
    });

    expect(files.map((file) => file.path)).toEqual(["domain/decision.md"]);
    expect(files[0]?.entityId).toBe("domain.decision");
    expect(files[0]?.content).toContain(
      "`src/public-domain.ts` exports `Decision` as an interface."
    );
  });

  it("generates interface specs from exported suffix-named functions and constants", () => {
    const files = generateBootstrapSpecFiles({
      files: [
        sourceFile("src/http.ts", [
          sourceSymbol({
            name: "SearchHandler",
            symbolKind: "function",
            isExported: true,
            line: 3,
            metadata: {}
          }),
          sourceSymbol({
            name: "ApiClient",
            symbolKind: "const",
            isExported: true,
            line: 9,
            metadata: {}
          })
        ])
      ],
      warnings: []
    });

    expect(files.map((file) => file.path)).toEqual([
      "interfaces/api-client.md",
      "interfaces/search-handler.md"
    ]);
    expect(files.find((file) => file.entityId === "interface.search-handler")?.content).toContain(
      "`src/http.ts` exports `SearchHandler` as a function."
    );
    expect(files.find((file) => file.entityId === "interface.api-client")?.content).toContain(
      "`src/http.ts` exports `ApiClient` as a const."
    );
  });

  it("slugifies source symbols stably", () => {
    expect(slugifySourceSymbol("DecisionService")).toBe("decision-service");
    expect(slugifySourceSymbol("workspace_record")).toBe("workspace-record");
    expect(slugifySourceSymbol("HTTPClient")).toBe("http-client");
  });
});

function scanResult(): ScanRepositoryResult {
  return {
    files: [
      sourceFile("src/domain.ts", [
        sourceSymbol({
          name: "Workspace",
          symbolKind: "interface",
          isExported: true,
          line: 1,
          metadata: {}
        }),
        sourceSymbol({
          name: "Decision",
          symbolKind: "interface",
          isExported: true,
          line: 7,
          metadata: {}
        }),
        sourceSymbol({
          name: "DecisionLink",
          symbolKind: "type_alias",
          isExported: true,
          line: 14,
          metadata: {}
        }),
        sourceSymbol({
          name: "internalHelper",
          symbolKind: "function",
          isExported: false,
          line: 20,
          metadata: {}
        })
      ]),
      sourceFile("src/services/decision-service.ts", [
        sourceSymbol({
          name: "DecisionService",
          symbolKind: "class",
          isExported: true,
          line: 4,
          metadata: {}
        })
      ]),
      sourceFile("src/services/reminder-scheduler.ts", [
        sourceSymbol({
          name: "ReminderScheduler",
          symbolKind: "class",
          isExported: true,
          line: 5,
          metadata: {}
        })
      ])
    ],
    warnings: []
  };
}

function sourceSymbol(symbol: Omit<SourceSymbolFact, "specopsAnnotations">): SourceSymbolFact {
  return { ...symbol, specopsAnnotations: [] };
}

function sourceFile(path: string, symbols: ScanRepositoryResult["files"][number]["symbols"]) {
  return {
    path,
    language: "typescript" as const,
    kind: "source" as const,
    sizeBytes: 100,
    contentHash: `${path}-hash`,
    imports: [],
    exports: symbols
      .filter((symbol) => symbol.isExported)
      .map((symbol) => ({
        exportedName: symbol.name,
        exportKind:
          symbol.symbolKind === "type_alias" || symbol.symbolKind === "interface"
            ? ("type" as const)
            : ("named" as const),
        sourceSpecifier: null
      })),
    symbols
  };
}
