import type { SpecEntityDto } from "@specops/contracts";

export function entityMarkdownForEditing(
  entity: Pick<SpecEntityDto, "markdown" | "frontmatter" | "bodyMarkdown">
): string {
  return entity.markdown ?? entityToMarkdown(entity.frontmatter, entity.bodyMarkdown);
}

function entityToMarkdown(frontmatter: Record<string, unknown>, bodyMarkdown: string) {
  return `---\n${stringifyFrontmatter(frontmatter)}---\n\n${bodyMarkdown}`;
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>) {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
    .join("\n")
    .concat("\n");
}

function formatYamlValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value ?? {});
}
