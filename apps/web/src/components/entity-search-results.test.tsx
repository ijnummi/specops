// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EntitySearchResultDto } from "@specops/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntitySearchResults } from "./entity-search-results.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    onClick,
    params,
    search,
    to
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    params: { projectId: string; entityId: string };
    search?: { q?: string };
    to: string;
  }) => (
    <a
      className={className}
      href={`${to}:${params.projectId}:${params.entityId}:${search?.q ?? ""}`}
      onClick={onClick}
    >
      {children}
    </a>
  )
}));

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EntitySearchResults", () => {
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

  it("renders compact search results with entity links", () => {
    const results: EntitySearchResultDto[] = [
      {
        entityId: "domain.customer",
        filePath: "specs/domain/customer.md",
        matchedFields: ["title", "bodyText"],
        rank: 0.5,
        snippet: "Customer profile requirements",
        status: "draft",
        title: "Customer",
        type: "domain_entity"
      }
    ];

    const container = renderEntitySearchResults({
      projectId: "project-1",
      query: "customer",
      results,
      selectedEntityId: null,
      variant: "compact"
    });

    expect(container.textContent).toContain("Customer");
    expect(container.textContent).toContain("domain.customer");
    expect(container.textContent).toContain("domain_entity");
    expect(container.textContent).toContain("draft");
    expect(container.textContent).toContain("Customer profile requirements");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/projects/$projectId/entities/$entityId:project-1:domain.customer:customer"
    );
  });

  it("renders expanded empty results", () => {
    const container = renderEntitySearchResults({
      projectId: "project-1",
      query: "missing",
      results: [],
      selectedEntityId: null,
      variant: "expanded"
    });

    expect(container.textContent).toContain("No results for");
    expect(container.textContent).toContain("missing");
  });
});

function renderEntitySearchResults(props: React.ComponentProps<typeof EntitySearchResults>) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(<EntitySearchResults {...props} />);
  });

  return container;
}
