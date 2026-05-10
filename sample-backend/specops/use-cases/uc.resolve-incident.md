---
id: uc.resolve-incident
type: use_case
title: Resolve Incident
status: draft
links:
  domain:
    - domain.incident
    - domain.incident-status
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
---

# Resolve Incident

## Goal

Close an incident with a resolution summary after response work has completed.

## Main Flow

1. The command service loads the incident.
2. The service verifies the incident can transition to resolved.
3. The incident is saved with resolved status, resolved timestamp, updated timestamp, and summary.
4. A resolved timeline event is appended.
5. An audit event records the resolution summary.

## Postconditions

- The incident is immutable to later command mutations.
- Search can return the incident using the final summary.
