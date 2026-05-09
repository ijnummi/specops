---
id: interface.markdown-indexer
type: interface
title: Markdown Indexer
status: draft
links:
  domain:
    - domain.project
    - domain.spec-file
    - domain.spec-entity
    - domain.spec-link
    - domain.index-run
    - domain.validation-message
  use_cases:
    - uc.index-spec-files
  decisions:
    - adr.001-markdown-is-source-of-truth
    - adr.002-postgresql-derived-cache
---

# Markdown Indexer

## Responsibility

Discovers markdown spec files, parses frontmatter and bodies, extracts links, validates results, and writes derived projections for query services.

## Operations

- `indexProject(projectId)`: run discovery and indexing for one project.
- `discoverFiles(specopsPath)`: return discoverable markdown files.
- `parseFile(filePath, content)`: parse one file into an entity, links, and messages.
- `getIndexRun(indexRunId)`: return indexing status and diagnostics.

## Inputs And Outputs

Inputs include a project ID or a `specops/` path. Outputs include an [Index Run](../domain/index-run.md), parsed [Spec Entity](../domain/spec-entity.md) records, [Spec Link](../domain/spec-link.md) records, and [Validation Message](../domain/validation-message.md) records.

## Errors

- Preserve parse and validation failures as validation messages.
- Fail the run for unsafe paths, unreadable folders, or persistence errors.
- Keep prior derived data available until a replacement projection is written successfully.
