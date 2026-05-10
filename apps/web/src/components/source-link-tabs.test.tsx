// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SourceSpecLinkDto } from "@specops/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { SourceLinkTabs } from "./source-link-tabs.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SourceLinkTabs", () => {
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

  it("renders the spec tab first and switches to source evidence", async () => {
    const { container } = await renderTabs({
      specTitle: "Decision Model",
      sourceLinks: [
        sourceLink({
          filePath: "src/domain/decision-model.ts",
          symbolKind: "function",
          symbolName: "createDecisionModel",
          excerpt: {
            status: "available",
            startLine: 12,
            endLine: 15,
            text: [
              "/**",
              " * @specops domain.decision",
              " */",
              "export function createDecisionModel() {}"
            ].join("\n")
          }
        })
      ],
      specPanel: <div data-testid="spec-panel">Spec editor panel</div>
    });

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0]?.textContent).toContain("Spec: Decision Model");
    expect(container.textContent).toContain("Spec editor panel");

    await clickButton(container, "decision-model.ts");

    expect(container.textContent).toContain("src/domain/decision-model.ts");
    expect(container.textContent).toContain("function");
    expect(container.textContent).toContain("createDecisionModel");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("@specops domain.decision");
  });

  it("renders stable messages for unavailable, changed, and missing excerpts", async () => {
    const { container } = await renderTabs({
      specTitle: "Decision Model",
      sourceLinks: [
        sourceLink({
          id: "missing-excerpt",
          filePath: "src/missing.ts",
          excerpt: undefined
        }),
        sourceLink({
          id: "changed-excerpt",
          filePath: "src/changed.ts",
          excerpt: {
            status: "changed",
            message: "Source changed since this evidence was indexed."
          }
        }),
        sourceLink({
          id: "unavailable-excerpt",
          filePath: "src/unavailable.ts",
          excerpt: {
            status: "unavailable",
            message: "Source file could not be read."
          }
        })
      ],
      specPanel: <div>Spec editor panel</div>
    });

    await clickButton(container, "missing.ts");
    expect(container.textContent).toContain("Source excerpt unavailable.");

    await clickButton(container, "changed.ts");
    expect(container.textContent).toContain("Source changed since this evidence was indexed.");

    await clickButton(container, "unavailable.ts");
    expect(container.textContent).toContain("Source file could not be read.");
  });

  it("shows an overflow count when more than four source links are provided", async () => {
    const { container } = await renderTabs({
      specTitle: "Decision Model",
      sourceLinks: Array.from({ length: 6 }, (_, index) =>
        sourceLink({
          id: `source-link-${index + 1}`,
          filePath: `src/source-${index + 1}.ts`
        })
      ),
      specPanel: <div>Spec editor panel</div>
    });

    expect(container.textContent).toContain("+2");
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe(
      "2 additional source links not shown"
    );
    expect(container.textContent).toContain("source-4.ts");
    expect(container.textContent).not.toContain("source-5.ts");
  });

  it("distinguishes source buttons with duplicate file basenames", async () => {
    const { container } = await renderTabs({
      specTitle: "Decision Model",
      sourceLinks: [
        sourceLink({
          id: "domain-source",
          filePath: "src/domain/decision-model.ts",
          symbolName: "createDecisionModel"
        }),
        sourceLink({
          id: "app-source",
          filePath: "src/app/decision-model.ts",
          symbolName: "renderDecisionModel"
        })
      ],
      specPanel: <div>Spec editor panel</div>
    });

    const sourceButtons = Array.from(container.querySelectorAll("button")).slice(1);
    expect(sourceButtons.map((button) => button.textContent)).toEqual([
      "decision-model.ts · createDecisionModel",
      "decision-model.ts · renderDecisionModel"
    ]);
    expect(sourceButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "src/domain/decision-model.ts createDecisionModel",
      "src/app/decision-model.ts renderDecisionModel"
    ]);
  });

  it("returns to the spec tab when the spec title changes", async () => {
    const { container, root } = await renderTabs({
      specTitle: "Decision Model",
      sourceLinks: [sourceLink({ id: "shared-source-link" })],
      specPanel: <div>Decision spec panel</div>
    });

    await clickButton(container, "decision-model.ts");
    expect(container.textContent).toContain("src/domain/decision-model.ts");

    await act(async () => {
      root.render(
        <SourceLinkTabs
          specTitle="Workspace"
          sourceLinks={[
            sourceLink({
              id: "shared-source-link",
              filePath: "src/domain/workspace.ts"
            })
          ]}
          specPanel={<div>Workspace spec panel</div>}
        />
      );
    });

    expect(container.textContent).toContain("Spec: Workspace");
    expect(container.textContent).toContain("Workspace spec panel");
    expect(container.textContent).not.toContain("src/domain/workspace.ts");
  });
});

async function renderTabs(props: {
  specTitle: string;
  sourceLinks: SourceSpecLinkDto[];
  specPanel: React.ReactNode;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(<SourceLinkTabs {...props} />);
  });

  return { container, root };
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes(label)
  );

  expect(button).toBeDefined();

  await act(async () => {
    button?.click();
  });
}

function sourceLink(input: Partial<SourceSpecLinkDto> = {}): SourceSpecLinkDto {
  return {
    id: "source-link-1",
    projectId: "project-1",
    sourceFileId: "source-file-1",
    filePath: "src/domain/decision-model.ts",
    entityId: "domain.decision",
    symbolName: "createDecisionModel",
    symbolKind: "function",
    symbolLine: 14,
    annotationLine: 13,
    contentHash: "source-content-hash",
    excerpt: {
      status: "available",
      startLine: 12,
      endLine: 14,
      text: "export function createDecisionModel() {}"
    },
    createdAt: "2026-05-10T12:00:00.000Z",
    ...input
  };
}
