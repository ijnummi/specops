export type ApiConfig = {
  databaseUrl: string;
  host: string;
  port: number;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const port = Number.parseInt(env.API_PORT ?? "4000", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("API_PORT must be a valid TCP port");
  }

  return {
    databaseUrl,
    host: env.API_HOST ?? "127.0.0.1",
    port
  };
}
