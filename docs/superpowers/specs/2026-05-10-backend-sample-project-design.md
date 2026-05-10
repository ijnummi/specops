# Backend Sample Project Design

## Goal

Create a new backend-only sample project that is larger than the existing `sample/` project and better exercises SpecOps indexing, source annotations, entity links, backlinks, and source evidence.

The existing `sample/` project stays unchanged. The new project lives in `sample-backend/`.

## Scope

The sample models an incident operations backend. It has no UI. It includes domain entities, database-shaped records, repository interfaces, service orchestration, seed data, and focused tests.

The sample is intentionally rich in relationships:

- use cases link to many domain entities and interfaces
- interfaces link to repositories and the domain entities they read or mutate
- domain entities link to related domain entities
- source symbols include `@specops` annotations for source evidence
- services import and actively use several entity types instead of only passing through simple strings

## Architecture

`sample-backend/` contains a standalone TypeScript sample:

- `src/domain/`: incident operations domain types and helpers
- `src/db/`: table-shaped records, schema metadata, and seed data
- `src/repositories/`: repository ports and in-memory database implementations
- `src/services/`: use-case services that coordinate repositories and domain entities
- `src/__tests__/`: focused service-flow tests
- `specops/domain/`: markdown specs for domain entities
- `specops/interfaces/`: markdown specs for services and repositories
- `specops/use-cases/`: markdown specs for detectable backend use cases

## Domain Model

The domain centers on incident response:

- workspace
- service ownership
- monitored service
- escalation policy
- alert
- incident
- incident severity
- incident status
- responder assignment
- runbook
- runbook step
- incident timeline event
- incident decision
- audit event

Relationships are explicit in both code and specs. For example, an incident references an alert, monitored service, severity, status, assignments, timeline events, runbook steps, decisions, and audit events.

## Backend And Database Layers

The database layer exposes table-shaped records and typed repositories. The implementation can be in-memory so the sample remains easy to run, but the boundaries should look like a real backend:

- repositories accept and return persisted record shapes
- services perform orchestration and validation
- domain helper functions keep status/severity transitions explicit
- seed data creates a realistic graph for tests and scanning

## Use Cases

The sample includes clear use-case specs and matching service methods:

- ingest alert and open incident
- triage incident severity
- assign responders through escalation policy
- attach runbook to incident
- record incident decision
- resolve incident with audit trail
- search operational history

Each use case links to the domain entities and interfaces it exercises.

## Testing

Focused Vitest tests should validate flows that cross several entities:

- opening an incident from an alert creates incident, assignment, timeline, and audit records
- attaching a runbook adds runbook-step timeline context
- recording a decision updates the incident timeline and audit trail
- resolving an incident enforces status rules and records an audit event
- searching operational history returns incidents by service, decision text, and runbook context

## Non-Goals

- no frontend
- no HTTP server unless needed for the sample's internal shape
- no external database dependency
- no generated markdown placeholders without useful links and body content
- no changes to the existing `sample/` directory
