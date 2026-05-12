import type { AnalyzeRunDiagnostic, AnalyzeRunSelectionSummary } from "@specops/contracts";

type SelectionCategory = AnalyzeRunSelectionSummary["categories"][number]["category"];

export type AnalyzeSourceCandidate = {
  id: string;
  path: string;
  kind: string;
  sizeBytes: number;
  importCount: number;
  exportCount: number;
  symbolCount: number;
};

type SelectAnalyzeSourceFilesInput = {
  files: AnalyzeSourceCandidate[];
  maxFiles: number;
  maxTotalBytes: number;
};

type ScoredCandidate = AnalyzeSourceCandidate & {
  category: SelectionCategory;
  score: number;
};

const categoryOrder: SelectionCategory[] = [
  "entrypoints_routes",
  "services_modules",
  "domain_models",
  "frontend_views",
  "tests_config"
];
const reservedCategoryOrder = categoryOrder.slice(0, 3);
const maxReservedCandidatesPerCategory = 16;

export function selectAnalyzeSourceFiles(
  input: SelectAnalyzeSourceFilesInput
): AnalyzeRunSelectionSummary {
  const scored = input.files
    .map(scoreCandidate)
    .filter((candidate) => candidate.score > 0)
    .sort(compareCandidates);
  const highSignal = scored.filter(isHighSignal);
  const selected = selectReservedBucketCandidates(scored, input);
  let selectedBytes = sumBytes(selected);

  for (const candidate of scored) {
    if (selected.some((item) => item.id === candidate.id)) continue;
    if (!canSelect(candidate, selected.length, selectedBytes, input)) continue;
    selected.push(candidate);
    selectedBytes += candidate.sizeBytes;
  }

  selected.sort((left, right) => compareStrings(left.path, right.path));

  const diagnostics: AnalyzeRunDiagnostic[] = [];
  const selectedHighSignalFileCount = selected.filter(isHighSignal).length;
  const skippedHighSignalFileCount = Math.max(0, highSignal.length - selectedHighSignalFileCount);
  if (selected.length === 0) {
    diagnostics.push({
      level: "warning",
      message: "No indexed source files fit within AI Prefill limits."
    });
  } else if (skippedHighSignalFileCount > 0) {
    diagnostics.push({
      level: "info",
      message: `AI source selection is partial: selected ${selectedHighSignalFileCount} of ${highSignal.length} high-signal files.`
    });
  }

  return {
    selectedSourceFileIds: selected.map((file) => file.id),
    selectedPaths: selected.map((file) => file.path),
    eligibleHighSignalFileCount: highSignal.length,
    skippedHighSignalFileCount,
    categories: categoryOrder
      .map((category) => ({
        category,
        count: selected.filter((file) => file.category === category).length
      }))
      .filter((item) => item.count > 0),
    diagnostics
  };
}

function scoreCandidate(candidate: AnalyzeSourceCandidate): ScoredCandidate {
  const path = candidate.path.toLowerCase();
  const category = categorizePath(path, candidate.kind);
  if (category === "tests_config") {
    return { ...candidate, category, score: 1 };
  }
  const categoryScore = {
    entrypoints_routes: 100,
    services_modules: 80,
    domain_models: 70,
    frontend_views: 55,
    tests_config: 0
  }[category];
  const score =
    categoryScore + candidate.exportCount * 4 + candidate.symbolCount * 2 + candidate.importCount;

  return { ...candidate, category, score };
}

function isHighSignal(candidate: ScoredCandidate) {
  return candidate.category !== "tests_config";
}

