import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const server = buildServer(config.databaseUrl, { aiPrefillConfig: config.aiPrefill });

await server.listen({ host: config.host, port: config.port });
