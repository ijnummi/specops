export type MarkdownSection = {
  title: string;
  content: string;
};

export function extractMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
      }

      currentTitle = heading[1].trim();
      currentLines = [];
      continue;
    }

    if (currentTitle) {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
  }

  return sections;
}

export function findSection(markdown: string, names: string[]): string | null {
  const normalizedNames = new Set(names.map(normalizeSectionName));
  const section = extractMarkdownSections(markdown).find((candidate) =>
    normalizedNames.has(normalizeSectionName(candidate.title))
  );

  return section?.content ? section.content : null;
}

export function firstNonEmptySection(markdown: string, names: string[]): string | null {
  return findSection(markdown, names);
}

function normalizeSectionName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}
