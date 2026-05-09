# Project Metadata Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users remove a project from SpecOps Workbench while leaving repository files and spec files untouched.

**Architecture:** Add a delete method in the API project service, expose it through `DELETE /api/projects/:projectId`, and add a project-card delete action that confirms before calling the API. PostgreSQL cascades derived metadata; no filesystem APIs are used by delete.

**Tech Stack:** Fastify, Drizzle/PostgreSQL, React, TanStack Query, Vitest.

---

## Tasks

- [ ] Add failing API route tests for delete success, 404 after delete, and files remaining on disk.
- [ ] Implement `projectService.deleteProject` and `DELETE /api/projects/:projectId`.
- [ ] Add failing web tests for `ProjectCard` delete confirmation.
- [ ] Implement `deleteProject` API helper and project card delete action.
- [ ] Wire `ProjectsPage` mutation and query invalidation.
- [ ] Run focused API and web tests plus typechecks.
