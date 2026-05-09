import { describe, expect, it } from "vitest";

import {
  sourceFileDetailSchema,
  sourceFileListQuerySchema,
  sourceFileSummarySchema,
  sourceSpecLinkSchema
} from "./source.js";
import { indexRunSchema } from "./indexing.js";

describe("source contracts", () => {
  it("parses source file list filters", () => {
    expect(
      sourceFileListQuerySchema.parse({
        language: "typescript",
        kind: "source",
        q: "indexer"
      })
    ).toEqual({
      language: "typescript",
      kind: "source",
      q: "indexer",
      limit: 50,
      offset: 0
    });
  });

  it("coerces source file list pagination params", () => {
    expect(
      sourceFileListQuerySchema.parse({
        limit: "10",
        offset: "20"
      })
    ).toMatchObject({
      limit: 10,
      offset: 20
    });
  });

  it("parses source file summaries", () => {
    expect(
      sourceFileSummarySchema.parse({
        id: "file-1",
        projectId: "project-1",
        path: "apps/api/src/server.ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 1200,
        contentHash: "abc123",
        lastSeenAt: "2026-05-09T12:00:00.000Z",
        importCount: 3,
        exportCount: 1,
        symbolCount: 2
      })
    ).toMatchObject({
      path: "apps/api/src/server.ts",
      importCount: 3,
      exportCount: 1,
      symbolCount: 2
    });
  });

  it("parses source file details with imports, exports, and symbols", () => {
    expect(
      sourceFileDetailSchema.parse({
        id: "file-1",
        projectId: "project-1",
        path: "packages/repo-scanner/src/index.ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 80,
        contentHash: "hash",
        lastSeenAt: "2026-05-09T12:00:00.000Z",
        imports: [
          {
            id: "import-1",
            specifier: "typescript",
            importKind: "named",
            importedNames: ["createSourceFile"],
            isRelative: false,
            resolvedPath: null
          }
        ],
        exports: [
          {
            id: "export-1",
            exportedName: "scanRepository",
            exportKind: "named",
            sourceSpecifier: null
          }
        ],
        symbols: [
          {
            id: "symbol-1",
            name: "scanRepository",
            symbolKind: "function",
            isExported: true,
            line: 7,
            metadata: {}
          }
        ]
      })
    ).toMatchObject({
      path: "packages/repo-scanner/src/index.ts",
      imports: [{ specifier: "typescript" }],
      symbols: [{ name: "scanRepository", isExported: true }]
    });
  });

  it("keeps source counts optional on index runs", () => {
    expect(
      indexRunSchema.parse({
        id: "run-1",
        projectId: "project-1",
        startedAt: "2026-05-09T12:00:00.000Z",
        finishedAt: "2026-05-09T12:00:01.000Z",
        status: "succeeded",
        entityCount: 1,
        linkCount: 2,
        errorCount: 0,
        warningCount: 0,
        gitCommit: null,
        sourceFileCount: 5,
        sourceImportCount: 8,
        sourceExportCount: 4,
        sourceSymbolCount: 6
      })
    ).toMatchObject({
      sourceFileCount: 5,
      sourceImportCount: 8,
      sourceExportCount: 4,
      sourceSymbolCount: 6
    });
  });

  it("parses source spec link DTOs", () => {
    expect(
      sourceSpecLinkSchema.parse({
        id: "link-1",
        projectId: "project-1",
        sourceFileId: "file-1",
        filePath: "src/decision.ts",
        entityId: "domain.decision",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 5,
        annotationLine: 3,
        contentHash: "abc123",
        excerpt: {
          status: "available",
          startLine: 1,
          endLine: 6,
          text:
            "/**\n" +
            " * @specops domain.decision\n" +
            " */\n" +
            "export interface Decision {}\n"
        },
        createdAt: "2026-05-10T00:00:00.000Z"
      })
    ).toMatchObject({
      entityId: "domain.decision",
      filePath: "src/decision.ts",
      excerpt: { status: "available" }
    });
  });
});
