---
id: uc.ingest-alert-and-open-incident
type: use_case
title: Ingest Alert And Open Incident
status: draft
links:
  domain:
    - domain.alert
    - domain.incident
    - domain.monitored-service
    - domain.workspace
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
    - interface.incident-command-service
---

# Ingest Alert And Open Incident

## Goal

Create an incident from a firing alert while preserving the alert, workspace, and monitored service references that responders need later.

## Main Flow

1. The command service receives an alert ID.
2. The incident repository loads the alert.
3. The operations repository loads the monitored service named by the alert.
4. The command service creates an open incident with the alert severity.
5. The command service appends an opened timeline event and an audit event.

## Postconditions

- The incident ID is derived from the alert ID when possible.
- The incident links back to the alert and monitored service.
- Timeline and audit evidence can be listed by incident ID.
