# Backend Sample Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new backend-only `sample-backend/` project with a larger incident operations domain, database-shaped repositories, service use cases, source annotations, tests, and a dense SpecOps markdown graph.

**Architecture:** Keep the existing `sample/` untouched and create a standalone TypeScript sample under `sample-backend/`. Domain types live separately from database records, repositories hide persistence, services orchestrate use cases, and markdown specs link use cases, interfaces, and domain entities.

**Tech Stack:** TypeScript, NodeNext modules, Vitest, SpecOps markdown frontmatter, `@specops` JSDoc annotations.

---

## File Structure

- Create `sample-backend/tsconfig.json`: standalone strict TypeScript config.
- Create `sample-backend/vitest.config.ts`: focused Vitest include for sample tests.
- Create `sample-backend/src/domain/incident.ts`: incident, alert, severity, status, timeline, decision, assignment, and transition helpers.
- Create `sample-backend/src/domain/operations.ts`: workspace, monitored service, ownership, escalation policy, responder, runbook, and runbook step entities.
- Create `sample-backend/src/db/schema.ts`: table-shaped record types and table metadata constants.
- Create `sample-backend/src/db/seed.ts`: realistic seed graph for workspace, services, responders, policies, runbooks, and alerts.
- Create `sample-backend/src/repositories/incident-repository.ts`: incident repository port and in-memory implementation.
- Create `sample-backend/src/repositories/operations-repository.ts`: operations repository port and in-memory implementation.
- Create `sample-backend/src/services/incident-command-service.ts`: open, triage, assign, attach runbook, record decision, and resolve flows.
- Create `sample-backend/src/services/operations-search-service.ts`: search across incidents, services, decisions, and runbook context.
- Create `sample-backend/src/index.ts`: public exports.
- Create `sample-backend/src/__tests__/incident-command-service.test.ts`: cross-entity command-flow tests.
- Create `sample-backend/src/__tests__/operations-search-service.test.ts`: cross-entity search tests.
- Create `sample-backend/specops/project.yaml`: bootstrap metadata.
- Create markdown specs under `sample-backend/specops/domain/`, `sample-backend/specops/interfaces/`, and `sample-backend/specops/use-cases/`.

### Task 1: Scaffold Standalone Sample

**Files:**
- Create: `sample-backend/tsconfig.json`
- Create: `sample-backend/vitest.config.ts`
- Create: `sample-backend/src/index.ts`

- [ ] **Step 1: Add TypeScript config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Add Vitest config**

```ts
export default {
  test: {
    include: ["src/**/*.test.ts"]
  }
};
```

- [ ] **Step 3: Add public export barrel**

```ts
export * from "./domain/incident.js";
export * from "./domain/operations.js";
export * from "./db/schema.js";
export * from "./db/seed.js";
export * from "./repositories/incident-repository.js";
export * from "./repositories/operations-repository.js";
export * from "./services/incident-command-service.js";
export * from "./services/operations-search-service.js";
```

- [ ] **Step 4: Run scaffold typecheck**

Run: `pnpm exec tsc -p sample-backend/tsconfig.json --noEmit`

Expected initially: FAIL because referenced files do not exist yet. This confirms the config is wired.

### Task 2: Add Domain And Database Types

**Files:**
- Create: `sample-backend/src/domain/incident.ts`
- Create: `sample-backend/src/domain/operations.ts`
- Create: `sample-backend/src/db/schema.ts`
- Create: `sample-backend/src/db/seed.ts`

- [ ] **Step 1: Add incident domain entities with annotations**

Define exported annotated symbols for `IncidentSeverity`, `IncidentStatus`, `Alert`, `Incident`, `ResponderAssignment`, `IncidentTimelineEvent`, `IncidentDecision`, `AuditEvent`, `canTransitionIncidentStatus`, and `nextTimelineSequence`.

Required behavior:

```ts
canTransitionIncidentStatus("open", "triaged") === true;
canTransitionIncidentStatus("resolved", "open") === false;
nextTimelineSequence([{ sequence: 1 }, { sequence: 2 }]) === 3;
```

- [ ] **Step 2: Add operations domain entities with annotations**

Define exported annotated symbols for `Workspace`, `Responder`, `ServiceOwnership`, `MonitoredService`, `EscalationPolicy`, `Runbook`, `RunbookStep`, `primaryOwnerForService`, and `stepsForSeverity`.

Required behavior:

```ts
primaryOwnerForService(service).responderId === service.ownership.primaryResponderId;
stepsForSeverity(runbook, "sev1").every((step) => step.minimumSeverity === "sev1" || step.minimumSeverity === "sev2" || step.minimumSeverity === "sev3");
```

- [ ] **Step 3: Add database record types**

Define table-shaped records for workspace, responder, monitored service, escalation policy, runbook, runbook step, alert, incident, assignment, timeline event, decision, and audit event. Export `incidentOperationsTables` with table names so source scanning sees a database layer symbol.

- [ ] **Step 4: Add seed data**

Export `createIncidentOperationsSeed()` returning a full graph with one workspace, two responders, two services, two escalation policies, two runbooks, and at least three alerts. Seed IDs must match the service tests:

```ts
workspace.platform
service.checkout-api
service.billing-worker
policy.checkout-primary
runbook.checkout-latency
alert.checkout-latency
```

### Task 3: Add Repository Ports And In-Memory Implementations

**Files:**
- Create: `sample-backend/src/repositories/incident-repository.ts`
- Create: `sample-backend/src/repositories/operations-repository.ts`

