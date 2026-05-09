---
id: interface.reminder-scheduler
type: interface
title: Reminder Scheduler
status: draft
links:
  use_cases:
    - uc.review-stale-decisions
  domain:
    - domain.decision
    - domain.review-reminder
  decisions:
    - adr.002-lightweight-review-reminders
  ui:
    - ui.decision-inbox
---

# Reminder Scheduler

## Responsibility

Finds decisions that need review and publishes reminders to the inbox.

## Operations

- `findDueReminders(workspaceId, now)`: return open reminders due at or before `now`.
- `scheduleReview(decisionId, dueAt, reason)`: create or update a reminder.
- `resolveReminder(reminderId, outcome)`: mark a reminder done or dismissed.

## Inputs And Outputs

Inputs include decision IDs, review dates, and reminder outcomes. Outputs are reminder summaries grouped by urgency.

## Errors

- Reject reminders for archived decisions.
- Reject reminder dates before the decision creation date.
