---
id: domain.spec-entity
type: domain_entity
title: Spec Entity
status: draft
links:
  domain:
    - domain.spec-file
    - domain.spec-link
  interfaces:
    - interface.spec-entity-service
    - interface.graph-query-service
  use_cases:
    - uc.edit-spec-entity
    - uc.link-spec-entities
---

# Spec Entity

## Definition

A spec entity is one indexed markdown document with required frontmatter and a human-readable body. It is the common unit for domain entities, interfaces, use cases, ADRs, templates after instantiation, and future spec types.

## Key Fields

- `id`: stable graph identifier from frontmatter.
- `type`: entity kind, such as `domain_entity`, `interface`, `use_case`, or `adr`.
- `title`: display name.
- `status`: lifecycle state, such as `draft` or `accepted`.
- `body_markdown`: canonical markdown body.
- `body_text`: normalized text used for search.

## Rules

- `id`, `type`, `title`, and `status` are required frontmatter fields.
- Entity IDs must be stable enough for links and generated tasks.
- The markdown file is canonical; indexed entity records are derived.

## Related Behavior

Spec entities are created and updated through [Edit Spec Entity](../use-cases/uc.edit-spec-entity.md), indexed by [Index Spec Files](../use-cases/uc.index-spec-files.md), and connected by [Link Spec Entities](../use-cases/uc.link-spec-entities.md).
