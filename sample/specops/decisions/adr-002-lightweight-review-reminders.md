---
id: adr.002-lightweight-review-reminders
type: adr
title: Lightweight Review Reminders
status: accepted
links:
  domain:
    - domain.review-reminder
    - domain.decision
  interfaces:
    - interface.reminder-scheduler
  use_cases:
    - uc.review-stale-decisions
---

# Lightweight Review Reminders

## Context

Some decisions become stale when assumptions change, but heavyweight approval workflows slow teams down.

## Decision

Use lightweight reminders that appear in the inbox and can be resolved, dismissed, or rescheduled. Reminders do not block editing or deployment.

## Consequences

- Review prompts stay visible without becoming process overhead.
- Review history is preserved.
- Teams can ignore reminders when they are not useful.
