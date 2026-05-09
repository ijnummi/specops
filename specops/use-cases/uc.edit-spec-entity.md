---
id: uc.edit-spec-entity
type: use_case
title: Edit Spec Entity
status: draft
links:
  domain:
    - domain.spec-entity
    - domain.spec-file
    - domain.validation-message
  interfaces:
    - interface.spec-entity-service
    - interface.markdown-indexer
  decisions:
    - adr.001-markdown-is-source-of-truth
  related:
    - uc.index-spec-files
---

# Edit Spec Entity

## Goal

Allow a user or agent to update a spec entity while preserving valid markdown frontmatter and body content.

## Actors

- User
- Agent
- Spec Entity Service

## Preconditions

- The target entity exists or the caller has chosen a valid new file path.
- The project `specops/` folder is writable.

## Main Flow

1. The caller opens a spec entity for editing.
2. The service returns the markdown source and indexed metadata.
3. The caller submits updated markdown.
4. The service validates required frontmatter and path safety.
5. The service writes the markdown file.
6. The project is reindexed or marked as needing reindex.

## Postconditions

- The [Spec File](../domain/spec-file.md) contains the updated canonical markdown.
- Validation messages reflect the latest parse result after indexing.

## Validation

- Reject missing `id`, `type`, `title`, or `status` fields.
- Reject writes outside the project `specops/` folder.
