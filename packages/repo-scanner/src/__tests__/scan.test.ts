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
});
