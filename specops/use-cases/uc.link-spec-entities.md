---
id: uc.link-spec-entities
type: use_case
title: Link Spec Entities
status: draft
links:
  domain:
    - domain.spec-entity
    - domain.spec-link
  interfaces:
    - interface.spec-entity-service
    - interface.graph-query-service
  decisions:
    - adr.003-flexible-spec-graph
  related:
    - uc.edit-spec-entity
    - uc.index-spec-files
---

# Link Spec Entities

## Goal

Create or update typed relationships between spec entities so the graph reflects intent, dependencies, and implementation context.

## Actors

- User
- Agent
- Spec Entity Service
- Graph Query Service

## Preconditions

- The source entity exists.
- The target entity ID is known or discoverable.

## Main Flow

1. The caller chooses a source entity, link type, and target entity.
2. The graph service checks current inbound and outbound links for context.
3. The spec entity service updates the source entity frontmatter.
4. The project is reindexed.
5. The graph service returns the updated neighborhood.

## Postconditions

- A [Spec Link](../domain/spec-link.md) connects the source and target entities.
- Graph queries expose the new relationship.

## Validation

- Warn when the target ID does not resolve to an indexed entity.
- Preserve existing link groups and unrelated frontmatter.
