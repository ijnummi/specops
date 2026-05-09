export function defaultTargetAgent(): string {
  return "codex";
}

export function suggestedTaskIdForSource(sourceEntityId: string): string {
  return `task.${sourceEntityId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")}`;
}

export function taskPreviewHasChanges(
  originalMarkdown: string,
  currentMarkdown: string
): boolean {
  return originalMarkdown !== currentMarkdown;
}