function selectReservedBucketCandidates(
  candidates: ScoredCandidate[],
  input: SelectAnalyzeSourceFilesInput
) {
  let best: ScoredCandidate[] = [];
  const candidatesByCategory = new Map(
    reservedCategoryOrder.map((category) => [
      category,
      rankReservedCandidatesForSearch(
        candidates.filter((candidate) => candidate.category === category),
        input
      ).slice(0, maxReservedCandidatesPerCategory)
    ])
  );

  function visit(categoryIndex: number, current: ScoredCandidate[]) {
    if (categoryIndex === reservedCategoryOrder.length) {
      if (compareSelections(current, best) < 0) {
        best = current;
      }
      return;
    }

    visit(categoryIndex + 1, current);

    const category = reservedCategoryOrder[categoryIndex];
    for (const candidate of candidatesByCategory.get(category) ?? []) {
      const next = [...current, candidate];
      if (next.length > input.maxFiles || sumBytes(next) > input.maxTotalBytes) continue;
      visit(categoryIndex + 1, next);
    }
  }

  visit(0, []);
  return best;
}

function rankReservedCandidatesForSearch(
  candidates: ScoredCandidate[],
  input: SelectAnalyzeSourceFilesInput
) {
  const reservedBucketTargetBytes =
    input.maxTotalBytes / Math.max(1, Math.min(input.maxFiles, reservedCategoryOrder.length));

  return [...candidates].sort((left, right) => {
    const leftFitsTarget = left.sizeBytes <= reservedBucketTargetBytes;
    const rightFitsTarget = right.sizeBytes <= reservedBucketTargetBytes;
    if (leftFitsTarget !== rightFitsTarget) return leftFitsTarget ? -1 : 1;
    return compareCandidates(left, right);
  });
}

function compareSelections(left: ScoredCandidate[], right: ScoredCandidate[]) {
  const byCount = right.length - left.length;
  if (byCount !== 0) return byCount;

  const byScore = sumScore(right) - sumScore(left);
  if (byScore !== 0) return byScore;

  const byBytes = sumBytes(left) - sumBytes(right);
  if (byBytes !== 0) return byBytes;

  return compareStrings(selectionKey(left), selectionKey(right));
}

function selectionKey(selection: ScoredCandidate[]) {
  return selection
    .map((candidate) => candidate.path)
    .sort(compareStrings)
    .join("\n");
}

function sumBytes(candidates: ScoredCandidate[]) {
  return candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0);
}

function sumScore(candidates: ScoredCandidate[]) {
  return candidates.reduce((total, candidate) => total + candidate.score, 0);
}

function categorizePath(path: string, kind: string): SelectionCategory {
  if (
    kind === "test" ||
    kind === "config" ||
    path.includes("/__tests__/") ||
    path.includes(".test.") ||
    path.includes("/config.")
  ) {
    return "tests_config";
  }
  if (
    (path.includes("apps/web/") || path.includes("/frontend/") || path.includes("/client/")) &&
    (path.includes("/routes/") ||
      path.includes("/pages/") ||
      path.includes("/components/") ||
      path.endsWith(".tsx"))
  ) {
    return "frontend_views";
  }
  if (
    path.includes("/routes/") ||
    path.includes("/controllers/") ||
    path.includes("/src/api/") ||
    path.endsWith("/index.ts") ||
    path.endsWith("/index.tsx") ||
    kind === "entrypoint"
  ) {
    return "entrypoints_routes";
  }
  if (
    path.includes("/services/") ||
    path.includes("/modules/") ||
    path.includes("-service.") ||
    path.includes(".service.")
  ) {
    return "services_modules";
  }
  if (
    path.includes("/domain/") ||
    path.includes("/models/") ||
    path.includes("/schema") ||
    path.includes("/types.")
  ) {
    return "domain_models";
  }
  if (
    path.includes("/pages/") ||
    path.includes("/components/") ||
    path.endsWith(".tsx")
  ) {
    return "frontend_views";
  }
  return "tests_config";
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate) {
  const byScore = right.score - left.score;
  return byScore === 0 ? compareStrings(left.path, right.path) : byScore;
}

function compareStrings(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canSelect(
  candidate: AnalyzeSourceCandidate,
  selectedCount: number,
  selectedBytes: number,
  input: SelectAnalyzeSourceFilesInput
) {
  return selectedCount < input.maxFiles && selectedBytes + candidate.sizeBytes <= input.maxTotalBytes;
}
