import { describe, expect, it } from "vitest";

import { validateEntityMarkdownIdentity } from "./entity-markdown.js";

describe("validateEntityMarkdownIdentity", () => {
  it("accepts markdown when frontmatter id matches selected entity", () => {
    expect(
      validateEntityMarkdownIdentity(
        "---\nid: \"uc.create-project\"\ntype: use_case\n---\n\n# Create Project\n",
        "uc.create-project"
      )
    ).toEqual({ ok: true, id: "uc.create-project" });
  });

  it("rejects identity-changing markdown before save", () => {
    expect(
      validateEntityMarkdownIdentity(
        "---\nid: uc.other\ntype: use_case\n---\n\n# Other\n",
        "uc.create-project"
      )
    ).toEqual({
      ok: false,
      message: "Entity id cannot be changed from uc.create-project to uc.other."
    });
  });

  it("rejects missing closing frontmatter before save", () => {
    expect(
      validateEntityMarkdownIdentity("---\nid: uc.create-project\n\n# Broken\n", "uc.create-project")
    ).toEqual({
      ok: false,
      message: "Frontmatter closing marker is missing."
    });
  });

  it("rejects frontmatter lines without a key separator", () => {
    expect(
      validateEntityMarkdownIdentity(
        "---\nid uc.create-project\ntype: use_case\n---\n",
        "uc.create-project"
      )
    ).toEqual({
      ok: false,
      message: "Frontmatter YAML is malformed."
    });
  });

  it("rejects malformed nested YAML", () => {
    expect(
      validateEntityMarkdownIdentity(
        "---\nid: uc.create-project\nlinks:\n  related: [uc.other\n---\n",
        "uc.create-project"
      )
    ).toEqual({
      ok: false,
      message: "Frontmatter YAML is malformed."
    });
  });

  it("rejects duplicate id keys", () => {
    expect(
      validateEntityMarkdownIdentity(
        "---\nid: uc.create-project\nid: uc.other\n---\n",
        "uc.create-project"
      )
    ).toEqual({
      ok: false,
      message: "Frontmatter contains duplicate keys."
    });
  });

  it("rejects non-object frontmatter", () => {
    expect(validateEntityMarkdownIdentity("---\n- id: uc.create-project\n---\n", "uc.create-project")).toEqual({
      ok: false,
      message: "Frontmatter must be a mapping."
    });
  });

  it("rejects non-string id", () => {
    expect(validateEntityMarkdownIdentity("---\nid: 123\n---\n", "uc.create-project")).toEqual({
      ok: false,
      message: "Frontmatter id must be a string."
    });
  });
});
