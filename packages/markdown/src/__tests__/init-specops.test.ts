import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { initializeSpecopsFolder } from "../init-specops.js";
import { parseSpecMarkdown } from "../parse.js";
import { createEntityMarkdown, initialSpecopsFiles } from "../templates.js";

describe("createEntityMarkdown", () => {
  it("creates deterministic markdown with required frontmatter", () => {
    expect(
      createEntityMarkdown({
        entityId: "domain.project",
        type: "domain_entity",
        title: "Project",
        status: "draft"
      })
    ).toBe(`---
id: domain.project
type: domain_entity
title: Project
status: draft
links: {}
---

# Project

Describe this domain_entity and the decisions that shape it.
`);
  });

  it("round-trips titles containing YAML punctuation", () => {
    const title = "Customer: Profile #1";
    const markdown = createEntityMarkdown({
      entityId: "domain.customer-profile",
      type: "domain_entity",
      title,
      status: "draft"
    });

    const result = parseSpecMarkdown("domain/customer-profile.md", markdown);

    expect(result.messages).toEqual([]);
    expect(result.entity).toMatchObject({
      entityId: "domain.customer-profile",
      type: "domain_entity",
      title,
      status: "draft"
    });
  });

  it("rejects multiline frontmatter scalars", () => {
    expect(() =>
      createEntityMarkdown({
        entityId: "domain.customer",
        type: "domain_entity",
        title: "Customer\nProfile",
        status: "draft"
      })
    ).toThrow(/title must be a single-line string/);
  });
});

describe("initialSpecopsFiles", () => {
  it("includes starter specs and templates", () => {
    const paths = initialSpecopsFiles().map((file) => file.path);

    expect(paths).toContain("project.yaml");
    expect(paths).toContain("decisions/adr-001-markdown-is-source-of-truth.md");
    expect(paths).toContain("domain/project.md");
    expect(paths).toContain("domain/spec-entity.md");
    expect(paths).toContain("interfaces/markdown-indexer.md");
    expect(paths).toContain("use-cases/uc.initialize-specops-folder.md");
    expect(paths).toContain("templates/use-case.template.md");
    expect(paths).toContain("templates/adr.template.md");
  });

  it("emits the canonical project config shape", () => {
    const projectFile = initialSpecopsFiles().find(
      (file) => file.path === "project.yaml"
    );

    expect(projectFile?.content).toBe(`id: specops-workbench
name: SpecOps Workbench
specops_version: 1
description: Local-first markdown-native workbench for specs-driven AI-assisted software development.
`);
  });

  it("emits the canonical ADR 001 id", () => {
    const adrFile = initialSpecopsFiles().find(
      (file) => file.path === "decisions/adr-001-markdown-is-source-of-truth.md"
    );

    expect(adrFile?.content).toContain("id: adr.001-markdown-is-source-of-truth\n");
  });
});

describe("initializeSpecopsFolder", () => {
  it("creates missing starter files without overwriting existing files", async () => {
    const root = join(tmpdir(), `specops-init-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "project.yaml"), "existing: true\n");

    const result = await initializeSpecopsFolder(root);

    expect(result.createdPaths).toContain(
      "decisions/adr-001-markdown-is-source-of-truth.md"
    );
    expect(result.skippedPaths).toEqual(["project.yaml"]);
    expect(result.createdCount).toBe(result.createdPaths.length);
    expect(result.skippedCount).toBe(1);
    await expect(readFile(join(root, "project.yaml"), "utf8")).resolves.toBe(
      "existing: true\n"
    );
    await expect(
      readFile(join(root, "templates", "domain-entity.template.md"), "utf8")
    ).resolves.toContain("{{id}}");
  });
});
