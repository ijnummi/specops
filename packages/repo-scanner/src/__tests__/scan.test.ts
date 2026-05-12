import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanRepository } from "../scan.js";

describe("scanRepository", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("scans supported files and ignores generated directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-scanner-"));
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export function run() { return 1; }\n");
    await writeFile(path.join(root, "src", "index.test.ts"), "import { run } from './index';\n");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "export const ignored = true;\n");
    await writeFile(path.join(root, "README.md"), "# ignored\n");

    const result = await scanRepository({ repoPath: root });

    expect(result.files.map((file) => file.path).sort()).toEqual([
      "src/index.test.ts",
      "src/index.ts"
    ]);
    expect(result.files.find((file) => file.path === "src/index.ts")).toMatchObject({
      language: "typescript",
      kind: "source"
    });
    expect(result.files.find((file) => file.path === "src/index.test.ts")).toMatchObject({
      kind: "test"
    });
  });

  it("resolves re-export import edges", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-scanner-"));
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "foo.ts"), "export const Foo = 1;\n");
    await writeFile(path.join(root, "src", "index.ts"), "export { Foo } from './foo';\n");

    const result = await scanRepository({ repoPath: root });
    const indexFile = result.files.find((file) => file.path === "src/index.ts");

    expect(indexFile?.imports).toContainEqual(
      expect.objectContaining({
        specifier: "./foo",
        importKind: "re_export",
        importedNames: ["Foo"],
        resolvedPath: "src/foo.ts"
      })
    );
  });

  it("scans a mixed source fixture with entrypoint, config, tests, and symbols", async () => {
    const sampleRoot = await mkdtemp(path.join(os.tmpdir(), "specops-scanner-sample-"));
    roots.push(sampleRoot);
    await mkdir(path.join(sampleRoot, "src", "__tests__"), { recursive: true });
    await mkdir(path.join(sampleRoot, "src", "services"), { recursive: true });
    await writeFile(
      path.join(sampleRoot, "src", "main.ts"),
      "import { DecisionService } from './services/decision-service';\nexport const service = new DecisionService();\n"
    );
    await writeFile(path.join(sampleRoot, "src", "index.ts"), "export * from './domain';\n");
    await writeFile(path.join(sampleRoot, "src", "domain.ts"), "export interface Decision { id: string; }\n");
    await writeFile(
      path.join(sampleRoot, "src", "services", "decision-service.ts"),
      "import type { Decision } from '../domain';\nexport function toDecisionId(value: string) { return value; }\nexport class DecisionService { list(): Decision[] { return []; } }\n"
    );
    await writeFile(
      path.join(sampleRoot, "src", "__tests__", "decision-service.test.ts"),
      "import { DecisionService } from '../services/decision-service';\nnew DecisionService();\n"
    );
    await writeFile(path.join(sampleRoot, "vitest.config.ts"), "export default {};\n");

    const result = await scanRepository({ repoPath: sampleRoot });
    const byPath = new Map(result.files.map((file) => [file.path, file]));

    expect(byPath.get("src/main.ts")?.kind).toBe("entrypoint");
    expect(byPath.get("src/index.ts")?.kind).toBe("source");
    expect(byPath.get("src/domain.ts")?.kind).toBe("source");
    expect(byPath.get("src/services/decision-service.ts")?.kind).toBe("source");
    expect(byPath.get("src/__tests__/decision-service.test.ts")?.kind).toBe("test");
    expect(byPath.get("vitest.config.ts")?.kind).toBe("config");

    const decisionService = byPath.get("src/services/decision-service.ts");
    expect(decisionService?.imports.map((sourceImport) => sourceImport.specifier)).toContain("../domain");
    expect(decisionService?.exports.map((sourceExport) => sourceExport.exportedName)).toEqual(
      expect.arrayContaining(["DecisionService", "toDecisionId"]),
    );
    expect(decisionService?.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["DecisionService", "toDecisionId"]),
    );

    expect([...byPath.keys()].sort()).toEqual([
      "src/__tests__/decision-service.test.ts",
      "src/domain.ts",
      "src/index.ts",
      "src/main.ts",
      "src/services/decision-service.ts",
      "vitest.config.ts"
    ]);
    expect(result.warnings).toEqual([]);
  });
});
