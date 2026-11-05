

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { CloudflareD1Adapter } from "../../src/server/drivers/d1.js";
import { splitSqlStatements } from "../card/render/render-test-storage.js";
import { randomBytes } from "../../deploy/shims/node-crypto-shim.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKER_ENTRY = `${REPO_ROOT}deploy/worker.ts`;
const CRYPTO_SHIM = `${REPO_ROOT}deploy/shims/node-crypto-shim.ts`;
const MIGRATIONS = `${REPO_ROOT}deploy/migrations/0001-schema.sql`;
const SEED = `${REPO_ROOT}deploy/seed/seed.sql`;

interface Chunk {
  type: string;
  code?: string;
}

let mf: Miniflare | undefined;
let adapter: CloudflareD1Adapter | undefined;

beforeAll(async () => {

  const viteResult = await build({
    configFile: false,
    logLevel: "warn",
    resolve: {
      alias: [{ find: "node:crypto", replacement: CRYPTO_SHIM }],
    },
    ssr: { noExternal: true },
    build: {
      write: false,
      minify: false,
      target: "es2022",
      ssr: true,
      rollupOptions: {
        input: WORKER_ENTRY,
        output: { format: "esm", entryFileNames: "deploy-worker.mjs" },
      },
    },
  });
  const outputs = (
    Array.isArray(viteResult) ? viteResult : [viteResult]
  ) as unknown as Array<{ output: Chunk[] }>;
  const bundle =
    outputs[0]?.output.find((chunk) => chunk.type === "chunk")?.code ?? "";

  expect(bundle).not.toContain("node:crypto");
  expect(bundle.length).toBeGreaterThan(10_000);

  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle,
      d1Databases: { DB: "decko-deploy-proof" },
    }),
  );
  const binding = await mf.getD1Database("DB");
  adapter = new CloudflareD1Adapter(binding);

  for (const statement of splitSqlStatements(readFileSync(MIGRATIONS, "utf8"))) {
    await adapter.query(statement, []);
  }
  await adapter.batch(
    splitSqlStatements(readFileSync(SEED, "utf8")).map((sql) => ({ sql, params: [] })),
  );
}, 180_000);

afterAll(async () => {
  await mf?.dispose();
});

async function fetchPath(pathAndQuery: string, init?: Record<string, unknown>): Promise<Response> {
  return (await mf!.dispatchFetch(
    `https://decko-demo.test${pathAndQuery}`,
    init as never,
  )) as unknown as Response;
}

describe("node:crypto shim (Web-standard route-around)", () => {
  it("produces the 20-lowercase-hex slot id shape", () => {
    const hex = randomBytes(10).toString("hex");
    expect(hex).toMatch(/^[0-9a-f]{20}$/);
  });

  it("rejects non-integer sizes", () => {
    expect(() => randomBytes(-1)).toThrow();
    expect(() => randomBytes(1.5)).toThrow();
  });
});

