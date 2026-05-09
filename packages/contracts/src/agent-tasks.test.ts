import { describe, expect, it } from "vitest";

import {
  agentTaskPreviewRequestSchema,
  saveAgentTaskRequestSchema
} from "./agent-tasks.js";

describe("agent task contracts", () => {
  it("defaults preview targetAgent to codex", () => {
    expect(
      agentTaskPreviewRequestSchema.parse({
        sourceEntityId: "uc.generate-agent-task"
      })
    ).toEqual({
      sourceEntityId: "uc.generate-agent-task",
      targetAgent: "codex"
    });
  });

  it("accepts an edited task save request", () => {
    expect(
      saveAgentTaskRequestSchema.parse({
        taskId: "task.uc-generate-agent-task",
        filePath: "agent-tasks/task.uc-generate-agent-task.md",
        markdown:
          "---\n" +
          "id: task.uc-generate-agent-task\n" +
          "type: agent_task\n" +
          "title: Generate Agent Task\n" +
          "status: ready\n" +
          "source_entity: uc.generate-agent-task\n" +
          "---\n\n" +
          "# Task: Generate Agent Task\n"
      })
    ).toMatchObject({
      taskId: "task.uc-generate-agent-task",
      filePath: "agent-tasks/task.uc-generate-agent-task.md"
    });
  });
});
