import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fastifyFormbody from "@fastify/formbody";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import "./db/index.js"; // applies schema on boot
import { registerTelephonyRoutes } from "./telephony/routes.js";
import { registerApiRoutes } from "./api/routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = Fastify({ logger: true });

await app.register(fastifyFormbody);
await app.register(fastifyWebsocket);
await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/",
  index: false, // index.html is served explicitly below, with cache-busted asset URLs
});

// Cache-busting: a redeploy must never leave a browser running stale
// app.js/style.css — hash both at boot and append ?v=<hash> to their URLs
// in the served index.html (the query string doesn't affect static routing).
const assetVersion = createHash("md5")
  .update(readFileSync(join(publicDir, "app.js")))
  .update(readFileSync(join(publicDir, "style.css")))
  .digest("hex")
  .slice(0, 10);

const indexHtml = readFileSync(join(publicDir, "index.html"), "utf-8")
  .replace('src="/app.js"', `src="/app.js?v=${assetVersion}"`)
  .replace('href="/style.css"', `href="/style.css?v=${assetVersion}"`);

app.get("/", async (_req, reply) => reply.type("text/html").send(indexHtml));

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
