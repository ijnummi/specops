import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { discoverMarkdownFiles } from "../discover.js";
import { parseSpecMarkdown } from "../parse.js";

describe("sample specops project", () => {
  it("parses all sample specs and links only to sample entities", async () => {
    const sampleRoot = path.join(await findRepoRoot(), "sample", "specops");
    const markdownPaths = await discoverMarkdownFiles(sampleRoot);

    expect(markdownPaths.length).toBeGreaterThanOrEqual(14);

    const parsed = await Promise.all(
      markdownPaths.map(async (relativePath) =>
        parseSpecMarkdown(
          relativePath,
          await readFile(path.join(sampleRoot, relativePath), "utf8")
        )
      )
    );

    const entities = parsed.map((result) => result.entity).filter((entity) => entity !== null);
    const entityIds = new Set(entities.map((entity) => entity.entityId));
    const types = new Set(entities.map((entity) => entity.type));

    expect(parsed.flatMap((result) => result.messages)).toEqual([]);
    expect(types).toEqual(
      new Set([
        "adr",
        "domain_entity",
        "interface",
        "use_case"
      ])
    );

    for (const link of parsed.flatMap((result) => result.links)) {
      expect(entityIds.has(link.toEntityId), `${link.fromEntityId} links to missing ${link.toEntityId}`).toBe(true);
    }
  });
});

async function findRepoRoot(startDir = process.cwd()): Promise<string> {
  let current = startDir;
  while (true) {
    try {
      await readFile(path.join(current, "pnpm-workspace.yaml"), "utf8");
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error("Could not find repository root");
      }
      current = parent;
    }
  }
}
