---
id: domain.decision-link
type: domain_entity
title: Decision Link
status: draft
links:
  use_cases:
    - uc.link-decision-context
  interfaces:
    - interface.decision-service
    - interface.search-service
  domain:
    - domain.decision
---

# Decision Link

## Definition

A decision link is a typed relationship between two decisions. It lets readers understand dependency, replacement, and contextual relationships without scanning every document manually.

## Key Fields

- `fromDecisionId`: source decision.
- `toDecisionId`: target decision.
- `linkType`: relationship type such as `depends_on`, `supersedes`, or `related`.
- `source`: where the link was declared.

## Rules

- A link must reference existing decisions.
- The same source, target, and type combination is unique.
- Links are stored in markdown frontmatter so graph state is reviewable.

## Related Behavior

Links are created by [Link Decision Context](../use-cases/uc.link-decision-context.md).
