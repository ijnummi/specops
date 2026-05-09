export type DecisionStatus = "proposed" | "accepted" | "superseded" | "archived";

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  decisionPath: string;
};

export type DecisionLink = {
  fromDecisionId: string;
  toDecisionId: string;
  linkType: "depends_on" | "supersedes" | "related";
  source: "frontmatter" | "author";
};

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

export type ReviewReminder = {
  id: string;
  decisionId: string;
  dueAt: string;
  reason: string;
  status: "open" | "done" | "dismissed";
};

export const activeDecisionStatuses: DecisionStatus[] = ["proposed", "accepted"];
