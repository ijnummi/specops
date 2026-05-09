---
id: interface.project-registry-service
type: interface
title: Project Registry Service
status: draft
links:
  domain:
    - domain.project
  use_cases:
    - uc.create-project
    - uc.initialize-specops-folder
---

# Project Registry Service

## Responsibility

Registers local workspaces as SpecOps projects and resolves project metadata for API and indexing workflows.

## Operations

- `createProject(input)`: validate a local workspace path and create a project record.
- `getProject(projectId)`: return registered project metadata.
- `listProjects()`: return registered projects known to the workbench.
- `resolveSpecopsPath(projectId)`: return the canonical `specops/` folder path for a project.

## Inputs And Outputs

Inputs include local paths, project names, and project IDs. Outputs are project records using [Project](../domain/project.md) semantics.

## Errors

- Reject paths outside allowed local workspaces.
- Report missing or unreadable project roots.
- Report duplicate project IDs or duplicate workspace registrations.
