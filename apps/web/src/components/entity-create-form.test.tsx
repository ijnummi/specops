// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntityCreateForm } from "./entity-create-form.js";

const mocks = vi.hoisted(() => ({
  createEntity: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn()
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: () => unknown; onSuccess?: (entity: { entityId: string }) => unknown }) => ({
    error: null,
    isPending: false,
    mutate: async () => {
      const entity = await options.mutationFn();
      await options.onSuccess?.(entity as { entityId: string });
    }
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock("../api/queries.js", () => ({
  createEntity: mocks.createEntity,
  queryKeys: {
    entities: (projectId: string) => ["projects", projectId, "entities"],
    indexRuns: (projectId: string) => ["projects", projectId, "index-runs"],
    project: (projectId: string) => ["projects", projectId],
    projectHealth: (projectId: string) => ["projects", projectId, "health"],
    projectOverview: (projectId: string) => ["projects", projectId, "overview"],
    validation: (projectId: string) => ["projects", projectId, "validation-messages"]
  }
}));

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EntityCreateForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    for (const container of containers.splice(0)) {
      container.remove();
    }
  });

  it("invalidates the project overview after creating an entity", async () => {
    mocks.createEntity.mockResolvedValue({ entityId: "domain.new" });
    const container = renderEntityCreateForm();

    await act(async () => {
      clickButton(container, "New Entity");
    });
    setInputValue(container, "Entity ID", "domain.new");
    setInputValue(container, "Title", "New Domain");

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await waitForMutation();
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "overview"]
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1", "health"]
    });
  });
});

function renderEntityCreateForm() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(<EntityCreateForm projectId="project-1" />);
  });

  return container;
}

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((element) =>
    element.textContent?.includes(label)
  );

  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  button.click();
}

function setInputValue(container: HTMLElement, placeholder: string, value: string) {
  const input = Array.from(container.querySelectorAll("input")).find(
    (element) => element.placeholder === placeholder
  );

  if (!input) {
    throw new Error(`Input not found: ${placeholder}`);
  }

  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function waitForMutation() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
