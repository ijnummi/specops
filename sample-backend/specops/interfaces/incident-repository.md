---
id: interface.incident-repository
type: interface
title: Incident Repository
status: draft
links:
  domain:
    - domain.alert
    - domain.incident
    - domain.responder-assignment
    - domain.incident-timeline-event
    - domain.incident-decision
    - domain.audit-event
    - domain.incident-operations-tables
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.triage-incident-severity
    - uc.assign-responders
    - uc.attach-runbook
    - uc.record-incident-decision
    - uc.resolve-incident
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/repositories/incident-repository.ts
  source_symbol: IncidentRepository
  start_line: 14
---

# Incident Repository

## Responsibility

The incident repository is the persistence boundary for alert and incident response records. It stores alerts, incidents, responder assignments, timeline events, decisions, and audit events.

## Operations

- Save write-side records created by the command service.
- Fetch an alert or incident by ID.
- List incidents, timeline events, decisions, and audit events for command and search workflows.

## Errors

Repository reads may return no record. Command services turn those missing records into domain-specific errors when a workflow requires the record.
