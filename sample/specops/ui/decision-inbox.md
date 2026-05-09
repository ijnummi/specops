---
id: ui.decision-inbox
type: ui_view
title: Decision Inbox
status: draft
links:
  use_cases:
    - uc.create-workspace
    - uc.review-stale-decisions
  domain:
    - domain.workspace
    - domain.decision
    - domain.review-reminder
  interfaces:
    - interface.decision-service
    - interface.reminder-scheduler
---

# Decision Inbox

## Purpose

Shows the team's decisions and review reminders in one scanning view.

## Layout

- Header with workspace name and create decision action.
- Reminder strip for decisions due for review.
- Filterable decision list grouped by status.
- Empty state that points to [Capture Decision](../use-cases/uc.capture-decision.md).

## States

- Empty workspace.
- Normal decision list.
- Review reminders due.
- Search or filter with no matches.

## Interactions

Selecting a decision opens [Decision Detail](decision-detail.md). Dismissing a reminder calls the [Reminder Scheduler](../interfaces/reminder-scheduler.md).
