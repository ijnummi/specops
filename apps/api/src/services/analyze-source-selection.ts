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

export function selectAnalyzeSourceFiles(
  input: SelectAnalyzeSourceFilesInput
): AnalyzeRunSelectionSummary {
  const scored = input.files
    .map(scoreCandidate)
    .filter((candidate) => candidate.score > 0)
    .sort(compareCandidates);
  const highSignal = scored.filter(isHighSignal);
  const selected: ScoredCandidate[] = [];
  let selectedBytes = 0;

  for (const category of categoryOrder.slice(0, 3)) {
    const candidate = scored.find(
      (item) =>
        item.category === category &&
        !selected.some((selectedItem) => selectedItem.id === item.id) &&
        canSelect(item, selected.length, selectedBytes, input)
    );
    if (candidate) {
      selected.push(candidate);
      selectedBytes += candidate.sizeBytes;
    }
  }

  for (const candidate of scored) {
    if (selected.some((item) => item.id === candidate.id)) continue;
    if (!canSelect(candidate, selected.length, selectedBytes, input)) continue;
    selected.push(candidate);
    selectedBytes += candidate.sizeBytes;
  }

  selected.sort((left, right) => left.path.localeCompare(right.path));

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
    path.includes("/routes/") ||
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
  return byScore === 0 ? left.path.localeCompare(right.path) : byScore;
}

function canSelect(
  candidate: AnalyzeSourceCandidate,
  selectedCount: number,
  selectedBytes: number,
  input: SelectAnalyzeSourceFilesInput
) {
  return selectedCount < input.maxFiles && selectedBytes + candidate.sizeBytes <= input.maxTotalBytes;
}
