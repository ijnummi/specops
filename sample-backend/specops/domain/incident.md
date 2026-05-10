---
id: domain.incident
type: domain_entity
title: Incident
status: draft
links:
  domain:
    - domain.workspace
    - domain.monitored-service
    - domain.alert
    - domain.incident-severity
    - domain.incident-status
    - domain.responder-assignment
    - domain.incident-timeline-event
    - domain.incident-decision
    - domain.audit-event
    - domain.runbook
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
    - interface.operations-search-service
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.triage-incident-severity
    - uc.assign-responders
    - uc.attach-runbook
    - uc.record-incident-decision
    - uc.resolve-incident
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: Incident
  start_line: 35
---

# Incident

## Definition

An incident is the coordinated operational response to a service-impacting alert. It binds workspace, service, alert, severity, status, optional runbook, final summary, and timestamps.

## Rules

- Incidents are opened from alerts and then mutated through command service use cases.
- Status transitions must follow the lifecycle rules before a command can persist a change.
- Incidents are the parent record for assignments, timeline events, decisions, and audit evidence.
