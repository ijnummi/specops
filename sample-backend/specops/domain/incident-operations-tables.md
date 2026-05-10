---
id: domain.incident-operations-tables
type: domain_entity
title: Incident Operations Tables
status: draft
links:
  domain:
    - domain.workspace
    - domain.responder
    - domain.monitored-service
    - domain.escalation-policy
    - domain.runbook
    - domain.runbook-step
    - domain.alert
    - domain.incident
    - domain.responder-assignment
    - domain.incident-timeline-event
    - domain.incident-decision
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
source_bootstrap:
  source_file: sample-backend/src/db/schema.ts
  source_symbol: incidentOperationsTables
  start_line: 137
---

# Incident Operations Tables

## Definition

Incident operations tables define the database-shaped record surface for the sample backend. They name tables for workspace, responder, service, policy, runbook, alert, incident, assignment, timeline, decision, and audit data.

## Rules

- Table constants are a persistence schema map, while domain entities remain the application model.
- Repository implementations hide table-shaped details from command and search services.
- The table list is intentionally broad enough to prove the markdown graph can describe database-backed backend samples.
