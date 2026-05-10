import { DecisionService } from "./services/decision-service";
import type { Workspace } from "./domain";

/**
 * @specops interface.create-sample-decision-service
 */
export function createSampleDecisionService(): DecisionService {
  const workspace: Workspace = {
    id: "workspace.sample",
    name: "Sample Workspace",
    rootPath: ".",
    decisionPath: "specops/decisions",
  };

  return new DecisionService(workspace);
}
