---
id: domain.project
type: domain_entity
title: Project
status: draft
links:
  interfaces:
    - interface.project-registry-service
  use_cases:
    - uc.create-project
    - uc.initialize-specops-folder
  decisions:
    - adr.001-markdown-is-source-of-truth
---

# Project

## Definition

A project is a local software workspace registered with SpecOps Workbench. It owns a `specops/` folder, a project configuration file, and the set of spec files that describe the work.

## Key Fields

- `id`: stable project identifier used by the workbench.
- `name`: human-readable project name.
- `root_path`: local filesystem path to the workspace root.
- `specops_path`: path to the project's canonical SpecOps folder.
- `specops_version`: document format version.

## Rules

- Each registered project points to one workspace root.
- The project configuration in `specops/project.yaml` is the local canonical description of the SpecOps project.
- Services may cache project metadata, but local files remain the durable artifact.

## Related Behavior

Projects are created by [Create Project](../use-cases/uc.create-project.md) and prepared by [Initialize SpecOps Folder](../use-cases/uc.initialize-specops-folder.md).
