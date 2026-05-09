---
id: uc.initialize-specops-folder
type: use_case
title: Initialize SpecOps Folder
status: draft
links:
  domain:
    - domain.project
    - domain.spec-file
  interfaces:
    - interface.project-registry-service
  decisions:
    - adr.001-markdown-is-source-of-truth
  next:
    - uc.index-spec-files
---

# Initialize SpecOps Folder

## Goal

Create the initial `specops/` folder structure for a project without overwriting user-authored files.

## Actors

- User
- Project Registry Service

## Preconditions

- A [Project](../domain/project.md) exists or is being created.
- The workspace root is writable.

## Main Flow

1. The user asks to initialize SpecOps content for a project.
2. The service creates `specops/project.yaml` when missing.
3. The service creates starter decisions, domain specs, interface specs, use cases, and templates when missing.
4. Existing files are skipped and reported.

## Postconditions

- The project contains canonical [Spec File](../domain/spec-file.md) content for dogfooding.
- The project can proceed to [Index Spec Files](uc.index-spec-files.md).

## Validation

- Never overwrite existing spec files.
- Report created and skipped paths.
