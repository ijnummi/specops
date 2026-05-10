import type { Decision, DecisionLink, DecisionStatus, Workspace } from "../domain";

/**
 * @specops domain.create-decision-input
 */
export type CreateDecisionInput = {
  title: string;
  contextMarkdown: string;
  decisionMarkdown: string;
  consequencesMarkdown?: string;
  status?: DecisionStatus;
};

/**
 * @specops interface.decision-service
 */
export class DecisionService {
  private readonly decisions = new Map<string, Decision>();

  constructor(private readonly workspace: Workspace) {}

  createDecision(input: CreateDecisionInput): Decision {
    const decision: Decision = {
      id: toDecisionId(input.title),
      workspaceId: this.workspace.id,
      title: input.title,
      status: input.status ?? "proposed",
      contextMarkdown: input.contextMarkdown,
      decisionMarkdown: input.decisionMarkdown,
      consequencesMarkdown: input.consequencesMarkdown ?? "",
      links: [],
      updatedAt: new Date().toISOString(),
    };

    this.decisions.set(decision.id, decision);
    return decision;
  }

  listDecisions(): Decision[] {
    return [...this.decisions.values()].sort((left, right) => left.title.localeCompare(right.title));
  }

  linkDecision(sourceId: string, targetId: string, linkType: DecisionLink["linkType"]): DecisionLink {
    const source = this.requireDecision(sourceId);
    this.requireDecision(targetId);

    const link: DecisionLink = {
      fromDecisionId: sourceId,
      toDecisionId: targetId,
      linkType,
      source: "author",
    };

    source.links = [...source.links, link];
    return link;
  }

  private requireDecision(decisionId: string): Decision {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Unknown decision: ${decisionId}`);
    }
    return decision;
  }
}

export function toDecisionId(title: string): string {
  return `decision.${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
