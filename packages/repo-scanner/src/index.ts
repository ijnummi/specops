export { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "./classify.js";
export { discoverSourceFiles } from "./discover.js";
export { parseSourceFacts } from "./parse.js";
export { scanRepository } from "./scan.js";
export type {
  ParseSourceFactsInput,
  ParseSourceFactsResult,
  ScanRepositoryInput,
  ScanRepositoryResult,
  SourceExportFact,
  SourceFileFact,
  SourceFileKind,
  SourceImportFact,
  SourceLanguage,
  SourceScanWarning,
  SourceSpecopsAnnotationFact,
  SourceSymbolFact
} from "./types.js";
