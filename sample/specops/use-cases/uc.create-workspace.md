---
id: uc.create-workspace
type: use_case
title: Create Workspace
status: draft
links:
  domain:
    - domain.workspace
  interfaces:
    - interface.decision-service
  ui:
    - ui.decision-inbox
  next:
    - uc.capture-decision
---

# Create Workspace

## Goal

Create a team workspace that owns decisions, review reminders, and searchable context.

## Actors

- Team lead
- Decision Service

## Preconditions

- The user has a local project folder.
- The project folder is writable.

## Main Flow

1. The team lead enters a workspace name and root path.
2. The service validates that the root path is readable and writable.
3. The service creates a workspace record.
4. The service initializes empty decision collections.
5. The UI opens the workspace inbox.

## Postconditions

- A [Workspace](../domain/workspace.md) exists.
- The workspace can accept new decisions through [Capture Decision](uc.capture-decision.md).

## Validation

- Reject duplicate workspace slugs.
- Reject paths that cannot store decision files.
