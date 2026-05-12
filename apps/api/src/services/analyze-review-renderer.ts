type RenderEvidence = {
  sourceFilePath: string;
  symbolName: string | null;
  startLine: number | null;
  endLine: number | null;
};

type RenderClaim = {
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
  const lines = [
    "---",
    `id: ${input.entityId}`,
    `type: ${input.entityType}`,
    `title: ${input.title}`,
    "status: draft",
    "---",
    "",
    `# ${input.title}`,
    "",
    input.summary.trim(),
    "",
    "## Reviewed Facts",
    "",
    ...renderClaims(facts),
    "## Hypotheses and Unknowns",
    "",
    ...renderClaims(hypotheses),
    "## Source Evidence",
    "",
    ...renderEvidence(input.claims),
    "## Proposed Links",
    "",
    ...renderLinks(input.proposedLinks)
  ];

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderClaims(claims: RenderClaim[]): string[] {
  if (claims.length === 0) {
    return ["- None recorded.", ""];
  }

  return claims.flatMap((claim) => [`- ${claim.text}`, ""]);
}

function renderEvidence(claims: RenderClaim[]): string[] {
  const evidence = claims.flatMap((claim) =>
    claim.evidence.map((item) => ({ claim: claim.text, ...item }))
  );

  if (evidence.length === 0) {
    return ["- None recorded.", ""];
  }

  return evidence.flatMap((item) => {
    const location =
      item.startLine && item.endLine
        ? `${item.sourceFilePath}:${item.startLine}-${item.endLine}`
        : item.sourceFilePath;
    const symbol = item.symbolName ? ` (${item.symbolName})` : "";
    return [`- ${location}${symbol}: ${item.claim}`, ""];
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
