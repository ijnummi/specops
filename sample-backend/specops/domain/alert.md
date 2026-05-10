---
id: domain.alert
type: domain_entity
title: Alert
status: draft
links:
  domain:
    - domain.workspace
    - domain.monitored-service
    - domain.incident
    - domain.incident-severity
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
  use_cases:
    - uc.ingest-alert-and-open-incident
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: Alert
  start_line: 17
---

# Alert

## Definition

An alert is a monitoring signal that can open an incident. It records the affected workspace and service, initial severity, source system, firing state, timestamps, and labels.

## Rules

- Opening an incident requires an existing alert from the incident repository.
- The alert service ID must resolve to a monitored service in the operations repository.
- Alert ID and service ID are preserved on the incident and audit event for traceability.
