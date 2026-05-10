import type { IncidentSeverity } from "./incident.js";

/**
 * Tenant boundary for incident operations data.
 * @specops domain.workspace
 */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

/**
 * Human operator who can own services or respond to incidents.
 * @specops domain.responder
 */
export interface Responder {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: "sre" | "engineer" | "manager";
  active: boolean;
}

/**
 * Service ownership and escalation wiring.
 * @specops domain.service-ownership
 */
export interface ServiceOwnership {
  teamName: string;
  primaryResponderId: string;
  secondaryResponderIds: string[];
  escalationPolicyId: string;
}

/**
 * Production system monitored by the incident operations workflow.
 * @specops domain.monitored-service
 */
export interface MonitoredService {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  tier: "critical" | "standard";
  ownership: ServiceOwnership;
  runbookIds: string[];
}

/**
 * Ordered responder escalation configuration.
 * @specops domain.escalation-policy
 */
export interface EscalationPolicy {
  id: string;
  workspaceId: string;
  name: string;
  responderIds: string[];
  repeatAfterMinutes: number;
}

/**
 * Response playbook attached to one or more monitored services.
 * @specops domain.runbook
 */
export interface Runbook {
  id: string;
  workspaceId: string;
  serviceId: string;
  title: string;
  summary: string;
  steps: RunbookStep[];
}

/**
 * Sequenced runbook instruction gated by minimum incident severity.
 * @specops domain.runbook-step
 */
export interface RunbookStep {
  id: string;
  runbookId: string;
  sequence: number;
  title: string;
  instruction: string;
  minimumSeverity: IncidentSeverity;
}

export interface ServiceOwner {
  serviceId: string;
  responderId: string;
  escalationPolicyId: string;
}

const severityRank: Readonly<Record<IncidentSeverity, number>> = {
  sev1: 1,
  sev2: 2,
  sev3: 3
};

/**
 * Selects the primary responder declared by a service ownership record.
 * @specops domain.service-ownership
 */
export function primaryOwnerForService(service: MonitoredService): ServiceOwner {
  return {
    serviceId: service.id,
    responderId: service.ownership.primaryResponderId,
    escalationPolicyId: service.ownership.escalationPolicyId
  };
}

/**
 * Returns runbook steps that apply to the current incident severity.
 * @specops domain.runbook-step
 */
export function stepsForSeverity(runbook: Runbook, severity: IncidentSeverity): RunbookStep[] {
  return runbook.steps
    .filter((step) => severityRank[severity] <= severityRank[step.minimumSeverity])
    .sort((left, right) => left.sequence - right.sequence);
}
