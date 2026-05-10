import { createIncidentOperationsSeed, type IncidentOperationsSeed } from "../db/seed.js";
import type { EscalationPolicy, MonitoredService, Responder, Runbook, Workspace } from "../domain/operations.js";

/**
 * Read model boundary for workspace, service, responder, policy, and runbook data.
 * @specops interface.operations-repository
 */
export interface OperationsRepository {
  loadSeedData(seed: IncidentOperationsSeed): void;
  getWorkspaceById(id: string): Workspace | undefined;
  getServiceById(id: string): MonitoredService | undefined;
  getResponderById(id: string): Responder | undefined;
  getEscalationPolicyById(id: string): EscalationPolicy | undefined;
  getRunbookById(id: string): Runbook | undefined;
  listServices(): MonitoredService[];
  listRunbooks(): Runbook[];
}

export type InMemoryOperationsRepositoryInput = IncidentOperationsSeed;

/**
 * Seed-backed in-memory operations repository for sample use cases and tests.
 * @specops interface.in-memory-operations-repository
 */
export class InMemoryOperationsRepository implements OperationsRepository {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly services = new Map<string, MonitoredService>();
  private readonly responders = new Map<string, Responder>();
  private readonly escalationPolicies = new Map<string, EscalationPolicy>();
  private readonly runbooks = new Map<string, Runbook>();

  constructor(input: InMemoryOperationsRepositoryInput = createIncidentOperationsSeed()) {
    this.loadSeedData(input);
  }

  loadSeedData(seed: IncidentOperationsSeed): void {
    this.workspaces.clear();
    this.services.clear();
    this.responders.clear();
    this.escalationPolicies.clear();
    this.runbooks.clear();

    this.workspaces.set(seed.workspace.id, cloneWorkspace(seed.workspace));
    seed.services.forEach((service) => this.services.set(service.id, cloneService(service)));
    seed.responders.forEach((responder) => this.responders.set(responder.id, cloneResponder(responder)));
    seed.escalationPolicies.forEach((policy) => this.escalationPolicies.set(policy.id, cloneEscalationPolicy(policy)));
    seed.runbooks.forEach((runbook) => this.runbooks.set(runbook.id, cloneRunbook(runbook)));
  }

  getWorkspaceById(id: string): Workspace | undefined {
    const workspace = this.workspaces.get(id);
    return workspace ? cloneWorkspace(workspace) : undefined;
  }

  getServiceById(id: string): MonitoredService | undefined {
    const service = this.services.get(id);
    return service ? cloneService(service) : undefined;
  }

  getResponderById(id: string): Responder | undefined {
    const responder = this.responders.get(id);
    return responder ? cloneResponder(responder) : undefined;
  }

  getEscalationPolicyById(id: string): EscalationPolicy | undefined {
    const policy = this.escalationPolicies.get(id);
    return policy ? cloneEscalationPolicy(policy) : undefined;
  }

  getRunbookById(id: string): Runbook | undefined {
    const runbook = this.runbooks.get(id);
    return runbook ? cloneRunbook(runbook) : undefined;
  }

  listServices(): MonitoredService[] {
    return [...this.services.values()].map(cloneService);
  }

  listRunbooks(): Runbook[] {
    return [...this.runbooks.values()].map(cloneRunbook);
  }
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return { ...workspace };
}

function cloneResponder(responder: Responder): Responder {
  return { ...responder };
}

function cloneService(service: MonitoredService): MonitoredService {
  return {
    ...service,
    ownership: {
      ...service.ownership,
      secondaryResponderIds: [...service.ownership.secondaryResponderIds]
    },
    runbookIds: [...service.runbookIds]
  };
}

function cloneEscalationPolicy(policy: EscalationPolicy): EscalationPolicy {
  return {
    ...policy,
    responderIds: [...policy.responderIds]
  };
}

function cloneRunbook(runbook: Runbook): Runbook {
  return {
    ...runbook,
    steps: runbook.steps
      .map((step) => ({ ...step }))
      .sort((left, right) => left.sequence - right.sequence)
  };
}
