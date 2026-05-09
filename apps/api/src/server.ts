import cors from "@fastify/cors";
import { createDb } from "@specops/db";
import Fastify from "fastify";
import { ZodError } from "zod";

import { isHttpError } from "./lib/http-errors.js";
import { registerAgentTaskRoutes } from "./routes/agent-tasks.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerIndexRunRoutes } from "./routes/index-runs.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerValidationRoutes } from "./routes/validation.js";

export function buildServer(databaseUrl: string) {
  const app = Fastify({ logger: true });
  const db = createDb(databaseUrl);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "bad_request",
          message: "Invalid request",
          details: error.flatten()
        }
      });
      return;
    }

    if (isHttpError(error)) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      });
      return;
    }

    const statusCode = readStatusCode(error);
    reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "internal_error" : "bad_request",
        message: error instanceof Error ? error.message : "Unexpected error"
      }
    });
  });

  app.addHook("onClose", async () => {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.register(registerProjectRoutes, { prefix: "/api", db });
  app.register(registerEntityRoutes, { prefix: "/api", db });
  app.register(registerAgentTaskRoutes, { prefix: "/api", db });
  app.register(registerSearchRoutes, { prefix: "/api", db });
  app.register(registerValidationRoutes, { prefix: "/api", db });
  app.register(registerIndexRunRoutes, { prefix: "/api", db });

  return app;
}

function readStatusCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return 500;
}
