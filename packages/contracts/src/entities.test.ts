import { describe, expect, it } from "vitest";

import { createEntityRequestSchema } from "./entities.js";

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
