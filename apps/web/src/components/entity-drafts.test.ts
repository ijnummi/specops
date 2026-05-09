import { beforeEach, describe, expect, it } from "vitest";

import {
  getEntityDraftsSnapshot,
  getDraft,
  resetEntityDraftsForTests,
  saveDraft,
  setEntityDrafts,
  subscribeEntityDrafts,
  syncFetchedMarkdown,
  updateDraft
} from "./entity-drafts.js";

describe("entity drafts", () => {
  beforeEach(() => {
    resetEntityDraftsForTests();
  });

  it("preserves dirty drafts across prop-level entity switches and refetches", () => {
    let drafts = syncFetchedMarkdown({}, "project-a/entity-a", "saved a", "hash-a");
    drafts = updateDraft(drafts, "project-a/entity-a", "dirty a");
    drafts = syncFetchedMarkdown(drafts, "project-a/entity-a", "refetched a", "hash-refetched");
    drafts = syncFetchedMarkdown(drafts, "project-a/entity-b", "saved b", "hash-b");

    expect(getDraft(drafts, "project-a/entity-b")).toEqual({
      markdown: "saved b",
      savedMarkdown: "saved b",
      baseContentHash: "hash-b"
    });
    expect(getDraft(drafts, "project-a/entity-a")).toEqual({
      markdown: "dirty a",
      savedMarkdown: "saved a",
      baseContentHash: "hash-a"
    });
  });

  it("replaces a draft after successful save", () => {
    let drafts = syncFetchedMarkdown({}, "project-a/entity-a", "saved a", "hash-a");
    drafts = updateDraft(drafts, "project-a/entity-a", "dirty a");
    drafts = saveDraft(drafts, "project-a/entity-a", "saved after save", "hash-after-save");

    expect(getDraft(drafts, "project-a/entity-a")).toEqual({
      markdown: "saved after save",
      savedMarkdown: "saved after save",
      baseContentHash: "hash-after-save"
    });
  });

  it("updates clean drafts when fetched markdown changes", () => {
    let drafts = syncFetchedMarkdown({}, "project-a/entity-a", "saved a", "hash-a");
    drafts = syncFetchedMarkdown(drafts, "project-a/entity-a", "refetched a", "hash-refetched");

    expect(getDraft(drafts, "project-a/entity-a")).toEqual({
      markdown: "refetched a",
      savedMarkdown: "refetched a",
      baseContentHash: "hash-refetched"
    });
  });

  it("keeps module-level drafts after subscribers unmount", () => {
    const unsubscribe = subscribeEntityDrafts(() => undefined);
    setEntityDrafts((drafts) =>
      syncFetchedMarkdown(drafts, "project-a/entity-a", "saved a", "hash-a")
    );
    unsubscribe();
    setEntityDrafts((drafts) => updateDraft(drafts, "project-a/entity-a", "dirty a"));

    expect(getEntityDraftsSnapshot()["project-a/entity-a"]).toEqual({
      markdown: "dirty a",
      savedMarkdown: "saved a",
      baseContentHash: "hash-a"
    });
  });
});
