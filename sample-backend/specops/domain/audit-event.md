---
id: domain.audit-event
type: domain_entity
title: Audit Event
status: draft
links:
  domain:
    - domain.workspace
    - domain.alert
    - domain.incident
    - domain.responder-assignment
    - domain.incident-timeline-event
    - domain.incident-decision
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
  source_symbol: AuditEvent
  start_line: 94
---

# Audit Event

## Definition

An audit event records incident operations writes. It stores workspace, optional actor, action, entity type, entity ID, occurrence time, and metadata.

## Rules

- Command service writes an audit event for each important mutation.
- Audit metadata includes incident ID so repository queries can recover evidence related to one incident.
- Audit events are write-side records, not user-facing timeline entries.
