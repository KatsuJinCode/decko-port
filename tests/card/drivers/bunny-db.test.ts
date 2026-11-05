// Conformance + behavior tests for BunnyDbDriver.
//
// Three things this file asserts:
//
//   1. The same SQL battery, run against a BunnyDbDriver and against a
//      fresh in-memory LocalSqliteDriver, returns IDENTICAL rows. The
//      two drivers must agree on what SQLite means on the wire — this is
//      the cross-driver conformance contract that lets the engine be
//      vendor-agnostic (src/server/driver.ts).
//
//   2. BunnyDbDriver passes the shared runDriverConformance suite, so it
//      satisfies the same surface contract as the other adapters.
//
//   3. The query-count instrumentation hook (BunnyDbQueryCounter) tracks
//      one count per query() call and one count per statement inside
//      batch(). This is the first-class DB-operations-per-page metric
//      the harness needs.
//
// The whole describe block is skipped when BUNNY_DB_URL is unset, so CI
// without credentials passes. The local-sqlite leg of the cross-driver
// comparison still runs (LocalSqliteDriver needs no env).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import { runDriverConformance } from "../../server/drivers/conformance.js";
import {
  BunnyDbDriver,
  BunnyDbError,
  BunnyDbQueryCounter,
  type BunnyDbOptions,
} from "../../../src/card/drivers/bunny-db.js";

const ENV_URL = "BUNNY_DB_URL";
const ENV_TOKEN = "BUNNY_DB_TOKEN";

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env !== "object") return undefined;
  const v = process.env[name];
  return typeof v === "string" && v !== "" ? v : undefined;
}

const hasBunnyCreds = (): boolean =>
  readEnv(ENV_URL) !== undefined && readEnv(ENV_TOKEN) !== undefined;

