import matter from "gray-matter";

import { extractFrontmatterLinks } from "./links.js";
import type { ParsedSpecEntity, ParseMessage, ParseResult } from "./types.js";
import { createParseMessage, readRequiredString } from "./validate.js";

export function parseSpecMarkdown(
  filePath: string,
  markdown: string
): ParseResult {
  let parsed: matter.GrayMatterFile<string>;

  try {
    parsed = matter(markdown);
  } catch (error) {
    return {
      filePath,
      entity: null,
      links: [],
      messages: [
        createParseMessage({
          level: "error",
          code: "malformed_frontmatter",
          message: `Malformed frontmatter: ${messageFromUnknown(error)}`,
          filePath,
          entityId: null
        })
      ]
    };
  }

  const frontmatter = normalizeFrontmatter(parsed.data);
  const possibleEntityId =
    typeof frontmatter.id === "string" && frontmatter.id.trim().length > 0
      ? frontmatter.id.trim()
      : null;
  const messages: ParseMessage[] = [];

  const id = readRequiredString(frontmatter, "id", filePath, possibleEntityId);
  const type = readRequiredString(frontmatter, "type", filePath, possibleEntityId);
  const title = readRequiredString(
    frontmatter,
    "title",
    filePath,
    possibleEntityId
  );
  const status = readRequiredString(
    frontmatter,
    "status",
    filePath,
    possibleEntityId
  );

  for (const result of [id, type, title, status]) {
    if (result.message) {
      messages.push(result.message);
    }
  }

  if (messages.some((message) => message.level === "error")) {
    return { filePath, entity: null, links: [], messages };
  }

  const entityId = id.value;
  if (entityId === null || type.value === null || title.value === null || status.value === null) {
    return { filePath, entity: null, links: [], messages };
  }

  const bodyMarkdown = parsed.content.replace(/^\r?\n/, "");
  const bodyText = toSearchText(bodyMarkdown);

  const entity: ParsedSpecEntity = {
    entityId,
    type: type.value,
    title: title.value,
    status: status.value,
    frontmatter,
    bodyMarkdown,
    bodyText,
    filePath
  };

  const extractedLinks = extractFrontmatterLinks(frontmatter, entityId, filePath);
  messages.push(...extractedLinks.messages);

  if (bodyText.length === 0) {
    messages.push(
      createParseMessage({
        level: "info",
        code: "empty_body",
        message: "Markdown body is empty.",
        filePath,
        entityId
      })
    );
  }

  return {
    filePath,
    entity,
    links: extractedLinks.links,
    messages
  };
}

function normalizeFrontmatter(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toSearchText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/[*_~>#|[\]()`{}-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
