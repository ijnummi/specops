---
id: domain.incident-severity
type: domain_entity
title: Incident Severity
status: draft
links:
  domain:
    - domain.alert
    - domain.incident
    - domain.runbook-step
  interfaces:
    - interface.incident-command-service
  use_cases:
    - uc.triage-incident-severity
    - uc.attach-runbook
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/incident.ts
  source_symbol: IncidentSeverity
  start_line: 5
---

# Incident Severity

## Definition

Incident severity expresses impact level, with `sev1` representing the most severe incident and `sev3` the least severe level in this sample domain.

## Rules

- Alerts supply the initial incident severity.
- Triage can update severity when responders have better impact evidence.
- Runbook step filtering uses severity ranking to decide which steps are applicable.
