// @vitest-environment happy-dom

import type {
  AnalyzeReviewAssemblyDto,
  AnalyzeReviewInputDto,
  AnalyzeReviewListResponse
} from "@specops/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeReviewWorkspace } from "./analyze-review-workspace.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AnalyzeReviewWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupRenderedRoots();
  });

  it("renders the draft pool, assembly list, and selected assembly detail", async () => {
    const { container } = await renderWorkspace();

    expect(container.textContent).toContain("Draft pool");
    expect(container.textContent).toContain("Assembly list");
    expect(container.textContent).toContain("Assembly detail");
    expect(container.textContent).toContain("Review drafts");
    expect(container.textContent).toContain("fact_missing_evidence");
  });

  it("filters draft inputs and assemblies to focused proposal ids", async () => {
    const { container } = await renderWorkspace(workspaceMocks(), reviewFixture(), {
      focusLabel: "Backend routes",
      focusProposalIds: ["proposal-unassigned"]
    });

    expect(container.textContent).toContain("Related draft review for Backend routes");
    expect(container.textContent).toContain("Review draft pool");
    expect(container.textContent).not.toContain("Review drafts");
    expect(container.textContent).not.toContain("Blocked draft");
    expect(container.textContent).toContain("No assemblies yet.");
  });

  it("creates an empty assembly", async () => {
    const mocks = workspaceMocks();
    const { container } = await renderWorkspace(mocks);

    await clickButton(container, "Create assembly");

    expect(mocks.createAssembly).toHaveBeenCalledWith(
      "project-1",
      "run-1",
      expect.objectContaining({ proposalIds: [] })
    );
  });

  it("accepts selected ready assemblies", async () => {
    const mocks = workspaceMocks();
    const { container } = await renderWorkspace(mocks);

    await changeCheckbox(container, "Select assembly Review drafts", true);
    await clickButton(container, "Accept selected");

    expect(mocks.acceptAssemblies).toHaveBeenCalledWith("project-1", "run-1", {
      assemblyIds: ["assembly-ready"]
    });
  });

  it("does not reselect ready assemblies after the user deselects them and review data refreshes", async () => {
    const mocks = workspaceMocks();
    const { container, rerender } = await renderWorkspace(mocks);

    await changeCheckbox(container, "Select assembly Review drafts", true);
    await changeCheckbox(container, "Select assembly Review drafts", false);
    await rerender(reviewFixture({ readyTitle: "Review drafts refreshed" }));

    expect(checkboxInput(container, "Select assembly Review drafts refreshed").checked).toBe(false);
    expect(button(container, "Accept selected").disabled).toBe(true);
  });

  it("preserves dirty detail edits across selected assembly refreshes", async () => {
    const { container, rerender } = await renderWorkspace();

    await changeTextInput(container, "Title", "Local title edit");
    await rerender(reviewFixture({ readyTitle: "Server refreshed title" }));

    expect(textInput(container, "Title").value).toBe("Local title edit");
    expect(container.textContent).toContain("Server refreshed title");
  });

  it("disables edit controls for non-draft assemblies", async () => {
    const mocks = workspaceMocks();
    const { container } = await renderWorkspace(
      mocks,
      reviewFixture({
        extraAssemblies: [
          assembly({
            id: "assembly-accepted",
            title: "Accepted assembly",
            status: "accepted",
            acceptedAt: "2026-05-12T08:10:00.000Z"
          })
        ]
      })
    );

    await clickButton(container, "Accepted assembly");
    await changeTextarea(container, "New claim", "Should not be added");
    await clickButton(container, "Add claim");
    await clickButton(container, "Mark fact");
    await clickButton(container, "Save detail");
    await clickButton(container, "Remove");

    expect(textInput(container, "Title").disabled).toBe(true);
    expect(selectInput(container, "Type").disabled).toBe(true);
    expect(textarea(container, "Summary").disabled).toBe(true);
    expect(textarea(container, "New claim").disabled).toBe(true);
    expect(radioInput(container, "hypothesis").disabled).toBe(true);
    expect(button(container, "Save detail").disabled).toBe(true);
    expect(button(container, "Add claim").disabled).toBe(true);
    expect(button(container, "Mark fact").disabled).toBe(true);
    expect(button(container, "Remove").disabled).toBe(true);
    expect(mocks.patchAssembly).not.toHaveBeenCalled();
    expect(mocks.createClaim).not.toHaveBeenCalled();
    expect(mocks.patchClaim).not.toHaveBeenCalled();
    expect(mocks.removeInput).not.toHaveBeenCalled();
  });

  it("preserves new claim edits across selected assembly refreshes", async () => {
    const { container, rerender } = await renderWorkspace();

    await changeTextarea(container, "New claim", "Unsaved claim text");
    await changeRadio(container, "hypothesis");
    await rerender(reviewFixture({ readyTitle: "Server refreshed title" }));

    expect(textarea(container, "New claim").value).toBe("Unsaved claim text");
    expect(radioInput(container, "hypothesis").checked).toBe(true);
  });
});

