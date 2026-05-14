export type AiPrefillProviderName = "ollama" | "openai";
export type AiPrefillEntityType = "use_case" | "domain_entity" | "interface";

export type AiPrefillSourceFile = {
  id: string;
  path: string;
  contentHash: string;
  language: string | null;
  kind: string;
  text: string;
  startLine: number;
  endLine: number;
  imports: Array<{
    specifier: string;
    importKind: string;
    importedNames: string[];
    resolvedPath: string | null;
  }>;
  exports: Array<{
    exportedName: string;
    exportKind: string;
    sourceSpecifier: string | null;
  }>;
  symbols: Array<{
    name: string;
    symbolKind: string;
    isExported: boolean;
    line: number | null;
  }>;
};

export type AiPrefillExistingEntity = {
  entityId: string;
  type: string;
  title: string;
};

export type AiPrefillPromptMessage = { role: "system" | "user"; content: string };

export type AiPrefillPromptPacket = {
  promptVersion: "ai-prefill-v1";
  messages: AiPrefillPromptMessage[];
  selectedSourceFiles: Array<{
    file: string;
    contentHash: string;
    excerptStartLine: number;
    excerptEndLine: number;
  }>;
};

export type ConceptGraphPromptPacket = {
  promptVersion: "concept-graph-v1";
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export type AiPrefillLimits = { maxFiles: number; maxTotalBytes: number };

export type AiPrefillCandidate = {
  entityId: string;
  type: AiPrefillEntityType;
  title: string;
  summary: string;
  sourceFiles: string[];
  claims: Array<{ text: string; sourceFiles: string[] }>;
  proposedLinks: Array<{
    linkType: string;
    targetEntityId: string;
    targetExists: boolean;
    rationale: string;
  }>;
  confidence: number | null;
};

export type AiPrefillDiagnostic = { level: "warning" | "info"; message: string };

export type AiPrefillProviderInput = {
  packet: AiPrefillPromptPacket;
  model: string;
  temperature: number;
};
export type ConceptGraphProviderInput = {
  packet: ConceptGraphPromptPacket;
  model: string;
  temperature: number;
};
export type AiPrefillProviderResult = {
  provider: AiPrefillProviderName;
  model: string;
  text: string;
};
export type AiPrefillProvider = {
  generateSpecProposals(input: AiPrefillProviderInput): Promise<AiPrefillProviderResult>;
  generateConceptGraph(input: ConceptGraphProviderInput): Promise<AiPrefillProviderResult>;
};

export type BuildAiPrefillPromptPacketInput = {
  project: { id: string; name: string };
  allowedEntityTypes: AiPrefillEntityType[];
  allowedLinkTypes: string[];
  existingEntities: AiPrefillExistingEntity[];
  selectedFiles: AiPrefillSourceFile[];
  limits: AiPrefillLimits;
};

export type NormalizeProviderResponseInput = {
  text: string;
  selectedSourceFiles: string[];
  existingEntityIds: Set<string>;
};

export type NormalizeProviderResponseResult = {
  candidates: AiPrefillCandidate[];
  diagnostics: AiPrefillDiagnostic[];
};

export type RenderAiSpecEntityProposalInput = {
  candidate: AiPrefillCandidate;
  provider: AiPrefillProviderName;
  model: string;
  packet: AiPrefillPromptPacket;
  warnings?: string[];
};

export type RenderedAiSpecEntityProposal = {
  proposalType: "ai_spec_entity";
  title: string;
  confidence: number | null;
  payload: {
    entityId: string;
    type: AiPrefillEntityType;
    title: string;
    status: "draft";
    filePath: string;
    generatedMarkdown: string;
    markdown: string;
    sourceFiles: string[];
    proposedLinks: AiPrefillCandidate["proposedLinks"];
  };
  evidence: {
    provider: AiPrefillProviderName;
    model: string;
    promptVersion: "ai-prefill-v1";
    selectedSourceFiles: AiPrefillPromptPacket["selectedSourceFiles"];
    claims: AiPrefillCandidate["claims"];
    warnings: string[];
  };
};
