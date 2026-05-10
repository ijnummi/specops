---
id: domain.runbook-step
type: domain_entity
title: Runbook Step
status: draft
links:
  domain:
    - domain.runbook
    - domain.incident-severity
    - domain.incident-timeline-event
  interfaces:
    - interface.incident-command-service
    - interface.operations-search-service
  use_cases:
    - uc.attach-runbook
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: RunbookStep
  start_line: 81
---

# Runbook Step

## Definition

A runbook step is one ordered instruction inside a runbook. The minimum severity gates whether the step is included when a runbook is attached to an incident.

## Rules

- Steps are sorted by sequence before they become timeline events.
- A severe incident includes steps for that severity and less severe thresholds.
- Step text is searchable so responders can find past operational context by remediation language.
