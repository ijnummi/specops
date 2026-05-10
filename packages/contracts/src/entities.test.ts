import { describe, expect, it } from "vitest";

import {
  createEntityRequestSchema,
  entitySearchQuerySchema,
  entitySearchResultSchema,
  updateEntityMarkdownRequestSchema
} from "./entities.js";

describe("createEntityRequestSchema", () => {
  it("defaults status to draft", () => {
    const parsed = createEntityRequestSchema.parse({
      entityId: "feature-auth",
      type: "feature",
      title: "Authentication"
    });

    expect(parsed.status).toBe("draft");
  });
});

describe("updateEntityMarkdownRequestSchema", () => {
  it("requires a base content hash for optimistic concurrency", () => {
    expect(() =>
      updateEntityMarkdownRequestSchema.parse({
        markdown: "---\nid: feature-auth\n---\n"
      })
    ).toThrow();

    expect(
      updateEntityMarkdownRequestSchema.parse({
        markdown: "---\nid: feature-auth\n---\n",
        baseContentHash: "abc123"
      })
    ).toEqual({
      markdown: "---\nid: feature-auth\n---\n",
      baseContentHash: "abc123"
    });
  });
});

describe("entitySearchQuerySchema", () => {
  it("requires non-empty q and defaults limit to 25", () => {
    expect(entitySearchQuerySchema.parse({ q: "customer" })).toEqual({
      q: "customer",
      limit: 25
    });

    expect(() => entitySearchQuerySchema.parse({ q: "   " })).toThrow();
  });

  it("accepts optional type, status, and bounded limit filters", () => {
    expect(
      entitySearchQuerySchema.parse({
        q: "customer",
        type: "domain_entity",
        status: "draft",
        limit: "50"
      })
    ).toEqual({
      q: "customer",
      type: "domain_entity",
      status: "draft",
      limit: 50
    });

    expect(() => entitySearchQuerySchema.parse({ q: "customer", limit: "51" })).toThrow();
    expect(() => entitySearchQuerySchema.parse({ q: "customer", limit: "0" })).toThrow();
  });
});

describe("entitySearchResultSchema", () => {
  it("parses a ranked entity search result", () => {
    expect(
      entitySearchResultSchema.parse({
        entityId: "domain.customer",
        title: "Customer",
        type: "domain_entity",
        status: "draft",
        filePath: "domain/domain.customer.md",
        rank: 0.92,
        snippet: "Customer profile requirements",
        matchedFields: ["title", "bodyText"]
      })
    ).toEqual({
      entityId: "domain.customer",
      title: "Customer",
      type: "domain_entity",
      status: "draft",
      filePath: "domain/domain.customer.md",
      rank: 0.92,
      snippet: "Customer profile requirements",
      matchedFields: ["title", "bodyText"]
    });
  });
});