function workspaceMocks() {
  return {
    acceptAssemblies: vi.fn(),
    attachInput: vi.fn(),
    createAssembly: vi.fn(),
    createClaim: vi.fn(),
    patchAssembly: vi.fn(),
    patchClaim: vi.fn(),
    removeInput: vi.fn()
  };
}

async function renderWorkspace(
  mocks = workspaceMocks(),
  review = reviewFixture(),
  focus: { focusLabel?: string | null; focusProposalIds?: string[] | null } = {}
) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  const render = (nextReview: AnalyzeReviewListResponse) =>
    root.render(
      <AnalyzeReviewWorkspace
        projectId="project-1"
        runId="run-1"
        review={nextReview}
        focusLabel={focus.focusLabel}
        focusProposalIds={focus.focusProposalIds}
        mutationPending={false}
        onAcceptAssemblies={(assemblyIds) =>
          mocks.acceptAssemblies("project-1", "run-1", { assemblyIds })
        }
        onAttachInput={(assemblyId, input) => mocks.attachInput(assemblyId, input)}
        onCreateAssembly={(input) => mocks.createAssembly("project-1", "run-1", input)}
        onCreateClaim={(assemblyId, input) => mocks.createClaim(assemblyId, input)}
        onPatchAssembly={(assemblyId, input) => mocks.patchAssembly(assemblyId, input)}
        onPatchClaim={(assemblyId, claimId, input) =>
          mocks.patchClaim(assemblyId, claimId, input)
        }
        onRemoveInput={(assemblyId, proposalId) => mocks.removeInput(assemblyId, proposalId)}
      />
    );

  await act(async () => {
    render(review);
  });
  await act(async () => {
    await waitForRender();
  });

  return {
    container,
    rerender: async (nextReview: AnalyzeReviewListResponse) => {
      await act(async () => {
        render(nextReview);
      });
      await act(async () => {
        await waitForRender();
      });
    }
  };
}

function cleanupRenderedRoots() {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
}

async function clickButton(container: HTMLElement, label: string) {
  const target = button(container, label);

  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();
  });
}

async function changeCheckbox(container: HTMLElement, label: string, checked: boolean) {
  const target = checkboxInput(container, label);

  await act(async () => {
    if (target.checked !== checked) {
      target.click();
    }
    await waitForRender();
  });
}

async function changeTextInput(container: HTMLElement, label: string, value: string) {
  const target = textInput(container, label);
  target.value = value;

  await act(async () => {
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await waitForRender();
  });
}

async function changeTextarea(container: HTMLElement, label: string, value: string) {
  const target = textarea(container, label);
  target.value = value;

  await act(async () => {
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await waitForRender();
  });
}

async function changeRadio(container: HTMLElement, label: string) {
  const target = radioInput(container, label);

  await act(async () => {
    target.click();
    await waitForRender();
  });
}

function button(container: HTMLElement, label: string) {
  const candidates = Array.from(container.querySelectorAll("button"));
  const target =
    candidates.find((candidate) => candidate.getAttribute("aria-label") === label) ??
    candidates.find((candidate) => candidate.textContent?.trim() === label) ??
    candidates.find((candidate) => candidate.textContent?.includes(label));

  expect(target).toBeDefined();
  return target as HTMLButtonElement;
}

