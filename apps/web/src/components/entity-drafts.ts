export type EntityDraft = {
  markdown: string;
  savedMarkdown: string;
};

export type EntityDrafts = Record<string, EntityDraft>;

export function entityDraftKey(projectId: string, entityId: string) {
  return `${projectId}/${entityId}`;
}

export function getDraft(drafts: EntityDrafts, key: string): EntityDraft | null {
  return drafts[key] ?? null;
}

export function isDraftDirty(draft: EntityDraft | null): boolean {
  return draft !== null && draft.markdown !== draft.savedMarkdown;
}

export function syncFetchedMarkdown(
  drafts: EntityDrafts,
  key: string,
  fetchedMarkdown: string
): EntityDrafts {
  const current = drafts[key];
  if (current) {
    return drafts;
  }

  return {
    ...drafts,
    [key]: {
      markdown: fetchedMarkdown,
      savedMarkdown: fetchedMarkdown
    }
  };
}

export function updateDraft(drafts: EntityDrafts, key: string, markdown: string): EntityDrafts {
  const current = drafts[key] ?? { markdown: "", savedMarkdown: "" };

  return {
    ...drafts,
    [key]: {
      ...current,
      markdown
    }
  };
}

export function saveDraft(drafts: EntityDrafts, key: string, savedMarkdown: string): EntityDrafts {
  return {
    ...drafts,
    [key]: {
      markdown: savedMarkdown,
      savedMarkdown
    }
  };
}
