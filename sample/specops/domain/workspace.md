---
id: domain.workspace
type: domain_entity
title: Workspace
status: draft
links:
  use_cases:
    - uc.create-workspace
    - uc.capture-decision
  interfaces:
    - interface.decision-service
  data:
    - data.decision-record
---

# Workspace

## Definition

A workspace is the local container for a team's decisions. It maps a project root to the decision files, search index, and review settings used by the application.

## Key Fields

- `id`: stable workspace identifier.
- `name`: human-readable team or project name.
- `rootPath`: local filesystem path for the workspace.
- `decisionPath`: relative path where decision markdown files are stored.

## Rules

- A workspace owns many decisions.
- A workspace can be indexed from files without a running service.
- Workspace IDs are unique within a user's local installation.

## Related Behavior

Workspaces are created by [Create Workspace](../use-cases/uc.create-workspace.md) and used by all decision workflows.
