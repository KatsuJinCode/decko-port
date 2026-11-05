import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const fromDist = name => import(pathToFileURL(path.join(repo, "dist", name)).href);
const port = Number(process.env.HARNESS_PORT);
if (!Number.isInteger(port) || port <= 0 || !process.env.HARNESS_DECK) throw new Error("runner-owned deck and port are required");
const spec = JSON.parse(readFileSync(process.env.HARNESS_DECK_JSON, "utf8"));
const { startMockHranaServer } = await fromDist("tests/server/drivers/mock-hrana-server.js");
const { handleBunnyEngineRequest, initializeBunnyServingRenderPolicy } = await fromDist("deploy/bunny-worker-src/bunny-edge-engine-handler.js");
initializeBunnyServingRenderPolicy();
const { setCaptureWallClock } = await fromDist("src/card/wall-clock.js");
const { LocalSqliteDriver } = await fromDist("src/server/drivers/local-sqlite.js");
const { runAuthMigrations } = await fromDist("src/card/auth/migrations.js");
const { CaptureTransport } = await fromDist("src/card/notify/transport.js");
const { ensureFreshnessStamp } = await fromDist("src/server/freshness-stamp.js");
const { startMockBunnyStorage } = await import(pathToFileURL(path.join(repo, "tests/server/mock-bunny-storage.mjs")).href);
const provisioningDriver = new LocalSqliteDriver({ path: process.env.HARNESS_DECK });
try {
  await runAuthMigrations(provisioningDriver, { migrationsDir: path.join(repo, "db", "migrations") });
  await ensureFreshnessStamp(provisioningDriver);
} finally { provisioningDriver.close(); }
if (process.env.HARNESS_FROZEN_CLOCK === "1" || process.env.HARNESS_CLOCK === "frozen") {
  setCaptureWallClock(new Date(spec.clock));
}
const hrana = await startMockHranaServer({ path: process.env.HARNESS_DECK });
const storage = await startMockBunnyStorage({ filesRoot: process.env.HARNESS_FILES });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const prefix = `https://${storage.host}/`;
  return originalFetch(value.startsWith(prefix) ? `http://${storage.host}/${value.slice(prefix.length)}` : input, init);
};
const origin = `http://127.0.0.1:${port}`;
const outbox = new CaptureTransport("bunny-browser-local-capture");
const frozenClock = process.env.HARNESS_FROZEN_CLOCK === "1" || process.env.HARNESS_CLOCK === "frozen";
const services = { accountMail: {
  transport: outbox,
  token: {
    secret: "local-journey-fixture-token-secret",
    ...(frozenClock ? { now: () => Math.floor(new Date(spec.clock).getTime() / 1000) } : {}),
  },
  origin, siteTitle: "My Deck",
} };
const env = {
  DECKO_DB_URL: hrana.url,
  DECKO_DB_TOKEN: "local-journey-only",
  DECKO_DECK_ORIGIN: origin,
  DECKO_ORIGIN: origin,
  DECKO_WRITE_PATH: "1",
  DECKO_FONT_AWESOME: process.env.DECKO_FONT_AWESOME ?? "local",
  DECKO_TOKEN_SECRET: "local-journey-fixture-token-secret",
  DECKO_STORAGE_ZONE: storage.zone,
  DECKO_STORAGE_PASSWORD: storage.password,
  DECKO_STORAGE_HOST: storage.host,
};
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/__harness/ready") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ host: "bunny-handler-node-local-hrana", productionRuntime: false }));
      return;
    }
    if (req.url === "/__harness/runtime") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ engine: "bunny-handler-node-local-hrana", node: process.version, productionRuntime: false, passwordHash: "pbkdf2-default", assetRefresh: "host-default", mailConfigured: true, mailProvider: "local-capture-notify-transport", fontAwesomeAssetMode: env.DECKO_FONT_AWESOME, fontAwesomeVersion: env.DECKO_FONT_AWESOME === "local" ? "6.7.2" : null, objectStorageConfigured: true, objectStorageProvider: "local-bunny-http-emulator" }));
      return;
    }
    if (req.url === "/__harness/mail") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(outbox.drain().map(message => ({
        to: String(message.to).split(",").map(value => value.trim()).filter(Boolean).sort(),
        subject: message.subject, text: message.textBody,
      }))));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
    }
    const method = req.method ?? "GET";
    const request = new Request(new URL(req.url ?? "/", origin), { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body }) });
    const response = await handleBunnyEngineRequest(request, env, services);
    res.statusCode = response.status;
    for (const [name, value] of response.headers) if (name !== "set-cookie") res.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.end(method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Local Bunny handler failed; see owned server log");
  }
});
server.listen(port, "127.0.0.1");
async function close() { server.close(); await hrana.close(); await storage.stop(); }
process.once("SIGTERM", () => { void close(); });
process.once("SIGINT", () => { void close(); });
