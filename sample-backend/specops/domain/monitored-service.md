---
id: domain.monitored-service
type: domain_entity
title: Monitored Service
status: draft
links:
  domain:
    - domain.workspace
    - domain.service-ownership
    - domain.alert
    - domain.incident
    - domain.runbook
    - domain.escalation-policy
  interfaces:
    - interface.operations-repository
    - interface.operations-search-service
  use_cases:
    - uc.ingest-alert-and-open-incident
    - uc.attach-runbook
    - uc.search-operational-history
source_bootstrap:
  source_file: sample-backend/src/domain/operations.ts
  source_symbol: MonitoredService
  start_line: 42
---

# Monitored Service

## Definition

A monitored service is a production system that can emit alerts, open incidents, attach runbooks, and appear in operational history search results.

## Rules

- Services belong to a workspace and carry a tier that helps operators understand blast radius.
- Service ownership supplies escalation policy and responder references.
- Runbook IDs on the service are the allowed response playbooks for incidents opened against that service.
