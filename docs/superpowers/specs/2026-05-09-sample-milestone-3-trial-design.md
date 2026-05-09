# Sample Milestone 3 Trial Design

Date: 2026-05-09

## Scope

Update `sample/` so it remains the Team Decision Log sample project while also acting as a practical Milestone 3 repository scanner trial.

The sample should include both canonical SpecOps markdown under `sample/specops` and compact TypeScript/JavaScript source files under `sample/src`. Indexing `sample/` should demonstrate markdown entity indexing plus source inventory scanning in one project.

## Sample Shape

Keep the existing decision-log product story. Add a small TypeScript skeleton that mirrors the existing spec entities:

- domain types for workspaces, decisions, decision links, and review reminders
- decision service operations for creating, listing, and linking decisions
- search service helpers for indexing and querying decisions
- reminder scheduler helpers for due reminders
- an entrypoint that re-exports the public API
- one test-shaped file so scanner classification includes `test`
- one config file so scanner classification includes `config`

The source files do not need to be a complete runnable application. They should be readable, coherent, and scanner-friendly.

## Scanner Coverage

The sample should exercise Milestone 3 scanner behavior without becoming an artificial parser torture test:

- relative imports
- named imports and exports
- re-exports through `src/index.ts`
- top-level interfaces, type aliases, functions, constants, and classes where useful
- source, test, config, and entrypoint classifications

Avoid generated output, package installation requirements, or external dependencies.

## Testing

Add focused scanner tests that run against `sample/` and assert that it produces meaningful source inventory facts:

- the sample scan includes source, test, config, and entrypoint files
- service files expose imports, exports, and symbols
- heavy/generated directories remain irrelevant to the sample trial

Existing markdown sample tests should continue to pass.

## Acceptance Criteria

- `sample/specops` keeps the existing Team Decision Log specs.
- `sample/src` contains a compact TypeScript skeleton tied to the same product story.
- Running the repository scanner against `sample/` returns non-empty files, imports, exports, and symbols.
- Tests prove the sample is useful as a Milestone 3 trial fixture.
