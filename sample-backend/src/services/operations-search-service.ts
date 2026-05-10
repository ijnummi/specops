import type { IncidentDecision } from "../domain/incident.js";
import type { MonitoredService, Runbook } from "../domain/operations.js";
import type { IncidentRepository } from "../repositories/incident-repository.js";
import type { OperationsRepository } from "../repositories/operations-repository.js";

export type OperationsSearchSource = "incident" | "service" | "decision" | "runbook";

/**
 * Search hit returned from incident operations repository data.
 * @specops interface.operations-search-service
 */
export interface OperationsSearchResult {
  source: OperationsSearchSource;
  entityId: string;
  title: string;
  snippet: string;
}

/**
 * Searches incident operations data directly from repositories without an external index.
 * @specops interface.operations-search-service
 */
export class OperationsSearchService {
  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly operationsRepository: OperationsRepository
  ) {}

  search(query: string): OperationsSearchResult[] {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
      return [];
    }

    const results: OperationsSearchResult[] = [];

    for (const incident of this.incidentRepository.listIncidents()) {
      const incidentText = [
        incident.id,
        incident.title,
        incident.alertId,
        incident.serviceId,
        incident.severity,
        incident.status,
        incident.summary ?? ""
      ].join(" ");

      if (matches(incidentText, normalizedQuery)) {
        results.push({
          source: "incident",
          entityId: incident.id,
          title: incident.title,
          snippet: incident.summary ?? `${incident.severity} ${incident.status} incident for ${incident.serviceId}`
        });
      }
    }

    for (const service of this.operationsRepository.listServices()) {
      const serviceText = serviceSearchText(service);
      if (matches(serviceText, normalizedQuery)) {
        results.push({
          source: "service",
          entityId: service.id,
          title: service.name,
          snippet: service.description
        });
      }
    }

    for (const decision of this.allDecisions()) {
      const decisionText = [decision.summary, decision.rationale, decision.authorResponderId].join(" ");
      if (matches(decisionText, normalizedQuery)) {
        results.push({
          source: "decision",
          entityId: decision.id,
          title: decision.summary,
          snippet: decision.rationale
        });
      }
    }

    for (const runbook of this.operationsRepository.listRunbooks()) {
      const runbookText = runbookSearchText(runbook);
      if (matches(runbookText, normalizedQuery)) {
        results.push({
          source: "runbook",
          entityId: runbook.id,
          title: runbook.title,
          snippet: runbook.summary
        });
      }
    }

    return results;
  }

  private allDecisions(): IncidentDecision[] {
    return this.incidentRepository
      .listIncidents()
      .flatMap((incident) => this.incidentRepository.listDecisionsByIncidentId(incident.id));
  }
}

function serviceSearchText(service: MonitoredService): string {
  return [
    service.id,
    service.name,
    service.description,
    service.tier,
    service.ownership.teamName,
    service.ownership.primaryResponderId,
    service.ownership.secondaryResponderIds.join(" "),
    service.ownership.escalationPolicyId,
    service.runbookIds.join(" ")
  ].join(" ");
}

function runbookSearchText(runbook: Runbook): string {
  return [
    runbook.id,
    runbook.title,
    runbook.summary,
    runbook.serviceId,
    ...runbook.steps.flatMap((step) => [step.title, step.instruction, step.minimumSeverity])
  ].join(" ");
}

function matches(text: string, normalizedQuery: string): boolean {
  return normalize(text).includes(normalizedQuery);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
