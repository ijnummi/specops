---
id: ui.decision-detail
type: ui_view
title: Decision Detail
status: draft
links:
  use_cases:
    - uc.capture-decision
    - uc.link-decision-context
  domain:
    - domain.decision
    - domain.decision-link
  interfaces:
    - interface.decision-service
    - interface.search-service
---

# Decision Detail

## Purpose

Lets authors write a decision, preview markdown, and connect the decision to related context.

## Layout

- Metadata header with status and review date.
- Markdown editor for context, decision, and consequences.
- Preview pane.
- Related decisions panel with link type controls.

## States

- Draft decision.
- Accepted read-only decision.
- Superseded decision with replacement link.
- Link target search results.

## Interactions

Saving calls the [Decision Service](../interfaces/decision-service.md). Searching related context calls the [Search Service](../interfaces/search-service.md).