- [ ] **Step 1: Add incident repository**

Export annotated `IncidentRepository` and `InMemoryIncidentRepository`. The repository must support saving alerts, incidents, assignments, timeline events, decisions, and audit events; fetching an alert by ID; fetching an incident by ID; listing incidents; and listing timeline, decisions, and audit events by incident ID.

- [ ] **Step 2: Add operations repository**

Export annotated `OperationsRepository` and `InMemoryOperationsRepository`. The repository must support fetching workspace, service, responder, escalation policy, and runbook records by ID; listing services and runbooks; and loading seed data.

- [ ] **Step 3: Verify repository typecheck**

Run: `pnpm exec tsc -p sample-backend/tsconfig.json --noEmit`

Expected: FAIL only if services/tests are still referenced but not created. Repository files themselves should have no TypeScript errors.

### Task 4: Add Command And Search Services With Tests

**Files:**
- Create: `sample-backend/src/services/incident-command-service.ts`
- Create: `sample-backend/src/services/operations-search-service.ts`
- Create: `sample-backend/src/__tests__/incident-command-service.test.ts`
- Create: `sample-backend/src/__tests__/operations-search-service.test.ts`

- [ ] **Step 1: Write command service tests**

Cover these exact flows:

```ts
openIncidentFromAlert("alert.checkout-latency")
triageIncident(incident.id, "sev1", "Customer checkout latency above SLO")
assignResponders(incident.id)
attachRunbook(incident.id, "runbook.checkout-latency")
recordDecision(incident.id, {
  summary: "Throttle expensive recommendations",
  rationale: "Latency traces show recommendation fan-out saturating checkout dependencies",
  authorResponderId: "responder.ada"
})
resolveIncident(incident.id, "Latency returned to normal")
```

Assert that incident, assignment, timeline, decision, and audit records are all created and connected by incident ID.

- [ ] **Step 2: Implement `IncidentCommandService`**

Export annotated `IncidentCommandService`. Methods:

- `openIncidentFromAlert(alertId: string): Incident`
- `triageIncident(incidentId: string, severity: IncidentSeverity, rationale: string): Incident`
- `assignResponders(incidentId: string): ResponderAssignment[]`
- `attachRunbook(incidentId: string, runbookId: string): IncidentTimelineEvent[]`
- `recordDecision(incidentId: string, input: RecordIncidentDecisionInput): IncidentDecision`
- `resolveIncident(incidentId: string, summary: string): Incident`

- [ ] **Step 3: Write search service tests**

Cover service, decision text, and runbook context search. Assert search results include entity IDs and source categories such as `incident`, `service`, `decision`, and `runbook`.

- [ ] **Step 4: Implement `OperationsSearchService`**

Export annotated `OperationsSearchService` and `OperationsSearchResult`. It should search repository data without external indexes.

- [ ] **Step 5: Run sample tests**

Run: `pnpm exec vitest --config sample-backend/vitest.config.ts run`

Expected: PASS.

### Task 5: Add Dense SpecOps Markdown Graph

**Files:**
- Create: `sample-backend/specops/project.yaml`
- Create: `sample-backend/specops/domain/*.md`
- Create: `sample-backend/specops/interfaces/*.md`
- Create: `sample-backend/specops/use-cases/*.md`

- [ ] **Step 1: Add project metadata**

```yaml
source_bootstrap:
  completed_at: 2026-05-10T00:00:00.000Z
  scanner: handcrafted-typescript
  generated_entity_count: 27
```

- [ ] **Step 2: Add domain specs**

Create specs for:

```text
domain.workspace
domain.responder
domain.service-ownership
domain.monitored-service
domain.escalation-policy
domain.runbook
domain.runbook-step
domain.alert
domain.incident
domain.incident-severity
domain.incident-status
domain.responder-assignment
domain.incident-timeline-event
domain.incident-decision
domain.audit-event
domain.incident-operations-tables
```

Every spec must have non-empty body content and `links` to related entities.

- [ ] **Step 3: Add interface specs**

Create specs for:

```text
interface.incident-repository
interface.operations-repository
interface.incident-command-service
interface.operations-search-service
```

Each interface spec must link to the domain entities it reads or writes and to relevant use cases.

- [ ] **Step 4: Add use-case specs**

Create specs for:

```text
uc.ingest-alert-and-open-incident
uc.triage-incident-severity
uc.assign-responders
uc.attach-runbook
uc.record-incident-decision
uc.resolve-incident
uc.search-operational-history
```

Each use-case spec must link to at least two domain entities and at least one interface.

- [ ] **Step 5: Check markdown parse/index assumptions**

Run: `rg -n "links: \\{\\}|Initial spec generated|TODO|TBD" sample-backend/specops`

Expected: no output.

### Task 6: Final Verification

**Files:**
- Modify only if verification finds issues in `sample-backend/`.

- [ ] **Step 1: Typecheck the new sample**

Run: `pnpm exec tsc -p sample-backend/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 2: Run the new sample tests**

Run: `pnpm exec vitest --config sample-backend/vitest.config.ts run`

Expected: PASS.

- [ ] **Step 3: Confirm original sample was not touched**

Run: `git diff -- sample`

Expected: no diff introduced by this task.

- [ ] **Step 4: Review new-file scope**

Run: `git status --short sample-backend docs/superpowers/plans/2026-05-10-backend-sample-project.md`

Expected: only the new sample tree and this plan are listed.
