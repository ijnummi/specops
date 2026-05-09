export type ValidationLevel = "error" | "warning" | "info";

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoPath: string;
  specopsPath: string;
  createdAt: string;
  updatedAt: string;
};

export type SpecEntity = {
  id: string;
  projectId: string;
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

export type SpecLink = {
  id: string;
  projectId: string;
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
  confidence: number | null;
  createdAt: string;
};

export type IndexRun = {
  id: string;
  projectId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  entityCount: number;
  linkCount: number;
  errorCount: number;
  warningCount: number;
  gitCommit: string | null;
};

export type ValidationMessage = {
  id: string;
  projectId: string;
  indexRunId: string | null;
  filePath: string | null;
  entityId: string | null;
  level: ValidationLevel;
  code: string;
  message: string;
  createdAt: string;
};
