import { describe, expect, it } from "vitest";

import {
  defaultAgentTaskFilePath,
  defaultAgentTaskId,
  safeTaskFileName,
  slugifyTaskIdPart,
} from "../id.js";

describe("agent task id helpers", () => {
  it("derives task ids from source entity ids", () => {
    expect(defaultAgentTaskId("uc.generate-agent-task")).toBe("task.uc-generate-agent-task");
    expect(defaultAgentTaskId("interface.spec-entity-service")).toBe(
      "task.interface-spec-entity-service"
    );
  });

  it("normalizes unexpected punctuation", () => {
    expect(slugifyTaskIdPart("Domain Customer_Profile")).toBe("domain-customer-profile");
  });

  it("derives file paths under agent-tasks", () => {
    expect(defaultAgentTaskFilePath("task.uc-generate-agent-task")).toBe(
      "agent-tasks/task.uc-generate-agent-task.md"
    );
  });

  it("removes path separators from editable task ids before deriving file names", () => {
    expect(safeTaskFileName("task.uc/generate")).toBe("task.uc-generate");
  });
});
