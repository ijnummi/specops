import { describe, expect, it } from "vitest";

import { createProjectRequestSchema } from "./projects.js";

describe("createProjectRequestSchema", () => {
  it("accepts kebab-case slugs", () => {
    const parsed = createProjectRequestSchema.parse({
      name: "SpecOps",
      slug: "specops-workbench",
      repoPath: "/repo",
      specopsPath: ".specops"
    });

    expect(parsed.slug).toBe("specops-workbench");
  });

  it("rejects slugs that are not kebab-case", () => {
    expect(() =>
      createProjectRequestSchema.parse({
        name: "SpecOps",
        slug: "SpecOps Workbench",
        repoPath: "/repo",
        specopsPath: ".specops"
      })
    ).toThrow();
  });
});
