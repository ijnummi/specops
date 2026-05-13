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

    await clickButton(container, "Accept selected");

    expect(mocks.acceptAssemblies).toHaveBeenCalledWith("project-1", "run-1", {
      assemblyIds: ["assembly-ready"]
    });
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

async function renderWorkspace(mocks = workspaceMocks()) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <AnalyzeReviewWorkspace
        projectId="project-1"
        runId="run-1"
        review={reviewFixture()}
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
  });
  await act(async () => {
    await waitForRender();
  });

  return { container };
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

function button(container: HTMLElement, label: string) {
  const candidates = Array.from(container.querySelectorAll("button"));
  const target =
    candidates.find((candidate) => candidate.getAttribute("aria-label") === label) ??
    candidates.find((candidate) => candidate.textContent?.trim() === label) ??
    candidates.find((candidate) => candidate.textContent?.includes(label));

  expect(target).toBeDefined();
  return target as HTMLButtonElement;
}

function waitForRender() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function reviewFixture(): AnalyzeReviewListResponse {
  return {
    assemblies: [
      assembly({
        id: "assembly-ready",
        title: "Review drafts",
        validation: {
          state: "ready",
          messages: []
        },
        renderedMarkdown: "# Review drafts\n\nReview generated analyze drafts."
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
      })
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
