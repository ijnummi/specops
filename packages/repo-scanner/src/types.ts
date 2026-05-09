export type SourceLanguage = "typescript" | "tsx" | "javascript" | "jsx" | "unknown";
export type SourceFileKind = "source" | "test" | "config" | "entrypoint" | "unknown";

export type SourceImportFact = {
  specifier: string;
  importKind: "named" | "default" | "namespace" | "side_effect" | "type" | "mixed" | "re_export";
  importedNames: string[];
  isRelative: boolean;
  resolvedPath: string | null;
};

export type SourceExportFact = {
  exportedName: string;
  exportKind: "named" | "default" | "namespace" | "re_export" | "type";
  sourceSpecifier: string | null;
};

export type SourceSymbolFact = {
  name: string;
  symbolKind: string;
  isExported: boolean;
  line: number | null;
  metadata: Record<string, unknown>;
};

export type SourceScanWarning = {
  code: "source_parse_error" | "source_read_error";
  message: string;
  filePath: string;
};

export type SourceFileFact = {
  path: string;
  language: SourceLanguage;
  kind: SourceFileKind;
  sizeBytes: number;
  contentHash: string;
  imports: SourceImportFact[];
  exports: SourceExportFact[];
  symbols: SourceSymbolFact[];
};

export type ParseSourceFactsInput = {
  path: string;
  content: string;
};

export type ParseSourceFactsResult = {
  imports: SourceImportFact[];
  exports: SourceExportFact[];
  symbols: SourceSymbolFact[];
  warnings: SourceScanWarning[];
};

export type ScanRepositoryInput = {
  repoPath: string;
};

export type ScanRepositoryResult = {
  files: SourceFileFact[];
  warnings: SourceScanWarning[];
};
