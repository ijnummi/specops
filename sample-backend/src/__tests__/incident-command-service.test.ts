import { describe, expect, it } from "vitest";

import { createIncidentOperationsSeed } from "../db/seed.js";
import { InMemoryIncidentRepository } from "../repositories/incident-repository.js";
import { InMemoryOperationsRepository } from "../repositories/operations-repository.js";
import { IncidentCommandService } from "../services/incident-command-service.js";

describe("IncidentCommandService", () => {
  it("coordinates the full checkout latency incident command flow", () => {
    const seed = createIncidentOperationsSeed();
    const incidentRepository = new InMemoryIncidentRepository({ alerts: seed.alerts });
    const operationsRepository = new InMemoryOperationsRepository(seed);
    const service = new IncidentCommandService(incidentRepository, operationsRepository);

    const incident = service.openIncidentFromAlert("alert.checkout-latency");
    const triagedIncident = service.triageIncident(
      incident.id,
      "sev1",
      "Customer checkout latency above SLO"
    );
    const assignments = service.assignResponders(incident.id);
    const runbookEvents = service.attachRunbook(incident.id, "runbook.checkout-latency");
    const decision = service.recordDecision(incident.id, {
      summary: "Throttle expensive recommendations",
      rationale: "Latency traces show recommendation fan-out saturating checkout dependencies",
      authorResponderId: "responder.ada"
    });
    const resolvedIncident = service.resolveIncident(incident.id, "Latency returned to normal");

    expect(incident).toMatchObject({
      alertId: "alert.checkout-latency",
      serviceId: "service.checkout-api",
      status: "open"
    });
    expect(triagedIncident).toMatchObject({
      id: incident.id,
      severity: "sev1",
      status: "triaged"
    });
    expect(resolvedIncident).toMatchObject({
      id: incident.id,
      runbookId: "runbook.checkout-latency",
      status: "resolved",
      summary: "Latency returned to normal"
    });

    expect(assignments).toHaveLength(2);
    expect(assignments.map((assignment) => assignment.incidentId)).toEqual([incident.id, incident.id]);
    expect(assignments.map((assignment) => assignment.responderId)).toEqual(["responder.ada", "responder.grace"]);
    expect(assignments.map((assignment) => assignment.role)).toEqual(["commander", "communications"]);

    expect(runbookEvents).toHaveLength(3);
    expect(runbookEvents.every((event) => event.incidentId === incident.id)).toBe(true);
    expect(runbookEvents.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Acknowledge customer impact"),
        expect.stringContaining("Inspect dependency traces"),
        expect.stringContaining("Throttle expensive recommendations")
      ])
    );

    expect(decision).toMatchObject({
      incidentId: incident.id,
      summary: "Throttle expensive recommendations",
      rationale: "Latency traces show recommendation fan-out saturating checkout dependencies",
      authorResponderId: "responder.ada"
    });

    const persistedIncident = incidentRepository.getIncidentById(incident.id);
    const timeline = incidentRepository.listTimelineEventsByIncidentId(incident.id);
    const decisions = incidentRepository.listDecisionsByIncidentId(incident.id);
    const auditEvents = incidentRepository.listAuditEventsByIncidentId(incident.id);

    expect(persistedIncident).toEqual(resolvedIncident);
    expect(timeline.map((event) => event.incidentId)).toEqual(
      Array.from({ length: timeline.length }, () => incident.id)
    );
    expect(timeline.map((event) => [event.sequence, event.kind, event.message])).toEqual([
      [
        1,
        "opened",
        "Checkout latency above SLO: Checkout API p95 latency has exceeded the customer SLO for ten minutes."
      ],
      [2, "triaged", "Triaged sev1: Customer checkout latency above SLO"],
      [3, "assigned", "Assigned Ada Lovelace as commander"],
      [4, "assigned", "Assigned Grace Hopper as communications"],
      [5, "assigned", "Status changed from triaged to investigating after responder assignment"],
      [
        6,
        "runbook-attached",
        "Attached Checkout Latency Response step 1: Acknowledge customer impact - Confirm checkout p95 latency and post initial customer impact summary."
      ],
      [
        7,
        "runbook-attached",
        "Attached Checkout Latency Response step 2: Inspect dependency traces - Compare checkout, recommendations, inventory, and payment trace spans."
      ],
      [
        8,
        "runbook-attached",
        "Attached Checkout Latency Response step 3: Throttle expensive recommendations - Disable high-cost recommendation fan-out if dependency saturation is confirmed."
      ],
      [9, "decision", "Decision by Ada Lovelace: Throttle expensive recommendations"],
      [10, "resolved", "Resolved: Latency returned to normal"]
    ]);
    expect(timeline.filter((event) => event.kind === "runbook-attached")).toHaveLength(3);
    expect(decisions).toEqual([decision]);
    expect(auditEvents.map((event) => [event.id, event.action, event.entityType, event.entityId])).toEqual([
      ["audit.incident.checkout-latency.1", "incident.opened", "incident", incident.id],
      ["audit.incident.checkout-latency.2", "incident.triaged", "incident", incident.id],
      [
        "audit.incident.checkout-latency.3",
        "assignment.created",
        "assignment",
        `assignment.${incident.id}.responder.ada`
      ],
      [
        "audit.incident.checkout-latency.4",
        "assignment.created",
        "assignment",
        `assignment.${incident.id}.responder.grace`
      ],
      ["audit.incident.checkout-latency.5", "incident.investigating", "incident", incident.id],
      ["audit.incident.checkout-latency.6", "runbook.attached", "timeline-event", `timeline.${incident.id}.6`],
      ["audit.incident.checkout-latency.7", "runbook.attached", "timeline-event", `timeline.${incident.id}.7`],
      ["audit.incident.checkout-latency.8", "runbook.attached", "timeline-event", `timeline.${incident.id}.8`],
      ["audit.incident.checkout-latency.9", "decision.recorded", "decision", decision.id],
      ["audit.incident.checkout-latency.10", "incident.resolved", "incident", incident.id]
    ]);
    expect(auditEvents.every((event) => event.metadata.incidentId === incident.id)).toBe(true);
  });

  it("does not overwrite audit events when a new command service instance uses an existing repository", () => {
    const seed = createIncidentOperationsSeed();
    const incidentRepository = new InMemoryIncidentRepository({ alerts: seed.alerts });
    const operationsRepository = new InMemoryOperationsRepository(seed);
    const firstService = new IncidentCommandService(incidentRepository, operationsRepository);

    const incident = firstService.openIncidentFromAlert("alert.checkout-latency");
    const secondService = new IncidentCommandService(incidentRepository, operationsRepository);
    secondService.triageIncident(incident.id, "sev1", "Customer checkout latency above SLO");

    const auditEvents = incidentRepository.listAuditEventsByIncidentId(incident.id);
    expect(auditEvents.map((event) => event.id)).toEqual([
      "audit.incident.checkout-latency.1",
      "audit.incident.checkout-latency.2"
    ]);
    expect(auditEvents.map((event) => event.action)).toEqual(["incident.opened", "incident.triaged"]);
  });

  it("rejects opening an incident from a resolved alert", () => {
    const seed = createIncidentOperationsSeed();
    const incidentRepository = new InMemoryIncidentRepository({ alerts: seed.alerts });
    const operationsRepository = new InMemoryOperationsRepository(seed);
    const service = new IncidentCommandService(incidentRepository, operationsRepository);
    const alert = incidentRepository.getAlertById("alert.checkout-latency");

    if (!alert) {
      throw new Error("Expected checkout latency alert in seed data.");
    }

    incidentRepository.saveAlert({
      ...alert,
      status: "resolved",
      resolvedAt: "2026-05-10T11:15:00.000Z"
    });

    expect(() => service.openIncidentFromAlert("alert.checkout-latency")).toThrow(
      "Cannot open incident from non-firing alert: alert.checkout-latency"
    );
    expect(incidentRepository.listIncidents()).toEqual([]);
  });

  it("does not duplicate assignment or status history when responders are already assigned", () => {
    const seed = createIncidentOperationsSeed();
    const incidentRepository = new InMemoryIncidentRepository({ alerts: seed.alerts });
    const operationsRepository = new InMemoryOperationsRepository(seed);
    const service = new IncidentCommandService(incidentRepository, operationsRepository);

    const incident = service.openIncidentFromAlert("alert.checkout-latency");
    service.triageIncident(incident.id, "sev1", "Customer checkout latency above SLO");
    const firstAssignments = service.assignResponders(incident.id);
    const timelineAfterFirstAssignment = incidentRepository.listTimelineEventsByIncidentId(incident.id);
    const auditAfterFirstAssignment = incidentRepository.listAuditEventsByIncidentId(incident.id);

    const secondAssignments = service.assignResponders(incident.id);

    expect(firstAssignments).toHaveLength(2);
    expect(secondAssignments).toEqual([]);
    expect(incidentRepository.getIncidentById(incident.id)?.status).toBe("investigating");
    expect(incidentRepository.listTimelineEventsByIncidentId(incident.id)).toEqual(timelineAfterFirstAssignment);
    expect(incidentRepository.listAuditEventsByIncidentId(incident.id)).toEqual(auditAfterFirstAssignment);
    expect(
      incidentRepository
        .listTimelineEventsByIncidentId(incident.id)
        .filter((event) => event.message.includes("Status changed"))
    ).toHaveLength(1);
    expect(
      incidentRepository
        .listAuditEventsByIncidentId(incident.id)
        .filter((event) => event.action === "incident.investigating")
    ).toHaveLength(1);
  });

  it("rejects resolved incident mutations", () => {
    const seed = createIncidentOperationsSeed();
    const incidentRepository = new InMemoryIncidentRepository({ alerts: seed.alerts });
    const operationsRepository = new InMemoryOperationsRepository(seed);
    const service = new IncidentCommandService(incidentRepository, operationsRepository);

    const incident = service.openIncidentFromAlert("alert.checkout-latency");
    service.triageIncident(incident.id, "sev1", "Customer checkout latency above SLO");
    service.resolveIncident(incident.id, "Latency returned to normal");

    expect(() => service.assignResponders(incident.id)).toThrow(
      `Cannot mutate resolved incident: ${incident.id}`
    );
    expect(() => service.attachRunbook(incident.id, "runbook.checkout-latency")).toThrow(
      `Cannot mutate resolved incident: ${incident.id}`
    );
    expect(() =>
      service.recordDecision(incident.id, {
        summary: "Throttle expensive recommendations",
        rationale: "Latency traces show recommendation fan-out saturating checkout dependencies",
        authorResponderId: "responder.ada"
      })
    ).toThrow(`Cannot mutate resolved incident: ${incident.id}`);

    expect(incidentRepository.listTimelineEventsByIncidentId(incident.id).map((event) => event.kind)).toEqual([
      "opened",
      "triaged",
      "resolved"
    ]);
    expect(incidentRepository.listDecisionsByIncidentId(incident.id)).toEqual([]);
    expect(incidentRepository.listAuditEventsByIncidentId(incident.id).map((event) => event.action)).toEqual([
      "incident.opened",
      "incident.triaged",
      "incident.resolved"
    ]);
  });
});
