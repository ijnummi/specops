import type {
  AnalyzeReviewAssemblyDto,
  AnalyzeReviewAssemblyStatus,
  AnalyzeReviewInputDto,
  AnalyzeReviewValidationState
} from "@specops/contracts";

export type AnalyzeReviewInputGroupName =
  | "Domain"
  | "Services"
  | "Interfaces"
  | "Use Cases"
  | "Data Models"
  | "Unknowns";

const validationRank: Record<AnalyzeReviewValidationState, number> = {
  blocker: 0,
  warning: 1,
  ready: 2
};

const statusRank: Record<AnalyzeReviewAssemblyStatus, number> = {
  draft: 0,
  accepted: 1,
  discarded: 2
};

export function groupAnalyzeReviewInputs(inputs: AnalyzeReviewInputDto[]) {
  const groups: Record<AnalyzeReviewInputGroupName, AnalyzeReviewInputDto[]> = {
    Domain: [],
    Services: [],
    Interfaces: [],
    "Use Cases": [],
    "Data Models": [],
    Unknowns: []
  };

  for (const input of inputs) {
    groups[groupForInput(input)].push(input);
  }

  return groups;
}

export function sortAnalyzeReviewAssemblies(assemblies: AnalyzeReviewAssemblyDto[]) {
  return [...assemblies].sort((left, right) => {
    const status = statusRank[left.status] - statusRank[right.status];
    if (status !== 0) {
      return status;
    }

    const validation =
      validationRank[left.validation.state] - validationRank[right.validation.state];
    if (validation !== 0) {
      return validation;
    }
    return left.title.localeCompare(right.title);
  });
}

function groupForInput(input: AnalyzeReviewInputDto): AnalyzeReviewInputGroupName {
  if (input.confidence === null || input.confidence < 0.35) {
    return "Unknowns";
  }

  if (input.entityType === "domain_entity") {
    return "Domain";
  }

  if (input.entityType === "interface") {
    const title = input.title.toLowerCase();
    const entityId = input.entityId.toLowerCase();
    if (
      title.includes("service") ||
      entityId.includes(".service") ||
      entityId.includes("service")
    ) {
      return "Services";
    }
    return title.includes("model") ? "Data Models" : "Interfaces";
  }

  return "Use Cases";
}
