---
id: domain.review-reminder
type: domain_entity
title: Review Reminder
status: draft
links:
  use_cases:
    - uc.review-stale-decisions
  interfaces:
    - interface.reminder-scheduler
  domain:
    - domain.decision
  decisions:
    - adr.002-lightweight-review-reminders
---

# Review Reminder

## Definition

A review reminder asks the team to revisit a decision after time passes or related context changes. It is a lightweight prompt, not a blocking workflow item.

## Key Fields

- `decisionId`: decision that needs review.
- `dueAt`: date when review should appear.
- `reason`: why the reminder exists.
- `status`: `open`, `done`, or `dismissed`.

## Rules

- Reminders do not change decision status by themselves.
- Dismissed reminders keep their reason for audit history.
- Archived decisions do not receive new reminders.

## Related Behavior

Reminders are generated and resolved by [Review Stale Decisions](../use-cases/uc.review-stale-decisions.md).
