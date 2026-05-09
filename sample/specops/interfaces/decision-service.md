---
id: interface.decision-service
type: interface
title: Decision Service
status: draft
links:
  use_cases:
    - uc.create-workspace
    - uc.capture-decision
    - uc.link-decision-context
    - uc.review-stale-decisions
  domain:
    - domain.workspace
    - domain.decision
    - domain.decision-link
  data:
    - data.decision-record
---

# Decision Service

## Responsibility

Owns workspace and decision persistence. It reads and writes markdown decision records, validates link targets, and exposes decision data to the UI.

## Operations

- `createWorkspace(input)`: create a workspace record and decision folder.
- `createDecision(workspaceId, input)`: write a new decision markdown file.
- `updateDecision(workspaceId, decisionId, patch)`: update editable fields.
- `linkDecision(workspaceId, sourceId, targetId, linkType)`: add a typed relationship.
- `listDecisions(workspaceId)`: return decisions for the inbox.

## Inputs And Outputs

Inputs use local workspace IDs, markdown bodies, decision metadata, and link requests. Outputs use [Decision Record](../data/decision-record.md) shapes.

## Errors

- Reject missing workspaces.
- Reject invalid decision IDs.
- Reject links to missing decisions.
