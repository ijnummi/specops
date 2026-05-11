import { stringify } from "yaml";
import type { ScanRepositoryResult, SourceFileFact, SourceSymbolFact } from "@specops/repo-scanner";

export type BootstrapSourceEvidence = {
  sourceFile: string;
  symbolName: string;
  symbolKind: string;
  exported: boolean;
  line: number | null;
};

export type BootstrapGeneratedSpecFile = {
  entityId: string;
  type: "domain_entity" | "interface";
  title: string;
  path: string;
  content: string;
  evidence: BootstrapSourceEvidence[];
};

export type BootstrapSpecProposal = {
  proposalType: "source_spec_entity";
  title: string;
  confidence: number;
  payload: {
    entityId: string;
    type: "domain_entity" | "interface";
    title: string;
    status: "draft";
    filePath: string;
    generatedMarkdown: string;
    markdown: string;
    sourceFiles: string[];
    symbols: {
      name: string;
      kind: string;
      exported: boolean;
      file: string;
      line: number | null;
    }[];
  };
  evidence: {
    scanner: "typescript";
    sourceFiles: {
      file: string;
      symbolName: string;
      symbolKind: string;
      exported: boolean;
      line: number | null;
    }[];
  };
};

type Candidate = {
  entityId: string;
  type: "domain_entity" | "interface";
  title: string;
  path: string;
  evidence: BootstrapSourceEvidence[];
};

const interfaceSuffixes = [
  "Service",
  "Scheduler",
  "Client",
  "Repository",
  "Controller",
  "Router",
  "Handler"
];

const domainSymbolKinds = new Set(["interface", "type_alias", "class", "enum"]);

export function generateBootstrapSpecFiles(
  scan: ScanRepositoryResult
): BootstrapGeneratedSpecFile[] {
  const candidates = new Map<string, Candidate>();

  for (const sourceFile of scan.files) {
    if (sourceFile.kind === "test" || sourceFile.kind === "config") continue;

    for (const symbol of sourceFile.symbols) {
      if (!isEligibleSymbol(sourceFile, symbol)) continue;

      const type = classifySymbol(symbol.name);
      const slug = slugifySourceSymbol(symbol.name);
      const entityId = type === "interface" ? `interface.${slug}` : `domain.${slug}`;
      const candidatePath = type === "interface" ? `interfaces/${slug}.md` : `domain/${slug}.md`;
      const evidence: BootstrapSourceEvidence = {
        sourceFile: sourceFile.path,
        symbolName: symbol.name,
        symbolKind: symbol.symbolKind,
        exported: symbol.isExported,
        line: symbol.line
      };
      const existing = candidates.get(entityId);

      if (existing) {
        existing.evidence.push(evidence);
        continue;
      }

      candidates.set(entityId, {
        entityId,
        type,
        title: symbol.name,
        path: candidatePath,
        evidence: [evidence]
      });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((candidate) => {
      const evidence = [...candidate.evidence].sort(compareEvidence);

      return {
        entityId: candidate.entityId,
        type: candidate.type,
        title: candidate.title,
        path: candidate.path,
        evidence,
        content: renderMarkdown({ ...candidate, evidence })
      };
    });
}

export function generateBootstrapSpecProposals(scan: ScanRepositoryResult): BootstrapSpecProposal[] {
  return generateBootstrapSpecFiles(scan).map((file) => ({
    proposalType: "source_spec_entity",
    title: file.title,
    confidence: 0.7,
    payload: {
      entityId: file.entityId,
      type: file.type,
      title: file.title,
      status: "draft",
      filePath: file.path,
      generatedMarkdown: file.content,
      markdown: file.content,
      sourceFiles: [...new Set(file.evidence.map((item) => item.sourceFile))],
      symbols: file.evidence.map((item) => ({
        name: item.symbolName,
        kind: item.symbolKind,
        exported: item.exported,
        file: item.sourceFile,
        line: item.line
      }))
    },
    evidence: {
      scanner: "typescript",
      sourceFiles: file.evidence.map((item) => ({
        file: item.sourceFile,
        symbolName: item.symbolName,
        symbolKind: item.symbolKind,
        exported: item.exported,
        line: item.line
      }))
    }
  }));
}

export function slugifySourceSymbol(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function isEligibleSymbol(sourceFile: SourceFileFact, symbol: SourceSymbolFact): boolean {
  if (!symbol.isExported) return false;
  if (!symbol.name || symbol.name === "default") return false;
  if (!domainSymbolKinds.has(symbol.symbolKind) && !isInterfaceLikeName(symbol.name)) return false;

  if (
    sourceFile.exports.length > 0 &&
    sourceFile.exports.every(
      (sourceExport) =>
        sourceExport.exportKind === "default" || sourceExport.exportedName === "default"
    )
  ) {
    return false;
  }

  return true;
}

function classifySymbol(name: string): "domain_entity" | "interface" {
  return isInterfaceLikeName(name) ? "interface" : "domain_entity";
}

function isInterfaceLikeName(name: string): boolean {
  return interfaceSuffixes.some((suffix) => name.endsWith(suffix));
}

function renderMarkdown(candidate: Candidate): string {
  const frontmatter = stringify(
    {
      id: candidate.entityId,
      type: candidate.type,
      title: candidate.title,
      status: "draft",
      links: {},
      source_bootstrap: {
        source_files: [...new Set(candidate.evidence.map((item) => item.sourceFile))],
        symbols: candidate.evidence.map((item) => ({
          name: item.symbolName,
          kind: item.symbolKind,
          exported: item.exported,
          file: item.sourceFile,
          line: item.line
        }))
      }
    },
    { lineWidth: 0 }
  ).trimEnd();
  const sectionHeading = candidate.type === "interface" ? "Responsibility" : "Definition";
  const evidenceLines = candidate.evidence
    .map(
      (item) =>
        `- \`${item.sourceFile}\` exports \`${item.symbolName}\` as ${article(item.symbolKind)} ${humanizeKind(item.symbolKind)}.`
    )
    .join("\n");

  return `---
${frontmatter}
---

# ${candidate.title}

## ${sectionHeading}

Initial spec generated from exported source symbol \`${candidate.title}\`.

## Source Evidence

${evidenceLines}

## Notes

- Review and expand this spec before using it as implementation guidance.
`;
}

function compareEvidence(a: BootstrapSourceEvidence, b: BootstrapSourceEvidence): number {
  return a.sourceFile.localeCompare(b.sourceFile) || a.symbolName.localeCompare(b.symbolName);
}

function humanizeKind(value: string): string {
  return value.replace(/_/g, " ");
}

function article(value: string): "a" | "an" {
  return /^[aeiou]/i.test(humanizeKind(value)) ? "an" : "a";
}
