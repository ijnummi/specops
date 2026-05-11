import { z } from "zod";

import type {
  AiPrefillCandidate,
  AiPrefillEntityType,
  NormalizeProviderResponseInput,
  NormalizeProviderResponseResult
} from "./types.js";

const proposalSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(["use_case", "domain_entity", "interface"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)).nonempty(),
  claims: z
    .array(
      z.object({
        text: z.string().min(1),
        sourceFiles: z.array(z.string().min(1)).nonempty()
      })
    )
    .nonempty(),
  proposedLinks: z
    .array(
      z.object({
        linkType: z.string().min(1),
        targetEntityId: z.string().min(1),
        targetExists: z.boolean().optional(),
        rationale: z.string().min(1)
      })
    )
    .default([]),
  confidence: z.number().min(0).max(1).nullable().default(null)
});

const entityIdPatternByType: Record<AiPrefillEntityType, RegExp> = {
  use_case: /^uc\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
  domain_entity: /^domain\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
  interface: /^interface\.[a-z0-9]+(?:-[a-z0-9]+)*$/
};

export function normalizeProviderResponse(
  input: NormalizeProviderResponseInput
): NormalizeProviderResponseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }

  const topLevel = z.object({ proposals: z.array(z.unknown()) }).safeParse(parsed);
  if (!topLevel.success) {
    return {
      candidates: [],
      diagnostics: [{ level: "warning", message: "Rejected provider response: invalid shape" }]
    };
  }

  const selectedSourceFiles = new Set(input.selectedSourceFiles);
  const candidates: AiPrefillCandidate[] = [];
  const diagnostics: NormalizeProviderResponseResult["diagnostics"] = [];

  topLevel.data.proposals.forEach((proposal, index) => {
    const proposalNumber = index + 1;
    const candidate = proposalSchema.safeParse(proposal);
    if (!candidate.success) {
      diagnostics.push({
        level: "warning",
        message: `Rejected proposal ${proposalNumber}: invalid shape`
      });
      return;
    }

    if (!entityIdPatternByType[candidate.data.type].test(candidate.data.entityId)) {
      diagnostics.push({
        level: "warning",
        message: `Rejected proposal ${proposalNumber}: invalid entity id`
      });
      return;
    }

    const sourceFiles = filterSelected(candidate.data.sourceFiles, selectedSourceFiles);
    const claims = candidate.data.claims
      .map((claim) => ({
        text: claim.text,
        sourceFiles: filterSelected(claim.sourceFiles, selectedSourceFiles)
      }))
      .filter((claim) => claim.sourceFiles.length > 0);

    if (sourceFiles.length === 0 || claims.length === 0) {
      diagnostics.push({
        level: "warning",
        message: `Rejected proposal ${proposalNumber}: no selected source evidence`
      });
      return;
    }

    candidates.push({
      ...candidate.data,
      sourceFiles,
      claims,
      proposedLinks: candidate.data.proposedLinks.map((link) => ({
        linkType: link.linkType,
        targetEntityId: link.targetEntityId,
        targetExists: input.existingEntityIds.has(link.targetEntityId),
        rationale: link.rationale
      }))
    });
  });

  return { candidates, diagnostics };
}

function filterSelected(values: string[], selected: Set<string>): string[] {
  return Array.from(new Set(values.filter((value) => selected.has(value)))).sort();
}
