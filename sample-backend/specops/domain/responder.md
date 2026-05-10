---
id: domain.responder
type: domain_entity
title: Responder
status: draft
links:
  domain:
    - domain.workspace
    - domain.service-ownership
    - domain.escalation-policy
    - domain.responder-assignment
    - domain.incident-decision
    - domain.audit-event
  interfaces:
    - interface.operations-repository
    - interface.incident-command-service
  use_cases:
    - uc.assign-responders
    - uc.record-incident-decision
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: Responder
  start_line: 18
---

# Responder

## Definition

A responder is an active human operator who can own services, participate in escalation policies, receive an incident assignment, and author incident decisions.

## Rules

- Only active responders can be assigned to incidents or author decisions.
- A responder belongs to one workspace.
- Responder IDs are referenced by service ownership, escalation policies, assignments, decisions, timeline actors, and audit metadata.
