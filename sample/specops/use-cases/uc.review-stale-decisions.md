---
id: uc.review-stale-decisions
type: use_case
title: Review Stale Decisions
status: draft
links:
  domain:
    - domain.decision
    - domain.review-reminder
  interfaces:
    - interface.reminder-scheduler
    - interface.decision-service
  ui:
    - ui.decision-inbox
  decisions:
    - adr.002-lightweight-review-reminders
  previous:
    - uc.link-decision-context
---

# Review Stale Decisions

## Goal

Help the team revisit decisions whose review date has passed or whose linked context changed.

## Actors

- Reviewer
- Reminder Scheduler

## Preconditions

- The workspace contains accepted decisions.
- Some decisions have review dates or stale linked dependencies.

## Main Flow

1. The scheduler finds decisions due for review.
2. The inbox groups reminders by urgency.
3. The reviewer opens each stale decision.
4. The reviewer confirms, updates, supersedes, or archives the decision.
5. The scheduler records the review outcome.

## Postconditions

- A [Review Reminder](../domain/review-reminder.md) is resolved or rescheduled.
- Reviewed decisions have current status and review metadata.

## Validation

- Do not create reminders for archived decisions.
- Keep review history even when a reminder is dismissed.
