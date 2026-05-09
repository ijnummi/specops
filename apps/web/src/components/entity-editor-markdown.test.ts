import { describe, expect, it } from "vitest";

import { entityMarkdownForEditing } from "./entity-editor-markdown.js";

describe("entityMarkdownForEditing", () => {
  it("uses canonical raw markdown when the entity response includes it", () => {
    const rawMarkdown =
      "---\n# frontmatter comment\nid: domain.customer\ntype: domain_entity\ntitle: Customer\nstatus: draft\n---\n\nBody\n";

    expect(
      entityMarkdownForEditing({
        markdown: rawMarkdown,
        frontmatter: {
          id: "domain.customer",
          type: "domain_entity",
          title: "Customer",
          status: "draft"
        },
        bodyMarkdown: "Reconstructed body would be different."
      })
    ).toBe(rawMarkdown);
  });

  it("falls back to reconstructed markdown when raw markdown is absent", () => {
    expect(
      entityMarkdownForEditing({
        frontmatter: {
          id: "domain.customer",
          type: "domain_entity",
          title: "Customer",
          status: "draft"
        },
        bodyMarkdown: "Body\n"
      })
    ).toBe(
      '---\nid: "domain.customer"\ntype: "domain_entity"\ntitle: "Customer"\nstatus: "draft"\n---\n\nBody\n'
    );
  });
});
