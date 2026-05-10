---
id: domain.workspace
type: domain_entity
title: Workspace
status: draft
links:
  domain:
    - domain.responder
    - domain.monitored-service
    - domain.escalation-policy
    - domain.runbook
    - domain.alert
    - domain.audit-event
  interfaces:
    - interface.operations-repository
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: Workspace
  start_line: 7
---

# Workspace

## Definition

A workspace is the tenant boundary for incident operations data. Responders, monitored services, escalation policies, runbooks, alerts, incidents, and audit events are all scoped to a workspace before they participate in any response workflow.

## Rules

- Workspace IDs are stable references shared across operations and incident repositories.
- Workspace metadata is read through the operations repository and copied into write-side records such as alerts and audit events.
- Cross-workspace relationships are invalid: services, responders, policies, runbooks, and incidents must remain inside the same workspace.
