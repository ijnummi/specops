// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptProposals: vi.fn(),
  generateSourceImportProposals: vi.fn(),
  invalidateQueries: vi.fn(),
  patchProposal: vi.fn(),
  proposalQueryOptions: [] as Array<{
    enabled?: boolean;
    queryKey: readonly unknown[];
    queryType?: string;
  }>,
  proposalsQuery: vi.fn((projectId: string, input: { status?: string } = {}) => ({
    queryKey: ["projects", projectId, "proposals", input],
    queryType: "proposals"
  })),
  proposalQuery: vi.fn((projectId: string, proposalId: string) => ({
    queryKey: ["projects", projectId, "proposals", proposalId],
    queryType: "proposal"
  }))
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    params,
    search,
    to
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    to: string;
  }) => {
    const href = to.replace("$projectId", params?.projectId ?? "");
    const query = search?.q ? `?q=${encodeURIComponent(search.q)}` : "";

    return (
      <a href={`${href}${query}`} onClick={onClick}>
        {children}
      </a>
    );
  }
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: {
    mutationFn: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown) => unknown;
  }) => ({
    error: null,
    isPending: false,
    mutate: (variables?: unknown) => {
      const result = options.mutationFn(variables);
      void options.onSuccess?.(result, variables);
      return result;
    }
  }),
  useQuery: (options: { enabled?: boolean; queryKey: readonly unknown[]; queryType?: string }) => {
    if (options.queryType === "proposals") {
      return {
        data: proposalSummaries(),
        error: null,
        isLoading: false
      };
    }

    if (options.queryType === "proposal") {
      mocks.proposalQueryOptions.push(options);
      const proposalId = String(options.queryKey[3]);

      return {
        data: proposalDetail(proposalId),
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
  generateSourceImportProposals: mocks.generateSourceImportProposals,
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
    proposals: (projectId: string, input: { status?: string } = {}) => [
      "projects",
      projectId,
      "proposals",
      input
    ],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  }
}));

