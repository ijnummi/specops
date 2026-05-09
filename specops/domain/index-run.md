---
id: domain.index-run
type: domain_entity
title: Index Run
status: draft
links:
  domain:
    - domain.project
    - domain.spec-file
    - domain.validation-message
  interfaces:
    - interface.markdown-indexer
  use_cases:
    - uc.index-spec-files
  decisions:
    - adr.002-postgresql-derived-cache
---

# Index Run

## Definition

An index run records one attempt to discover, parse, validate, and persist derived projections for a project's spec files.

## Key Fields

- `id`: unique index run identifier.
- `project_id`: project being indexed.
- `status`: run state, such as `running`, `completed`, or `failed`.
- `started_at`: time indexing began.
- `completed_at`: time indexing ended, if complete.
- `message_count`: number of validation messages produced.

## Rules

- Each run is append-only history for indexing work.
- A completed run reflects the parser and validator results for the files observed during that run.
- Failed runs should preserve enough diagnostics for the user to correct files and rerun indexing.

## Related Behavior

Index runs are created by [Index Spec Files](../use-cases/uc.index-spec-files.md) and exposed by [Markdown Indexer](../interfaces/markdown-indexer.md).
