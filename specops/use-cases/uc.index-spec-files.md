---
id: uc.index-spec-files
type: use_case
title: Index Spec Files
status: draft
links:
  domain:
    - domain.project
    - domain.spec-file
    - domain.spec-entity
    - domain.spec-link
    - domain.index-run
    - domain.validation-message
  interfaces:
    - interface.markdown-indexer
    - interface.graph-query-service
  decisions:
    - adr.001-markdown-source-of-truth
    - adr.002-postgresql-derived-cache
    - adr.003-flexible-spec-graph
---

# Index Spec Files

## Goal

Refresh derived project state from markdown specs so the API can serve entity, validation, search, and graph views.

## Actors

- User
- Markdown Indexer

## Preconditions

- The project has a `specops/` folder.
- The indexer can read the project files.

## Main Flow

1. The user or system starts indexing for a project.
2. The indexer discovers markdown files excluding templates.
3. Each file is parsed into a [Spec Entity](../domain/spec-entity.md), [Spec Link](../domain/spec-link.md) set, and validation messages.
4. The indexer stores derived projections and records an [Index Run](../domain/index-run.md).
5. The workbench displays validation status and indexed results.

## Postconditions

- Indexed entities and links reflect the observed markdown files.
- Validation messages are available for user correction.

## Validation

- Missing required frontmatter fields create error messages.
- Malformed frontmatter creates error messages.
- Broken links create validation messages when link validation is enabled.
