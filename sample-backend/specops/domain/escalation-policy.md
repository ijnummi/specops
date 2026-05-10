---
id: domain.escalation-policy
type: domain_entity
title: Escalation Policy
status: draft
links:
  domain:
    - domain.workspace
    - domain.responder
    - domain.service-ownership
    - domain.responder-assignment
  interfaces:
    - interface.operations-repository
    - interface.incident-command-service
  use_cases:
    - uc.assign-responders
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: EscalationPolicy
  start_line: 56
---

# Escalation Policy

## Definition

An escalation policy is the ordered responder list and repeat interval used to staff an incident for a monitored service.

## Rules

- Policy responder order maps to incident roles: first commander, second communications, and later responders as subject-matter experts.
- Policies are read from the operations repository and are not mutated by incident command flows.
- A missing policy prevents responder assignment because the service cannot be staffed safely.
