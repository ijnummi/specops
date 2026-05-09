---
id: uc.create-project
type: use_case
title: Create Project
status: draft
links:
  domain:
    - domain.project
  interfaces:
    - interface.project-registry-service
  next:
    - uc.initialize-specops-folder
---

# Create Project

## Goal

Register a local workspace as a SpecOps project so it can be initialized, indexed, browsed, and edited.

## Actors

- User
- Project Registry Service

## Preconditions

- The user has selected a local workspace path.
- The path is readable by the workbench.

## Main Flow

1. The user provides a workspace path and optional project name.
2. The service validates the path and derives a stable project ID.
3. The service records project metadata.
4. The workbench offers to initialize the `specops/` folder if it is missing.

## Postconditions

- A [Project](../domain/project.md) is registered.
- The project can proceed to [Initialize SpecOps Folder](uc.initialize-specops-folder.md).

## Validation

- Reject unsafe or unreadable paths.
- Avoid registering the same workspace twice.
