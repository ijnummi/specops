import { describe, expect, it } from "vitest";

import { defaultSpecopsPathForRepoInput } from "./project-create-form.js";

describe("ProjectCreateForm helpers", () => {
  it("defaults the specops path to a specops folder under the repository path", () => {
    expect(defaultSpecopsPathForRepoInput("/repo/product")).toBe("/repo/product/specops");
    expect(defaultSpecopsPathForRepoInput("/repo/product/")).toBe("/repo/product/specops");
  });
});
