// CloudflareD1Adapter integration tests under miniflare's local D1
// emulation (workerd runs for real; no Cloudflare account involved).
//
// Miniflare 5 alpha note (2026-09-19, miniflare@5.20260918.0-alpha): the
// classic single-worker options shape ({modules, script, d1Databases}) is
// REJECTED by the v5 zod schema ("workers: undefined — expected array"),
// and the `workers: [{...}]` array shape is also rejected ("config:
// undefined — expected object") because v5 moved to wrangler-config-style
// worker options. The package exports convertV4MiniflareOptions(), which
// converts classic v4 options into the v5 shape; feeding that converter's
// output to the constructor boots workerd cleanly on Windows, including D1.
// Documented in docs/driver-notes.md.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { CloudflareD1Adapter } from "../../../src/server/drivers/d1.js";
import { runDriverConformance } from "./conformance.js";

describe("CloudflareD1Adapter (miniflare local D1)", () => {
  let mf: Miniflare | undefined;
  let driver: CloudflareD1Adapter | undefined;

  beforeAll(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: `export default { fetch() { return new Response("ok"); } }`,
        d1Databases: { DB: "decko-driver-test" },
      }),
    );
    const binding = await mf.getD1Database("DB");
    driver = new CloudflareD1Adapter(binding);
  }, 120_000);

  afterAll(async () => {
    await mf?.dispose();
  });

  runDriverConformance("conformance: CloudflareD1Adapter (miniflare D1)", () => ({
    driver: driver as CloudflareD1Adapter,
  }));

  it("rejects bigint bind values the way real D1 does (documented limitation)", async () => {
    // Verified against workerd locally: D1_TYPE_ERROR for bigint bindings.
    await expect(driver!.query("SELECT ?", [10n])).rejects.toThrow();
  });

  it("maps meta.changes and meta.last_row_id on writes", async () => {
    await driver!.query("CREATE TABLE d1_map_check (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)", []);
    const r = await driver!.query("INSERT INTO d1_map_check (s) VALUES (?)", ["row-a"]);
    expect(r.rowsAffected).toBe(1);
    expect(BigInt(r.lastInsertRowId as number | bigint)).toBe(1n);
  });
});
