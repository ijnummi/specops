import type { AnnotationRelationshipType, SourceSpecAnnotationDto } from "@specops/contracts";

const RELATIONSHIP_ORDER: AnnotationRelationshipType[] = [
  "implements",
  "uses",
  "defines",
  "tests",
  "references"
];

const RELATIONSHIP_LABELS: Record<AnnotationRelationshipType, string> = {
  implements: "Implements",
  uses: "Uses",
  defines: "Defines",
  tests: "Tests",
  references: "References"
};

type AnnotationSummaryPanelProps = {
  annotations: SourceSpecAnnotationDto[];
};

export function AnnotationSummaryPanel({ annotations }: AnnotationSummaryPanelProps) {
  const groupedAnnotations = RELATIONSHIP_ORDER.map((relationshipType) => ({
    relationshipType,
    annotations: annotations.filter(
      (annotation) => annotation.relationshipType === relationshipType
    )
  })).filter((group) => group.annotations.length > 0);

  return (
    <section
      className="border-b border-slate-200 bg-white px-3 py-2"
      aria-label="Source/spec annotations"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Source/spec annotations</h3>
        <span className="text-xs text-slate-500">{annotations.length} total</span>
      </div>
      {groupedAnnotations.length === 0 ? (
        <p className="text-xs text-slate-500">No source/spec annotations yet.</p>
      ) : (
        <div className="grid max-h-32 gap-2 overflow-auto pr-1">
          {groupedAnnotations.map((group) => (
            <section key={group.relationshipType} className="grid gap-1">
              <h4 className="text-xs font-semibold text-slate-700">
                {RELATIONSHIP_LABELS[group.relationshipType]}
              </h4>
              <ul className="grid gap-1">
                {group.annotations.map((annotation) => (
                  <li
                    key={annotation.id}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 max-w-full truncate font-mono text-slate-900">
                        {formatLocation(annotation)}
                      </span>
                      {annotation.symbolName ? (
                        <span className="shrink-0 text-slate-700">
                          {annotation.symbolKind ? `${annotation.symbolKind} ` : ""}
                          {annotation.symbolName}
                        </span>
                      ) : null}
                      <span className="shrink-0">{annotation.provenance}</span>
                      <span className="shrink-0">{formatConfidence(annotation.confidence)}</span>
                      <span className="shrink-0 font-mono">{annotation.entityId}</span>
                      {annotation.status === "stale" ? (
                        <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
                          Stale
                        </span>
                      ) : null}
                      {annotation.claimId || annotation.claimEvidenceId ? (
                        <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">
                          Claim-backed
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function formatLocation(annotation: SourceSpecAnnotationDto) {
  const lineRange = formatLineRange(annotation.startLine, annotation.endLine);
  return lineRange ? `${annotation.sourceFilePath}:${lineRange}` : annotation.sourceFilePath;
}

function formatLineRange(startLine: number | null, endLine: number | null) {
  if (startLine === null) {
    return null;
  }

  if (endLine !== null && endLine !== startLine) {
    return `${startLine}-${endLine}`;
  }

  return String(startLine);
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "Confidence unknown" : `${Math.round(confidence * 100)}%`;
}
