import { stringify } from "yaml";

import type {
  AiPrefillCandidate,
  AiPrefillEntityType,
  RenderAiSpecEntityProposalInput,
  RenderedAiSpecEntityProposal
} from "./types.js";

const directoryByType: Record<AiPrefillEntityType, string> = {
  use_case: "use-cases",
  domain_entity: "domain",
  interface: "interfaces"
};

export function renderAiSpecEntityProposal(
  input: RenderAiSpecEntityProposalInput
): RenderedAiSpecEntityProposal {
  const { candidate } = input;
  const filePath = `${directoryByType[candidate.type]}/${candidate.entityId}.md`;
  const proposedLinks = sortLinks(candidate.proposedLinks);
  const sourceFiles = [...candidate.sourceFiles].sort();
  const claims = candidate.claims.map((claim) => ({
    text: claim.text,
    sourceFiles: [...claim.sourceFiles].sort()
  }));
  const generatedMarkdown = renderMarkdown({
    candidate: { ...candidate, sourceFiles, claims, proposedLinks },
    linkFrontmatter: groupLinks(proposedLinks)
  });

  return {
    proposalType: "ai_spec_entity",
    title: candidate.title,
    confidence: candidate.confidence,
    payload: {
      entityId: candidate.entityId,
      type: candidate.type,
      title: candidate.title,
      status: "draft",
      filePath,
      generatedMarkdown,
      markdown: generatedMarkdown,
      sourceFiles,
      proposedLinks
    },
    evidence: {
      provider: input.provider,
      model: input.model,
      promptVersion: input.packet.promptVersion,
      selectedSourceFiles: input.packet.selectedSourceFiles,
      claims,
      warnings: input.warnings ?? []
    }
  };
}

function renderMarkdown(input: {
  candidate: AiPrefillCandidate;
  linkFrontmatter: Record<string, string[]>;
}): string {
  const frontmatter = stringify({
    id: input.candidate.entityId,
    type: input.candidate.type,
    title: input.candidate.title,
    status: "draft",
    links: input.linkFrontmatter,
    source_files: input.candidate.sourceFiles
  });

  const sourceEvidence = input.candidate.claims.map(
    (claim) => `- ${claim.text} (${claim.sourceFiles.join(", ")})`
  );
  const proposedLinks =
    input.candidate.proposedLinks.length === 0
      ? ["- None"]
      : input.candidate.proposedLinks.map(
          (link) => `- ${link.linkType} -> ${link.targetEntityId}: ${link.rationale}`
        );

  return [
    "---",
    frontmatter.trimEnd(),
    "---",
    "",
    `# ${input.candidate.title}`,
    "",
    input.candidate.summary,
    "",
    "## Source Evidence",
    "",
    ...sourceEvidence,
    "",
    "## Proposed Links",
    "",
    ...proposedLinks,
    ""
  ].join("\n");
}

function groupLinks(
  proposedLinks: AiPrefillCandidate["proposedLinks"]
): Record<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const link of proposedLinks) {
    const targets = grouped.get(link.linkType) ?? new Set<string>();
    targets.add(link.targetEntityId);
    grouped.set(link.linkType, targets);
  }

  return Object.fromEntries(
    Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([linkType, targets]) => [linkType, Array.from(targets).sort()])
  );
}

function sortLinks(
  links: AiPrefillCandidate["proposedLinks"]
): AiPrefillCandidate["proposedLinks"] {
  return [...links].sort((left, right) => {
    const byType = left.linkType.localeCompare(right.linkType);
    if (byType !== 0) {
      return byType;
    }
    return left.targetEntityId.localeCompare(right.targetEntityId);
  });
}
