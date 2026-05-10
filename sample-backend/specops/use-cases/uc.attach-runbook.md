---
id: uc.attach-runbook
type: use_case
title: Attach Runbook
status: draft
links:
  domain:
    - domain.incident
    - domain.monitored-service
    - domain.runbook
    - domain.runbook-step
    - domain.incident-severity
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
    - interface.incident-command-service
---

# Attach Runbook

## Goal

Attach a service runbook to a mutable incident and expand the applicable severity-filtered steps into incident timeline history.

## Main Flow

1. The command service loads the incident and requested runbook.
2. The service verifies the runbook belongs to the incident's monitored service.
3. The incident is saved with the runbook ID.
4. Applicable steps are selected by incident severity and sorted by sequence.
5. Each step becomes a runbook-attached timeline event with matching audit evidence.

## Postconditions

- The incident points at the attached runbook.
- Responders see actionable runbook steps in the incident timeline.
