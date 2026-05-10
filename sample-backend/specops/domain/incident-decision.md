---
id: domain.incident-decision
type: domain_entity
title: Incident Decision
status: draft
links:
  domain:
    - domain.incident
    - domain.responder
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
    - interface.operations-search-service
  use_cases:
    - uc.record-incident-decision
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: IncidentDecision
  start_line: 81
---

# Incident Decision

## Definition

An incident decision is a durable operational choice made during response. It captures summary, rationale, author responder, creation time, and incident relationship.

## Rules

- The author must be an active responder.
- Recording a decision also appends a timeline event and audit event.
- Search includes decision summaries and rationales so operators can recover past reasoning.
