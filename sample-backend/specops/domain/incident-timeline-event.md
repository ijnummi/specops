---
id: domain.incident-timeline-event
type: domain_entity
title: Incident Timeline Event
status: draft
links:
  domain:
    - domain.incident
    - domain.responder-assignment
    - domain.incident-decision
    - domain.runbook
    - domain.runbook-step
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.triage-incident-severity
    - uc.assign-responders
    - uc.attach-runbook
    - uc.record-incident-decision
    - uc.resolve-incident
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: IncidentTimelineEvent
  start_line: 67
---

# Incident Timeline Event

## Definition

An incident timeline event is an ordered history entry for an incident. It captures command outcomes such as opened, triaged, assigned, runbook-attached, decision, mitigated, and resolved.

## Rules

- Timeline sequence is monotonically increasing per incident.
- Command methods append timeline events as durable operator-facing history.
- Timeline event IDs are used by audit events when the command writes runbook attachment evidence.
