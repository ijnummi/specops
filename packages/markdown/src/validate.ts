import type { ParseMessage } from "./types.js";

export function createParseMessage(input: ParseMessage): ParseMessage {
  return input;
}

export function readRequiredString(
  frontmatter: Record<string, unknown>,
  field: "id" | "type" | "title" | "status",
  filePath: string,
  entityId: string | null
): { value: string | null; message: ParseMessage | null } {
  const value = frontmatter[field];

  if (typeof value === "string" && value.trim().length > 0) {
    return { value: value.trim(), message: null };
  }

  return {
    value: null,
    message: createParseMessage({
      level: "error",
      code: "missing_required_field",
      message: `Missing required frontmatter field: ${field}`,
      filePath,
      entityId
    })
  };
}
