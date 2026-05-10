---
id: uc.assign-responders
type: use_case
title: Assign Responders
status: draft
links:
  domain:
    - domain.incident
    - domain.monitored-service
    - domain.service-ownership
    - domain.escalation-policy
    - domain.responder
    - domain.responder-assignment
    - domain.incident-status
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
    - interface.incident-command-service
---

# Assign Responders

## Goal

Staff an incident using the monitored service's escalation policy and record responder roles in incident history.

## Main Flow

1. The command service loads the mutable incident.
2. The operations repository loads the incident's monitored service and escalation policy.
3. Each policy responder is validated as active.
4. Assignments are written with roles based on policy order.
5. Timeline and audit events are written for each assignment.
6. The incident moves to investigating when the lifecycle allows it.

## Postconditions

- Assignment records connect responders to the incident.
- Operators can inspect both timeline history and audit evidence for staffing.
