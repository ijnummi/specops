import type {
  Alert,
  AuditEvent,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEvent,
  ResponderAssignment
} from "../domain/incident.js";
import type { MonitoredService, Responder } from "../domain/operations.js";

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

export interface ResponderRecord {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: Responder["role"];
  active: boolean;
}

export interface MonitoredServiceRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  tier: MonitoredService["tier"];
  teamName: string;
  primaryResponderId: string;
  secondaryResponderIds: string[];
  escalationPolicyId: string;
  runbookIds: string[];
}

export interface EscalationPolicyRecord {
  id: string;
  workspaceId: string;
  name: string;
  responderIds: string[];
  repeatAfterMinutes: number;
}

export interface RunbookRecord {
  id: string;
  workspaceId: string;
  serviceId: string;
  title: string;
  summary: string;
}

export interface RunbookStepRecord {
  id: string;
  runbookId: string;
  sequence: number;
  title: string;
  instruction: string;
  minimumSeverity: IncidentSeverity;
}

export interface AlertRecord {
  id: string;
  workspaceId: string;
  serviceId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  source: string;
  status: Alert["status"];
  startedAt: string;
  resolvedAt: string | null;
  labels: Record<string, string>;
}

export interface IncidentRecord {
  id: string;
  workspaceId: string;
  serviceId: string;
  alertId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  runbookId: string | null;
  summary: string | null;
}

export interface AssignmentRecord {
  id: string;
  incidentId: string;
  responderId: string;
  role: ResponderAssignment["role"];
  assignedAt: string;
  releasedAt: string | null;
}

export interface TimelineEventRecord {
  id: string;
  incidentId: string;
  sequence: number;
  kind: IncidentTimelineEvent["kind"];
  message: string;
  actorResponderId: string | null;
  createdAt: string;
}

export interface DecisionRecord {
  id: string;
  incidentId: string;
  summary: string;
  rationale: string;
  authorResponderId: string;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  workspaceId: string;
  actorResponderId: string | null;
  action: string;
  entityType: AuditEvent["entityType"];
  entityId: string;
  occurredAt: string;
  metadata: Record<string, string>;
}

/**
 * Database table names for incident operations records.
 * @specops domain.incident-operations-tables
 */
export const incidentOperationsTables = {
  workspaces: "incident_workspaces",
  responders: "incident_responders",
  monitoredServices: "incident_monitored_services",
  escalationPolicies: "incident_escalation_policies",
  runbooks: "incident_runbooks",
  runbookSteps: "incident_runbook_steps",
  alerts: "incident_alerts",
  incidents: "incidents",
  assignments: "incident_assignments",
  timelineEvents: "incident_timeline_events",
  decisions: "incident_decisions",
  auditEvents: "incident_audit_events"
} as const;
