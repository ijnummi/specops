---
id: data.decision-record
type: data_model
title: Decision Record
status: draft
links:
  domain:
    - domain.workspace
    - domain.decision
    - domain.decision-link
  interfaces:
    - interface.decision-service
    - interface.search-service
  use_cases:
    - uc.capture-decision
---

# Decision Record

## Shape

```ts
type DecisionRecord = {
  id: string;
  workspaceId: string;
  title: string;
  status: "proposed" | "accepted" | "superseded" | "archived";
  contextMarkdown: string;
  decisionMarkdown: string;
  consequencesMarkdown: string;
  links: Array<{ type: string; targetId: string }>;
  reviewAfter?: string;
  updatedAt: string;
};
```

## Persistence

Decision records are serialized as markdown files with YAML frontmatter. The body stores human-readable sections, while frontmatter stores IDs, status, review metadata, and links.

## Validation

- `id`, `workspaceId`, `title`, and `status` are required.
- `links.targetId` must reference an existing decision.
- `updatedAt` changes whenever editable content changes.
