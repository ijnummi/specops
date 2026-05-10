// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChangeImpactPreviewResponseDto } from "@specops/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeImpactPreviewPanel } from "./change-impact-preview-panel.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangeImpactPreviewPanel", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    for (const container of containers.splice(0)) {
      container.remove();
    }
  });

  it("renders tabbed impact preview content and generates a task", async () => {
    const onGenerateTask = vi.fn();
    const { container } = await renderPanel({
      preview: samplePreview(),
      selectedNodeId: "domain.policy",
      onGenerateTask
    });

    expect(container.querySelector('[data-testid="change-impact-preview-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("Change Impact Preview");
    expect(container.textContent).toContain("uc.change-policy");
    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("Specs");
    expect(container.textContent).toContain("Source");
    expect(container.textContent).toContain("Warnings");
    expect(container.textContent).toContain("Tasks");
    expect(container.textContent).toContain("Impacted specs");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Source files");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("Related tasks");

    await clickButton(container, "Specs");
    expect(container.textContent).toContain("domain.policy");

    await clickButton(container, "Source");
    expect(container.textContent).toContain("src/domain.ts");

    await clickButton(container, "Warnings");
    expect(container.textContent).toContain("source_spec_missing_entity");

    await clickButton(container, "Tasks");
    expect(container.textContent).toContain("task.domain-decision");

    await clickButton(container, "Generate task from impact");
    expect(onGenerateTask).toHaveBeenCalledTimes(1);
  });
});

async function renderPanel(input: {
  preview: ChangeImpactPreviewResponseDto;
  selectedNodeId: string | null;
  onGenerateTask: () => void;
  isGeneratingTask?: boolean;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <ChangeImpactPreviewPanel
        preview={input.preview}
        selectedNodeId={input.selectedNodeId}
        onGenerateTask={input.onGenerateTask}
        isGeneratingTask={input.isGeneratingTask ?? false}
      />
    );
  });

  return { container, root };
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label)
  );
  expect(button).toBeDefined();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function samplePreview(): ChangeImpactPreviewResponseDto {
  return {
    rootEntity: {
      entityId: "uc.change-policy",
      type: "use-case",
      title: "Change Policy",
      status: "draft",
      filePath: "specs/use-cases/change-policy.md"
    },
    impact: {
      rootEntity: {
        entityId: "uc.change-policy",
        type: "use-case",
        title: "Change Policy",
        status: "draft",
        filePath: "specs/use-cases/change-policy.md"
      },
      nodes: [
        {
          id: "spec:uc.change-policy",
          kind: "spec",
          label: "Change Policy",
          entityId: "uc.change-policy",
          type: "use-case",
          title: "Change Policy",
          status: "draft",
          filePath: "specs/use-cases/change-policy.md"
        },
        {
          id: "spec:domain.policy",
          kind: "spec",
          label: "Policy",
          entityId: "domain.policy",
          type: "domain",
          title: "Policy",
          status: "active",
          filePath: "specs/domain/policy.md"
        }
      ],
      edges: [],
      upstreamPaths: [],
      downstreamPaths: [
        {
          direction: "downstream",
          entityIds: ["uc.change-policy", "domain.policy"],
          steps: [
            {
              entityId: "uc.change-policy",
              title: "Change Policy",
              type: "use-case",
              status: "draft"
            },
            {
              entityId: "domain.policy",
              title: "Policy",
              type: "domain",
              status: "active"
            }
          ],
          linkTypes: ["uses"]
        }
      ],
      sourceEvidence: [
        {
          entityId: "domain.policy",
          filePath: "src/domain.ts",
          sourceFileId: "source-domain",
          symbolName: "applyPolicy",
          symbolKind: "function",
          symbolLine: 12,
          annotationLine: 10
        }
      ],
      truncated: {
        isTruncated: false,
        reason: null,
        nodeCount: 2,
        edgeCount: 1,
        sourceEvidenceCount: 1
      }
    },
    overview: {
      impactedSpecCount: 2,
      upstreamSpecCount: 0,
      downstreamSpecCount: 1,
      sourceFileCount: 1,
      sourceSymbolCount: 1,
      warningCount: 1,
      relatedTaskCount: 1,
      shortestPaths: [
        {
          direction: "downstream",
          entityIds: ["uc.change-policy", "domain.policy"],
          steps: [
            {
              entityId: "uc.change-policy",
              title: "Change Policy",
              type: "use-case",
              status: "draft"
            },
            {
              entityId: "domain.policy",
              title: "Policy",
              type: "domain",
              status: "active"
            }
          ],
          linkTypes: ["uses"]
        }
      ]
    },
    impactedSpecs: [
      {
        direction: "downstream",
        type: "domain",
        specs: [
          {
            entityId: "domain.policy",
            type: "domain",
            title: "Policy",
            status: "active",
            filePath: "specs/domain/policy.md",
            direction: "downstream",
            distance: 1
          }
        ]
      },
      {
        direction: "root",
        type: "use-case",
        specs: [
          {
            entityId: "uc.change-policy",
            type: "use-case",
            title: "Change Policy",
            status: "draft",
            filePath: "specs/use-cases/change-policy.md",
            direction: "root",
            distance: 0
          }
        ]
      }
    ],
    sourceGroups: [
      {
        filePath: "src/domain.ts",
        symbols: [
          {
            entityId: "domain.policy",
            filePath: "src/domain.ts",
            sourceFileId: "source-domain",
            symbolName: "applyPolicy",
            symbolKind: "function",
            symbolLine: 12,
            annotationLine: 10
          }
        ]
      }
    ],
    validationMessages: [
      {
        id: "validation-1",
        projectId: "demo",
        indexRunId: null,
        filePath: "src/domain.ts",
        entityId: null,
        level: "warning",
        code: "source_spec_missing_entity",
        message: "Source annotation points to a missing entity.",
        createdAt: "2026-05-10T12:00:00.000Z"
      }
    ],
    relatedTasks: [
      {
        entityId: "task.domain-decision",
        type: "task",
        title: "Domain decision task",
        status: "todo",
        filePath: "specs/tasks/domain-decision.md",
        linkTypes: ["updates"]
      }
    ],
    taskSeed: {
      sourceEntityId: "uc.change-policy",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.policy"]
    },
    sectionWarnings: []
  };
}
