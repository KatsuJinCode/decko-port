// Shared conformance suite for SQLDatabaseDriver implementations.
// Every storage adapter must pass this suite — that is the contract that
// lets the engine stay vendor-agnostic (src/server/driver.ts).
//
// A driver under test is supplied as a factory so each suite owns its
// resource lifecycle (temp files, running servers, miniflare instances).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SQLDatabaseDriver, SQLQueryResult } from "../../../src/server/driver.js";

export interface DriverUnderTest {
  driver: SQLDatabaseDriver;
  /** Release the driver's resources (close db, stop server, dispose
   *  miniflare). Called once after the suite finishes. */
  dispose?: () => void | Promise<void>;
}

export type DriverFactory = () => DriverUnderTest | Promise<DriverUnderTest>;

export function runDriverConformance(suiteName: string, factory: DriverFactory): void {
  describe(suiteName, () => {
    let handle: DriverUnderTest;
    let driver: SQLDatabaseDriver;

    beforeAll(async () => {
      handle = await factory();
      driver = handle.driver;
    }, 30_000);

    afterAll(async () => {
      await handle.dispose?.();
    });

    it("creates a table, inserts with params, and maps rows/rowsAffected/lastInsertRowId", async () => {
      await driver.query(
        "CREATE TABLE conf_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER, f REAL, s TEXT, z)",
        [],
      );

      const ins: SQLQueryResult = await driver.query(
        "INSERT INTO conf_cards (n, f, s, z) VALUES (?, ?, ?, ?)",
        [42, 1.5, "hello", null],
      );
      expect(ins.rows).toEqual([]);
      expect(ins.rowsAffected).toBe(1);
      // lastInsertRowId arrives as number (better-sqlite3, D1) or bigint
      // (@libsql/client); normalize with BigInt before comparing.
      expect(ins.lastInsertRowId).toBeDefined();
      expect(BigInt(ins.lastInsertRowId as number | bigint)).toBe(1n);

      const sel = await driver.query<Record<string, unknown>>(
        "SELECT id, n, f, s, z FROM conf_cards WHERE id = 1",
        [],
      );
      expect(sel.rows).toEqual([{ id: 1, n: 42, f: 1.5, s: "hello", z: null }]);
      expect(sel.rowsAffected).toBe(0);
      // For reads, whether lastInsertRowId is reported is provider-dependent:
      // SQLite tracks it per connection, so some drivers could legitimately
      // surface the previous insert's rowid here. Absent is the norm; a
      // present value must be the last inserted rowid, not garbage.
      if (sel.lastInsertRowId !== undefined) {
        expect(BigInt(sel.lastInsertRowId)).toBe(1n);
      }
    });

    it("runs a batch of two statements and returns results in order", async () => {
      await driver.query("CREATE TABLE conf_batch (id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT)", []);
      await driver.query("INSERT INTO conf_batch (s) VALUES ('one')", []);

      const results = await driver.batch([
        { sql: "INSERT INTO conf_batch (s) VALUES (?)", params: ["two"] },
        { sql: "SELECT COUNT(*) AS c FROM conf_batch", params: [] },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].rows).toEqual([]);
      expect(results[0].rowsAffected).toBe(1);
      expect(results[1].rows).toEqual([{ c: 2 }]);
    });

    it("round-trips null, integer, float and text values", async () => {
      await driver.query("CREATE TABLE conf_types (n INTEGER, f REAL, s TEXT, z)", []);
      const row = { n: -3, f: 2.25, s: "déjà vu ☕ — quotes 'single' and \"double\"", z: null };
      await driver.query("INSERT INTO conf_types (n, f, s, z) VALUES (?, ?, ?, ?)", [
        row.n,
        row.f,
        row.s,
        row.z,
      ]);
      const got = await driver.query<Record<string, unknown>>("SELECT n, f, s, z FROM conf_types", []);
      expect(got.rows).toEqual([{ n: -3, f: 2.25, s: row.s, z: null }]);
    });

    it("throws on bad SQL instead of swallowing the error", async () => {
      await expect(driver.query("SELEC 1", [])).rejects.toThrow();
      await expect(driver.query("INSERT INTO conf_no_such_table (x) VALUES (1)", [])).rejects.toThrow();
      await expect(
        driver.batch([{ sql: "SELECT 1", params: [] }, { sql: "ALSO NOT SQL", params: [] }]),
      ).rejects.toThrow();
    });

    it("leaves the schema usable after failed statements", async () => {
      // A driver that swallows or half-applies failures would corrupt engine
      // state; a clean throw must leave the connection usable.
      const after = await driver.query<Record<string, unknown>>("SELECT COUNT(*) AS c FROM conf_batch", []);
      expect(after.rows[0].c).toBe(2);
    });
  });
}
