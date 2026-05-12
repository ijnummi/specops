import type { InferSelectModel } from "drizzle-orm";
import type {
  aiProposals,
  analyzeReviewAssemblies,
  analyzeReviewClaims,
  analyzeRuns,
  indexRuns,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specLinks,
} from "./schema.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type SpecLink = InferSelectModel<typeof specLinks>;
type AiProposal = InferSelectModel<typeof aiProposals>;
type SourceImport = InferSelectModel<typeof sourceImports>;
type SourceSymbol = InferSelectModel<typeof sourceSymbols>;
type SourceSpecLink = InferSelectModel<typeof sourceSpecLinks>;
type IndexRun = InferSelectModel<typeof indexRuns>;
type AnalyzeRun = InferSelectModel<typeof analyzeRuns>;
type AnalyzeReviewAssembly = InferSelectModel<typeof analyzeReviewAssemblies>;
type AnalyzeReviewClaim = InferSelectModel<typeof analyzeReviewClaims>;

type _SpecLinkConfidenceIsNumberOrNull = Expect<Equal<SpecLink["confidence"], number | null>>;
type _AiProposalConfidenceIsNumberOrNull = Expect<Equal<AiProposal["confidence"], number | null>>;
type _SourceImportImportedNamesIsStringArray = Expect<Equal<SourceImport["importedNames"], string[]>>;
type _SourceSymbolIsExportedIsBoolean = Expect<Equal<SourceSymbol["isExported"], boolean>>;
type _SourceSymbolMetadataIsRecord = Expect<Equal<SourceSymbol["metadataJson"], unknown>>;
type _IndexRunSourceFileCountIsNumber = Expect<Equal<IndexRun["sourceFileCount"], number>>;
type _AnalyzeReviewAssemblyRenderedMarkdownIsNullable = Expect<
  Equal<AnalyzeReviewAssembly["renderedMarkdown"], string | null>
>;
type _AnalyzeReviewClaimConfidenceIsNullable = Expect<
  Equal<AnalyzeReviewClaim["confidence"], number | null>
>;

const _sourceSpecLink = null as unknown as SourceSpecLink;
void _sourceSpecLink;

const analyzeRun = null as unknown as AnalyzeRun;
analyzeRun.status satisfies string;
