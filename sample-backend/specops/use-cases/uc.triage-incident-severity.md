---
id: uc.triage-incident-severity
type: use_case
title: Triage Incident Severity
status: draft
links:
  domain:
    - domain.incident
    - domain.incident-severity
    - domain.incident-status
    - domain.incident-timeline-event
    - domain.audit-event
  interfaces:
    - interface.incident-repository
    - interface.incident-command-service
---

# Triage Incident Severity

## Goal

Update an open incident with assessed severity and triage rationale so response urgency reflects current evidence.

## Main Flow

1. The command service loads the incident.
2. The service verifies that the incident can transition to triaged.
3. The incident is saved with the requested severity and triaged status.
4. A timeline event records the rationale.
5. An audit event records severity and rationale metadata.

## Postconditions

- The incident carries the triaged status.
- Later assignment and runbook flows operate against the updated severity.
