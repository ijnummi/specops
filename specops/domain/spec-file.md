---
id: domain.spec-file
type: domain_entity
title: Spec File
status: draft
links:
  domain:
    - domain.spec-entity
    - domain.validation-message
  interfaces:
    - interface.markdown-indexer
  use_cases:
    - uc.initialize-specops-folder
    - uc.index-spec-files
  decisions:
    - adr.001-markdown-source-of-truth
---

# Spec File

## Definition

A spec file is a markdown file under the project `specops/` folder that can be discovered and parsed into a spec entity. Template markdown files are intentionally excluded from discovery until instantiated.

## Key Fields

- `path`: POSIX-style path relative to the `specops/` folder.
- `content`: markdown source with YAML frontmatter.
- `modified_at`: filesystem modification timestamp observed during indexing.
- `hash`: optional content digest used to detect changes.

## Rules

- Discoverable spec files end in `.md` and do not end in `.template.md`.
- `project.yaml` configures the project but is not a spec entity.
- Parse failures and missing required fields produce validation messages.

## Related Behavior

Spec files are created during [Initialize SpecOps Folder](../use-cases/uc.initialize-specops-folder.md) and parsed during [Index Spec Files](../use-cases/uc.index-spec-files.md).