describe("deploy worker under miniflare (workerd + local D1)", () => {
  it("GET /_status reports engine + database health with the seeded count", async () => {
    const response = await fetchPath("/_status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      engine: string;
      database: { ok: boolean; card_count: number };
    };
    expect(body.ok).toBe(true);
    expect(body.engine).toBe("decko-ts");
    expect(body.database.ok).toBe(true);
    expect(body.database.card_count).toBe(15);
  });

  it("GET / renders the Home card with the inclusion chain four levels deep", async () => {
    const response = await fetchPath("/");
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("Welcome to the decko-ts synthetic demo deck");
    expect(html).toContain("Section One rendered as a compound card");
    expect(html).toContain("History body text — the fourth inclusion level");

    expect(html).toContain("data-slot=");
  });

  it("GET /:card-name renders that card (simple name)", async () => {
    const response = await fetchPath("/About");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("only synthetic demo content");
  });

  it("GET /:card-name resolves a depth-2 compound name (URL: + is the joint, %20 the space)", async () => {
    const response = await fetchPath("/Demo%20Guide+Section%20One");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Section One rendered as a compound card");
  });

  it("GET /:card-name renders the deepest node of the depth-4 compound chain through the Lexicon", async () => {
    const response = await fetchPath("/Demo%20Guide+Section%20One+Detail+History");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("History body at compound depth 4");
  });

  it("GET /:card-name treats '+' as the decko joint, not a space", async () => {

    const response = await fetchPath("/Demo+Guide");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Card not found");
  });

  it("GET /~10 resolves the id mark through the primed name environment", async () => {

    const response = await fetchPath("/~10");
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("Welcome to the decko-ts synthetic demo deck");
  });

  it("GET /:search_type resolves the codename mark through the primed codehash", async () => {

    const response = await fetchPath("/:search_type");
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain('data-card-name="Search"');
  });

  it("GET /:card-name.json returns the card record with its type name", async () => {
    const response = await fetchPath("/Home.json");
    expect(response.status).toBe(200);
    const record = (await response.json()) as {
      name: string;
      key: string;
      type_name: string | null;
      db_content: string | null;
    };
    expect(record.name).toBe("Home");
    expect(record.key).toBe("home");
    expect(record.type_name).toBe("Note");
    expect(record.db_content).toContain("{{Demo Guide}}");
  });

  it("GET /:card-name.json 404s unknown cards as JSON", async () => {
    const response = await fetchPath("/Missing.json");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "card not found", name: "Missing" });
  });

  it("GET /:card-name 404s unknown cards as HTML", async () => {
    const response = await fetchPath("/NoSuchCard");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Card not found");
  });

  it("POST /api/query executes CQL with the primed name resolver (type + sort)", async () => {
    const response = await fetchPath("/api/query", {
      method: "POST",
      body: JSON.stringify({ cql: { type: "Note", sort: "name" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      rows: Array<{ id: number; name: string | null }>;
      sql: string;
    };

    expect(result.rows.map((row) => row.id).sort((a, b) => a - b)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(result.sql).toContain("ORDER BY");
  });

  it("POST /api/query resolves name conditions and count returns", async () => {
    const response = await fetchPath("/api/query", {
      method: "POST",
      body: JSON.stringify({ cql: { name: "Home" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { rows: Array<{ id: number }> };
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe(10);
  });

  it("POST /api/query accepts a JSON-encoded cql string and executes counts", async () => {
    const response = await fetchPath("/api/query", {
      method: "POST",
      body: JSON.stringify({ cql: '{"type":"User","return":"count"}' }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { count: number };
    expect(result.count).toBe(1);
  });

  it("POST /api/query 400s bad CQL and malformed bodies", async () => {
    const badCql = await fetchPath("/api/query", {
      method: "POST",
      body: JSON.stringify({ cql: { bogus_attribute: 1 } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(badCql.status).toBe(400);

    const notJson = await fetchPath("/api/query", {
      method: "POST",
      body: "this is not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(notJson.status).toBe(400);

    const missingCql = await fetchPath("/api/query", {
      method: "POST",
      body: JSON.stringify({ query: {} }),
      headers: { "Content-Type": "application/json" },
    });
    expect(missingCql.status).toBe(400);
  });

  it("rejects wrong methods on the API routes", async () => {
    const getStatus = await fetchPath("/_status", { method: "POST" });
    expect(getStatus.status).toBe(405);
    const getQuery = await fetchPath("/api/query");
    expect(getQuery.status).toBe(405);
  });

  it("404s unknown paths (no accidental card render for slash paths)", async () => {
    const response = await fetchPath("/no/route/here");
    expect(response.status).toBe(404);
  });

  it("GET /:card-name.json 403s a read-denied card instead of serving db_content", async () => {

    const T = "2026-09-20 00:00:00.000";
    const insert = (values: string): string =>
      `INSERT INTO cards (\n` +
      `  id, name, key, codename, left_id, right_id, current_revision_id,\n` +
      `  created_at, updated_at, creator_id, updater_id,\n` +
      `  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content\n` +
      `) VALUES (\n${values}\n)`;
    for (const statement of [

      insert(`9001, '*read', 'read', 'read', NULL, NULL, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 3, NULL`),
      insert(`9002, '*all', 'all', 'all', NULL, NULL, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 3, NULL`),
      insert(`9003, 'Set', 'set', 'set', NULL, NULL, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 3, NULL`),
      insert(`9004, '*self', 'self', 'self', NULL, NULL, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 3, NULL`),

      insert(`9010, 'Probe Restricted', 'probe_restricted', NULL, NULL, NULL, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 5, 'Restricted secret body'`),
      insert(`9011, NULL, NULL, NULL, 9010, 9004, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 9003, NULL`),
      insert(`9012, NULL, NULL, NULL, 9011, 9001, NULL, '${T}', '${T}', 1, 1, NULL, NULL, NULL, 0, 5, NULL`),

      `UPDATE cards SET read_rule_id = 9012, read_rule_class = 'R' WHERE id = 9010`,
    ]) {
      await adapter!.query(statement, []);
    }

    const page = await fetchPath("/Probe%20Restricted");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('class="denied"');
    expect(html).not.toContain("Restricted secret body");

    const record = await fetchPath("/Probe%20Restricted.json");
    expect(record.status).toBe(403);
    const body = await record.json() as { error?: string; name?: string };
    expect(body).toMatchObject({ error: "permission denied", name: "Probe Restricted" });
    expect(JSON.stringify(body)).not.toContain("Restricted secret body");

    const home = await fetchPath("/Home.json");
    expect(home.status).toBe(200);
  });
});
