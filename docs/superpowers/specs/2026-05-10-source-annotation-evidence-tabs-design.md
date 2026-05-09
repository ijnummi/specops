# Source Annotation Evidence Tabs Design

Date: 2026-05-10

## Scope

Add canonical spec-to-source links using source-code annotations. The first user-facing feature is source evidence inside the entity detail screen: the spec remains the primary editable artifact, and annotated source files appear as read-only tabs beside it.

This feature extends the source bootstrap and index workflows. Bootstrap may write source annotations while creating initial specs. Normal re-index is read-only for source files and only derives evidence from annotations that already exist.

The v1 scope covers TypeScript and JavaScript files already supported by the repository scanner. It does not add fuzzy matching, drift repair, full source editing, source coverage dashboards, or AI-generated source links.

## Annotation Format

The canonical annotation is a JSDoc tag on a top-level source declaration:

```ts
/**
 * @specops domain.decision
 */
export interface Decision {}
```

The tag value is a SpecOps entity ID. A declaration may have existing JSDoc content; the scanner only needs to recognize `@specops <entity-id>` tags. The bootstrap writer should preserve existing JSDoc text when adding the tag.

For v1, the scanner reads annotations from leading JSDoc attached to top-level declarations that already produce source symbol facts, such as exported interfaces, type aliases, classes, enums, functions, and constants.

## Product Behavior

### Bootstrap

When source bootstrap generates a spec from an exported source symbol, it also inserts a matching `@specops <entity-id>` JSDoc tag before that source declaration.

Bootstrap writes source annotations and markdown specs as one deterministic setup action. It should avoid partial writes:

1. Scan source files and select bootstrap candidates.
2. Plan markdown writes and source annotation edits.
3. Refuse before writing if a candidate declaration already has a different `@specops` entity ID.
4. Write source annotation edits.
5. Write generated markdown specs.
6. Run indexing.
7. Mark bootstrap complete.

If any pre-index write fails, bootstrap should remove files written during the current attempt and avoid marking completion. If source files were edited before a later failure, the API should either restore their original content from the planned edit snapshot or fail before source edits whenever possible.

### Re-index

Normal re-index never writes source files. It reads source annotations, persists derived spec-source links, and emits validation messages for invalid references.

If source contains `@specops domain.decision` and `domain.decision` exists as markdown, the entity gains source evidence. If the annotation points to a missing markdown entity, indexing emits a warning tied to the source file and annotation line.

If a markdown entity has no source annotation, v1 does not warn by default. The exception is a bootstrapped entity whose annotation disappeared and can be identified from existing bootstrap metadata; that case may produce a warning if the metadata is available without fuzzy matching.

## Data Model

Add a derived table for annotation-backed source links named `source_spec_links`.

Each row represents one annotation found during the latest source scan:

- project ID
- source file ID
- source file path
- entity ID from the `@specops` tag
- symbol name
- symbol kind
- symbol line
- annotation line
- content hash of the source file
- created or indexed timestamp

The table is rebuildable cache like `source_files`, `source_symbols`, and `spec_entities`. Re-index replaces links for the current project from the latest source scan.

The table should enforce enough uniqueness to avoid duplicate rows for the same project, file, symbol, and entity ID.

## Scanner Changes

Extend `packages/repo-scanner` to extract source-spec annotations while parsing TypeScript/JavaScript source files.

The parser should:

- inspect leading JSDoc on top-level declarations that produce source symbol facts.
- extract one or more `@specops <entity-id>` tags.
- attach annotation facts to the matching symbol fact, including entity ID and annotation line when available.
- preserve current parse-warning behavior; malformed source should produce warnings instead of aborting the whole scan.

The scanner does not validate that the referenced entity exists. Existence validation belongs to API indexing because it depends on the current spec index.

## API

Add a route for entity-specific source evidence:

```text
GET /api/projects/:projectId/entities/:entityId/source-links
```

