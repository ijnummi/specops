// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminDatabasePage } from "./admin-database.js";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  tables: [
    { name: "projects", label: "projects", rowCount: 2, supportsRowId: true },
    { name: "spec_entities", label: "spec_entities", rowCount: 4, supportsRowId: true }
  ],
  schema: {
    table: "projects",
    primaryKey: "id",
    columns: [
      { name: "id", dataType: "uuid", notNull: true },
      { name: "name", dataType: "text", notNull: true },
      { name: "created_at", dataType: "timestamp with time zone", notNull: true }
    ]
  },
  row: {
    table: "projects",
    row: {
      id: "00000000-0000-4000-8000-000000000101",
      name: "Sample"
    }
  },
  rows: {
    table: "projects",
    rows: [
      { id: "00000000-0000-4000-8000-000000000101", name: "Sample" },
      { id: "00000000-0000-4000-8000-000000000102", name: "Second" }
    ],
    limit: 50
  },
  nextRow: {
    table: "projects",
    row: { id: "00000000-0000-4000-8000-000000000102", name: "Second" }
  },
  prevRow: {
    table: "projects",
    row: { id: "00000000-0000-4000-8000-000000000100", name: "Previous" }
  }
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate
}));

vi.mock("../api/queries.js", async () => {
  const actual = await vi.importActual<typeof import("../api/queries.js")>("../api/queries.js");

  return {
    ...actual,
    adminDatabaseTablesQuery: () => ({
      queryKey: ["admin", "database", "tables"],
      queryFn: async () => mocks.tables
    }),
    adminDatabaseSchemaQuery: (table: string) => ({
      queryKey: ["admin", "database", table, "schema"],
      queryFn: async () => mocks.schema
    }),
    adminDatabaseRowQuery: (table: string, rowId: string) => ({
      queryKey: ["admin", "database", table, "row", rowId],
      queryFn: async () => mocks.row
    }),
    adminDatabaseRowNeighborQuery: (
      table: string,
      rowId: string,
      direction: "prev" | "next"
    ) => ({
      queryKey: ["admin", "database", table, "row-neighbor", rowId, direction],
      queryFn: async () => (direction === "next" ? mocks.nextRow : mocks.prevRow)
    }),
    adminDatabaseRowsQuery: (table: string, limit: number) => ({
      queryKey: ["admin", "database", table, "rows", limit],
      queryFn: async () => mocks.rows
    })
  };
});

const roots: Root[] = [];
const containers: HTMLElement[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminDatabasePage", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
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

  it("renders table navigation and schema mode", async () => {
    const { container } = await renderAdminDatabasePage({ mode: "schema" });

    expect(container.textContent).toContain("Database");
    expect(container.textContent).toContain("projects");
    expect(container.textContent).toContain("spec_entities");
    expect(container.textContent).toContain("Schema");
    expect(container.textContent).toContain("Row JSON");
    expect(container.textContent).toContain("Data List");
    expect(container.textContent).toContain("created_at");
    expect(container.textContent).toContain("timestamp with time zone");
  });

  it("renders one selected row as formatted JSON", async () => {
    const { container } = await renderAdminDatabasePage({
      mode: "row",
      rowId: "00000000-0000-4000-8000-000000000101"
    });

    expect(container.textContent).toContain('"name": "Sample"');
    expect(container.textContent).toContain("Show row");
    expect(container.textContent).toContain("Previous row");
    expect(container.textContent).toContain("Next row");
  });

  it("navigates to the previous and next row ids returned by the API", async () => {
    const { container } = await renderAdminDatabasePage({
      mode: "row",
      rowId: "00000000-0000-4000-8000-000000000101"
    });

    await clickButton(container, "Next row");
    await clickButton(container, "Previous row");

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/admin/database",
      search: {
        table: "projects",
        mode: "row",
        rowId: "00000000-0000-4000-8000-000000000102"
      }
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/admin/database",
      search: {
        table: "projects",
        mode: "row",
        rowId: "00000000-0000-4000-8000-000000000100"
      }
    });
  });

  it("renders table data as a list", async () => {
    const { container } = await renderAdminDatabasePage({ mode: "rows" });

    expect(container.textContent).toContain("2 rows shown");
    expect(container.textContent).toContain("Sample");
    expect(container.textContent).toContain("Second");
  });
});

async function renderAdminDatabasePage(props: {
  tableName?: string;
  mode: "schema" | "row" | "rows";
  rowId?: string;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AdminDatabasePage tableName="projects" {...props} />
      </QueryClientProvider>
    );
  });

  await act(async () => {
    await waitForQueryResult();
  });

  return { container };
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  );

  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForQueryResult();
  });
}

function waitForQueryResult() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
