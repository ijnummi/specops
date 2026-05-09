# Project Metadata Delete Design

Date: 2026-05-10

## Scope

Add the ability to remove a project from SpecOps Workbench without deleting any repository files, source files, or `specops/` markdown files from disk.

The delete action removes only workbench metadata and derived cache rows stored in PostgreSQL. Existing foreign keys cascade derived rows for the project, including indexed entities, links, validation messages, index runs, and source scan facts.

## API Behavior

Add `DELETE /api/projects/:projectId`.

The endpoint should:

- return `204 No Content` when the project row is deleted
- return `404` when the project does not exist
- avoid filesystem operations entirely

## UI Behavior

Expose a delete action in the project registry card. The action should be visually secondary and require browser confirmation.

The confirmation copy should make the boundary clear:

`Remove this project from SpecOps? This only deletes workbench metadata; repository files and spec files stay on disk.`

On success, invalidate the project list so the deleted project disappears from the registry.

## Testing

API tests should verify that deleting a project removes the project row and leaves files on disk.

Web tests should verify that the project card exposes a delete action and only calls its delete callback after confirmation.
