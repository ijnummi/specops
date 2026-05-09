import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export type Db = ReturnType<typeof createDb>;

export function createPool(connectionString: string) {
  return new Pool({ connectionString });
}

export function createDb(connectionString: string) {
  const pool = createPool(connectionString);
  return drizzle(pool, { schema });
}
