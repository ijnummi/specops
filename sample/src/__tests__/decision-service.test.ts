import type { Workspace } from "../domain";
import { DecisionService } from "../services/decision-service";

const workspace: Workspace = {
  id: "workspace.sample",
  name: "Sample Workspace",
  rootPath: ".",
  decisionPath: "specops/decisions",
};

export function createSampleDecisionTitle(): string {
  const service = new DecisionService(workspace);
  return service.createDecision({
    title: "Choose Markdown",
    contextMarkdown: "The team wants reviewable decisions.",
    decisionMarkdown: "Use markdown decision records.",
  }).title;
}