The response returns annotation-backed source links for the entity:

- source file ID
- source file path
- entity ID
- symbol name
- symbol kind
- symbol line
- annotation line
- source excerpt around the annotation or declaration

The endpoint may read the current source file from disk for a bounded excerpt, after validating the path stays inside the project repo. If the file is missing or has changed since the scan, the endpoint should still return the persisted link metadata and include a clear excerpt status such as `missing`, `changed`, or `unavailable`.

Indexing should validate source annotations after markdown entities are known:

- valid annotation to existing entity: persist as source evidence.
- annotation to missing entity: persist the link if useful for inspection and emit a warning.
- duplicate annotations on one declaration: allow multiple source links if they reference distinct entity IDs.
- invalid entity ID shape: emit a warning and skip the link.

## Entity Detail UI

The entity detail card becomes a tabbed surface.

The first tab is the editable spec markdown:

- label: `Spec: <title>` or a compact equivalent.
- existing markdown editor, save behavior, task generation, link panels, and validation behavior remain available.

Additional tabs represent annotated source files for the selected entity:

- tab label: source file basename, such as `decision-model.ts`.
- content: read-only excerpt around the `@specops` annotation and source declaration.
- metadata: file path, symbol name, symbol kind, annotation line, and symbol line.
- no full source editing in v1.

When an entity has many source links, show the first few source tabs and collapse overflow behind a compact `+N` menu or tab. The tab row must stay usable on narrow screens.

Empty state:

- If there are no source links, the spec tab remains the only tab.
- The UI may show a small subdued note that no source annotations reference this entity, but it should not interrupt editing.

Error state:

- If source evidence cannot be loaded, keep the spec editor usable and show a small error in the tab area.
- If an excerpt is unavailable, show metadata with an unavailable message instead of failing the whole entity detail panel.

## Source Excerpts

Source tabs show read-only excerpts, not complete files.

The excerpt should include a small window around the annotation and declaration, enough to show:

- the JSDoc `@specops` tag.
- the declaration name.
- nearby type/function signature context.

The API should cap excerpt size to avoid loading or returning large files. Syntax highlighting can be basic in v1; preserving indentation and line numbers matters more.

## Validation

Indexing emits warnings for source annotation problems:

- `source_spec_missing_entity`: annotation references an entity ID not found in markdown.
- `source_spec_invalid_entity_id`: annotation value is empty or invalid.
- `source_spec_unresolved_symbol`: annotation was found but could not be associated with a top-level symbol.

These warnings appear in the existing validation panel and can be filtered by source file path or entity ID where applicable.

## Testing

Scanner tests should cover:

- extracting `@specops` from JSDoc on exported declarations.
- preserving existing import/export/symbol behavior.
- multiple `@specops` tags on one declaration.
- ignoring unrelated comments.
- parse warnings still return scanner results.

Bootstrap tests should cover:

- generated specs receive matching source annotations.
- existing JSDoc is preserved when adding `@specops`.
- conflicting existing annotations cause refusal before partial output.
- successful bootstrap indexes the new source links.

API tests should cover:

- indexing persists source-spec links from annotations.
- missing markdown entity annotations produce validation warnings.
- entity source-link endpoint returns metadata and excerpts.
- source excerpt path safety and missing-file handling.

Web tests should cover:

- entity detail renders the spec tab first.
- source tabs render for annotation-backed links.
- source tabs are read-only.
- no-source-link entities still render the existing editor flow.
- source-link load failures do not block editing.

## Acceptance Criteria

The feature is complete when:

- bootstrap writes `@specops <entity-id>` JSDoc tags for generated source-backed specs.
- normal re-index reads annotations without editing source files.
- annotation-derived links are persisted as rebuildable source scan data.
- missing or invalid source annotations create validation warnings.
- entity detail shows the spec as the first tab and annotated source files as read-only tabs.
- source evidence remains deterministic and based on explicit source annotations, not fuzzy name matching.
