import { describe, expect, it } from "vitest";

import {
  getDraft,
  saveDraft,
  syncFetchedMarkdown,
  updateDraft
} from "./entity-drafts.js";

describe("entity drafts", () => {
  it("preserves dirty drafts across prop-level entity switches and refetches", () => {
    let drafts = syncFetchedMarkdown({}, "project-a/entity-a", "saved a");
    drafts = updateDraft(drafts, "project-a/entity-a", "dirty a");
    drafts = syncFetchedMarkdown(drafts, "project-a/entity-a", "refetched a");
    drafts = syncFetchedMarkdown(drafts, "project-a/entity-b", "saved b");

    expect(getDraft(drafts, "project-a/entity-b")).toEqual({
      markdown: "saved b",
      savedMarkdown: "saved b"
    });
    expect(getDraft(drafts, "project-a/entity-a")).toEqual({
      markdown: "dirty a",
      savedMarkdown: "saved a"
    });
  });

  it("replaces a draft after successful save", () => {
    let drafts = syncFetchedMarkdown({}, "project-a/entity-a", "saved a");
    drafts = updateDraft(drafts, "project-a/entity-a", "dirty a");
    drafts = saveDraft(drafts, "project-a/entity-a", "saved after save");

    expect(getDraft(drafts, "project-a/entity-a")).toEqual({
      markdown: "saved after save",
      savedMarkdown: "saved after save"
    });
  });
});
