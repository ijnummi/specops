---
id: uc.generate-agent-task
type: use_case
title: Generate Agent Task
status: draft
links:
  domain:
    - domain.project
    - domain.spec-entity
    - domain.spec-link
  interfaces:
    - interface.spec-entity-service
    - interface.graph-query-service
  related:
    - uc.index-spec-files
    - uc.link-spec-entities
---

# Generate Agent Task

## Goal

Generate a focused implementation prompt for an AI agent from selected specs and their graph context.

## Actors

- User
- Agent
- Spec Entity Service
- Graph Query Service

## Preconditions

- The project has been indexed.
- The user has selected a target spec entity, use case, or graph neighborhood.

## Main Flow

1. The user selects the implementation target.
2. The graph service gathers directly related specs and decisions.
3. The spec entity service provides canonical markdown for selected entities.
4. The workbench composes an agent task using the selected specs and template.
5. The user reviews or edits the generated task.

## Postconditions

- The user has a human-readable task prompt grounded in canonical specs.
- No canonical spec files are changed unless the user explicitly saves edits.

## Validation

- Identify missing or stale index data before task generation.
- Keep generated tasks traceable to the source spec entity IDs.