vi.mock("../components/markdown-editor.js", () => ({
  MarkdownEditor: ({
    onChange,
    value
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Proposal markdown"
      value={value}
      onInput={(event) => onChange(event.currentTarget.value)}
    />
  )
}));

import { SourceImportPage } from "./source-import.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SourceImportPage", () => {
  beforeEach(() => {
    mocks.acceptProposals.mockReset();
    mocks.acceptProposals.mockImplementation((projectId: string, input: unknown) => {
      return { acceptedProposalIds: (input as { proposalIds: string[] }).proposalIds };
    });
    mocks.generateSourceImportProposals.mockReset();
    mocks.generateSourceImportProposals.mockImplementation(() => {
      return proposalSummaries();
    });
    mocks.invalidateQueries.mockReset();
    mocks.patchProposal.mockReset();
    mocks.patchProposal.mockImplementation(
      (_projectId: string, proposalId: string, input: { markdown?: string; status?: string }) => {
        const detail = proposalDetail(proposalId);
        return proposalDetail(proposalId, {
          markdown: input.markdown ?? proposalDetail().payload.markdown,
          status: input.status ?? detail.status
        });
      }
    );
    mocks.proposalQuery.mockClear();
    mocks.proposalQueryOptions = [];
    mocks.proposalsQuery.mockClear();
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

  it("renders pending proposal review content from cached data", () => {
    const html = renderToStaticMarkup(<SourceImportPage projectId="project-1" />);

    expect(html).toContain("Import from source");
    expect(html).toContain("DecisionService");
    expect(html).toContain("interfaces/decision-service.md");
    expect(html).toContain("Generate proposals");
    expect(html).toContain("Accept selected");
  });

  it("loads pending proposals and enables the first proposal detail query from cached proposals", () => {
    renderToStaticMarkup(<SourceImportPage projectId="project-1" />);

    expect(mocks.proposalsQuery).toHaveBeenCalledWith("project-1");
    expect(mocks.proposalQuery).toHaveBeenCalledWith("project-1", "proposal-1");
    expect(mocks.proposalQueryOptions).toContainEqual(
      expect.objectContaining({
        enabled: true,
        queryKey: ["projects", "project-1", "proposals", "proposal-1"]
      })
    );
  });

  it("accepts checked proposals by id", async () => {
    const { container } = await renderSourceImportPage();

    await changeCheckbox(container, "Select DecisionService", true);
    await clickButton(container, "Accept selected");

    expect(mocks.acceptProposals).toHaveBeenCalledWith("project-1", {
      proposalIds: ["proposal-1"]
    });
  });

  it("saves markdown edits through the proposal patch API", async () => {
    const { container } = await renderSourceImportPage();

    await changeTextarea(container, "Proposal markdown", "# DecisionService\n\nEdited.");
    await clickButton(container, "Save markdown");

    expect(mocks.patchProposal).toHaveBeenCalledWith("project-1", "proposal-1", {
      markdown: "# DecisionService\n\nEdited."
    });
  });

  it("rejects the selected proposal through the proposal patch API", async () => {
    const { container } = await renderSourceImportPage();

    await clickButton(container, "Reject");

    expect(mocks.patchProposal).toHaveBeenCalledWith("project-1", "proposal-1", {
      status: "rejected"
    });
  });

  it("generates source import proposals", async () => {
    const { container } = await renderSourceImportPage();

    await clickButton(container, "Generate proposals");

    expect(mocks.generateSourceImportProposals).toHaveBeenCalledWith("project-1");
  });

  it("shows proposal status counts and filters accepted review history", async () => {
    const { container } = await renderSourceImportPage();

    expect(container.textContent).toContain("Pending 2");
    expect(container.textContent).toContain("Accepted 2");
    expect(container.textContent).toContain("Rejected 1");
    expect(container.textContent).toContain("Obsolete 1");

    await clickButton(container, "Accepted");

    expect(container.textContent).toContain("AcceptedGateway");
    expect(container.textContent).toContain("EditedGateway");
    expect(input(container, "Select AcceptedGateway").disabled).toBe(true);
    expect(button(container, "Reject").disabled).toBe(true);
  });

  it("blocks accepting a checked proposal with unsaved editor changes", async () => {
    const { container } = await renderSourceImportPage();

    await changeCheckbox(container, "Select DecisionService", true);
    await changeTextarea(container, "Proposal markdown", "# DecisionService\n\nUnsaved.");

    expect(button(container, "Accept selected").disabled).toBe(true);
    expect(container.textContent).toContain("Save edits before accepting selected proposals.");

    await clickButton(container, "Accept selected");

    expect(mocks.acceptProposals).not.toHaveBeenCalled();
  });

  it("blocks accepting a dirty checked proposal after selecting another clean proposal", async () => {
    const { container } = await renderSourceImportPage();

    await changeCheckbox(container, "Select DecisionService", true);
    await changeTextarea(container, "Proposal markdown", "# DecisionService\n\nUnsaved.");
    await clickButton(container, "ReviewPolicy");

    expect(textarea(container, "Proposal markdown").value).toContain("ReviewPolicy");
    expect(button(container, "Accept selected").disabled).toBe(true);
    expect(container.textContent).toContain("Save edits before accepting selected proposals.");

    await clickButton(container, "Accept selected");

    expect(mocks.acceptProposals).not.toHaveBeenCalled();
  });

  it("blocks generate, reject, and back navigation while any draft is dirty", async () => {
    const { container } = await renderSourceImportPage();

    await changeTextarea(container, "Proposal markdown", "# DecisionService\n\nUnsaved.");

    expect(button(container, "Generate proposals").disabled).toBe(true);
    expect(button(container, "Reject").disabled).toBe(true);

    await clickButton(container, "Generate proposals");
    await clickButton(container, "Reject");

    expect(mocks.generateSourceImportProposals).not.toHaveBeenCalled();
    expect(mocks.patchProposal).not.toHaveBeenCalled();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    let allowed = true;
    await act(async () => {
      allowed = link(container, "Back to project").dispatchEvent(event);
      await waitForRender();
    });

    expect(allowed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(container.textContent).toContain("Save edits before leaving source import.");
  });
});

async function renderSourceImportPage() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(<SourceImportPage projectId="project-1" />);
  });

  await act(async () => {
    await waitForRender();
  });

  return { container };
}

