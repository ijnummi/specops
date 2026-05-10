---
id: domain.responder-assignment
type: domain_entity
title: Responder Assignment
status: draft
links:
  domain:
    - domain.incident
    - domain.responder
    - domain.escalation-policy
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
  use_cases:
    - uc.assign-responders
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: ResponderAssignment
  start_line: 54
---

# Responder Assignment

## Definition

A responder assignment records one responder's role on an incident and when that role was assigned or released.

## Rules

- Assignments are created from escalation policy order.
- Each assignment is persisted independently, emits a timeline event, and receives audit evidence.
- Assignment IDs include incident and responder IDs so repository queries can connect them back to an incident.
