import type { Db } from "@specops/db";
import {
  aiProposals,
  indexRuns,
  projects,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSpecLinks,
  sourceSymbols,
  specEntities,
  specFiles,
  specLinks,
  validationMessages
} from "@specops/db";
import { getTableColumns, sql } from "drizzle-orm";

import { NotFoundError } from "../lib/http-errors.js";

type AdminTableName =
  | "projects"
  | "index_runs"
  | "spec_files"
  | "spec_entities"
  | "spec_links"
  | "validation_messages"
  | "source_files"
  | "source_imports"
  | "source_exports"
  | "source_symbols"
  | "source_spec_links"
  | "ai_proposals";

type AdminTableDefinition = {
  name: AdminTableName;
  table: unknown;
  primaryKey: "id";
};

type CountRow = {
  count: number | string;
};

export type AdminDatabaseTableDto = {
  name: AdminTableName;
  label: string;
  rowCount: number;
  supportsRowId: boolean;
};

export type AdminDatabaseColumnDto = {
  name: string;
  dataType: string;
  notNull: boolean;
};

export type AdminDatabaseSchemaDto = {
  table: AdminTableName;
  primaryKey: string;
  columns: AdminDatabaseColumnDto[];
};

export type AdminDatabaseRowDto = {
  table: AdminTableName;
  row: Record<string, unknown> | null;
};

export type AdminDatabaseRowsDto = {
  table: AdminTableName;
  rows: Array<Record<string, unknown>>;
  limit: number;
};

const adminTables: AdminTableDefinition[] = [
  { name: "projects", table: projects, primaryKey: "id" },
  { name: "index_runs", table: indexRuns, primaryKey: "id" },
  { name: "spec_files", table: specFiles, primaryKey: "id" },
  { name: "spec_entities", table: specEntities, primaryKey: "id" },
  { name: "spec_links", table: specLinks, primaryKey: "id" },
  { name: "validation_messages", table: validationMessages, primaryKey: "id" },
  { name: "source_files", table: sourceFiles, primaryKey: "id" },
  { name: "source_imports", table: sourceImports, primaryKey: "id" },
  { name: "source_exports", table: sourceExports, primaryKey: "id" },
  { name: "source_symbols", table: sourceSymbols, primaryKey: "id" },
  { name: "source_spec_links", table: sourceSpecLinks, primaryKey: "id" },
  { name: "ai_proposals", table: aiProposals, primaryKey: "id" }
];

const tableLookup = new Map(adminTables.map((table) => [table.name, table]));

export function createAdminDatabaseService(db: Pick<Db, "execute">) {
  return {
    async listTables(): Promise<AdminDatabaseTableDto[]> {
      return Promise.all(
        adminTables.map(async (definition) => ({
          name: definition.name,
          label: definition.name,
          rowCount: await countRows(db, definition),
          supportsRowId: true
        }))
      );
    },

    getSchema(tableName: string): AdminDatabaseSchemaDto {
      const definition = readTableDefinition(tableName);

      return {
        table: definition.name,
        primaryKey: definition.primaryKey,
        columns: readColumns(definition)
      };
    },

    async getRow(tableName: string, id: string): Promise<AdminDatabaseRowDto> {
      const definition = readTableDefinition(tableName);
      const result = await db.execute<Record<string, unknown>>(sql`
        select *
        from ${sql.raw(definition.name)}
        where id = ${id}
        limit 1
      `);

      return {
        table: definition.name,
        row: result.rows[0] ?? null
      };
    },

    async getNeighbor(
      tableName: string,
      id: string,
      direction: "prev" | "next"
    ): Promise<AdminDatabaseRowDto> {
      const definition = readTableDefinition(tableName);
      const operator = direction === "next" ? sql.raw(">") : sql.raw("<");
      const order = direction === "next" ? sql.raw("asc") : sql.raw("desc");
      const result = await db.execute<Record<string, unknown>>(sql`
        select *
        from ${sql.raw(definition.name)}
        where id ${operator} ${id}
        order by id ${order}
        limit 1
      `);

      return {
        table: definition.name,
        row: result.rows[0] ?? null
      };
    },

    async listRows(tableName: string, limit: number): Promise<AdminDatabaseRowsDto> {
      const definition = readTableDefinition(tableName);
      const result = await db.execute<Record<string, unknown>>(sql`
        select *
        from ${sql.raw(definition.name)}
        order by id asc
        limit ${limit}
      `);

      return {
        table: definition.name,
        rows: result.rows,
        limit
      };
    }
  };
}

function readTableDefinition(tableName: string): AdminTableDefinition {
  const definition = tableLookup.get(tableName as AdminTableName);

  if (!definition) {
    throw new NotFoundError("Unknown admin database table");
  }

  return definition;
}

async function countRows(db: Pick<Db, "execute">, definition: AdminTableDefinition) {
  const result = await db.execute<CountRow>(sql`
    select count(*)::int as count
    from ${sql.raw(definition.name)}
  `);
  const value = result.rows[0]?.count ?? 0;
  return typeof value === "number" ? value : Number(value);
}

function readColumns(definition: AdminTableDefinition): AdminDatabaseColumnDto[] {
  const columns = getTableColumns(definition.table as never);

  return Object.values(columns).map((column) => {
    const typedColumn = column as {
      name: string;
      notNull: boolean;
      getSQLType: () => string;
    };

    return {
      name: typedColumn.name,
      dataType: typedColumn.getSQLType(),
      notNull: typedColumn.notNull
    };
  });
}
