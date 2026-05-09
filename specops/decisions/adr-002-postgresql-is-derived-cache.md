---
id: adr.002-postgresql-derived-cache
type: adr
title: PostgreSQL is a derived cache
status: accepted
links:
  decisions:
    - adr.001-markdown-is-source-of-truth
  domain:
    - domain.index-run
    - domain.validation-message
  interfaces:
    - interface.markdown-indexer
---

# PostgreSQL is a derived cache

## Context

SpecOps Workbench benefits from database-backed querying for search, graph traversal, validation history, and API responses. At the same time, the workbench must preserve markdown files as the durable project artifact.

## Decision

PostgreSQL stores indexed projections of markdown specs, including entities, links, index runs, and validation messages. Database rows are derived from files under `specops/` and may be deleted and rebuilt from the markdown source.

## Consequences

- Database schema can optimize read paths without redefining canonical spec semantics.
- Indexing must be repeatable and idempotent so the cache can be rebuilt safely.
- Services that mutate specs must write markdown first or treat markdown writes as the commit point before refreshing derived state.
