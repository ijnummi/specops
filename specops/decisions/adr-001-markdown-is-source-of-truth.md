---
id: adr.001-markdown-is-source-of-truth
type: adr
title: Markdown is the source of truth
status: accepted
links:
  domain:
    - domain.spec-file
    - domain.spec-entity
  use_cases:
    - uc.edit-spec-entity
    - uc.index-spec-files
---

# Markdown is the source of truth

## Context

SpecOps Workbench must support local-first, AI-assisted specification work without requiring a running service or database before useful edits can happen. Specifications need to be reviewable in normal code review, editable with standard tools, and durable across implementation changes.

## Decision

Canonical SpecOps content is stored as markdown files with YAML frontmatter. The markdown files are the authoritative source for spec entities, links, and human-readable intent. Other stores may index, cache, validate, or present that content, but they do not become the system of record.

## Consequences

- Spec changes can be reviewed, branched, merged, and reverted with normal git workflows.
- Indexers and services must tolerate direct file edits and rebuild derived state from the filesystem.
- Markdown structure and frontmatter conventions need enough consistency for automated parsing while staying readable by humans.
