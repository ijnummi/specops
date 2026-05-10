---
id: interface.operations-repository
type: interface
title: Operations Repository
status: draft
links:
  domain:
    - domain.workspace
    - domain.responder
    - domain.monitored-service
    - domain.service-ownership
    - domain.escalation-policy
    - domain.runbook
    - domain.runbook-step
    - domain.incident-operations-tables
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.assign-responders
    - uc.attach-runbook
    - uc.record-incident-decision
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/repositories/operations-repository.ts
  source_symbol: OperationsRepository
  start_line: 8
---

# Operations Repository

## Responsibility

The operations repository is the read-model boundary for workspace, service, responder, escalation policy, and runbook data.

## Operations

- Load seed data for the sample backend.
- Fetch workspace, service, responder, escalation policy, and runbook records by ID.
- List services and runbooks for operational history search.

## Errors

Missing operations data blocks workflows that depend on it, such as opening an incident for an unknown service or assigning responders without a policy.
