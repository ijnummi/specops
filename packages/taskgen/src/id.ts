export function defaultAgentTaskId(sourceEntityId: string): string {
  return `task.${slugifyTaskIdPart(sourceEntityId)}`;
}

export function defaultAgentTaskFilePath(taskId: string): string {
  return `agent-tasks/${safeTaskFileName(taskId)}.md`;
}

export function safeTaskFileName(taskId: string): string {
  return taskId
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function slugifyTaskIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
