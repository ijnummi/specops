import { describe, expect, it } from "vitest";

import { parseSpecMarkdown } from "../parse.js";

describe("parseSpecMarkdown", () => {
  it("parses required frontmatter and body", () => {
    const result = parseSpecMarkdown(
      "use-cases/uc.demo.md",
      `---
id: uc.demo
type: use_case
title: Demo
status: draft
links:
  domain:
    - domain.project
---

# Demo

Create a project from a repository.
`
    );

    expect(result.entity).toMatchObject({
      entityId: "uc.demo",
      type: "use_case",
      title: "Demo",
      status: "draft",
      filePath: "use-cases/uc.demo.md",
      bodyMarkdown: "# Demo\n\nCreate a project from a repository.\n",
      bodyText: "Demo Create a project from a repository."
    });
    expect(result.entity?.frontmatter).toMatchObject({
      id: "uc.demo",
      type: "use_case",
      title: "Demo",
      status: "draft"
    });
    expect(result.links).toEqual([
      {
        fromEntityId: "uc.demo",
        toEntityId: "domain.project",
        linkType: "domain",
        source: "frontmatter:links.domain"
      }
    ]);
    expect(result.messages).toEqual([]);
  });

  it("reports missing required frontmatter fields", () => {
    const result = parseSpecMarkdown(
      "domain/missing.md",
      `---
id: domain.missing
title: Missing
---

Body
`
    );

    expect(result.entity).toBeNull();
    expect(result.links).toEqual([]);
    expect(result.messages).toEqual([
      expect.objectContaining({
        level: "error",
        code: "missing_required_field",
        message: expect.stringContaining("type"),
        entityId: "domain.missing"
      }),
      expect.objectContaining({
        level: "error",
        code: "missing_required_field",
        message: expect.stringContaining("status"),
        entityId: "domain.missing"
      })
    ]);
  });

  it("reports malformed frontmatter without throwing", () => {
    const result = parseSpecMarkdown(
      "domain/bad.md",
      `---
id: domain.bad
type: domain_entity
title: Bad
status: draft
links:
  domain: [domain.project
---

Body
`
    );

    expect(result.entity).toBeNull();
    expect(result.links).toEqual([]);
    expect(result.messages).toEqual([
      expect.objectContaining({
        level: "error",
        code: "malformed_frontmatter",
        filePath: "domain/bad.md",
        entityId: null
      })
    ]);
  });

  it("extracts typed links from nested frontmatter arrays", () => {
    const result = parseSpecMarkdown(
      "use-cases/uc.links.md",
      `---
id: uc.links
type: use_case
title: Links
status: draft
links:
  domain:
    - domain.project
    - domain.spec-entity
  interfaces:
    - interface.markdown-indexer
---

Body
`
    );

    expect(result.links).toEqual([
      {
        fromEntityId: "uc.links",
        toEntityId: "domain.project",
        linkType: "domain",
        source: "frontmatter:links.domain"
      },
      {
        fromEntityId: "uc.links",
        toEntityId: "domain.spec-entity",
        linkType: "domain",
        source: "frontmatter:links.domain"
      },
      {
        fromEntityId: "uc.links",
        toEntityId: "interface.markdown-indexer",
        linkType: "interfaces",
        source: "frontmatter:links.interfaces"
      }
    ]);
  });

  it("ignores invalid link values with validation warnings", () => {
    const result = parseSpecMarkdown(
      "use-cases/uc.invalid-links.md",
      `---
id: uc.invalid-links
type: use_case
title: Invalid Links
status: draft
links:
  domain:
    - domain.project
    - 42
  interfaces: interface.markdown-indexer
---

`
    );

    expect(result.links).toEqual([
      {
        fromEntityId: "uc.invalid-links",
        toEntityId: "domain.project",
        linkType: "domain",
        source: "frontmatter:links.domain"
      }
    ]);
    expect(result.messages).toEqual([
      expect.objectContaining({
        level: "warning",
        code: "invalid_link_value",
        entityId: "uc.invalid-links",
        message: expect.stringContaining("links.domain")
      }),
      expect.objectContaining({
        level: "warning",
        code: "invalid_link_group",
        entityId: "uc.invalid-links",
        message: expect.stringContaining("links.interfaces")
      }),
      expect.objectContaining({
        level: "info",
        code: "empty_body",
        entityId: "uc.invalid-links"
      })
    ]);
  });
});
