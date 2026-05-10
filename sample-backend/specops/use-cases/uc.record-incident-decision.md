---
id: uc.record-incident-decision
type: use_case
title: Record Incident Decision
status: draft
links:
  domain:
    - domain.incident
    - domain.responder
    - domain.incident-decision
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
    - interface.incident-command-service
---

# Record Incident Decision

## Goal

Persist an operational decision made during incident response with summary, rationale, author, timeline history, and audit evidence.

## Main Flow

1. The command service loads the mutable incident.
2. The operations repository verifies the author responder exists and is active.
3. The incident repository saves the decision.
4. A timeline event records the decision summary and author.
5. An audit event records the decision entity and author responder ID.

## Postconditions

- Decision records can be listed by incident ID.
- Search can later find the decision by summary or rationale text.
