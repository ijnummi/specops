---
id: interface.incident-command-service
type: interface
title: Incident Command Service
status: draft
links:
  domain:
    - domain.alert
    - domain.incident
    - domain.incident-severity
    - domain.incident-status
    - domain.responder
    - domain.responder-assignment
    - domain.incident-timeline-event
    - domain.incident-decision
    - domain.audit-event
    - domain.runbook
    - domain.runbook-step
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.triage-incident-severity
    - uc.assign-responders
    - uc.attach-runbook
    - uc.record-incident-decision
    - uc.resolve-incident
source_bootstrap:
  source_file: sample-backend/src/services/incident-command-service.ts
  source_symbol: IncidentCommandService
  start_line: 30
---

# Incident Command Service

## Responsibility

The incident command service orchestrates state-changing incident workflows. It coordinates incident repository writes with operations repository reads so commands can validate services, responders, escalation policies, and runbooks.

## Operations

- Open an incident from an alert.
- Triage incident severity.
- Assign responders from service escalation policy.
- Attach applicable runbook steps.
- Record durable decisions.
- Resolve the incident with a summary.

## Errors

The service rejects missing records, invalid status transitions, inactive responders, cross-service runbook attachment, and mutation of resolved incidents.
