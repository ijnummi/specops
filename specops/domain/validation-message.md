---
id: domain.validation-message
type: domain_entity
title: Validation Message
status: draft
links:
  domain:
    - domain.spec-file
    - domain.spec-entity
    - domain.index-run
  interfaces:
    - interface.markdown-indexer
  use_cases:
    - uc.index-spec-files
    - uc.edit-spec-entity
---

# Validation Message

## Definition

A validation message describes an issue, warning, or informational finding produced while parsing or validating spec files.

## Key Fields

- `level`: severity, such as `error`, `warning`, or `info`.
- `code`: machine-readable validation code.
- `message`: human-readable explanation.
- `file_path`: relative spec file path.
- `entity_id`: related spec entity ID when known.
- `index_run_id`: index run that produced the message.

## Rules

- Error messages prevent a malformed file from becoming an indexed spec entity.
- Warnings and info messages can coexist with a successfully parsed entity.
- Messages should be specific enough to guide direct markdown edits.

## Related Behavior

Validation messages are produced by [Index Spec Files](../use-cases/uc.index-spec-files.md) and surfaced while users [Edit Spec Entity](../use-cases/uc.edit-spec-entity.md).