function checkboxInput(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("input")).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );

  expect(target).toBeDefined();
  return target!;
}

function textInput(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.includes(label)
  )?.querySelector("input");

  expect(target).toBeDefined();
  return target as HTMLInputElement;
}

function selectInput(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.includes(label)
  )?.querySelector("select");

  expect(target).toBeDefined();
  return target as HTMLSelectElement;
}

function textarea(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("textarea")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.closest("label")?.textContent?.includes(label)
  );

  expect(target).toBeDefined();
  return target!;
}

function radioInput(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll('input[type="radio"]')).find(
    (candidate) => candidate.closest("label")?.textContent?.includes(label)
  );

  expect(target).toBeDefined();
  return target as HTMLInputElement;
}

function waitForRender() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function reviewFixture({
  extraAssemblies = [],
  readyTitle = "Review drafts"
}: {
  extraAssemblies?: AnalyzeReviewAssemblyDto[];
  readyTitle?: string;
} = {}): AnalyzeReviewListResponse {
  return {
    assemblies: [
      assembly({
        id: "assembly-ready",
        title: readyTitle,
        validation: {
          state: "ready",
          messages: []
        },
        renderedMarkdown: `# ${readyTitle}\n\nReview generated analyze drafts.`
      }),
      assembly({
        id: "assembly-blocked",
        title: "Blocked draft",
        validation: {
          state: "blocker",
          messages: [
            {
              severity: "blocker",
              code: "fact_missing_evidence",
              message: "Fact claims need evidence before accepting.",
              field: "claims"
            }
          ]
        },
        claims: [
          {
            id: "claim-1",
            text: "The review workspace accepts ready drafts.",
            kind: "fact",
            confidence: 0.9,
            sortOrder: 0,
            evidence: []
          }
        ]
      }),
      ...extraAssemblies
    ],
    counts: {
      assemblies: {
        accepted: 0,
        discarded: 0,
        draft: 2
      },
      inputs: {
        assigned: 1,
        discarded: 0,
        unassigned: 1
      },
      validation: {
        blocker: 1,
        ready: 1,
        warning: 0
      }
    },
    unassignedInputs: [
      input({
        proposalId: "proposal-unassigned",
        title: "Review draft pool",
        entityId: "uc.review-draft-pool",
        entityType: "use_case"
      })
    ]
  };
}

function input(overrides: Partial<AnalyzeReviewInputDto> = {}): AnalyzeReviewInputDto {
  return {
    proposalId: "proposal-1",
    role: "primary",
    proposalType: "ai_spec_entity",
    title: "Review drafts",
    entityType: "use_case",
    entityId: "uc.review-drafts",
    filePath: "use-cases/review-drafts.md",
    confidence: 0.84,
    assignmentState: "assigned",
    evidenceCount: 1,
    ...overrides
  };
}

function assembly(overrides: Partial<AnalyzeReviewAssemblyDto> = {}): AnalyzeReviewAssemblyDto {
  return {
    id: "assembly-1",
    projectId: "project-1",
    analyzeRunId: "run-1",
    status: "draft",
    entityType: "use_case",
    entityId: "uc.review-drafts",
    title: "Review drafts",
    summary: "Review generated analyze drafts.",
    filePath: "use-cases/review-drafts.md",
    renderedMarkdown: null,
    inputs: [input()],
    claims: [
      {
        id: "claim-2",
        text: "Review drafts groups inputs by assembly.",
        kind: "hypothesis",
        confidence: 0.67,
        sortOrder: 0,
        evidence: [
          {
            id: "evidence-1",
            proposalId: "proposal-1",
            sourceFilePath: "apps/web/src/routes/analyze-run-review.tsx",
            symbolName: "AnalyzeRunReviewPage",
            startLine: 1,
            endLine: 40,
            provenance: "ai",
            confidence: 0.67
          }
        ]
      }
    ],
    validation: {
      state: "ready",
      messages: []
    },
    createdAt: "2026-05-12T08:00:00.000Z",
    updatedAt: "2026-05-12T08:05:00.000Z",
    acceptedAt: null,
    discardedAt: null,
    ...overrides
  };
}
