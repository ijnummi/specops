---
id: domain.spec-link
type: domain_entity
title: Spec Link
status: draft
links:
  domain:
    - domain.spec-entity
  interfaces:
    - interface.graph-query-service
    - interface.markdown-indexer
  use_cases:
    - uc.link-spec-entities
    - uc.index-spec-files
  decisions:
    - adr.003-flexible-spec-graph
---

# Spec Link

## Definition

A spec link is a typed edge from one spec entity to another. Links make the spec graph traversable for impact analysis, navigation, task generation, and validation.

## Key Fields

- `from_entity_id`: source spec entity ID.
- `to_entity_id`: target spec entity ID.
- `link_type`: relationship name from the frontmatter link group.
- `source`: location where the link was declared.

## Rules

- Links are declared in a spec entity's frontmatter under `links`.
- A link target should resolve to another indexed spec entity.
- Broken links produce validation messages rather than silently disappearing.

## Related Behavior

Links are edited in [Link Spec Entities](../use-cases/uc.link-spec-entities.md) and queried through [Graph Query Service](../interfaces/graph-query-service.md).
