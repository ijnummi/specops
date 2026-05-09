import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { discoverMarkdownFiles } from "../discover.js";

describe("discoverMarkdownFiles", () => {
  it("recursively returns relative POSIX markdown paths", async () => {
    const root = join(tmpdir(), `specops-discover-${crypto.randomUUID()}`);
    await mkdir(join(root, "domain", "nested"), { recursive: true });
    await mkdir(join(root, "templates"), { recursive: true });
    await writeFile(join(root, "domain", "project.md"), "# Project");
    await writeFile(join(root, "domain", "nested", "spec-link.md"), "# Link");
    await writeFile(join(root, "templates", "ignore.txt"), "Ignore");

    await expect(discoverMarkdownFiles(root)).resolves.toEqual([
      "domain/nested/spec-link.md",
      "domain/project.md"
    ]);
  });
});
