import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAdminDatabaseService } from "../services/admin-database-service.js";

type RouteOptions = {
  db: Db;
};

const tableParamsSchema = z.object({
  table: z.string().min(1)
});

const rowQuerySchema = z.object({
  id: z.string().uuid()
});

const rowNeighborQuerySchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["prev", "next"])
});

const rowsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const registerAdminDatabaseRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { db }
) => {
  const adminDatabaseService = createAdminDatabaseService(db);

  app.get("/admin/database/tables", async () => adminDatabaseService.listTables());

  app.get("/admin/database/tables/:table/schema", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    return adminDatabaseService.getSchema(table);
  });

  app.get("/admin/database/tables/:table/row", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    const { id } = rowQuerySchema.parse(request.query);
    return adminDatabaseService.getRow(table, id);
  });

  app.get("/admin/database/tables/:table/row-neighbor", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    const { id, direction } = rowNeighborQuerySchema.parse(request.query);
    return adminDatabaseService.getNeighbor(table, id, direction);
  });

  app.get("/admin/database/tables/:table/rows", async (request) => {
    const { table } = tableParamsSchema.parse(request.params);
    const { limit } = rowsQuerySchema.parse(request.query);
    return adminDatabaseService.listRows(table, limit);
  });
};
