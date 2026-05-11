import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Braces, ChevronLeft, ChevronRight, Database, Rows3, Search, Table2 } from "lucide-react";

import {
  adminDatabaseRowNeighborQuery,
  adminDatabaseRowQuery,
  adminDatabaseRowsQuery,
  adminDatabaseSchemaQuery,
  adminDatabaseTablesQuery,
  type AdminDatabaseRowsDto,
  type AdminDatabaseSchemaDto,
  type AdminDatabaseTableDto
} from "../api/queries.js";

export type AdminDatabaseMode = "schema" | "row" | "rows";

type AdminDatabasePageProps = {
  tableName?: string;
  mode: AdminDatabaseMode;
  rowId?: string;
};

const rowLimit = 50;

export function AdminDatabasePage({ tableName, mode, rowId }: AdminDatabasePageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tables = useQuery(adminDatabaseTablesQuery());
  const selectedTableName = tableName ?? tables.data?.[0]?.name ?? "";
  const selectedTable = tables.data?.find((table) => table.name === selectedTableName) ?? null;
  const [rowIdInput, setRowIdInput] = useState(rowId ?? "");

  useEffect(() => {
    setRowIdInput(rowId ?? "");
  }, [rowId]);

  const schema = useQuery({
    ...adminDatabaseSchemaQuery(selectedTableName),
    enabled: selectedTableName.length > 0 && mode === "schema"
  });
  const selectedRow = useQuery({
    ...adminDatabaseRowQuery(selectedTableName, rowId ?? ""),
    enabled: selectedTableName.length > 0 && mode === "row" && Boolean(rowId)
  });
  const rows = useQuery({
    ...adminDatabaseRowsQuery(selectedTableName, rowLimit),
    enabled: selectedTableName.length > 0 && mode === "rows"
  });

  const navigateTo = (next: {
    table?: string;
    mode?: AdminDatabaseMode;
    rowId?: string | undefined;
  }) =>
    navigate({
      to: "/admin/database",
      search: {
        table: next.table ?? selectedTableName,
        mode: next.mode ?? mode,
        rowId: next.rowId
      }
    });

  const showRowId = rowIdInput.trim();

  async function navigateToNeighbor(direction: "prev" | "next") {
    if (!selectedTableName || !rowId) {
      return;
    }

    const response = await queryClient.fetchQuery(
      adminDatabaseRowNeighborQuery(selectedTableName, rowId, direction)
    );
    const nextRowId = readRowId(response.row);

    if (nextRowId) {
      navigateTo({ mode: "row", rowId: nextRowId });
    }
  }

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 truncate text-base font-semibold">
            <Database className="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />
            Database
          </h1>
          <p className="truncate text-sm text-slate-600">Read-only inspection for known tables.</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-3">
            <h2 className="section-heading">Tables</h2>
          </div>
          <div className="min-h-0 overflow-auto p-2">
            {tables.isLoading ? (
              <p className="p-2 text-sm text-slate-500">Loading tables...</p>
            ) : tables.error ? (
              <ErrorPanel message={tables.error.message} compact />
            ) : tables.data && tables.data.length > 0 ? (
              <div className="grid gap-1">
                {tables.data.map((table) => (
                  <TableButton
                    key={table.name}
                    table={table}
                    isSelected={table.name === selectedTableName}
                    onSelect={() => navigateTo({ table: table.name, mode, rowId: undefined })}
                  />
                ))}
              </div>
            ) : (
              <p className="p-2 text-sm text-slate-500">No known tables.</p>
            )}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden rounded border border-slate-200 bg-white">
          <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-900">
                {selectedTableName || "Select a table"}
              </h2>
              <p className="truncate text-xs text-slate-500">
                {selectedTable ? `${selectedTable.rowCount} rows` : "Known table metadata"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <ModeButton
                label="Schema"
                icon={<Table2 className="h-4 w-4" aria-hidden="true" />}
                isSelected={mode === "schema"}
                onClick={() => navigateTo({ mode: "schema", rowId })}
              />
              <ModeButton
                label="Row JSON"
                icon={<Braces className="h-4 w-4" aria-hidden="true" />}
                isSelected={mode === "row"}
                onClick={() => navigateTo({ mode: "row", rowId })}
              />
              <ModeButton
                label="Data List"
                icon={<Rows3 className="h-4 w-4" aria-hidden="true" />}
                isSelected={mode === "rows"}
                onClick={() => navigateTo({ mode: "rows", rowId })}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-auto p-4">
            {!selectedTableName ? (
              <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
                Select a known table.
              </div>
            ) : mode === "schema" ? (
              <SchemaPanel schema={schema} />
            ) : mode === "row" ? (
              <div className="grid gap-3">
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    navigateTo({ mode: "row", rowId: showRowId || undefined });
                  }}
                >
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={!rowId}
                    onClick={() => void navigateToNeighbor("prev")}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Previous row
                  </button>
                  <input
                    className="input max-w-[360px]"
                    aria-label="Row id"
                    value={rowIdInput}
                    placeholder="Row id"
                    onChange={(event) => setRowIdInput(event.target.value)}
                  />
                  <button className="button-secondary" type="submit">
                    <Search className="h-4 w-4" aria-hidden="true" />
                    Show row
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={!rowId}
                    onClick={() => void navigateToNeighbor("next")}
                  >
                    Next row
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </form>
                {!rowId ? (
                  <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
                    Enter a row id to inspect JSON.
                  </div>
                ) : selectedRow.error ? (
                  <ErrorPanel message={selectedRow.error.message} />
                ) : selectedRow.isLoading ? (
                  <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
                    Loading row...
                  </div>
                ) : selectedRow.data?.row ? (
                  <JsonBlock value={selectedRow.data.row} />
                ) : (
                  <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
                    No row found.
                  </div>
                )}
              </div>
            ) : (
              <RowsPanel rows={rows} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function TableButton({
  table,
  isSelected,
  onSelect
}: {
  table: AdminDatabaseTableDto;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={[
        "grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-2 text-left text-sm transition",
        isSelected
          ? "border-slate-400 bg-slate-100 text-slate-950"
          : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
      ].join(" ")}
      type="button"
      onClick={onSelect}
    >
      <span className="truncate font-medium">{table.label}</span>
      <span className="text-xs text-slate-500">{table.rowCount}</span>
    </button>
  );
}

function ModeButton({
  icon,
  isSelected,
  label,
  onClick
}: {
  icon: ReactNode;
  isSelected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "inline-flex h-9 min-w-0 items-center gap-2 rounded border px-3 text-sm font-medium transition",
        isSelected
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
      ].join(" ")}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function SchemaPanel({
  schema
}: {
  schema: UseQueryResult<AdminDatabaseSchemaDto, Error>;
}) {
  if (schema.error) {
    return <ErrorPanel message={schema.error.message} />;
  }
  if (schema.isLoading) {
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
        Loading schema...
      </div>
    );
  }
  if (!schema.data) {
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
        Schema unavailable.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-slate-200">
      <div className="grid grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_90px] border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
        <span>Column</span>
        <span>Type</span>
        <span>Required</span>
      </div>
      {schema.data.columns.map((column) => (
        <div
          key={column.name}
          className="grid grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_90px] border-b border-slate-100 px-3 py-2 text-sm last:border-b-0"
        >
          <code className="truncate text-xs text-slate-900">{column.name}</code>
          <span className="truncate text-slate-600">{column.dataType}</span>
          <span className="text-slate-600">{column.notNull ? "yes" : "no"}</span>
        </div>
      ))}
    </div>
  );
}

function RowsPanel({
  rows
}: {
  rows: UseQueryResult<AdminDatabaseRowsDto, Error>;
}) {
  const rowList = rows.data?.rows ?? [];

  if (rows.error) {
    return <ErrorPanel message={rows.error.message} />;
  }
  if (rows.isLoading) {
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
        Loading rows...
      </div>
    );
  }
  if (rowList.length === 0) {
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">
        No rows found.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">{rowList.length} rows shown</p>
      {rowList.map((row, index) => (
        <article
          key={readRowId(row) ?? index}
          className="min-w-0 rounded border border-slate-200 p-3"
        >
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
            <code className="truncate text-xs font-semibold text-slate-800">
              {readRowId(row) ?? `row-${index + 1}`}
            </code>
            <span className="shrink-0 text-xs text-slate-500">#{index + 1}</span>
          </div>
          <JsonBlock value={row} compact />
        </article>
      ))}
    </div>
  );
}

function JsonBlock({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);

  return (
    <pre
      className={[
        "min-w-0 overflow-auto rounded bg-slate-950 p-3 text-xs leading-5 text-slate-100",
        compact ? "max-h-52" : "max-h-[calc(100vh-280px)]"
      ].join(" ")}
    >
      {json}
    </pre>
  );
}

function ErrorPanel({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      className={[
        "rounded border border-red-200 bg-red-50 text-sm text-red-800",
        compact ? "p-2" : "p-4"
      ].join(" ")}
    >
      {message}
    </div>
  );
}

function readRowId(row: Record<string, unknown> | null | undefined) {
  return typeof row?.id === "string" ? row.id : null;
}
