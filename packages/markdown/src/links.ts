import type { ParsedSpecLink, ParseMessage } from "./types.js";
import { createParseMessage } from "./validate.js";

type ExtractedLinks = {
  links: ParsedSpecLink[];
  messages: ParseMessage[];
};

export function extractFrontmatterLinks(
  frontmatter: Record<string, unknown>,
  fromEntityId: string,
  filePath: string
): ExtractedLinks {
  const linksValue = frontmatter.links;

  if (linksValue === undefined || linksValue === null) {
    return { links: [], messages: [] };
  }

  if (!isRecord(linksValue)) {
    return {
      links: [],
      messages: [
        createParseMessage({
          level: "warning",
          code: "invalid_links",
          message: "frontmatter.links must be an object of link arrays.",
          filePath,
          entityId: fromEntityId
        })
      ]
    };
  }

  const links: ParsedSpecLink[] = [];
  const messages: ParseMessage[] = [];

  for (const [linkType, groupValue] of Object.entries(linksValue)) {
    const source = `frontmatter:links.${linkType}`;

    if (!Array.isArray(groupValue)) {
      messages.push(
        createParseMessage({
          level: "warning",
          code: "invalid_link_group",
          message: `${source} must be an array of entity ids.`,
          filePath,
          entityId: fromEntityId
        })
      );
      continue;
    }

    for (const linkValue of groupValue) {
      if (typeof linkValue !== "string" || linkValue.trim().length === 0) {
        messages.push(
          createParseMessage({
            level: "warning",
            code: "invalid_link_value",
            message: `${source} contains a non-string or empty entity id.`,
            filePath,
            entityId: fromEntityId
          })
        );
        continue;
      }

      links.push({
        fromEntityId,
        toEntityId: linkValue.trim(),
        linkType,
        source
      });
    }
  }

  return { links, messages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
