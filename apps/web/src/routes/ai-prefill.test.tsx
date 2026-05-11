// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptProposals: vi.fn(),
  generateAiPrefillProposals: vi.fn(),
  invalidateQueries: vi.fn(),
  mutationCallIndex: 0,
  patchProposal: vi.fn(),
  pendingMutationLabel: undefined as string | undefined,
  proposalDetailOverride: undefined as unknown,
  proposalQueryOptions: [] as Array<{
    enabled?: boolean;
    queryKey: readonly unknown[];
    queryType?: string;
  }>,
  proposalSummariesOverride: undefined as unknown,
  proposalsQuery: vi.fn((projectId: string, input: { proposalType?: string } = {}) => ({
    queryKey: ["projects", projectId, "proposals", input],
    queryType: "proposals"
  })),
  proposalQuery: vi.fn((projectId: string, proposalId: string) => ({
    queryKey: ["projects", projectId, "proposals", proposalId],
    queryType: "proposal"
  })),
  sourceFilesQuery: vi.fn((projectId: string, input: { limit: number; offset: number }) => ({
    queryKey: ["projects", projectId, "source-files", input],
    queryType: "sourceFiles"
  }))
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: {
    mutationFn: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown) => unknown;
  }) => {
    const mutationLabels = ["generate", "accept", "reject", "save"];
    const mutationLabel = mutationLabels[mocks.mutationCallIndex % mutationLabels.length];
    mocks.mutationCallIndex += 1;

    return {
      error: null,
      isPending: mutationLabel === mocks.pendingMutationLabel,
      mutate: (variables?: unknown) => {
        const result = options.mutationFn(variables);
        void options.onSuccess?.(result, variables);
        return result;
      }
    };
  },
  useQuery: (options: {
    enabled?: boolean;
    queryKey: readonly unknown[];
    queryType?: string;
  }) => {
    if (options.queryType === "sourceFiles") {
      return {
        data: [
          {
            id: "source-file-1",
            projectId: "project-1",
            path: "apps/api/src/routes/projects.ts",
            language: "typescript",
            kind: "source",
            sizeBytes: 1234,
            contentHash: "hash-1",
            lastSeenAt: "2026-01-02T03:04:05.000Z",
            importCount: 2,
            exportCount: 1,
            symbolCount: 3
          }
        ],
        error: null,
        isLoading: false
      };
    }

    if (options.queryType === "proposals") {
      return {
        data: mocks.proposalSummariesOverride ?? [],
        error: null,
        isLoading: false
      };
    }

    if (options.queryType === "proposal") {
      mocks.proposalQueryOptions.push(options);
      if (options.enabled === false) {
        return { data: undefined, error: null, isLoading: false };
      }

      return {
        data: mocks.proposalDetailOverride ?? aiProposalDetail(),
        error: null,
        isLoading: false
      };
    }

    return { data: undefined, error: null, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../api/queries.js", () => ({
  acceptProposals: mocks.acceptProposals,
  generateAiPrefillProposals: mocks.generateAiPrefillProposals,
  patchProposal: mocks.patchProposal,
  proposalQuery: mocks.proposalQuery,
  proposalsQuery: mocks.proposalsQuery,
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    proposal: (projectId: string, proposalId: string) => [
      "projects",
      projectId,
      "proposals",
      proposalId
    ],
    proposalsRoot: (projectId: string) => ["projects", projectId, "proposals"],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  },
  sourceFilesQuery: mocks.sourceFilesQuery
}));

