---
id: uc.link-decision-context
type: use_case
title: Link Decision Context
status: draft
links:
  domain:
    - domain.decision
    - domain.decision-link
  interfaces:
    - interface.decision-service
    - interface.search-service
  ui:
    - ui.decision-detail
  previous:
    - uc.capture-decision
  next:
    - uc.review-stale-decisions
---

# Link Decision Context

## Goal

Connect related decisions so the team can trace how newer choices depend on older context.

## Actors

- Author
- Reviewer
- Search Service

## Preconditions

- At least two decisions exist in the workspace.
- The source decision is open in the detail view.

## Main Flow

1. The author searches for related decisions.
2. The UI shows candidate decisions with title, status, and excerpt.
3. The author chooses a link type such as `supersedes`, `depends_on`, or `related`.
4. The service writes a decision link into frontmatter.
5. The graph updates so linked decisions appear together.

## Postconditions

- A [Decision Link](../domain/decision-link.md) connects two decisions.
- Search and detail views include the new relationship.

## Validation

- Reject links to missing decisions.
- Reject duplicate links with the same source, target, and link type.
