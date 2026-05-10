---
id: domain.incident-status
type: domain_entity
title: Incident Status
status: draft
links:
  domain:
    - domain.incident
    - domain.responder-assignment
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-command-service
    - interface.operations-search-service
  use_cases:
    - uc.triage-incident-severity
    - uc.assign-responders
    - uc.resolve-incident
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: IncidentStatus
  start_line: 11
---

# Incident Status

## Definition

Incident status tracks lifecycle state: open, triaged, investigating, mitigated, or resolved.

## Rules

- Command operations validate status transitions before persisting changes.
- Assignment can move an incident into investigating when the current state allows it.
- Resolved incidents are immutable to later assignment, runbook, and decision commands.
