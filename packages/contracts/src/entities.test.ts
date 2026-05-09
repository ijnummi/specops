import { describe, expect, it } from "vitest";

import { createEntityRequestSchema, updateEntityMarkdownRequestSchema } from "./entities.js";

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