import { AiPrefillPage } from "./ai-prefill.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AiPrefillPage", () => {
  beforeEach(() => {
    mocks.acceptProposals.mockReset();
    mocks.acceptProposals.mockImplementation((_projectId: string, input: unknown) => ({
      acceptedProposalIds: (input as { proposalIds: string[] }).proposalIds
    }));
    mocks.generateAiPrefillProposals.mockReset();
    mocks.generateAiPrefillProposals.mockImplementation(() => ({ proposals: [], diagnostics: [] }));
    mocks.invalidateQueries.mockReset();
    mocks.mutationCallIndex = 0;
    mocks.patchProposal.mockReset();
    mocks.patchProposal.mockImplementation(
      (_projectId: string, _proposalId: string, input: { markdown?: string; status?: string }) => ({
        ...aiProposalDetail(),
        status: input.status ?? "pending",
        payload: {
          ...aiProposalDetail().payload,
          markdown: input.markdown ?? aiProposalDetail().payload.markdown
        }
      })
    );
    mocks.proposalDetailOverride = undefined;
    mocks.proposalQuery.mockClear();
    mocks.proposalQueryOptions = [];
    mocks.proposalSummariesOverride = undefined;
    mocks.proposalsQuery.mockClear();
    mocks.pendingMutationLabel = undefined;
    mocks.sourceFilesQuery.mockClear();
  });

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

  it("renders the source and proposal panes", () => {
    const html = renderToStaticMarkup(<AiPrefillPage projectId="project-1" />);

    expect(html).toContain("AI Prefill");
    expect(html).toContain("apps/api/src/routes/projects.ts");
    expect(html).toContain("Provider");
    expect(html).toContain("Model");
    expect(html).toContain("Pending proposals");
    expect(html).toContain("Select a proposal to review.");
  });

  it("generates proposals for selected source files", async () => {
    const { container } = await renderAiPrefillPage();

    expect(buttonNamed(container, "Generate").disabled).toBe(true);

    await changeCheckbox(container, "Select apps/api/src/routes/projects.ts", true);
    expect(buttonNamed(container, "Generate").disabled).toBe(false);

    await clickButton(container, "Generate");

    expect(mocks.generateAiPrefillProposals).toHaveBeenCalledWith("project-1", {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      sourceFileIds: ["source-file-1"],
      temperature: 0.1
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "proposals"]
    });
  });

  it("fetches and shows AI proposal detail after clicking a proposal row", async () => {
    mocks.proposalSummariesOverride = [aiProposalSummary()];
    const { container } = await renderAiPrefillPage();

    await clickButton(container, "Manage projects");

    expect(mocks.proposalsQuery).toHaveBeenCalledWith("project-1", {
      proposalType: "ai_spec_entity",
      status: "pending"
    });
    expect(mocks.proposalQuery).toHaveBeenCalledWith("project-1", "proposal-1");
    expect(mocks.proposalQueryOptions).toContainEqual(
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "proposals", "proposal-1"]
      })
    );
    expect(container.textContent).toContain("use-cases/uc.manage-projects.md");
    expect(textarea(container, "Proposal markdown").value).toContain("# Manage projects");
  });

  it("shows AI evidence, claims, and proposed links for the selected detail", async () => {
    mocks.proposalSummariesOverride = [aiProposalSummary()];
    const { container } = await renderAiPrefillPage();

    await clickButton(container, "Manage projects");

    expect(container.textContent).toContain("AI evidence");
    expect(container.textContent).toContain("ollama");
    expect(container.textContent).toContain("qwen2.5-coder:7b");
    expect(container.textContent).toContain("ai-prefill-v1");
    expect(container.textContent).toContain("Project routes create and list projects.");
    expect(container.textContent).toContain("apps/api/src/routes/projects.ts");
    expect(container.textContent).toContain("Proposed links");
    expect(container.textContent).toContain("uses -> interface.project-service");
    expect(container.textContent).toContain(
      "The selected route delegates project behavior to the project service."
    );
  });

  it("saves markdown edits through the proposal patch API", async () => {
    mocks.proposalSummariesOverride = [aiProposalSummary()];
    const { container } = await renderAiPrefillPage();

    await clickButton(container, "Manage projects");
    await changeTextarea(container, "Proposal markdown", "# Manage projects\n\nEdited.");
    await clickButton(container, "Save");

    expect(mocks.patchProposal).toHaveBeenCalledWith("project-1", "proposal-1", {
      markdown: "# Manage projects\n\nEdited."
    });
  });

  it("rejects the selected proposal through the proposal patch API", async () => {
    mocks.proposalSummariesOverride = [aiProposalSummary()];
    const { container } = await renderAiPrefillPage();

    await clickButton(container, "Manage projects");
    await clickButton(container, "Reject");

    expect(mocks.patchProposal).toHaveBeenCalledWith("project-1", "proposal-1", {
      status: "rejected"
    });
  });

  it("accepts checked AI proposals by id", async () => {
    mocks.proposalSummariesOverride = [aiProposalSummary()];
    const { container } = await renderAiPrefillPage();

    await changeCheckbox(container, "Select Manage projects", true);
    await clickButton(container, "Accept selected");

    expect(mocks.acceptProposals).toHaveBeenCalledWith("project-1", {
      proposalIds: ["proposal-1"]
    });
  });

  it.each(["accept", "reject", "save"])(
    "disables review actions while the %s mutation is pending",
    async (pendingMutationLabel) => {
      mocks.pendingMutationLabel = pendingMutationLabel;
      mocks.proposalSummariesOverride = [aiProposalSummary()];
      const { container } = await renderAiPrefillPage();

      await changeCheckbox(container, "Select Manage projects", true);
      await clickButton(container, "Manage projects");
      await changeTextarea(container, "Proposal markdown", "# Manage projects\n\nEdited.");

      expect(buttonNamed(container, "Accept selected").disabled).toBe(true);
      expect(buttonNamed(container, "Reject").disabled).toBe(true);
      expect(buttonNamed(container, "Save").disabled).toBe(true);
    }
  );
});

