import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fastifyFormbody from "@fastify/formbody";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import "./db/index.js"; // applies schema on boot
import { registerTelephonyRoutes } from "./telephony/routes.js";
import { registerApiRoutes } from "./api/routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(fastifyFormbody);
await app.register(fastifyWebsocket);
await app.register(fastifyStatic, {
  root: join(__dirname, "..", "public"),
  prefix: "/",
});

app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

await registerTelephonyRoutes(app);
await registerApiRoutes(app);

app.listen({ port: env.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Unsay listening on ${address}`);
  console.log(`Public URL: ${env.publicBaseUrl}`);
  console.log(`Calls enabled: ${env.callsEnabled}`);
});
