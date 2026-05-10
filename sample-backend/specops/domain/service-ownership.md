---
id: domain.service-ownership
type: domain_entity
title: Service Ownership
status: draft
links:
  domain:
    - domain.monitored-service
    - domain.responder
    - domain.escalation-policy
    - domain.responder-assignment
  interfaces:
    - interface.operations-repository
    - interface.incident-command-service
  use_cases:
    - uc.assign-responders
    - uc.ingest-alert-and-open-incident
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: ServiceOwnership
  start_line: 31
---

# Service Ownership

## Definition

Service ownership captures the team, primary responder, secondary responders, and escalation policy for a monitored service. It is the wiring the command service uses when an incident needs people assigned.

## Rules

- Each monitored service carries exactly one ownership record.
- The primary responder and secondary responder IDs must refer to responders in the same workspace.
- The escalation policy ID determines the ordered assignment list during responder assignment.
