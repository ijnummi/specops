---
id: domain.decision
type: domain_entity
title: Decision
status: draft
links:
  use_cases:
    - uc.capture-decision
    - uc.link-decision-context
    - uc.review-stale-decisions
  interfaces:
    - interface.decision-service
    - interface.search-service
  data:
    - data.decision-record
  decisions:
    - adr.001-markdown-decision-log
---

# Decision

## Definition

A decision records a choice made by the team, the context that led to it, and the consequences the team accepts. It is intentionally short enough to review but structured enough to index.

## Key Fields

- `id`: stable identifier such as `decision.choose-storage`.
- `title`: concise description of the choice.
- `status`: lifecycle value such as `proposed`, `accepted`, `superseded`, or `archived`.
- `context`: facts and constraints that motivated the decision.
- `decision`: the selected option.
- `consequences`: expected tradeoffs.
- `reviewAfter`: optional date for future review.

## Rules

- Accepted decisions are immutable except for review metadata and supersession links.
- Superseded decisions keep their historical body.
- Each decision belongs to exactly one workspace.

## Related Behavior

Decisions are captured by [Capture Decision](../use-cases/uc.capture-decision.md) and connected by [Link Decision Context](../use-cases/uc.link-decision-context.md).
