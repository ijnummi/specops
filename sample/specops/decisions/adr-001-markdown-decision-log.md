---
id: adr.001-markdown-decision-log
type: adr
title: Markdown Decision Log
status: accepted
links:
  domain:
    - domain.decision
    - domain.decision-link
  data:
    - data.decision-record
  use_cases:
    - uc.capture-decision
---

# Markdown Decision Log

## Context

The team wants decisions to survive tool changes, appear in code review, and remain editable with normal local tools.

## Decision

Store decisions as markdown files with YAML frontmatter. The markdown body is the canonical human explanation. Frontmatter carries IDs, status, review dates, and typed links.

## Consequences

- Decisions can be reviewed and merged through git.
- Indexes and UI state are derived from files.
- Automated tools must preserve human-readable markdown.
