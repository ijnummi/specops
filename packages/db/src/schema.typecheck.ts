import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  aiProposals,
  analyzeReviewAssemblies,
  analyzeReviewAssemblyInputs,
  analyzeReviewClaimEvidence,
  analyzeReviewClaims,
  analyzeRuns,
  indexRuns,
  projectConceptMemberships,
  projectConceptRelationships,
  projectConceptVersions,
  projectConcepts,
  projectGraphEdges,
  projectGraphNodes,
  projectGraphVersions,
  sourceImports,
  sourceSpecAnnotations,
  sourceSpecLinks,
  sourceSymbols,
  specLinks,
  systemMapAreas,
  systemMapSnapshots,
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
type AnalyzeReviewAssemblyInput = InferSelectModel<typeof analyzeReviewAssemblyInputs>;
type AnalyzeReviewClaim = InferSelectModel<typeof analyzeReviewClaims>;
type AnalyzeReviewClaimEvidence = InferSelectModel<typeof analyzeReviewClaimEvidence>;
type SourceSpecAnnotation = InferSelectModel<typeof sourceSpecAnnotations>;
type NewSourceSpecAnnotation = InferInsertModel<typeof sourceSpecAnnotations>;
type SystemMapSnapshotSelect = typeof systemMapSnapshots.$inferSelect;
type SystemMapSnapshotInsert = typeof systemMapSnapshots.$inferInsert;
type SystemMapAreaSelect = typeof systemMapAreas.$inferSelect;
type SystemMapAreaInsert = typeof systemMapAreas.$inferInsert;
type ProjectGraphVersionSelect = typeof projectGraphVersions.$inferSelect;
type ProjectGraphVersionInsert = typeof projectGraphVersions.$inferInsert;
type ProjectGraphNodeSelect = typeof projectGraphNodes.$inferSelect;
type ProjectGraphNodeInsert = typeof projectGraphNodes.$inferInsert;
type ProjectGraphEdgeSelect = typeof projectGraphEdges.$inferSelect;
type ProjectGraphEdgeInsert = typeof projectGraphEdges.$inferInsert;
type ProjectConceptVersionSelect = typeof projectConceptVersions.$inferSelect;
type ProjectConceptVersionInsert = typeof projectConceptVersions.$inferInsert;
type ProjectConceptSelect = typeof projectConcepts.$inferSelect;
type ProjectConceptInsert = typeof projectConcepts.$inferInsert;
type ProjectConceptMembershipSelect = typeof projectConceptMemberships.$inferSelect;
type ProjectConceptMembershipInsert = typeof projectConceptMemberships.$inferInsert;
type ProjectConceptRelationshipSelect = typeof projectConceptRelationships.$inferSelect;
type ProjectConceptRelationshipInsert = typeof projectConceptRelationships.$inferInsert;

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
type _AnalyzeReviewAssemblyInputProjectIdIsString = Expect<
  Equal<AnalyzeReviewAssemblyInput["projectId"], string>
>;
type _AnalyzeReviewClaimProjectIdIsString = Expect<Equal<AnalyzeReviewClaim["projectId"], string>>;
type _AnalyzeReviewClaimEvidenceProjectIdIsString = Expect<
  Equal<AnalyzeReviewClaimEvidence["projectId"], string>
>;
type _SourceSpecAnnotationStatusIsString = Expect<Equal<SourceSpecAnnotation["status"], string>>;
type _SourceSpecAnnotationConfidenceIsNullable = Expect<
  Equal<SourceSpecAnnotation["confidence"], number | null>
>;
type _NewSourceSpecAnnotationSourceFileIdIsOptional = Expect<
  Equal<NewSourceSpecAnnotation["sourceFileId"], string | null | undefined>
>;
type _ProjectGraphVersionStatusIsString = Expect<Equal<ProjectGraphVersionSelect["status"], string>>;
type _ProjectGraphNodeConfidenceIsNullable = Expect<
  Equal<ProjectGraphNodeSelect["confidence"], number | null>
>;
type _ProjectGraphEdgeProvenanceIsString = Expect<Equal<ProjectGraphEdgeSelect["provenance"], string>>;
type _ProjectConceptVersionProviderIsString = Expect<
  Equal<ProjectConceptVersionSelect["provider"], string>
>;
type _ProjectConceptConfidenceIsNumber = Expect<Equal<ProjectConceptSelect["confidence"], number>>;
type _ProjectConceptInsertStatusIsOptional = Expect<
  Equal<ProjectConceptInsert["status"], string | undefined>
>;
type _ProjectConceptMembershipRoleIsString = Expect<
  Equal<ProjectConceptMembershipSelect["role"], string>
>;
type _ProjectConceptMembershipGraphVersionIdIsString = Expect<
  Equal<ProjectConceptMembershipSelect["projectGraphVersionId"], string>
>;
type _ProjectConceptMembershipInsertGraphVersionIdIsRequired = Expect<
  Equal<ProjectConceptMembershipInsert["projectGraphVersionId"], string>
>;
type _ProjectConceptRelationshipTypeIsString = Expect<
  Equal<ProjectConceptRelationshipSelect["relationshipType"], string>
>;

const _sourceSpecLink = null as unknown as SourceSpecLink;
void _sourceSpecLink;

const _sourceSpecAnnotation = null as unknown as SourceSpecAnnotation;
void _sourceSpecAnnotation;

const analyzeRun = null as unknown as AnalyzeRun;
analyzeRun.status satisfies string;

const systemMapSnapshotSelect = null as unknown as SystemMapSnapshotSelect;
const systemMapSnapshotInsert = null as unknown as SystemMapSnapshotInsert;
const systemMapAreaSelect = null as unknown as SystemMapAreaSelect;
const systemMapAreaInsert = null as unknown as SystemMapAreaInsert;
void systemMapSnapshotSelect;
void systemMapSnapshotInsert;
void systemMapAreaSelect;
void systemMapAreaInsert;

const projectGraphVersionSelect = null as unknown as ProjectGraphVersionSelect;
const projectGraphVersionInsert = null as unknown as ProjectGraphVersionInsert;
const projectGraphNodeSelect = null as unknown as ProjectGraphNodeSelect;
const projectGraphNodeInsert = null as unknown as ProjectGraphNodeInsert;
const projectGraphEdgeSelect = null as unknown as ProjectGraphEdgeSelect;
const projectGraphEdgeInsert = null as unknown as ProjectGraphEdgeInsert;
void projectGraphVersionSelect;
void projectGraphVersionInsert;
void projectGraphNodeSelect;
void projectGraphNodeInsert;
void projectGraphEdgeSelect;
void projectGraphEdgeInsert;

const projectConceptVersionSelect = null as unknown as ProjectConceptVersionSelect;
const projectConceptVersionInsert = null as unknown as ProjectConceptVersionInsert;
const projectConceptSelect = null as unknown as ProjectConceptSelect;
const projectConceptInsert = null as unknown as ProjectConceptInsert;
const projectConceptMembershipSelect = null as unknown as ProjectConceptMembershipSelect;
const projectConceptMembershipInsert = null as unknown as ProjectConceptMembershipInsert;
const projectConceptRelationshipSelect = null as unknown as ProjectConceptRelationshipSelect;
const projectConceptRelationshipInsert = null as unknown as ProjectConceptRelationshipInsert;
void projectConceptVersionSelect;
void projectConceptVersionInsert;
void projectConceptSelect;
void projectConceptInsert;
void projectConceptMembershipSelect;
void projectConceptMembershipInsert;
void projectConceptRelationshipSelect;
void projectConceptRelationshipInsert;
