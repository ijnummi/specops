import {
  canTransitionIncidentStatus,
  nextTimelineSequence,
  type AuditEvent,
  type Incident,
  type IncidentDecision,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentTimelineEvent,
  type ResponderAssignment
} from "../domain/incident.js";
import { stepsForSeverity } from "../domain/operations.js";
import type { IncidentRepository } from "../repositories/incident-repository.js";
import type { OperationsRepository } from "../repositories/operations-repository.js";

/**
 * Input for recording an incident decision.
 * @specops interface.record-incident-decision-input
 */
export interface RecordIncidentDecisionInput {
  summary: string;
  rationale: string;
  authorResponderId: string;
}

/**
 * Coordinates incident command writes across incident and operations repositories.
 * @specops interface.incident-command-service
 */
export class IncidentCommandService {
  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly operationsRepository: OperationsRepository
  ) {}

  openIncidentFromAlert(alertId: string): Incident {
    const alert = this.incidentRepository.getAlertById(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    const service = this.operationsRepository.getServiceById(alert.serviceId);
    if (!service) {
      throw new Error(`Service not found for alert ${alertId}: ${alert.serviceId}`);
    }

    const openedAt = alert.startedAt;
    const incident: Incident = {
      id: this.nextIncidentId(alert.id),
      workspaceId: alert.workspaceId,
      serviceId: service.id,
      alertId: alert.id,
      title: alert.title,
      severity: alert.severity,
      status: "open",
      openedAt,
      updatedAt: openedAt
    };

    const savedIncident = this.incidentRepository.saveIncident(incident);
    const timelineEvent = this.timelineEvent(savedIncident.id, "opened", `${alert.title}: ${alert.description}`, openedAt);
    this.incidentRepository.saveTimelineEvent(timelineEvent);
    this.audit("incident.opened", savedIncident, "incident", savedIncident.id, {
      alertId: alert.id,
      serviceId: service.id
    });

    return savedIncident;
  }

  triageIncident(incidentId: string, severity: IncidentSeverity, rationale: string): Incident {
    const incident = this.requireIncident(incidentId);
    this.requireTransition(incident, "triaged");

    const updatedIncident = this.incidentRepository.saveIncident({
      ...incident,
      severity,
      status: "triaged",
      updatedAt: this.now()
    });

    this.incidentRepository.saveTimelineEvent(
      this.timelineEvent(updatedIncident.id, "triaged", `Triaged ${severity}: ${rationale}`)
    );
    this.audit("incident.triaged", updatedIncident, "incident", updatedIncident.id, {
      severity,
      rationale
    });

    return updatedIncident;
  }

  assignResponders(incidentId: string): ResponderAssignment[] {
    const incident = this.requireIncident(incidentId);
    this.requireMutableIncident(incident);
    if (incident.status === "investigating") {
      return [];
    }

    const service = this.operationsRepository.getServiceById(incident.serviceId);
    if (!service) {
      throw new Error(`Service not found for incident ${incidentId}: ${incident.serviceId}`);
    }

    const policy = this.operationsRepository.getEscalationPolicyById(service.ownership.escalationPolicyId);
    if (!policy) {
      throw new Error(`Escalation policy not found: ${service.ownership.escalationPolicyId}`);
    }

    const assignments = policy.responderIds.map((responderId, index): ResponderAssignment => {
      const responder = this.operationsRepository.getResponderById(responderId);
      if (!responder || !responder.active) {
        throw new Error(`Active responder not found: ${responderId}`);
      }

      return {
        id: `assignment.${incident.id}.${responderId}`,
        incidentId: incident.id,
        responderId,
        role: responderRole(index),
        assignedAt: this.now()
      };
    });

    assignments.forEach((assignment) => {
      const savedAssignment = this.incidentRepository.saveAssignment(assignment);
      const responder = this.operationsRepository.getResponderById(savedAssignment.responderId);
      this.incidentRepository.saveTimelineEvent(
        this.timelineEvent(
          incident.id,
          "assigned",
          `Assigned ${responder?.name ?? savedAssignment.responderId} as ${savedAssignment.role}`,
          savedAssignment.assignedAt,
          savedAssignment.responderId
        )
      );
      this.audit("assignment.created", incident, "assignment", savedAssignment.id, {
        responderId: savedAssignment.responderId,
        role: savedAssignment.role
      });
    });

    if (canTransitionIncidentStatus(incident.status, "investigating")) {
      const investigatingIncident = this.incidentRepository.saveIncident({
        ...incident,
        status: "investigating",
        updatedAt: this.now()
      });
      this.incidentRepository.saveTimelineEvent(
        this.timelineEvent(
          incident.id,
          "assigned",
          `Status changed from ${incident.status} to investigating after responder assignment`
        )
      );
      this.audit("incident.investigating", investigatingIncident, "incident", investigatingIncident.id, {
        fromStatus: incident.status,
        toStatus: "investigating"
      });
    }

    return assignments;
  }

  attachRunbook(incidentId: string, runbookId: string): IncidentTimelineEvent[] {
    const incident = this.requireIncident(incidentId);
    this.requireMutableIncident(incident);
    const runbook = this.operationsRepository.getRunbookById(runbookId);
    if (!runbook) {
      throw new Error(`Runbook not found: ${runbookId}`);
    }

    if (runbook.serviceId !== incident.serviceId) {
      throw new Error(`Runbook ${runbookId} does not belong to incident service ${incident.serviceId}`);
    }

    this.incidentRepository.saveIncident({
      ...incident,
      runbookId,
      updatedAt: this.now()
    });

    const runbookEvents = stepsForSeverity(runbook, incident.severity).map((step) => {
      const event = this.timelineEvent(
        incident.id,
        "runbook-attached",
        `Attached ${runbook.title} step ${step.sequence}: ${step.title} - ${step.instruction}`
      );
      const savedEvent = this.incidentRepository.saveTimelineEvent(event);
      this.audit("runbook.attached", incident, "timeline-event", savedEvent.id, {
        runbookId,
        runbookStepId: step.id
      });
      return savedEvent;
    });

    return runbookEvents;
  }

  recordDecision(incidentId: string, input: RecordIncidentDecisionInput): IncidentDecision {
    const incident = this.requireIncident(incidentId);
    this.requireMutableIncident(incident);
    const author = this.operationsRepository.getResponderById(input.authorResponderId);
    if (!author || !author.active) {
      throw new Error(`Active responder not found: ${input.authorResponderId}`);
    }

    const decision: IncidentDecision = {
      id: `decision.${incident.id}.${this.incidentRepository.listDecisionsByIncidentId(incident.id).length + 1}`,
      incidentId: incident.id,
      summary: input.summary,
      rationale: input.rationale,
      authorResponderId: input.authorResponderId,
      createdAt: this.now()
    };

    const savedDecision = this.incidentRepository.saveDecision(decision);
    this.incidentRepository.saveTimelineEvent(
      this.timelineEvent(incident.id, "decision", `Decision by ${author.name}: ${input.summary}`, decision.createdAt, author.id)
    );
    this.audit("decision.recorded", incident, "decision", savedDecision.id, {
      authorResponderId: input.authorResponderId
    });

    return savedDecision;
  }

  resolveIncident(incidentId: string, summary: string): Incident {
    const incident = this.requireIncident(incidentId);
    this.requireTransition(incident, "resolved");

    const resolvedAt = this.now();
    const resolvedIncident = this.incidentRepository.saveIncident({
      ...incident,
      status: "resolved",
      updatedAt: resolvedAt,
      resolvedAt,
      summary
    });

    this.incidentRepository.saveTimelineEvent(
      this.timelineEvent(resolvedIncident.id, "resolved", `Resolved: ${summary}`, resolvedAt)
    );
    this.audit("incident.resolved", resolvedIncident, "incident", resolvedIncident.id, { summary });

    return resolvedIncident;
  }

  private requireIncident(incidentId: string): Incident {
    const incident = this.incidentRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }
    return incident;
  }

  private requireMutableIncident(incident: Incident): void {
    if (incident.status === "resolved") {
      throw new Error(`Cannot mutate resolved incident: ${incident.id}`);
    }
  }

  private requireTransition(incident: Incident, nextStatus: IncidentStatus): void {
    if (!canTransitionIncidentStatus(incident.status, nextStatus)) {
      throw new Error(`Cannot transition incident ${incident.id} from ${incident.status} to ${nextStatus}`);
    }
  }

  private timelineEvent(
    incidentId: string,
    kind: IncidentTimelineEvent["kind"],
    message: string,
    createdAt = this.now(),
    actorResponderId?: string
  ): IncidentTimelineEvent {
    const sequence = nextTimelineSequence(this.incidentRepository.listTimelineEventsByIncidentId(incidentId));

    return {
      id: `timeline.${incidentId}.${sequence}`,
      incidentId,
      sequence,
      kind,
      message,
      actorResponderId,
      createdAt
    };
  }

  private audit(
    action: string,
    incident: Incident,
    entityType: AuditEvent["entityType"],
    entityId: string,
    metadata: Record<string, string>
  ): AuditEvent {
    return this.incidentRepository.saveAuditEvent({
      id: `audit.${incident.id}.${this.nextAuditSequence(incident.id)}`,
      workspaceId: incident.workspaceId,
      action,
      entityType,
      entityId,
      occurredAt: this.now(),
      metadata: {
        incidentId: incident.id,
        ...metadata
      }
    });
  }

  private nextAuditSequence(incidentId: string): number {
    const auditIdPrefix = `audit.${incidentId}.`;
    return (
      this.incidentRepository
        .listAuditEventsByIncidentId(incidentId)
        .map((event) => event.id)
        .filter((id) => id.startsWith(auditIdPrefix))
        .map((id) => Number.parseInt(id.slice(auditIdPrefix.length), 10))
        .filter((sequence) => Number.isInteger(sequence))
        .reduce((maxSequence, sequence) => Math.max(maxSequence, sequence), 0) + 1
    );
  }

  private nextIncidentId(alertId: string): string {
    const baseId = `incident.${alertId.replace(/^alert\./, "")}`;
    const existingIds = new Set(this.incidentRepository.listIncidents().map((incident) => incident.id));
    if (!existingIds.has(baseId)) {
      return baseId;
    }

    let suffix = 2;
    while (existingIds.has(`${baseId}.${suffix}`)) {
      suffix += 1;
    }
    return `${baseId}.${suffix}`;
  }

  private now(): string {
    return new Date().toISOString();
  }
}

function responderRole(index: number): ResponderAssignment["role"] {
  if (index === 0) {
    return "commander";
  }
  if (index === 1) {
    return "communications";
  }
  return "subject-matter-expert";
}
