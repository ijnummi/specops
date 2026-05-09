import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { discoverMarkdownFiles } from "../discover.js";
import { initializeSpecopsFolder } from "../init-specops.js";

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

  it("excludes initialized template markdown files from indexing", async () => {
    const root = join(tmpdir(), `specops-discover-init-${crypto.randomUUID()}`);
    await initializeSpecopsFolder(root);

    const files = await discoverMarkdownFiles(root);

    expect(files).toContain("domain/project.md");
    expect(files).toContain("use-cases/uc.initialize-specops-folder.md");
    expect(files).not.toContain("templates/use-case.template.md");
    expect(files).not.toContain("templates/domain-entity.template.md");
    expect(files.every((file) => !file.endsWith(".template.md"))).toBe(true);
  });
});
