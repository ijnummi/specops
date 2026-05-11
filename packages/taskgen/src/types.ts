export type TaskgenEntity = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
  contentHash?: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
};

export type TaskgenLink = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type AgentTaskGenerationWarning = {
  code: string;
  message: string;
  entityId?: string | null;
};

export type GenerateAgentTaskInput = {
  source: TaskgenEntity;
  context: TaskgenEntity[];
  links: TaskgenLink[];
  targetAgent: string;
  taskId?: string;
  title?: string;
  validationCommands: string[];
};

export type GenerateAgentTaskResult = {
  markdown: string;
  taskId: string;
  title: string;
  filePath: string;
  sourceSpecIds: string[];
  contextSpecIds: string[];
  warnings: AgentTaskGenerationWarning[];
};
