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
});