async function renderAiPrefillPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(<AiPrefillPage projectId="project-1" />);
  });
  await act(async () => {
    await waitForRender();
  });

  return { container };
}

async function changeCheckbox(container: HTMLElement, label: string, checked: boolean) {
  const checkbox = controlNamed<HTMLInputElement>(container, label);

  await act(async () => {
    if (checkbox.checked !== checked) {
      checkbox.click();
    }
  });
}

async function clickButton(container: HTMLElement, label: string) {
  const button = buttonNamed(container, label);

  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

function buttonNamed(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label
  );

  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }

  return button as HTMLButtonElement;
}

function controlNamed<T extends HTMLInputElement | HTMLSelectElement>(
  container: HTMLElement,
  label: string
) {
  const labelledControl = [...container.querySelectorAll("input, select")].find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );
  if (labelledControl) {
    return labelledControl as T;
  }

  const labels = [...container.querySelectorAll("label")];
  const match = labels.find((candidate) => candidate.textContent?.includes(label));
  const control = match?.querySelector("input, select");

  if (!control) {
    throw new Error(`Missing control: ${label}`);
  }

  return control as T;
}

function textarea(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("textarea")).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );

  if (!target) {
    throw new Error(`Missing textarea: ${label}`);
  }

  return target;
}

function waitForRender() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function aiProposalSummary() {
  return {
    id: "proposal-1",
    projectId: "project-1",
    proposalType: "ai_spec_entity",
    status: "pending",
    title: "Manage projects",
    entityId: "uc.manage-projects",
    entityType: "use_case",
    filePath: "use-cases/uc.manage-projects.md",
    confidence: 0.82,
    conflict: { status: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null
  };
}

function aiProposalDetail() {
  return {
    ...aiProposalSummary(),
    payload: {
      entityId: "uc.manage-projects",
      type: "use_case",
      title: "Manage projects",
      status: "draft",
      filePath: "use-cases/uc.manage-projects.md",
      generatedMarkdown: "# Manage projects",
      markdown: "# Manage projects\n\nDraft spec.",
      sourceFiles: ["apps/api/src/routes/projects.ts"],
      proposedLinks: [
        {
          linkType: "uses",
          targetEntityId: "interface.project-service",
          targetExists: true,
          rationale: "The selected route delegates project behavior to the project service."
        }
      ]
    },
    evidence: {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      promptVersion: "ai-prefill-v1",
      selectedSourceFiles: [
        {
          file: "apps/api/src/routes/projects.ts",
          contentHash: "hash-1",
          excerptStartLine: 1,
          excerptEndLine: 80
        }
      ],
      claims: [
        {
          text: "Project routes create and list projects.",
          sourceFiles: ["apps/api/src/routes/projects.ts"]
        }
      ],
      warnings: []
    }
  };
}
