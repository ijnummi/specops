---
id: adr.003-flexible-spec-graph
type: adr
title: Flexible spec graph
status: accepted
links:
  decisions:
    - adr.001-markdown-is-source-of-truth
  domain:
    - domain.spec-entity
    - domain.spec-link
  interfaces:
    - interface.graph-query-service
---

# Flexible spec graph

## Context

SpecOps documents need to connect use cases, domain concepts, interfaces, decisions, tasks, and future spec types. The graph must be useful early without locking the project into a rigid taxonomy.

## Decision

SpecOps uses typed links between spec entity IDs instead of a fixed relational model for every possible spec relationship. Link groups are declared in frontmatter, and the indexer records them as graph edges with a source and link type.

## Consequences

- New spec types and link meanings can be added without immediate schema changes.
- Query services can expose graph traversal and impact analysis across heterogeneous specs.
- Validation should report broken or malformed links while allowing the document model to evolve.
