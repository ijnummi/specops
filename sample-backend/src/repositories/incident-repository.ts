import type {
  Alert,
  AuditEvent,
  Incident,
  IncidentDecision,
  IncidentTimelineEvent,
  ResponderAssignment
} from "../domain/incident.js";

/**
 * Persistence boundary for incident response records.
 * @specops interface.incident-repository
 */
export interface IncidentRepository {
  saveAlert(alert: Alert): Alert;
  saveIncident(incident: Incident): Incident;
  saveAssignment(assignment: ResponderAssignment): ResponderAssignment;
  saveTimelineEvent(event: IncidentTimelineEvent): IncidentTimelineEvent;
  saveDecision(decision: IncidentDecision): IncidentDecision;
  saveAuditEvent(event: AuditEvent): AuditEvent;
  getAlertById(id: string): Alert | undefined;
  getIncidentById(id: string): Incident | undefined;
  listIncidents(): Incident[];
  listTimelineEventsByIncidentId(incidentId: string): IncidentTimelineEvent[];
  listDecisionsByIncidentId(incidentId: string): IncidentDecision[];
  listAuditEventsByIncidentId(incidentId: string): AuditEvent[];
}

export interface InMemoryIncidentRepositoryInput {
  alerts?: readonly Alert[];
  incidents?: readonly Incident[];
  assignments?: readonly ResponderAssignment[];
  timelineEvents?: readonly IncidentTimelineEvent[];
  decisions?: readonly IncidentDecision[];
  auditEvents?: readonly AuditEvent[];
}

/**
 * In-memory incident repository for sample use cases and tests.
 * @specops interface.incident-repository
 */
export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly alerts = new Map<string, Alert>();
  private readonly incidents = new Map<string, Incident>();
  private readonly assignments = new Map<string, ResponderAssignment>();
  private readonly timelineEvents = new Map<string, IncidentTimelineEvent>();
  private readonly decisions = new Map<string, IncidentDecision>();
  private readonly auditEvents = new Map<string, AuditEvent>();

  constructor(input: InMemoryIncidentRepositoryInput = {}) {
    input.alerts?.forEach((alert) => this.saveAlert(alert));
    input.incidents?.forEach((incident) => this.saveIncident(incident));
    input.assignments?.forEach((assignment) => this.saveAssignment(assignment));
    input.timelineEvents?.forEach((event) => this.saveTimelineEvent(event));
    input.decisions?.forEach((decision) => this.saveDecision(decision));
    input.auditEvents?.forEach((event) => this.saveAuditEvent(event));
  }

  saveAlert(alert: Alert): Alert {
    const stored = cloneAlert(alert);
    this.alerts.set(stored.id, stored);
    return cloneAlert(stored);
  }

  saveIncident(incident: Incident): Incident {
    const stored = cloneIncident(incident);
    this.incidents.set(stored.id, stored);
    return cloneIncident(stored);
  }

  saveAssignment(assignment: ResponderAssignment): ResponderAssignment {
    const stored = { ...assignment };
    this.assignments.set(stored.id, stored);
    return { ...stored };
  }

  saveTimelineEvent(event: IncidentTimelineEvent): IncidentTimelineEvent {
    const stored = { ...event };
    this.timelineEvents.set(stored.id, stored);
    return { ...stored };
  }

  saveDecision(decision: IncidentDecision): IncidentDecision {
    const stored = { ...decision };
    this.decisions.set(stored.id, stored);
    return { ...stored };
  }

  saveAuditEvent(event: AuditEvent): AuditEvent {
    const stored = cloneAuditEvent(event);
    this.auditEvents.set(stored.id, stored);
    return cloneAuditEvent(stored);
  }

  getAlertById(id: string): Alert | undefined {
    const alert = this.alerts.get(id);
    return alert ? cloneAlert(alert) : undefined;
  }

  getIncidentById(id: string): Incident | undefined {
    const incident = this.incidents.get(id);
    return incident ? cloneIncident(incident) : undefined;
  }

  listIncidents(): Incident[] {
    return [...this.incidents.values()].map(cloneIncident);
  }

  listTimelineEventsByIncidentId(incidentId: string): IncidentTimelineEvent[] {
    return [...this.timelineEvents.values()]
      .filter((event) => event.incidentId === incidentId)
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => ({ ...event }));
  }

  listDecisionsByIncidentId(incidentId: string): IncidentDecision[] {
    return [...this.decisions.values()]
      .filter((decision) => decision.incidentId === incidentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((decision) => ({ ...decision }));
  }

  listAuditEventsByIncidentId(incidentId: string): AuditEvent[] {
    const incidentEntityIds = new Set([
      incidentId,
      ...[...this.assignments.values()]
        .filter((assignment) => assignment.incidentId === incidentId)
        .map((assignment) => assignment.id),
      ...[...this.timelineEvents.values()]
        .filter((event) => event.incidentId === incidentId)
        .map((event) => event.id),
      ...[...this.decisions.values()]
        .filter((decision) => decision.incidentId === incidentId)
        .map((decision) => decision.id)
    ]);

    return [...this.auditEvents.values()]
      .filter((event) => incidentEntityIds.has(event.entityId))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map(cloneAuditEvent);
  }
}

function cloneAlert(alert: Alert): Alert {
  return {
    ...alert,
    labels: { ...alert.labels }
  };
}

function cloneIncident(incident: Incident): Incident {
  return { ...incident };
}

function cloneAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    metadata: { ...event.metadata }
  };
}
