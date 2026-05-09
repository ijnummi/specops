import { describe, expect, it } from "vitest";

import {
  defaultTargetAgent,
  suggestedTaskIdForSource,
  taskPreviewHasChanges
} from "./agent-task-preview-state.js";

describe("agent task preview state helpers", () => {
  it("uses codex as the initial target agent", () => {
    expect(defaultTargetAgent()).toBe("codex");
  });

  it("suggests an editable task id from the source entity id", () => {
    expect(suggestedTaskIdForSource("uc.generate-agent-task")).toBe(
      "task.uc-generate-agent-task"
    );
  });

  it("detects edited preview markdown", () => {
    expect(taskPreviewHasChanges("original", "changed")).toBe(true);
    expect(taskPreviewHasChanges("same", "same")).toBe(false);
  });
});
