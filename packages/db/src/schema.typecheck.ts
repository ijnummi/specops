import type { InferSelectModel } from "drizzle-orm";
import type { aiProposals, indexRuns, sourceImports, sourceSymbols, specLinks } from "./schema.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type SpecLink = InferSelectModel<typeof specLinks>;
type AiProposal = InferSelectModel<typeof aiProposals>;
type SourceImport = InferSelectModel<typeof sourceImports>;
type SourceSymbol = InferSelectModel<typeof sourceSymbols>;
type IndexRun = InferSelectModel<typeof indexRuns>;

type _SpecLinkConfidenceIsNumberOrNull = Expect<Equal<SpecLink["confidence"], number | null>>;
type _AiProposalConfidenceIsNumberOrNull = Expect<Equal<AiProposal["confidence"], number | null>>;
type _SourceImportImportedNamesIsStringArray = Expect<Equal<SourceImport["importedNames"], string[]>>;
type _SourceSymbolIsExportedIsBoolean = Expect<Equal<SourceSymbol["isExported"], boolean>>;
type _SourceSymbolMetadataIsRecord = Expect<Equal<SourceSymbol["metadataJson"], unknown>>;
type _IndexRunSourceFileCountIsNumber = Expect<Equal<IndexRun["sourceFileCount"], number>>;
