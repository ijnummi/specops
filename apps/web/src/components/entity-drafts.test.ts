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

  it("updates clean drafts when fetched markdown changes", () => {
    let drafts = syncFetchedMarkdown({}, "project-a/entity-a", "saved a");
    drafts = syncFetchedMarkdown(drafts, "project-a/entity-a", "refetched a");

    expect(getDraft(drafts, "project-a/entity-a")).toEqual({
      markdown: "refetched a",
      savedMarkdown: "refetched a"
    });
  });

  it("keeps module-level drafts after subscribers unmount", () => {
    const unsubscribe = subscribeEntityDrafts(() => undefined);
    setEntityDrafts((drafts) =>
      syncFetchedMarkdown(drafts, "project-a/entity-a", "saved a")
    );
    unsubscribe();
    setEntityDrafts((drafts) => updateDraft(drafts, "project-a/entity-a", "dirty a"));

    expect(getEntityDraftsSnapshot()["project-a/entity-a"]).toEqual({
      markdown: "dirty a",
      savedMarkdown: "saved a"
    });
  });
});
