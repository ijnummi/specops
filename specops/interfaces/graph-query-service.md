---
id: interface.graph-query-service
type: interface
title: Graph Query Service
status: draft
links:
  domain:
    - domain.spec-entity
    - domain.spec-link
  use_cases:
    - uc.link-spec-entities
    - uc.generate-agent-task
  decisions:
    - adr.003-flexible-spec-graph
---

# Graph Query Service

## Responsibility

Provides traversal and neighborhood queries over indexed spec entities and typed links.

## Operations

- `getEntityGraph(projectId, entityId)`: return an entity and nearby linked entities.
- `findInboundLinks(projectId, entityId)`: return links pointing at an entity.
- `findOutboundLinks(projectId, entityId)`: return links declared by an entity.
- `queryByLinkType(projectId, linkType)`: return graph edges of a given type.

## Inputs And Outputs

Inputs include project IDs, entity IDs, and optional link type filters. Outputs include [Spec Entity](../domain/spec-entity.md) nodes and [Spec Link](../domain/spec-link.md) edges.

## Errors

- Report missing target entities clearly.
- Return empty graph neighborhoods for valid but unlinked entities.
- Avoid exposing stale graph data while an index run is replacing derived projections.
