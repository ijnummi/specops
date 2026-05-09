import { isMap, parseDocument, type Scalar, type YAMLMap } from "yaml";

export type EntityMarkdownIdentityResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

export function validateEntityMarkdownIdentity(
  markdown: string,
  expectedEntityId: string
): EntityMarkdownIdentityResult {
  const frontmatter = extractFrontmatter(markdown);

  if (!frontmatter.ok) {
    return { ok: false, message: frontmatter.message };
  }

  const document = parseDocument(frontmatter.value, { uniqueKeys: true });
  if (document.errors.length > 0) {
    const hasDuplicateKey = document.errors.some((error) => /duplicate|unique/i.test(error.message));
    return {
      ok: false,
      message: hasDuplicateKey
        ? "Frontmatter contains duplicate keys."
        : "Frontmatter YAML is malformed."
    };
  }

  if (!document.contents || !isMap(document.contents)) {
    return { ok: false, message: "Frontmatter must be a mapping." };
  }

  const id = readStringKey(document.contents, "id");
  if (id === undefined) {
    return { ok: false, message: "Frontmatter must include an id." };
  }

  if (id === null) {
    return { ok: false, message: "Frontmatter id must be a string." };
  }

  if (id !== expectedEntityId) {
    return {
      ok: false,
      message: `Entity id cannot be changed from ${expectedEntityId} to ${id}.`
    };
  }

  return { ok: true, id };
}

function extractFrontmatter(markdown: string): { ok: true; value: string } | { ok: false; message: string } {
  const normalized = markdown.replace(/^\uFEFF/, "");

  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { ok: false, message: "Markdown must start with frontmatter." };
  }

  const newline = normalized.startsWith("---\r\n") ? "\r\n" : "\n";
  const closingMarker = `${newline}---`;
  const closingIndex = normalized.indexOf(closingMarker, 4);

  if (closingIndex === -1) {
    return { ok: false, message: "Frontmatter closing marker is missing." };
  }

  return { ok: true, value: normalized.slice(4, closingIndex) };
}

function readStringKey(map: YAMLMap, key: string): string | null | undefined {
  const pair = map.items.find((item) => {
    const itemKey = item.key as Scalar | null;
    return itemKey?.value === key;
  });

  if (!pair) {
    return undefined;
  }

  const value = (pair.value as Scalar | null)?.value;
  return typeof value === "string" ? value : null;
}
