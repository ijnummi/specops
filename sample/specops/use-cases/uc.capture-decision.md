---
id: uc.capture-decision
type: use_case
title: Capture Decision
status: draft
links:
  domain:
    - domain.workspace
    - domain.decision
  interfaces:
    - interface.decision-service
  ui:
    - ui.decision-detail
  data:
    - data.decision-record
  decisions:
    - adr.001-markdown-decision-log
  next:
    - uc.link-decision-context
---

# Capture Decision

## Goal

Record a decision with enough context that a future teammate can understand why it was made.

## Actors

- Author
- Decision Service

## Preconditions

- A workspace exists.
- The author has selected or created a topic.

## Main Flow

1. The author enters a title, status, context, decision, and consequences.
2. The UI previews the markdown document.
3. The service assigns a stable decision ID.
4. The service writes the decision record as markdown.
5. The service indexes the new decision for search and linking.

## Postconditions

- A [Decision](../domain/decision.md) exists.
- The decision appears in [Decision Detail](../ui/decision-detail.md).

## Validation

- Require a title, context, and decision text.
- Keep decision IDs stable after creation.
