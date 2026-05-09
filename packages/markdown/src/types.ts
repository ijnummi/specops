export type ValidationMessageLevel = "error" | "warning" | "info";

export type ParsedSpecEntity = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
  filePath: string;
};

export type ParsedSpecLink = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type ParseMessage = {
  level: ValidationMessageLevel;
  code: string;
  message: string;
  filePath: string;
  entityId: string | null;
};

export type ParseResult = {
  filePath: string;
  entity: ParsedSpecEntity | null;
  links: ParsedSpecLink[];
  messages: ParseMessage[];
};

export type CreateEntityMarkdownInput = {
  entityId: string;
  type: string;
  title: string;
  status: string;
};

export type SpecopsFile = {
  path: string;
  content: string;
};

export type InitializeSpecopsFolderResult = {
  createdCount: number;
  skippedCount: number;
  createdPaths: string[];
  skippedPaths: string[];
};
