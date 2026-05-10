---
id: domain.runbook
type: domain_entity
title: Runbook
status: draft
links:
  domain:
    - domain.workspace
    - domain.monitored-service
    - domain.runbook-step
    - domain.incident
    - domain.incident-severity
    - domain.incident-timeline-event
  interfaces:
    - interface.operations-repository
    - interface.incident-command-service
    - interface.operations-search-service
  use_cases:
    - uc.attach-runbook
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: Runbook
  start_line: 68
---

# Runbook

## Definition

A runbook is a response playbook for a monitored service. It contains ordered steps, a summary for search, and service binding that prevents attaching the wrong playbook to an incident.

## Rules

- A runbook must belong to the same service as the incident before it can be attached.
- Attachment expands applicable steps into incident timeline events.
- Operational history search indexes runbook title, summary, service ID, and step content.
