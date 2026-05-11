// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateAiPrefillProposals: vi.fn(),
  invalidateQueries: vi.fn(),
  proposalsQuery: vi.fn((projectId: string, input: { proposalType?: string } = {}) => ({
    queryKey: ["projects", projectId, "proposals", input],
    queryType: "proposals"
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
  }) => ({
    error: null,
    isPending: false,
    mutate: (variables?: unknown) => {
      const result = options.mutationFn(variables);
      void options.onSuccess?.(result, variables);
      return result;
    }
  }),
  useQuery: (options: { queryKey: readonly unknown[]; queryType?: string }) => {
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
        data: [],
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
  generateAiPrefillProposals: mocks.generateAiPrefillProposals,
  proposalsQuery: mocks.proposalsQuery,
  queryKeys: {
    proposalsRoot: (projectId: string) => ["projects", projectId, "proposals"]
  },
  sourceFilesQuery: mocks.sourceFilesQuery
}));

import { AiPrefillPage } from "./ai-prefill.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AiPrefillPage", () => {
  beforeEach(() => {
    mocks.generateAiPrefillProposals.mockReset();
    mocks.generateAiPrefillProposals.mockImplementation(() => ({ proposals: [], diagnostics: [] }));
    mocks.invalidateQueries.mockReset();
    mocks.proposalsQuery.mockClear();
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
  });
}

function buttonNamed(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
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
