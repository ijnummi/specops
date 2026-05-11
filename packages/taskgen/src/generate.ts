import { stringify } from "yaml";

import { defaultAgentTaskFilePath, defaultAgentTaskId } from "./id.js";
import { firstNonEmptySection } from "./sections.js";
import type {
  AgentTaskGenerationWarning,
  GenerateAgentTaskInput,
  GenerateAgentTaskResult,
  TaskgenEntity,
} from "./types.js";

const fallbackValidationCommands = ["pnpm typecheck", "pnpm test"];

const typeGroupOrder = [
  ["use_case", "Use Cases"],
  ["domain_entity", "Domain Entities"],
  ["data_model", "Data Models"],
  ["interface", "Interfaces"],
  ["ui_view", "UI Views"],
  ["adr", "ADRs"],
  ["source_file", "Source Files"],
] as const;

export function generateAgentTaskMarkdown(
  input: GenerateAgentTaskInput
): GenerateAgentTaskResult {
  const sourceEntityId = singleLineMarkdownScalar(input.source.entityId);
  const taskId = singleLineMarkdownScalar(input.taskId ?? defaultAgentTaskId(sourceEntityId));
  const title = singleLineMarkdownScalar(input.title ?? input.source.title);
  const targetAgent = singleLineMarkdownScalar(input.targetAgent);
  const context = dedupeEntities(input.context).sort(compareEntities);
  const contextSpecIds = context.map((entity) => singleLineMarkdownScalar(entity.entityId));
  const trackedSpecHashes = trackedSpecHashesFor([input.source, ...context]);
  const validationCommands =
    input.validationCommands.length > 0 ? input.validationCommands : fallbackValidationCommands;
  const validationFence = markdownFenceFor(validationCommands);
  const warnings: AgentTaskGenerationWarning[] = [];
  const sourceGoal = firstNonEmptySection(input.source.bodyMarkdown, [
    "Goal",
    "Objective",
    "Purpose",
  ]);
  const sourceRequirements = firstNonEmptySection(input.source.bodyMarkdown, [
    "Requirements",
    "Main Flow",
    "Validation",
  ]);
  const acceptanceCriteria = firstNonEmptySection(input.source.bodyMarkdown, [
    "Acceptance Criteria",
    "Validation",
    "Postconditions",
  ]);

  if (!sourceGoal && !sourceRequirements && !acceptanceCriteria) {
    warnings.push({
      code: "missing_source_sections",
      message: "Source spec does not include Goal, Requirements, or Acceptance Criteria sections.",
      entityId: sourceEntityId,
    });
  }

  const frontmatter = stringify({
    id: taskId,
    type: "agent_task",
    title,
    status: "ready",
    target_agent: targetAgent,
    source_entity: sourceEntityId,
    links: {
      generated_from: [sourceEntityId],
      uses: contextSpecIds,
    },
    ...(Object.keys(trackedSpecHashes).length > 0
      ? { tracked_spec_hashes: trackedSpecHashes }
      : {}),
  }).trim();

  const markdown = [
    "---",
    frontmatter,
    "---",
    "",
    `# Task: ${title}`,
    "",
    "## Objective",
    "",
    sourceGoal ?? `Implement the behavior described by ${inlineCode(sourceEntityId)}.`,
    "",
    "## Source Specs",
    "",
    `- ${inlineCode(sourceEntityId)} - ${singleLineMarkdownScalar(input.source.title)}`,
    "",
    "## Context",
    "",
    renderContext(context),
    "",
    "## Requirements",
    "",
    sourceRequirements ?? "- Add concrete implementation requirements before saving.",
    "- Preserve the behavior described by the source specs.",
    "",
    "## Acceptance Criteria",
    "",
    acceptanceCriteria ??
      "- Add acceptance criteria before saving when the source spec does not provide them.",
    "",
    "## Expected Files",
    "",
    "- Add expected files or modules before saving when known.",
    "",
    "## Do Not Change",
    "",
    "- Add out-of-scope files, behaviors, or modules before saving when relevant.",
    "",
    "## Validation Commands",
    "",
    `${validationFence}bash`,
    ...validationCommands,
    validationFence,
    "",
  ].join("\n");

  return {
    markdown,
    taskId,
    title,
    filePath: defaultAgentTaskFilePath(taskId),
    sourceSpecIds: [sourceEntityId],
    contextSpecIds,
    warnings,
  };
}

