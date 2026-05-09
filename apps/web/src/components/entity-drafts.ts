import { useSyncExternalStore } from "react";

export type EntityDraft = {
  markdown: string;
  savedMarkdown: string;
  baseContentHash: string;
};

export type EntityDrafts = Record<string, EntityDraft>;

let entityDrafts: EntityDrafts = {};
const listeners = new Set<() => void>();

export function entityDraftKey(projectId: string, entityId: string) {
  return `${projectId}/${entityId}`;
}

export function useEntityDrafts(): EntityDrafts {
  return useSyncExternalStore(
    subscribeEntityDrafts,
    getEntityDraftsSnapshot,
    getEntityDraftsSnapshot
  );
}

export function getEntityDraftsSnapshot(): EntityDrafts {
  return entityDrafts;
}

export function subscribeEntityDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setEntityDrafts(updater: (drafts: EntityDrafts) => EntityDrafts) {
  const nextDrafts = updater(entityDrafts);
  if (nextDrafts === entityDrafts) {
    return;
  }

  entityDrafts = nextDrafts;
  for (const listener of listeners) {
    listener();
  }
}

export function resetEntityDraftsForTests() {
  entityDrafts = {};
  for (const listener of listeners) {
    listener();
  }
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
  fetchedMarkdown: string,
  contentHash: string
): EntityDrafts {
  const current = drafts[key];
  if (isDraftDirty(current ?? null)) {
    return drafts;
  }

  if (
    current?.markdown === fetchedMarkdown &&
    current.savedMarkdown === fetchedMarkdown &&
    current.baseContentHash === contentHash
  ) {
    return drafts;
  }

  return {
    ...drafts,
    [key]: {
      markdown: fetchedMarkdown,
      savedMarkdown: fetchedMarkdown,
      baseContentHash: contentHash
    }
  };
}

export function updateDraft(drafts: EntityDrafts, key: string, markdown: string): EntityDrafts {
  const current = drafts[key] ?? { markdown: "", savedMarkdown: "", baseContentHash: "" };

  return {
    ...drafts,
    [key]: {
      ...current,
      markdown
    }
  };
}

export function saveDraft(
  drafts: EntityDrafts,
  key: string,
  savedMarkdown: string,
  contentHash: string
): EntityDrafts {
  return {
    ...drafts,
    [key]: {
      markdown: savedMarkdown,
      savedMarkdown,
      baseContentHash: contentHash
    }
  };
}
