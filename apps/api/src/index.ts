import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const server = buildServer(config.databaseUrl);

await server.listen({ host: config.host, port: config.port });