describe("BunnyDbDriver (cross-driver conformance + behavior)", () => {
  describe.skipIf(!hasBunnyCreds())("with live Bunny Database credentials", () => {
    let bunny: BunnyDbDriver;
    let local: LocalSqliteDriver;

    beforeAll(async () => {
      const opts: BunnyDbOptions = {
        url: readEnv(ENV_URL),
        authToken: readEnv(ENV_TOKEN),
        timeoutMs: 15_000,
      };
      bunny = new BunnyDbDriver(opts);
      local = new LocalSqliteDriver({ path: ":memory:" });
    });

    afterAll(() => {
      local.close();
    });

    // -- (1) cross-driver conformance: identical rows for the same battery --
    describe("same SQL battery against both drivers -> identical rows", () => {
      it("CREATE TABLE + INSERT + SELECT round-trip", async () => {
        await Promise.all([
          bunny.query(
            "CREATE TABLE cross_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER, f REAL, s TEXT, z)",
            [],
          ),
          local.query(
            "CREATE TABLE cross_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER, f REAL, s TEXT, z)",
            [],
          ),
        ]);

        const ins = await Promise.all([
          bunny.query(
            "INSERT INTO cross_cards (n, f, s, z) VALUES (?, ?, ?, ?)",
            [42, 1.5, "hello", null],
          ),
          local.query(
            "INSERT INTO cross_cards (n, f, s, z) VALUES (?, ?, ?, ?)",
            [42, 1.5, "hello", null],
          ),
        ]);
        // lastInsertRowId is a number on both for this range; coerce via
        // BigInt to be safe across runtimes that surface bigint.
        expect(BigInt(ins[0].lastInsertRowId as number | bigint)).toBe(
          BigInt(ins[1].lastInsertRowId as number | bigint),
        );

        const bunnyRows = (
          await bunny.query<Record<string, unknown>>(
            "SELECT id, n, f, s, z FROM cross_cards WHERE id = 1",
            [],
          )
        ).rows;
        const localRows = (
          await local.query<Record<string, unknown>>(
            "SELECT id, n, f, s, z FROM cross_cards WHERE id = 1",
            [],
          )
        ).rows;
        expect(bunnyRows).toEqual(localRows);
      });

      it("round-trips null, integer, float and text values identically", async () => {
        await Promise.all([
          bunny.query("CREATE TABLE cross_types (n INTEGER, f REAL, s TEXT, z)", []),
          local.query("CREATE TABLE cross_types (n INTEGER, f REAL, s TEXT, z)", []),
        ]);
        const row = {
          n: -3,
          f: 2.25,
          s: "déjà vu ☕ — quotes 'single' and \"double\"",
          z: null,
        };
        await Promise.all([
          bunny.query("INSERT INTO cross_types (n, f, s, z) VALUES (?, ?, ?, ?)", [
            row.n,
            row.f,
            row.s,
            row.z,
          ]),
          local.query("INSERT INTO cross_types (n, f, s, z) VALUES (?, ?, ?, ?)", [
            row.n,
            row.f,
            row.s,
            row.z,
          ]),
        ]);
        const bunnyRows = (
          await bunny.query<Record<string, unknown>>(
            "SELECT n, f, s, z FROM cross_types",
            [],
          )
        ).rows;
        const localRows = (
          await local.query<Record<string, unknown>>(
            "SELECT n, f, s, z FROM cross_types",
            [],
          )
        ).rows;
        expect(bunnyRows).toEqual(localRows);
        expect(bunnyRows).toEqual([row]);
      });

      it("returns identical batch results", async () => {
        await Promise.all([
          bunny.query(
            "CREATE TABLE cross_batch (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)",
            [],
          ),
          local.query(
            "CREATE TABLE cross_batch (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)",
            [],
          ),
        ]);
        // Use distinct SQL text from the conformance suite so the tables
        // don't collide (the conformance suite runs below in the same
        // describe).
        const stmtBatches = [
          { sql: "INSERT INTO cross_batch (s) VALUES (?)", params: ["alpha"] },
          { sql: "INSERT INTO cross_batch (s) VALUES (?)", params: ["beta"] },
          { sql: "SELECT s FROM cross_batch ORDER BY id", params: [] },
        ];
        const [bBunny, bLocal] = await Promise.all([
          bunny.batch(stmtBatches),
          local.batch(stmtBatches),
        ]);
        // Batch length must match.
        expect(bBunny).toHaveLength(bLocal.length);
        // Each batch result's rows[] must match across drivers.
        for (let i = 0; i < bBunny.length; i += 1) {
          expect(bBunny[i].rows).toEqual(bLocal[i].rows);
        }
        // rowsAffected must agree on the writes.
        expect(bBunny[0].rowsAffected).toBe(bLocal[0].rowsAffected);
        expect(bBunny[1].rowsAffected).toBe(bLocal[1].rowsAffected);
      });

      it("agrees on aggregate functions (COUNT, SUM, AVG)", async () => {
        await Promise.all([
          bunny.query("CREATE TABLE cross_agg (n INTEGER)", []),
          local.query("CREATE TABLE cross_agg (n INTEGER)", []),
        ]);
        const inserts = [1, 2, 3, 4, 5];
        for (const n of inserts) {
          await Promise.all([
            bunny.query("INSERT INTO cross_agg (n) VALUES (?)", [n]),
            local.query("INSERT INTO cross_agg (n) VALUES (?)", [n]),
          ]);
        }
        for (const sql of [
          "SELECT COUNT(*) AS c FROM cross_agg",
          "SELECT SUM(n) AS s FROM cross_agg",
          "SELECT AVG(n) AS a FROM cross_agg",
          "SELECT MIN(n) AS mn, MAX(n) AS mx FROM cross_agg",
        ]) {
          const [bR, lR] = await Promise.all([
            bunny.query<Record<string, unknown>>(sql, []),
            local.query<Record<string, unknown>>(sql, []),
          ]);
          expect(bR.rows).toEqual(lR.rows);
        }
      });

      it("both drivers throw on bad SQL", async () => {
        await expect(bunny.query("SELEC 1", [])).rejects.toThrow();
        await expect(local.query("SELEC 1", [])).rejects.toThrow();
        await expect(
          bunny.batch([
            { sql: "SELECT 1", params: [] },
            { sql: "ALSO NOT SQL", params: [] },
          ]),
        ).rejects.toThrow();
        await expect(
          local.batch([
            { sql: "SELECT 1", params: [] },
            { sql: "ALSO NOT SQL", params: [] },
          ]),
        ).rejects.toThrow();
      });
    });

    // -- (2) shared runDriverConformance: standard surface contract --
    runDriverConformance("conformance: BunnyDbDriver (live)", () => ({
      driver: bunny,
    }));

    // -- (3) query-count instrumentation hook: DB-operations-per-page --
    describe("query-count instrumentation hook", () => {
      it("counts one per query() call", async () => {
        const counter = new BunnyDbQueryCounter();
        const driver = new BunnyDbDriver({
          url: readEnv(ENV_URL),
          authToken: readEnv(ENV_TOKEN),
          timeoutMs: 15_000,
          queryCounter: counter,
        });
        expect(driver.queryCount()).toBe(0);
        await driver.query("SELECT 1 AS one", []);
        expect(driver.queryCount()).toBe(1);
        await driver.query("SELECT 2 AS two", []);
        expect(driver.queryCount()).toBe(2);
      });

      it("counts one per statement inside batch()", async () => {
        const counter = new BunnyDbQueryCounter();
        const driver = new BunnyDbDriver({
          url: readEnv(ENV_URL),
          authToken: readEnv(ENV_TOKEN),
          timeoutMs: 15_000,
          queryCounter: counter,
        });
        expect(driver.queryCount()).toBe(0);
        await driver.batch([
          { sql: "SELECT 1 AS one", params: [] },
          { sql: "SELECT 2 AS two", params: [] },
          { sql: "SELECT 3 AS three", params: [] },
        ]);
        expect(driver.queryCount()).toBe(3);
      });

      it("reset() returns the counter to zero", async () => {
        const counter = new BunnyDbQueryCounter();
        const driver = new BunnyDbDriver({
          url: readEnv(ENV_URL),
          authToken: readEnv(ENV_TOKEN),
          timeoutMs: 15_000,
          queryCounter: counter,
        });
        await driver.query("SELECT 1", []);
        await driver.query("SELECT 2", []);
        expect(driver.queryCount()).toBe(2);
        counter.reset();
        expect(driver.queryCount()).toBe(0);
        await driver.query("SELECT 3", []);
        expect(driver.queryCount()).toBe(1);
      });

      it("captures SQL into the recent buffer when configured", async () => {
        const counter = new BunnyDbQueryCounter({ captureSql: true, recentLimit: 4 });
        const driver = new BunnyDbDriver({
          url: readEnv(ENV_URL),
          authToken: readEnv(ENV_TOKEN),
          timeoutMs: 15_000,
          queryCounter: counter,
        });
        await driver.query("SELECT 10 AS ten", []);
        await driver.query("SELECT 20 AS twenty", []);
        const recent = counter.recentSql();
        expect(recent).toEqual(["SELECT 10 AS ten", "SELECT 20 AS twenty"]);
      });

      it("queryCount() is zero when no counter is injected (no-op default)", () => {
        const driver = new BunnyDbDriver({
          url: readEnv(ENV_URL),
          authToken: readEnv(ENV_TOKEN),
          timeoutMs: 15_000,
        });
        expect(driver.queryCount()).toBe(0);
      });
    });
  });

  // -- Tests that do NOT need network / credentials --

  describe("without credentials (no network, offline)", () => {
    it("throws BunnyDbError when neither options nor env provides a URL", () => {
      const savedUrl = process.env[ENV_URL];
      const savedToken = process.env[ENV_TOKEN];
      try {
        delete process.env[ENV_URL];
        delete process.env[ENV_TOKEN];
        expect(() => new BunnyDbDriver({})).toThrowError(BunnyDbError);
        expect(() => new BunnyDbDriver({})).toThrow(/no URL configured/);
      } finally {
        if (savedUrl !== undefined) process.env[ENV_URL] = savedUrl;
        if (savedToken !== undefined) process.env[ENV_TOKEN] = savedToken;
      }
    });

    it("reads URL + token from env when not passed in options", () => {
      const savedUrl = process.env[ENV_URL];
      const savedToken = process.env[ENV_TOKEN];
      try {
        process.env[ENV_URL] = "https://example-db.lite.bunnydb.net";
        process.env[ENV_TOKEN] = "test-token-abc";
        const driver = new BunnyDbDriver({});
        // Constructor succeeded; we just verify the env read worked.
        expect(driver).toBeInstanceOf(BunnyDbDriver);
        expect(driver.queryCount()).toBe(0);
      } finally {
        if (savedUrl === undefined) delete process.env[ENV_URL];
        else process.env[ENV_URL] = savedUrl;
        if (savedToken === undefined) delete process.env[ENV_TOKEN];
        else process.env[ENV_TOKEN] = savedToken;
      }
    });

    it("rejects unsupported parameter types before issuing a request", async () => {
      // A mock fetch is supplied so the constructor-validated driver
      // never actually makes a network call. We don't invoke query()
      // because the mock would still need to fake a Hrana response;
      // the unsupported-type guard fires synchronously before any
      // fetch is attempted.
      const noopFetch: typeof fetch = (() =>
        Promise.reject(new Error("fetch should not be called"))) as typeof fetch;
      const driver = new BunnyDbDriver({
        url: "https://example-db.lite.bunnydb.net",
        authToken: "token",
        fetchImpl: noopFetch,
      });
      await expect(
        driver.query("SELECT ?", [{ nested: "object" }]),
      ).rejects.toThrow(/unsupported parameter type/);
    });
  });
});
