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

  const syntaxError = findMalformedFrontmatterLine(frontmatter.value);
  if (syntaxError) {
    return { ok: false, message: syntaxError };
  }

  const id = readScalar(frontmatter.value, "id");
  if (!id) {
    return { ok: false, message: "Frontmatter must include an id." };
  }

  if (id !== expectedEntityId) {
    return {
      ok: false,
      message: `Entity id cannot be changed from ${expectedEntityId} to ${id}.`
    };
  }

  return { ok: true, id };
}

function findMalformedFrontmatterLine(frontmatter: string): string | null {
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---") {
      continue;
    }

    if (!trimmed.includes(":")) {
      return `Malformed frontmatter near: ${trimmed}`;
    }
  }

  return null;
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

function readScalar(frontmatter: string, key: string): string | null {
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    if (name !== key) {
      continue;
    }

    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!value || value.startsWith("[") || value.startsWith("{")) {
      return null;
    }

    return unquote(value);
  }

  return null;
}

function unquote(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
