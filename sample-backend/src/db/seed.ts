import type { Alert } from "../domain/incident.js";
import type { EscalationPolicy, MonitoredService, Responder, Runbook, Workspace } from "../domain/operations.js";

export interface IncidentOperationsSeed {
  workspace: Workspace;
  responders: Responder[];
  services: MonitoredService[];
  escalationPolicies: EscalationPolicy[];
  runbooks: Runbook[];
  alerts: Alert[];
}

/**
 * Creates a connected incident operations sample graph.
 * @specops domain.incident-operations-seed
 */
export function createIncidentOperationsSeed(): IncidentOperationsSeed {
  const workspace: Workspace = {
    id: "workspace.platform",
    name: "Platform Operations",
    slug: "platform",
    timezone: "UTC"
  };

  const ada: Responder = {
    id: "responder.ada",
    workspaceId: workspace.id,
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "sre",
    active: true
  };

  const grace: Responder = {
    id: "responder.grace",
    workspaceId: workspace.id,
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "engineer",
    active: true
  };

  const responders: Responder[] = [ada, grace];

  const checkoutPolicy: EscalationPolicy = {
    id: "policy.checkout-primary",
    workspaceId: workspace.id,
    name: "Checkout Primary",
    responderIds: [ada.id, grace.id],
    repeatAfterMinutes: 15
  };

  const billingPolicy: EscalationPolicy = {
    id: "policy.billing-primary",
    workspaceId: workspace.id,
    name: "Billing Primary",
    responderIds: [grace.id, ada.id],
    repeatAfterMinutes: 30
  };

  const escalationPolicies: EscalationPolicy[] = [checkoutPolicy, billingPolicy];

  const checkoutRunbookId = "runbook.checkout-latency";
  const billingRunbookId = "runbook.billing-retry-queue";

  const checkoutService: MonitoredService = {
    id: "service.checkout-api",
    workspaceId: workspace.id,
    name: "Checkout API",
    description: "Customer-facing checkout orchestration service.",
    tier: "critical",
    ownership: {
      teamName: "Checkout Platform",
      primaryResponderId: ada.id,
      secondaryResponderIds: [grace.id],
      escalationPolicyId: checkoutPolicy.id
    },
    runbookIds: [checkoutRunbookId]
  };

  const billingService: MonitoredService = {
    id: "service.billing-worker",
    workspaceId: workspace.id,
    name: "Billing Worker",
    description: "Asynchronous billing capture and reconciliation worker.",
    tier: "standard",
    ownership: {
      teamName: "Revenue Platform",
      primaryResponderId: grace.id,
      secondaryResponderIds: [ada.id],
      escalationPolicyId: billingPolicy.id
    },
    runbookIds: [billingRunbookId]
  };

  const services: MonitoredService[] = [checkoutService, billingService];

  const runbooks: Runbook[] = [
    {
      id: checkoutRunbookId,
      workspaceId: workspace.id,
      serviceId: checkoutService.id,
      title: "Checkout Latency Response",
      summary: "Diagnose and mitigate checkout API latency above the customer SLO.",
      steps: [
        {
          id: "runbook-step.checkout-latency.acknowledge",
          runbookId: checkoutRunbookId,
          sequence: 1,
          title: "Acknowledge customer impact",
          instruction: "Confirm checkout p95 latency and post initial customer impact summary.",
          minimumSeverity: "sev3"
        },
        {
          id: "runbook-step.checkout-latency.trace",
          runbookId: checkoutRunbookId,
          sequence: 2,
          title: "Inspect dependency traces",
          instruction: "Compare checkout, recommendations, inventory, and payment trace spans.",
          minimumSeverity: "sev2"
        },
        {
          id: "runbook-step.checkout-latency.throttle",
          runbookId: checkoutRunbookId,
          sequence: 3,
          title: "Throttle expensive recommendations",
          instruction: "Disable high-cost recommendation fan-out if dependency saturation is confirmed.",
          minimumSeverity: "sev1"
        }
      ]
    },
    {
      id: billingRunbookId,
      workspaceId: workspace.id,
      serviceId: billingService.id,
      title: "Billing Retry Queue Drain",
      summary: "Recover delayed billing captures when retry queue depth grows.",
      steps: [
        {
          id: "runbook-step.billing-retry-queue.depth",
          runbookId: billingRunbookId,
          sequence: 1,
          title: "Check retry queue depth",
          instruction: "Review queue age, oldest message timestamp, and downstream processor health.",
          minimumSeverity: "sev3"
        },
        {
          id: "runbook-step.billing-retry-queue.scale",
          runbookId: billingRunbookId,
          sequence: 2,
          title: "Scale billing workers",
          instruction: "Increase worker concurrency after confirming downstream payment limits.",
          minimumSeverity: "sev2"
        }
      ]
    }
  ];

  const alerts: Alert[] = [
    {
      id: "alert.checkout-latency",
      workspaceId: workspace.id,
      serviceId: checkoutService.id,
      title: "Checkout latency above SLO",
      description: "Checkout API p95 latency has exceeded the customer SLO for ten minutes.",
      severity: "sev1",
      source: "synthetics",
      status: "firing",
      startedAt: "2026-05-10T09:00:00.000Z",
      labels: {
        route: "/checkout",
        region: "us-east-1"
      }
    },
    {
      id: "alert.checkout-errors",
      workspaceId: workspace.id,
      serviceId: checkoutService.id,
      title: "Checkout error rate elevated",
      description: "Payment authorization failures are above the warning threshold.",
      severity: "sev2",
      source: "metrics",
      status: "firing",
      startedAt: "2026-05-10T09:05:00.000Z",
      labels: {
        route: "/checkout/payment",
        region: "us-east-1"
      }
    },
    {
      id: "alert.billing-retry-depth",
      workspaceId: workspace.id,
      serviceId: billingService.id,
      title: "Billing retry queue depth high",
      description: "Billing capture retries are accumulating faster than workers can drain them.",
      severity: "sev3",
      source: "queue-monitor",
      status: "firing",
      startedAt: "2026-05-10T09:10:00.000Z",
      labels: {
        queue: "billing-retry",
        region: "us-east-1"
      }
    }
  ];

  return {
    workspace,
    responders,
    services,
    escalationPolicies,
    runbooks,
    alerts
  };
}
