/**
 * @specops domain.decision-status
 */
export type DecisionStatus = "proposed" | "accepted" | "superseded" | "archived";

/**
 * @specops domain.workspace
 */
export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  decisionPath: string;
};

/**
 * @specops domain.decision-link
 */
export type DecisionLink = {
  fromDecisionId: string;
  toDecisionId: string;
  linkType: "depends_on" | "supersedes" | "related";
  source: "frontmatter" | "author";
};

/**
 * @specops domain.decision
 */
export type Decision = {
  id: string;
  workspaceId: string;
  title: string;
  status: DecisionStatus;
  contextMarkdown: string;
  decisionMarkdown: string;
  consequencesMarkdown: string;
  links: DecisionLink[];
  reviewAfter?: string;
  updatedAt: string;
};

/**
 * @specops domain.review-reminder
 */
export type ReviewReminder = {
  id: string;
  decisionId: string;
  dueAt: string;
  reason: string;
  status: "open" | "done" | "dismissed";
};

export const activeDecisionStatuses: DecisionStatus[] = ["proposed", "accepted"];
