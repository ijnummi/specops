---
id: interface.search-service
type: interface
title: Search Service
status: draft
links:
  use_cases:
    - uc.link-decision-context
  domain:
    - domain.decision
    - domain.decision-link
  data:
    - data.decision-record
  ui:
    - ui.decision-detail
---

# Search Service

## Responsibility

Indexes decision titles, body text, statuses, and links so users can find related decisions while writing or reviewing.

## Operations

- `indexWorkspace(workspaceId)`: rebuild searchable state from markdown files.
- `searchDecisions(workspaceId, query)`: return matching decisions.
- `relatedDecisions(workspaceId, decisionId)`: return linked and textually similar decisions.

## Inputs And Outputs

Inputs are workspace IDs, queries, and decision IDs. Outputs include decision summaries with matching excerpts.

## Errors

- Return an empty result set for unmatched queries.
- Report stale index state when files changed during indexing.
