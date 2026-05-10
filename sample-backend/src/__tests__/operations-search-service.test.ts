import { describe, expect, it } from "vitest";

import { createIncidentOperationsSeed } from "../db/seed.js";
import { InMemoryIncidentRepository } from "../repositories/incident-repository.js";
import { InMemoryOperationsRepository } from "../repositories/operations-repository.js";
import { IncidentCommandService } from "../services/incident-command-service.js";
import { OperationsSearchService } from "../services/operations-search-service.js";

describe("OperationsSearchService", () => {
  it("searches incidents, services, decisions, and runbook context without an external index", () => {
    const seed = createIncidentOperationsSeed();
    const incidentRepository = new InMemoryIncidentRepository({ alerts: seed.alerts });
    const operationsRepository = new InMemoryOperationsRepository(seed);
    const commandService = new IncidentCommandService(incidentRepository, operationsRepository);
    const searchService = new OperationsSearchService(incidentRepository, operationsRepository);

    const incident = commandService.openIncidentFromAlert("alert.checkout-latency");
    commandService.triageIncident(incident.id, "sev1", "Customer checkout latency above SLO");
    commandService.attachRunbook(incident.id, "runbook.checkout-latency");
    const decision = commandService.recordDecision(incident.id, {
      summary: "Throttle expensive recommendations",
      rationale: "Latency traces show recommendation fan-out saturating checkout dependencies",
      authorResponderId: "responder.ada"
    });

    expect(searchService.search("checkout latency above SLO")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: incident.id,
          source: "incident"
        })
      ])
    );

    expect(searchService.search("Checkout API")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: "service.checkout-api",
          source: "service"
        })
      ])
    );

    expect(searchService.search("fan-out saturating")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: decision.id,
          source: "decision"
        })
      ])
    );

    expect(searchService.search("dependency traces")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: "runbook.checkout-latency",
          source: "runbook"
        })
      ])
    );
  });
});
