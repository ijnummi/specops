/**
 * Incident impact level, where sev1 is the most severe.
 * @specops domain.incident-severity
 */
export type IncidentSeverity = "sev1" | "sev2" | "sev3";

/**
 * Incident lifecycle state.
 * @specops domain.incident-status
 */
export type IncidentStatus = "open" | "triaged" | "investigating" | "mitigated" | "resolved";

/**
 * Monitoring signal that can open an incident.
 * @specops domain.alert
 */
export interface Alert {
  id: string;
  workspaceId: string;
  serviceId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  source: string;
  status: "firing" | "resolved";
  startedAt: string;
  resolvedAt?: string;
  labels: Record<string, string>;
}

/**
 * Coordinated operational response to a service-impacting event.
 * @specops domain.incident
 */
export interface Incident {
  id: string;
  workspaceId: string;
  serviceId: string;
  alertId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  openedAt: string;
  updatedAt: string;
  resolvedAt?: string;
  runbookId?: string;
  summary?: string;
}

/**
 * Responder participation in an incident.
 * @specops domain.responder-assignment
 */
export interface ResponderAssignment {
  id: string;
  incidentId: string;
  responderId: string;
  role: "commander" | "communications" | "subject-matter-expert";
  assignedAt: string;
  releasedAt?: string;
}

/**
 * Ordered incident history entry.
 * @specops domain.incident-timeline-event
 */
export interface IncidentTimelineEvent {
  id: string;
  incidentId: string;
  sequence: number;
  kind: "opened" | "triaged" | "assigned" | "runbook-attached" | "decision" | "mitigated" | "resolved";
  message: string;
  actorResponderId?: string;
  createdAt: string;
}

/**
 * Durable operational choice made during response.
 * @specops domain.incident-decision
 */
export interface IncidentDecision {
  id: string;
  incidentId: string;
  summary: string;
  rationale: string;
  authorResponderId: string;
  createdAt: string;
}

/**
 * Audit trail entry for incident operations writes.
 * @specops domain.audit-event
 */
export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorResponderId?: string;
  action: string;
  entityType: "alert" | "incident" | "assignment" | "timeline-event" | "decision";
  entityId: string;
  occurredAt: string;
  metadata: Record<string, string>;
}

const allowedStatusTransitions: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  open: ["triaged", "investigating", "mitigated", "resolved"],
  triaged: ["investigating", "mitigated", "resolved"],
  investigating: ["mitigated", "resolved"],
  mitigated: ["resolved"],
  resolved: []
};

/**
 * Checks whether an incident can move between lifecycle states.
 * @specops domain.incident-status
 */
export function canTransitionIncidentStatus(from: IncidentStatus, to: IncidentStatus): boolean {
  return from === to || allowedStatusTransitions[from].includes(to);
}

/**
 * Allocates the next monotonically increasing timeline sequence.
 * @specops domain.incident-timeline-event
 */
export function nextTimelineSequence(events: readonly Pick<IncidentTimelineEvent, "sequence">[]): number {
  return events.reduce((maxSequence, event) => Math.max(maxSequence, event.sequence), 0) + 1;
}
