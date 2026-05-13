import { stringify } from "yaml";

type RelationshipType = "implements" | "uses" | "defines" | "tests" | "references";

type RenderEvidence = {
  sourceFilePath: string;
  symbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  relationshipType?: RelationshipType;
};

type RenderClaim = {
  id?: string;
  text: string;
  kind: "fact" | "hypothesis";
  evidence: RenderEvidence[];
};

type RenderLink = {
  linkType: string;
  targetEntityId: string;
  rationale: string;
};

type RenderAssemblyInput = {
  entityId: string;
  entityType: "domain_entity" | "interface" | "use_case";
  title: string;
  summary: string;
  claims: RenderClaim[];
  proposedLinks: RenderLink[];
};

export function renderAnalyzeReviewAssemblyMarkdown(input: RenderAssemblyInput): string {
  const facts = input.claims.filter((claim) => claim.kind === "fact");
  const hypotheses = input.claims.filter((claim) => claim.kind === "hypothesis");
  const evidenceReferences = createEvidenceReferences(input.claims);
  const frontmatter = stringify(
    {
      id: input.entityId,
      type: input.entityType,
      title: input.title,
      status: "draft"
    },
    { lineWidth: 0 }
  ).trimEnd();
  const lines = [
    "---",
    frontmatter,
    "---",
    "",
    `# ${input.title}`,
    "",
    input.summary.trim(),
    "",
    "## Reviewed Facts",
    "",
    ...renderClaims(facts, evidenceReferences),
    "## Hypotheses and Unknowns",
    "",
    ...renderClaims(hypotheses, evidenceReferences),
    "",
    ...renderFootnotes(evidenceReferences),
    "## Source Links",
    "",
    ...renderSourceLinks(evidenceReferences),
    "## Proposed Links",
    "",
    ...renderLinks(input.proposedLinks)
  ];

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderClaims(
  claims: RenderClaim[],
  evidenceReferences: EvidenceReference[]
): string[] {
  if (claims.length === 0) {
    return ["- None recorded.", ""];
  }

  return claims.flatMap((claim) => {
    const footnotes = evidenceReferences
      .filter((reference) => reference.claim === claim)
      .map((reference) => `[^${reference.footnoteId}]`);
    const suffix = footnotes.length > 0 ? ` ${footnotes.join(" ")}` : "";
    return [`- ${claim.text}${suffix}`, ""];
  });
}

function renderFootnotes(evidenceReferences: EvidenceReference[]): string[] {
  if (evidenceReferences.length === 0) {
    return [];
  }

  return evidenceReferences.flatMap((reference) => [
    `[^${reference.footnoteId}]: ${reference.relationshipType} \`${reference.location}\`${renderSymbol(reference)}`,
    ""
  ]);
}

function renderSourceLinks(evidenceReferences: EvidenceReference[]): string[] {
  if (evidenceReferences.length === 0) {
    return ["- None recorded.", ""];
  }

  return RELATIONSHIP_ORDER.flatMap((relationshipType) => {
    const group = evidenceReferences.filter(
      (reference) => reference.relationshipType === relationshipType
    );
    if (group.length === 0) {
      return [];
    }

    return [
      `### ${RELATIONSHIP_LABELS[relationshipType]}`,
      "",
      ...group.flatMap((reference) => [
        `- \`${reference.location}\`${renderSymbol(reference)}`,
        ""
      ])
    ];
  });
}

function renderLinks(links: RenderLink[]): string[] {
  if (links.length === 0) {
    return ["- None proposed.", ""];
  }

  return links.flatMap((link) => [
    `- ${link.linkType}: ${link.targetEntityId}`,
    `  - ${link.rationale}`,
    ""
  ]);
}

type EvidenceReference = RenderEvidence & {
  claim: RenderClaim;
  footnoteId: string;
  location: string;
  relationshipType: RelationshipType;
};

const RELATIONSHIP_ORDER: RelationshipType[] = [
  "implements",
  "uses",
  "defines",
  "tests",
  "references"
];

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  implements: "Implements",
  uses: "Uses",
  defines: "Defines",
  tests: "Tests",
  references: "References"
};

function createEvidenceReferences(claims: RenderClaim[]): EvidenceReference[] {
  return claims.flatMap((claim, claimIndex) =>
    claim.evidence.map((evidence, evidenceIndex) => ({
      ...evidence,
      claim,
      footnoteId: `claim-${claimIndex + 1}-${evidenceIndex + 1}`,
      location: formatLocation(evidence),
      relationshipType: evidence.relationshipType ?? "references"
    }))
  );
}

function formatLocation(evidence: RenderEvidence): string {
  return evidence.startLine && evidence.endLine
    ? `${evidence.sourceFilePath}:${evidence.startLine}-${evidence.endLine}`
    : evidence.sourceFilePath;
}

function renderSymbol(evidence: Pick<RenderEvidence, "symbolName">): string {
  return evidence.symbolName ? ` (\`${evidence.symbolName}\`)` : "";
}