async function clickButton(container: HTMLElement, label: string) {
  const target = button(container, label);

  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();
  });
}

async function changeCheckbox(container: HTMLElement, label: string, checked: boolean) {
  const target = input(container, label);

  await act(async () => {
    if (target.checked !== checked) {
      target.click();
    }
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

function button(container: HTMLElement, label: string) {
  const candidates = Array.from(container.querySelectorAll("button"));
  const target =
    candidates.find((candidate) => candidate.textContent?.trim() === label) ??
    candidates.find((candidate) => candidate.textContent?.includes(label));

  expect(target).toBeDefined();
  return target!;
}

function link(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("a")).find((candidate) =>
    candidate.textContent?.includes(label)
  );

  expect(target).toBeDefined();
  return target!;
}

function input(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("input")).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );

  expect(target).toBeDefined();
  return target!;
}

function textarea(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll("textarea")).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );

  expect(target).toBeDefined();
  return target!;
}

function waitForRender() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function proposalSummaries() {
  return [
    proposalSummary("proposal-1"),
    proposalSummary("proposal-2", {
      title: "ReviewPolicy",
      entityId: "domain.review-policy",
      entityType: "domain_entity",
      filePath: "domain/review-policy.md",
      confidence: 0.88
    }),
    proposalSummary("proposal-3", {
      title: "AcceptedGateway",
      entityId: "interface.accepted-gateway",
      filePath: "interfaces/accepted-gateway.md",
      status: "accepted"
    }),
    proposalSummary("proposal-4", {
      title: "EditedGateway",
      entityId: "interface.edited-gateway",
      filePath: "interfaces/edited-gateway.md",
      status: "edited_and_accepted"
    }),
    proposalSummary("proposal-5", {
      title: "RejectedGateway",
      entityId: "interface.rejected-gateway",
      filePath: "interfaces/rejected-gateway.md",
      status: "rejected"
    }),
    proposalSummary("proposal-6", {
      title: "OldGateway",
      entityId: "interface.old-gateway",
      filePath: "interfaces/old-gateway.md",
      status: "obsolete"
    })
  ];
}

function proposalSummary(
  id = "proposal-1",
  overrides: {
    confidence?: number;
    entityId?: string;
    entityType?: string;
    filePath?: string;
    status?: string;
    title?: string;
  } = {}
) {
  return {
    id,
    projectId: "project-1",
    proposalType: "source_spec_entity",
    status: overrides.status ?? "pending",
    title: overrides.title ?? "DecisionService",
    entityId: overrides.entityId ?? "interfaces.decision-service",
    entityType: overrides.entityType ?? "interface",
    filePath: overrides.filePath ?? "interfaces/decision-service.md",
    confidence: overrides.confidence ?? 0.92,
    conflict: { status: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null
  };
}

function proposalDetail(
  id = "proposal-1",
  overrides: { markdown?: string; status?: string } = {}
) {
  const summary =
    proposalSummaries().find((candidate) => candidate.id === id) ?? proposalSummary(id);
  const title = summary.title;
  const type = summary.entityType;

  return {
    ...summary,
    status: overrides.status ?? summary.status,
    payload: {
      entityId: summary.entityId,
      type,
      title,
      status: "draft",
      filePath: summary.filePath,
      generatedMarkdown: `# ${title}`,
      markdown: overrides.markdown ?? `# ${title}\n\nCoordinates policy decisions.`,
      sourceFiles: [`apps/api/src/${title.toLowerCase()}.ts`],
      symbols: [
        {
          name: title,
          kind: "class",
          exported: true,
          file: `apps/api/src/${title.toLowerCase()}.ts`,
          line: 12
        }
      ]
    },
    evidence: {
      scanner: "typescript",
      sourceFiles: [
        {
          file: `apps/api/src/${title.toLowerCase()}.ts`,
          symbolName: title,
          symbolKind: "class",
          exported: true,
          line: 12
        }
      ]
    }
  };
}
