---
id: interface.operations-search-service
type: interface
title: Operations Search Service
status: draft
links:
  domain:
    - domain.incident
    - domain.incident-status
    - domain.incident-severity
    - domain.monitored-service
    - domain.service-ownership
    - domain.runbook
    - domain.runbook-step
    - domain.incident-decision
  interfaces:
    - interface.incident-repository
    - interface.operations-repository
  use_cases:
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/services/operations-search-service.ts
  source_symbol: OperationsSearchService
  start_line: 23
---

# Operations Search Service

## Responsibility

The operations search service finds operational history without an external index. It searches incidents, monitored services, decisions, and runbooks using repository data.

## Operations

- Return incident hits by ID, title, alert, service, severity, status, or summary.
- Return service hits by ownership and descriptive metadata.
- Return decision hits by summary, rationale, or author.
- Return runbook hits by title, summary, service, step title, step instruction, or severity.

## Errors

An empty query returns no results. Search reads do not mutate incident or operations records.
