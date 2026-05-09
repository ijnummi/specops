import type { CreateEntityMarkdownInput, SpecopsFile } from "./types.js";

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
    entityId: "adr.002-postgresql-is-derived-cache",
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

const templateTypes = [
  ["use-case.template.md", "use_case", "Use Case"],
  ["domain-entity.template.md", "domain_entity", "Domain Entity"],
  ["interface.template.md", "interface", "Interface"],
  ["data-model.template.md", "data_model", "Data Model"],
  ["ui-view.template.md", "ui_view", "UI View"],
  ["agent-task.template.md", "agent_task", "Agent Task"],
  ["adr.template.md", "adr", "Architecture Decision Record"]
] as const;

export function createEntityMarkdown(input: CreateEntityMarkdownInput): string {
  return `---
id: ${input.entityId}
type: ${input.type}
title: ${input.title}
status: ${input.status}
links: {}
---

# ${input.title}

Describe this ${input.type} and the decisions that shape it.
`;
}

export function initialSpecopsFiles(): SpecopsFile[] {
  const files: SpecopsFile[] = [
    {
      path: "project.yaml",
      content: `name: SpecOps Workbench
version: 1
specs:
  root: .
`
    },
    ...starterSpecs.map((spec) => ({
      path: spec.path,
      content: createEntityMarkdown(spec)
    })),
    ...templateTypes.map(([fileName, type, title]) => ({
      path: `templates/${fileName}`,
      content: templateMarkdown(type, title)
    }))
  ];

  return files;
}

function templateMarkdown(type: string, title: string): string {
  return `---
id: {{id}}
type: {{type}}
title: {{title}}
status: {{status}}
links: {}
---

# {{title}}

Describe this ${title.toLowerCase()}.

## Notes

- Replace template tokens before saving.
- Keep markdown as the source of truth.
`;
}
