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
      message: "Malformed frontmatter near: id uc.create-project"
    });
  });
});
