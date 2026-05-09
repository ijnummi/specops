---
id: interface.spec-entity-service
type: interface
title: Spec Entity Service
status: draft
links:
  domain:
    - domain.project
    - domain.spec-entity
    - domain.spec-file
    - domain.validation-message
  use_cases:
    - uc.edit-spec-entity
    - uc.generate-agent-task
  interfaces:
    - interface.markdown-indexer
---

# Spec Entity Service

## Responsibility

Reads and writes individual spec entities while preserving markdown as the canonical representation.

## Operations

- `getEntity(projectId, entityId)`: return the indexed entity and source file path.
- `listEntities(projectId, filters)`: return indexed entities for browsing and search.
- `writeEntity(projectId, entityId, markdown)`: safely update the entity's markdown file.
- `validateEntityMarkdown(filePath, markdown)`: parse candidate markdown before saving.

## Inputs And Outputs

Inputs include project IDs, entity IDs, filters, and markdown content. Outputs use [Spec Entity](../domain/spec-entity.md), [Spec File](../domain/spec-file.md), and [Validation Message](../domain/validation-message.md) semantics.

## Errors

- Reject writes that escape the project `specops/` folder.
- Reject markdown missing required frontmatter fields.
- Report concurrent file changes when detected by the caller or persistence layer.