function renderContext(entities: TaskgenEntity[]): string {
  const renderedGroups: string[] = [];
  const grouped = new Map<string, TaskgenEntity[]>();

  for (const entity of entities) {
    const items = grouped.get(entity.type) ?? [];
    items.push(entity);
    grouped.set(entity.type, items);
  }

  for (const [type, heading] of typeGroupOrder) {
    const items = grouped.get(type) ?? [];
    if (items.length > 0) {
      renderedGroups.push(renderContextGroup(heading, items));
      grouped.delete(type);
    }
  }

  const remaining = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [type, items] of remaining) {
    renderedGroups.push(renderContextGroup(labelForType(type), items));
  }

  return renderedGroups.join("\n\n") || "- No linked context specs were found.";
}

function renderContextGroup(heading: string, entities: TaskgenEntity[]): string {
  return [
    `### ${heading}`,
    "",
    ...entities.flatMap((entity) => [
      `- ${inlineCode(singleLineMarkdownScalar(entity.entityId))} - ${singleLineMarkdownScalar(
        entity.title
      )}`,
      indentContextSnippet(entity),
    ]),
  ].join("\n");
}

function indentContextSnippet(entity: TaskgenEntity): string {
  const snippet =
    firstNonEmptySection(entity.bodyMarkdown, ["Goal", "Definition", "Responsibility", "Purpose"]) ??
    entity.bodyText;
  const normalized = snippet.trim();

  if (!normalized) {
    return "  - Add details before saving if this context is needed.";
  }

  return normalized
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 6)
    .map((line) => `  ${line}`)
    .join("\n");
}

function dedupeEntities(entities: TaskgenEntity[]): TaskgenEntity[] {
  const seen = new Set<string>();
  const deduped: TaskgenEntity[] = [];

  for (const entity of entities) {
    if (seen.has(entity.entityId)) {
      continue;
    }

    seen.add(entity.entityId);
    deduped.push(entity);
  }

  return deduped;
}

function trackedSpecHashesFor(entities: TaskgenEntity[]): Record<string, string> {
  const hashesByEntityId = new Map<string, string>();

  for (const entity of entities) {
    const contentHash = entity.contentHash?.trim();
    if (!contentHash || hashesByEntityId.has(entity.entityId)) {
      continue;
    }

    hashesByEntityId.set(singleLineMarkdownScalar(entity.entityId), contentHash);
  }

  return Object.fromEntries(
    [...hashesByEntityId.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

function compareEntities(left: TaskgenEntity, right: TaskgenEntity): number {
  const leftType = typeRank(left.type);
  const rightType = typeRank(right.type);

  if (leftType !== rightType) {
    return leftType - rightType;
  }

  if (leftType === typeGroupOrder.length && left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }

  return left.entityId.localeCompare(right.entityId);
}

function typeRank(type: string): number {
  const index = typeGroupOrder.findIndex(([candidate]) => candidate === type);
  return index === -1 ? typeGroupOrder.length : index;
}

function labelForType(type: string): string {
  return type
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function singleLineMarkdownScalar(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function inlineCode(value: string): string {
  const fence = "`".repeat(longestBacktickRun(value) + 1);
  return `${fence}${value}${fence}`;
}

function markdownFenceFor(lines: string[]): string {
  const maxRun = Math.max(0, ...lines.map(longestBacktickRun));
  return "`".repeat(Math.max(3, maxRun + 1));
}

function longestBacktickRun(value: string): number {
  const runs = value.match(/`+/g) ?? [];
  return Math.max(0, ...runs.map((run) => run.length));
}
