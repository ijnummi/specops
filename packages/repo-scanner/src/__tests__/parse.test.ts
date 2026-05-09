import { describe, expect, it } from "vitest";

import { parseSourceFacts } from "../parse.js";

describe("parseSourceFacts", () => {
  it("extracts imports, exports, and top-level symbols", () => {
    const result = parseSourceFacts({
      path: "src/example.tsx",
      content:
        "import React, { useMemo as memo } from 'react';\n" +
        "import type { Project } from './types';\n" +
        "export const Example = () => memo(() => null, []);\n" +
        "export interface ExampleProps { name: string }\n" +
        "class Internal {}\n" +
        "export { Internal as RenamedInternal };\n"
    });

    expect(result.warnings).toEqual([]);
    expect(result.imports).toContainEqual(
      expect.objectContaining({
        specifier: "react",
        importKind: "mixed",
        importedNames: ["default", "useMemo"],
        isRelative: false
      })
    );
    expect(result.imports).toContainEqual(
      expect.objectContaining({
        specifier: "./types",
        importKind: "type",
        importedNames: ["Project"],
        isRelative: true
      })
    );
    expect(result.exports).toContainEqual(
      expect.objectContaining({ exportedName: "Example", exportKind: "named" })
    );
    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "Example",
        symbolKind: "react_component",
        isExported: true,
        line: 3
      })
    );
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "Internal", symbolKind: "class", isExported: true })
    );
  });

  it("returns parse warnings instead of throwing", () => {
    const result = parseSourceFacts({
      path: "src/broken.ts",
      content: "export const ="
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_parse_error",
        filePath: "src/broken.ts"
      })
    );
  });

  it("represents named default function exports", () => {
    const result = parseSourceFacts({
      path: "src/default-function.ts",
      content: "export default function run() {}\n"
    });

    expect(result.exports).toContainEqual({
      exportedName: "default",
      exportKind: "default",
      sourceSpecifier: null
    });
    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "run",
        symbolKind: "function",
        isExported: true
      })
    );
  });

  it("marks local symbols exported through export declarations", () => {
    const result = parseSourceFacts({
      path: "src/re-export-local.ts",
      content: "const helper = () => null;\nexport { helper as exportedHelper };\n"
    });

    expect(result.exports).toContainEqual({
      exportedName: "exportedHelper",
      exportKind: "named",
      sourceSpecifier: null
    });
    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "helper",
        symbolKind: "constant",
        isExported: true
      })
    );
  });

  it("represents anonymous default exports", () => {
    const classResult = parseSourceFacts({
      path: "src/default-class.ts",
      content: "export default class {}\n"
    });
    const expressionResult = parseSourceFacts({
      path: "src/default-expression.ts",
      content: "export default () => null;\n"
    });
    const functionResult = parseSourceFacts({
      path: "src/default-anonymous-function.ts",
      content: "export default function () {}\n"
    });

    expect(classResult.exports).toContainEqual({
      exportedName: "default",
      exportKind: "default",
      sourceSpecifier: null
    });
    expect(expressionResult.exports).toContainEqual({
      exportedName: "default",
      exportKind: "default",
      sourceSpecifier: null
    });
    expect(functionResult.exports).toContainEqual({
      exportedName: "default",
      exportKind: "default",
      sourceSpecifier: null
    });
  });

  it("tracks re-export declarations as imports", () => {
    const starResult = parseSourceFacts({
      path: "src/star-barrel.ts",
      content: "export * from './foo';\n"
    });
    const namedResult = parseSourceFacts({
      path: "src/named-barrel.ts",
      content: "export { Foo } from './foo';\n"
    });

    expect(starResult.imports).toContainEqual({
      specifier: "./foo",
      importKind: "re_export",
      importedNames: ["*"],
      isRelative: true,
      resolvedPath: null
    });
    expect(starResult.exports).toContainEqual({
      exportedName: "*",
      exportKind: "namespace",
      sourceSpecifier: "./foo"
    });
    expect(namedResult.imports).toContainEqual({
      specifier: "./foo",
      importKind: "re_export",
      importedNames: ["Foo"],
      isRelative: true,
      resolvedPath: null
    });
    expect(namedResult.exports).toContainEqual({
      exportedName: "Foo",
      exportKind: "re_export",
      sourceSpecifier: "./foo"
    });
  });

  it("represents default aliases in export declarations", () => {
    const result = parseSourceFacts({
      path: "src/default-alias.ts",
      content: "const Foo = 1;\nexport { Foo as default };\n"
    });

    expect(result.exports).toContainEqual({
      exportedName: "default",
      exportKind: "default",
      sourceSpecifier: null
    });
  });

  it("extracts specops annotations from leading JSDoc", () => {
    const result = parseSourceFacts({
      path: "src/decision.ts",
      content:
        "/**\n" +
        " * Domain decision record.\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    });

    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "Decision",
        specopsAnnotations: [
          {
            entityId: "domain.decision",
            line: 3
          }
        ]
      })
    );
  });

  it("extracts multiple specops annotations on one declaration", () => {
    const result = parseSourceFacts({
      path: "src/decision-service.ts",
      content:
        "/**\n" +
        " * @specops interface.decision-service\n" +
        " * @specops uc.create-decision\n" +
        " */\n" +
        "export class DecisionService {}\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "DecisionService")).toMatchObject({
      specopsAnnotations: [
        { entityId: "interface.decision-service", line: 2 },
        { entityId: "uc.create-decision", line: 3 }
      ]
    });
  });

  it("extracts specops annotations from variable statement JSDoc", () => {
    const result = parseSourceFacts({
      path: "src/search-handler.ts",
      content:
        "/**\n" +
        " * @specops interface.search-handler\n" +
        " */\n" +
        "export const SearchHandler = () => null;\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "SearchHandler")).toMatchObject({
      specopsAnnotations: [{ entityId: "interface.search-handler", line: 2 }]
    });
  });

  it("warns when variable statement specops annotations attach to no symbol", () => {
    const result = parseSourceFacts({
      path: "src/destructured.ts",
      content:
        "/** @specops domain.x */\n" +
        "export const { x } = source;\n"
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_spec_unresolved_symbol",
        filePath: "src/destructured.ts"
      })
    );
  });

  it("warns instead of attaching variable statement annotations to multiple symbols", () => {
    const result = parseSourceFacts({
      path: "src/multi-variable.ts",
      content:
        "/** @specops domain.foo */\n" +
        "export const Foo = 1, Bar = 2;\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "Foo")).toMatchObject({
      specopsAnnotations: []
    });
    expect(result.symbols.find((symbol) => symbol.name === "Bar")).toMatchObject({
      specopsAnnotations: []
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_spec_unresolved_symbol",
        filePath: "src/multi-variable.ts"
      })
    );
  });

  it("warns instead of attaching mixed variable statement annotations", () => {
    const result = parseSourceFacts({
      path: "src/mixed-variable.ts",
      content:
        "/** @specops domain.foo */\n" +
        "export const Foo = 1, { bar } = source;\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "Foo")).toMatchObject({
      specopsAnnotations: []
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_spec_unresolved_symbol",
        filePath: "src/mixed-variable.ts"
      })
    );
  });

  it("ignores unrelated leading comments", () => {
    const result = parseSourceFacts({
      path: "src/workspace.ts",
      content:
        "// specops: domain.workspace\n" +
        "/** not a specops tag */\n" +
        "export type Workspace = { id: string }\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "Workspace")).toMatchObject({ specopsAnnotations: [] });
  });

  it("ignores prose mentions of specops tags in JSDoc", () => {
    const result = parseSourceFacts({
      path: "src/prose.ts",
      content:
        "/**\n" +
        " * Use @specops in examples.\n" +
        " */\n" +
        "export interface Foo {}\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "Foo")).toMatchObject({
      specopsAnnotations: []
    });
    expect(result.warnings).toEqual([]);
  });

  it("keeps empty specops annotations for API validation", () => {
    const result = parseSourceFacts({
      path: "src/broken-annotation.ts",
      content:
        "/**\n" +
        " * @specops\n" +
        " */\n" +
        "export interface BrokenAnnotation { id: string }\n"
    });

    expect(result.symbols.find((symbol) => symbol.name === "BrokenAnnotation")).toMatchObject({
      specopsAnnotations: [{ entityId: "", line: 2 }]
    });
  });

  it("warns when a specops JSDoc tag is not attached to a symbol declaration", () => {
    const result = parseSourceFacts({
      path: "src/barrel.ts",
      content:
        "/** @specops domain.decision */\n" +
        "export { Decision } from './decision';\n"
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "source_spec_unresolved_symbol",
        filePath: "src/barrel.ts"
      })
    );
  });
});
