import type { CreateEntityMarkdownInput, SpecopsFile } from "./types.js";
import { stringify } from "yaml";

const starterSpecs = [
  {
    path: "decisions/adr-001-markdown-is-source-of-truth.md",
    entityId: "adr.001-markdown-is-source-of-truth",
    type: "adr",
    title: "Markdown Is Source Of Truth",
    status: "accepted"
  },
  {
    path: "decisions/adr-002-postgresql-is-derived-cache.md",
    entityId: "adr.002-postgresql-derived-cache",
    type: "adr",
    title: "PostgreSQL Is Derived Cache",
    status: "accepted"
  },
  {
    path: "decisions/adr-003-flexible-spec-graph.md",
    entityId: "adr.003-flexible-spec-graph",
    type: "adr",
    title: "Flexible Spec Graph",
    status: "accepted"
  },
  {
    path: "domain/project.md",
    entityId: "domain.project",
    type: "domain_entity",
    title: "Project",
    status: "draft"
  },
  {
    path: "domain/spec-entity.md",
    entityId: "domain.spec-entity",
    type: "domain_entity",
    title: "Spec Entity",
    status: "draft"
  },
  {
    path: "domain/spec-link.md",
    entityId: "domain.spec-link",
    type: "domain_entity",
    title: "Spec Link",
    status: "draft"
  },
  {
    path: "domain/spec-file.md",
    entityId: "domain.spec-file",
    type: "domain_entity",
    title: "Spec File",
    status: "draft"
  },
  {
    path: "domain/index-run.md",
    entityId: "domain.index-run",
    type: "domain_entity",
    title: "Index Run",
    status: "draft"
  },
  {
    path: "domain/validation-message.md",
    entityId: "domain.validation-message",
    type: "domain_entity",
    title: "Validation Message",
    status: "draft"
  },
  {
    path: "interfaces/project-registry-service.md",
    entityId: "interface.project-registry-service",
    type: "interface",
    title: "Project Registry Service",
    status: "draft"
  },
  {
    path: "interfaces/markdown-indexer.md",
    entityId: "interface.markdown-indexer",
    type: "interface",
    title: "Markdown Indexer",
    status: "draft"
  },
  {
    path: "interfaces/spec-entity-service.md",
    entityId: "interface.spec-entity-service",
    type: "interface",
    title: "Spec Entity Service",
    status: "draft"
  },
  {
    path: "interfaces/graph-query-service.md",
    entityId: "interface.graph-query-service",
    type: "interface",
    title: "Graph Query Service",
    status: "draft"
  },
  {
    path: "use-cases/uc.create-project.md",
    entityId: "uc.create-project",
    type: "use_case",
    title: "Create Project",
    status: "draft"
  },
  {
    path: "use-cases/uc.initialize-specops-folder.md",
    entityId: "uc.initialize-specops-folder",
    type: "use_case",
    title: "Initialize SpecOps Folder",
    status: "draft"
  },
  {
    path: "use-cases/uc.index-spec-files.md",
    entityId: "uc.index-spec-files",
    type: "use_case",
    title: "Index Spec Files",
    status: "draft"
  },
  {
    path: "use-cases/uc.edit-spec-entity.md",
    entityId: "uc.edit-spec-entity",
    type: "use_case",
    title: "Edit Spec Entity",
    status: "draft"
  },
  {
    path: "use-cases/uc.link-spec-entities.md",
    entityId: "uc.link-spec-entities",
    type: "use_case",
    title: "Link Spec Entities",
    status: "draft"
  },
  {
    path: "use-cases/uc.generate-agent-task.md",
    entityId: "uc.generate-agent-task",
    type: "use_case",
    title: "Generate Agent Task",
    status: "draft"
  }
] as const;

const templateFiles = [
  {
    path: "templates/use-case.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Goal

Describe the outcome this use case delivers.

## Actors

- Primary actor

## Preconditions

- Required starting condition.

## Main Flow

1. First step.
2. Next step.

## Postconditions

- Resulting state.

## Validation

- Important constraints or failure cases.
`
  },
  {
    path: "templates/domain-entity.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Definition

Define the domain concept in one or two paragraphs.

## Key Fields

- \`field\`: meaning.

## Rules

- Invariant or business rule.

## Related Behavior

Describe use cases or interfaces that depend on this entity.
`
  },
  {
    path: "templates/interface.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Responsibility

Describe what this interface owns.

## Operations

- \`operation(input)\`: result.

## Inputs And Outputs

Describe important request and response shapes.

## Errors

- Expected error or validation case.
`
  },
  {
    path: "templates/data-model.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Purpose

Describe the persisted or derived data model.

## Fields

- \`field\`: meaning.

## Relationships

- Related entity or table.

## Constraints

- Required constraint or index.
`
  },
  {
    path: "templates/ui-view.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Purpose

Describe what the view helps the user accomplish.

## Primary Content

- Main information shown.

## Interactions

- User action and expected response.

## States

- Empty, loading, error, and success states.
`
  },
  {
    path: "templates/agent-task.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Objective

State the implementation outcome.

## Context

- Relevant spec entity IDs.

## Requirements

- Required behavior or document change.

## Verification

- Command or review step that proves the work is complete.
`
  },
  {
    path: "templates/adr.template.md",
    content: `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

## Context

Describe the forces, constraints, and alternatives.

## Decision

State the chosen direction.

## Consequences

- Expected benefit or tradeoff.
`
  }
] as const;

export function createEntityMarkdown(input: CreateEntityMarkdownInput): string {
  assertSingleLine("entityId", input.entityId);
  assertSingleLine("type", input.type);
  assertSingleLine("title", input.title);
  assertSingleLine("status", input.status);
  const frontmatter = stringify(
    {
      id: input.entityId,
      type: input.type,
      title: input.title,
      status: input.status,
      links: {}
    },
    { lineWidth: 0 }
  ).trimEnd();

  return `---
${frontmatter}
---

# ${input.title}

Describe this ${input.type} and the decisions that shape it.
`;
}

function assertSingleLine(field: string, value: string) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} must be a single-line string`);
  }
}

export function initialSpecopsFiles(): SpecopsFile[] {
  const files: SpecopsFile[] = [
    {
      path: "project.yaml",
      content: `id: specops-workbench
name: SpecOps Workbench
specops_version: 1
description: Local-first markdown-native workbench for specs-driven AI-assisted software development.
`
    },
    ...starterSpecs.map((spec) => ({
      path: spec.path,
      content: createEntityMarkdown(spec)
    })),
    ...templateFiles
  ];

  return files;
}
