export type SourceSpecAnnotationInput = {
  entityId: string;
  symbolName: string;
  symbolLine: number | null;
};

export type ApplySourceSpecAnnotationsInput = {
  content: string;
  annotations: SourceSpecAnnotationInput[];
};

export type ApplySourceSpecAnnotationsResult = {
  content: string;
  changed: boolean;
};

type LeadingJsdoc = {
  start: number;
  end: number;
};

const specopsTagPattern = /@specops\s+([A-Za-z0-9_.-]+)/g;

export function applySourceSpecAnnotations(
  input: ApplySourceSpecAnnotationsInput
): ApplySourceSpecAnnotationsResult {
  const lineEnding = detectLineEnding(input.content);
  const lines = input.content.split(lineEnding);
  let changed = false;

  const annotations = input.annotations
    .filter((annotation): annotation is SourceSpecAnnotationInput & { symbolLine: number } =>
      annotation.symbolLine !== null
    )
    .sort((a, b) => b.symbolLine - a.symbolLine);
  assertUniqueAnnotationLines(annotations);

  for (const annotation of annotations) {
    if (annotation.symbolLine < 1 || annotation.symbolLine > lines.length) {
      throw new Error(
        `Cannot annotate ${annotation.symbolName}: symbol line ${annotation.symbolLine} is outside source content`
      );
    }

    const declarationIndex = annotation.symbolLine - 1;
    const leadingJsdoc = findLeadingJsdoc(lines, declarationIndex);

    if (!leadingJsdoc) {
      lines.splice(
        declarationIndex,
        0,
        "/**",
        ` * @specops ${annotation.entityId}`,
        " */"
      );
      changed = true;
      continue;
    }

    const specopsTags = extractSpecopsTags(lines.slice(leadingJsdoc.start, leadingJsdoc.end + 1));
    if (specopsTags.includes(annotation.entityId)) {
      continue;
    }

    if (specopsTags.length > 0) {
      throw new Error(
        `${annotation.symbolName} already has a different @specops annotation`
      );
    }

    insertSpecopsTag(lines, leadingJsdoc, annotation.entityId);
    changed = true;
  }

  return {
    content: lines.join(lineEnding),
    changed
  };
}

function findLeadingJsdoc(lines: string[], declarationIndex: number): LeadingJsdoc | null {
  const candidateEnd = declarationIndex - 1;
  if (candidateEnd < 0 || !lines[candidateEnd]?.includes("*/")) {
    return null;
  }

  for (let index = candidateEnd; index >= 0; index -= 1) {
    const line = lines[index] ?? "";

    if (/^\s*\/\*/.test(line)) {
      if (/^\s*\/\*\*/.test(line)) {
        return { start: index, end: candidateEnd };
      }

      return null;
    }
  }

  return null;
}

function assertUniqueAnnotationLines(
  annotations: Array<SourceSpecAnnotationInput & { symbolLine: number }>
) {
  const seenLines = new Set<number>();

  for (const annotation of annotations) {
    if (seenLines.has(annotation.symbolLine)) {
      throw new Error(`Multiple source annotations target line ${annotation.symbolLine}`);
    }

    seenLines.add(annotation.symbolLine);
  }
}

function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function extractSpecopsTags(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const tags: string[] = [];

    for (const match of line.matchAll(specopsTagPattern)) {
      tags.push(match[1] ?? "");
    }

    return tags;
  });
}

function insertSpecopsTag(lines: string[], jsdoc: LeadingJsdoc, entityId: string) {
  const openingLine = lines[jsdoc.start] ?? "";
  const blockIndent = openingLine.match(/^\s*/)?.[0] ?? "";
  const tagLine = `${blockIndent} * @specops ${entityId}`;

  if (jsdoc.start === jsdoc.end) {
    lines.splice(jsdoc.start, 1, ...expandSingleLineJsdoc(openingLine, blockIndent, tagLine));
    return;
  }

  lines.splice(jsdoc.end, 0, tagLine);
}

function expandSingleLineJsdoc(line: string, blockIndent: string, tagLine: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("/**") && trimmed.endsWith("*/")
    ? trimmed.slice(3, -2).trim()
    : "";
  const expanded = [`${blockIndent}/**`];

  if (inner.length > 0) {
    expanded.push(`${blockIndent} * ${inner.replace(/^\*\s?/, "")}`);
  }

  expanded.push(tagLine, `${blockIndent} */`);
  return expanded;
}
