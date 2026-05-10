---
id: uc.search-operational-history
type: use_case
title: Search Operational History
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
    - interface.operations-search-service
---

# Search Operational History

## Goal

Find incidents, services, decisions, and runbooks by operational text without requiring an external search index.

## Main Flow

1. The search service normalizes the query.
2. It scans incidents from the incident repository.
3. It scans monitored services and runbooks from the operations repository.
4. It scans decisions by walking incidents and listing decisions per incident.
5. It returns typed hits with source category, entity ID, title, and snippet.

## Postconditions

- Empty queries return no results.
- Results identify whether the hit came from incident, service, decision, or runbook context.
