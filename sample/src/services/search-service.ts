import type { Decision } from "../domain";

/**
 * @specops domain.decision-search-result
 */
export type DecisionSearchResult = {
  id: string;
  title: string;
  excerpt: string;
};

export function indexDecisionText(decision: Decision): string {
  return [
    decision.title,
    decision.contextMarkdown,
    decision.decisionMarkdown,
    decision.consequencesMarkdown,
  ].join("\n");
}

export function searchDecisions(decisions: Decision[], query: string): DecisionSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return decisions
    .filter((decision) => indexDecisionText(decision).toLowerCase().includes(normalizedQuery))
    .map((decision) => ({
      id: decision.id,
      title: decision.title,
      excerpt: decision.contextMarkdown.slice(0, 120),
    }));
}
