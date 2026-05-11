import { describe, expect, it } from "vitest";

import { generateAgentTaskMarkdown } from "../generate.js";
import type { TaskgenEntity, TaskgenLink } from "../types.js";

const source: TaskgenEntity = {
  entityId: "uc.generate-agent-task",
  type: "use_case",
  title: "Generate Agent Task",
  status: "draft",
  filePath: "use-cases/uc.generate-agent-task.md",
  frontmatter: {},
  bodyMarkdown:
    "# Generate Agent Task\n\n" +
    "## Goal\n\n" +
    "Generate a focused implementation prompt.\n\n" +
    "## Validation\n\n" +
    "- Keep generated tasks traceable.\n",
  bodyText: "Generate a focused implementation prompt. Keep generated tasks traceable.",
};

const context: TaskgenEntity[] = [
  {
    entityId: "domain.spec-entity",
    type: "domain_entity",
    title: "Spec Entity",
    status: "draft",
    filePath: "domain/spec-entity.md",
    frontmatter: {},
    bodyMarkdown: "# Spec Entity\n\n## Definition\n\nA spec entity is one markdown document.\n",
    bodyText: "A spec entity is one markdown document.",
  },
  {
    entityId: "interface.spec-entity-service",
    type: "interface",
    title: "Spec Entity Service",
    status: "draft",
    filePath: "interfaces/spec-entity-service.md",
    frontmatter: {},
    bodyMarkdown:
      "# Spec Entity Service\n\n## Responsibility\n\nReads and writes spec entities.\n",
    bodyText: "Reads and writes spec entities.",
  },
];

const links: TaskgenLink[] = [
  {
    fromEntityId: "uc.generate-agent-task",
    toEntityId: "domain.spec-entity",
    linkType: "domain",
    source: "frontmatter",
  },
  {
    fromEntityId: "interface.spec-entity-service",
    toEntityId: "uc.generate-agent-task",
    linkType: "use_cases",
    source: "frontmatter",
  },
];

describe("generateAgentTaskMarkdown", () => {
  it("generates deterministic task markdown with graph traceability", () => {
    const result = generateAgentTaskMarkdown({
      source,
      context,
      links,
      targetAgent: "codex",
      validationCommands: ["pnpm typecheck", "pnpm test"],
    });

    expect(result.taskId).toBe("task.uc-generate-agent-task");
    expect(result.filePath).toBe("agent-tasks/task.uc-generate-agent-task.md");
    expect(result.sourceSpecIds).toEqual(["uc.generate-agent-task"]);
    expect(result.contextSpecIds).toEqual([
      "domain.spec-entity",
      "interface.spec-entity-service",
    ]);
    expect(result.markdown).toContain("type: agent_task");
    expect(result.markdown).toContain("target_agent: codex");
    expect(result.markdown).toContain("source_entity: uc.generate-agent-task");
    expect(result.markdown).toContain("generated_from:");
    expect(result.markdown).toContain("- uc.generate-agent-task");
    expect(result.markdown).toContain("uses:");
    expect(result.markdown).toContain("- domain.spec-entity");
    expect(result.markdown).toContain("- interface.spec-entity-service");
    expect(result.markdown).toContain("### Domain Entities");
    expect(result.markdown).toContain("A spec entity is one markdown document.");
    expect(result.markdown).toContain("### Interfaces");
    expect(result.markdown).toContain("Reads and writes spec entities.");
    expect(result.markdown).toContain("pnpm typecheck");
    expect(result.markdown).toContain("pnpm test");
  });

  it("uses editable guidance when source sections are missing", () => {
    const result = generateAgentTaskMarkdown({
      source: {
        ...source,
        bodyMarkdown: "# Generate Agent Task\n",
        bodyText: "Generate Agent Task",
      },
      context: [],
      links: [],
      targetAgent: "codex",
      validationCommands: [],
    });

    expect(result.warnings).toContainEqual({
      code: "missing_source_sections",
      message: "Source spec does not include Goal, Requirements, or Acceptance Criteria sections.",
      entityId: "uc.generate-agent-task",
    });
    expect(result.markdown).toContain("- Add concrete implementation requirements before saving.");
    expect(result.markdown).toContain("pnpm typecheck");
    expect(result.markdown).toContain("pnpm test");
  });

  it("renders scalar titles as single-line markdown text", () => {
    const result = generateAgentTaskMarkdown({
      source: {
        ...source,
        title: "Source Title\n## Injected Source Section",
      },
      context: [
        {
          ...context[0],
          title: "Context Title\n## Injected Context Section",
        },
      ],
      links,
      title: "Task Title\n## Injected Task Section",
      targetAgent: "codex\ninjected",
      validationCommands: ["pnpm test"],
    });

    expect(result.title).toBe("Task Title ## Injected Task Section");
    expect(result.markdown).toContain("# Task: Task Title ## Injected Task Section");
    expect(result.markdown).toContain(
      "- `uc.generate-agent-task` - Source Title ## Injected Source Section"
    );
    expect(result.markdown).toContain(
      "- `domain.spec-entity` - Context Title ## Injected Context Section"
    );
    expect(result.markdown).toContain("target_agent: codex injected");
    expect(result.markdown).not.toContain("\n## Injected Task Section");
    expect(result.markdown).not.toContain("\n## Injected Source Section");
    expect(result.markdown).not.toContain("\n## Injected Context Section");
  });

  it("uses a validation command fence longer than command backtick runs", () => {
    const result = generateAgentTaskMarkdown({
      source,
      context: [],
      links: [],
      targetAgent: "codex",
      validationCommands: ["printf '```'"],
    });

    const lines = result.markdown.split("\n");
    expect(result.markdown).toContain("````bash\nprintf '```'\n````");
    expect(lines).toContain("````bash");
    expect(lines).toContain("````");
    expect(lines).not.toContain("```bash");
    expect(lines).not.toContain("```");
  });

  it("includes deterministic tracked spec hashes when entities provide content hashes", () => {
    const result = generateAgentTaskMarkdown({
      source: { ...source, contentHash: "hash-source" },
      context: [
        { ...context[1], contentHash: "hash-interface" },
        { ...context[0], contentHash: "hash-domain" },
      ],
      links,
      targetAgent: "codex",
      validationCommands: ["pnpm test"],
    });

    expect(result.markdown).toContain("tracked_spec_hashes:");
    expect(result.markdown.indexOf("domain.spec-entity: hash-domain")).toBeLessThan(
      result.markdown.indexOf("interface.spec-entity-service: hash-interface")
    );
    expect(result.markdown.indexOf("interface.spec-entity-service: hash-interface")).toBeLessThan(
      result.markdown.indexOf("uc.generate-agent-task: hash-source")
    );
    expect(result.markdown).toContain("uc.generate-agent-task: hash-source");
  });
});
