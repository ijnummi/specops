---
id: task.capture-decision
type: agent_task
title: Implement Capture Decision
status: draft
links:
  use_cases:
    - uc.capture-decision
  domain:
    - domain.decision
    - domain.workspace
  interfaces:
    - interface.decision-service
  ui:
    - ui.decision-detail
  data:
    - data.decision-record
---

# Implement Capture Decision

## Objective

Build the vertical slice that lets a user create a draft decision in a workspace and see it in the decision detail view.

## Scope

- Add a `createDecision` operation to the Decision Service.
- Serialize the decision as markdown using [Decision Record](../data/decision-record.md).
- Add a simple create form to [Decision Detail](../ui/decision-detail.md).
- Index the new decision after it is written.

## Acceptance Criteria

- Creating a decision writes a markdown file with required frontmatter.
- The new decision appears in the workspace inbox.
- Missing title, context, or decision text returns a validation error.
- The implementation includes tests for successful creation and validation failure.
