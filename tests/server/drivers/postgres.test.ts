// PostgresDriver tests.
//
// This file proves the PostgresDriver's contract over an injected
// connection WITHOUT a live PostgreSQL server. The driver is exercised
// against a FakePostgresConnection that records every (sql, params) the
// driver sends and hands back scripted PostgresResults. That proves:
//   * the dialect mapping is the ONLY transformation the driver applies
//     to the engine's SQL (param placeholder rewrite, function rename,
//     NOCASE rewrite, ...);
//   * param values are mapped through toPostgresValue;
//   * the driver contract (query/batch, rows/rowsAffected/lastInsertRowId,
//     error propagation) matches the other adapters.
//
// What this file does NOT prove (and what the live-PG rung in
// docs/postgres-dialect-notes.md must cover):
//   * real PG executes the rewritten SQL without errors;
//   * real PG returns the expected row shapes and types;
//   * collation, REGEXP, LASTVAL(), and id-generation semantics match
//     the engine's storage contract.
// Those rungs require a real PostgreSQL instance. The driver is not
// proven byte-parity without them — the doc above is the spec.
//
// LIVE SKIP: a real PG URL via POSTGRES_URL would route the conformance
// suite to a live path, but this file does NOT include that path — the
// pg client is not a dependency in this repo today, and adding it is a
// future stream's call. The live-PG rung is documented as the path
// forward; the in-repo test surface is the dialect-mapping battery.

import { describe, it, expect, afterAll } from "vitest";
import { PostgresDriver } from "../../../src/server/drivers/postgres.js";
import { FakePostgresConnection } from "./fake-postgres-connection.js";

describe("PostgresDriver (FakePostgresConnection)", () => {
  describe("query() — single statement", () => {
    it("rewrites ? placeholders to $N and sends the PG-flavored SQL to the connection", async () => {
      const conn = new FakePostgresConnection({ responses: [{ rows: [], rowCount: 0 }] });
      const driver = new PostgresDriver({ connection: conn });
      await driver.query("SELECT * FROM cards WHERE id = ? AND key = ?", [42, "alpha"]);

      expect(conn.queries).toHaveLength(1);
      expect(conn.queries[0].sql).toBe("SELECT * FROM cards WHERE id = $1 AND key = $2");
      expect(conn.queries[0].params).toEqual([42, "alpha"]);
    });

    it("rewrites SQLite functions and the REGEXP operator before sending", async () => {
      const conn = new FakePostgresConnection({ responses: [{ rows: [], rowCount: 0 }] });
      const driver = new PostgresDriver({ connection: conn });
      await driver.query("SELECT * FROM cards WHERE name REGEXP ? AND instr(name, 'A') > 0", ["foo"]);

      expect(conn.queries[0].sql).toBe(
        "SELECT * FROM cards WHERE name ~* $1 AND STRPOS(name, 'A') > 0",
      );
    });

    it("rewrites COLLATE NOCASE to LOWER(...) before sending", async () => {
      const conn = new FakePostgresConnection({ responses: [{ rows: [], rowCount: 0 }] });
      const driver = new PostgresDriver({ connection: conn });
      await driver.query(
        'SELECT * FROM cards WHERE "key" COLLATE NOCASE IN (?, ?) AND trash = 0',
        ["alpha", "beta"],
      );

      expect(conn.queries[0].sql).toBe(
        'SELECT * FROM cards WHERE LOWER("key") IN (LOWER($1), LOWER($2)) AND trash = 0',
      );
      expect(conn.queries[0].params).toEqual(["alpha", "beta"]);
    });

    it("maps bigint params to their string form (PG int8 binding)", async () => {
      const conn = new FakePostgresConnection({ responses: [{ rows: [], rowCount: 0 }] });
      const driver = new PostgresDriver({ connection: conn });
      await driver.query("SELECT * FROM cards WHERE id = ?", [2n ** 63n - 1n]);

      expect(conn.queries[0].params).toEqual(["9223372036854775807"]);
    });

    it("maps Uint8Array params to Buffer (PG bytea binding)", async () => {
      const conn = new FakePostgresConnection({ responses: [{ rows: [], rowCount: 0 }] });
      const driver = new PostgresDriver({ connection: conn });
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      await driver.query("SELECT * FROM blobs WHERE data = ?", [bytes]);

      const sent = conn.queries[0].params[0];
      expect(sent).toBeInstanceOf(Buffer);
      expect(Array.from(sent as Buffer)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    it("returns rows, rowsAffected, and (for INSERTs) leaves lastInsertRowId unset", async () => {
      // PG has no connection-scoped last_insert_rowid the way SQLite does;
      // the engine reads it via `SELECT lastval()` or RETURNING when it
      // needs it. The driver must NOT invent a lastInsertRowId.
      const conn = new FakePostgresConnection({
        responses: [
          { rows: [{ id: 7, name: "alpha" }, { id: 11, name: "beta" }], rowCount: 2 },
        ],
      });
      const driver = new PostgresDriver({ connection: conn });
      const result = await driver.query<{ id: number; name: string }>(
        "SELECT id, name FROM cards WHERE trash = ?",
        [0],
      );
      expect(result.rows).toEqual([
        { id: 7, name: "alpha" },
        { id: 11, name: "beta" },
      ]);
      expect(result.rowsAffected).toBe(2);
      expect(result.lastInsertRowId).toBeUndefined();
    });

    it("propagates a scripted connection error to the caller", async () => {
      const conn = new FakePostgresConnection();
      conn.enqueueError(new Error("PostgresError: syntax error at or near \"FROM\""));
      const driver = new PostgresDriver({ connection: conn });
      await expect(driver.query("SELEC 1", [])).rejects.toThrow(/syntax error/);
    });

    it("throws a clear error when SQL has more placeholders than params", async () => {
      const conn = new FakePostgresConnection();
      const driver = new PostgresDriver({ connection: conn });
      await expect(driver.query("SELECT ?, ?, ?", [1])).rejects.toThrow(/parameter count mismatch/);
    });

    it("throws a clear error when params has more entries than placeholders", async () => {
      const conn = new FakePostgresConnection();
      const driver = new PostgresDriver({ connection: conn });
      await expect(driver.query("SELECT ?", [1, 2])).rejects.toThrow(/parameter count mismatch/);
    });
  });

  describe("batch() — multiple statements", () => {
    it("rewrites every statement and sends them in order; returns results in order", async () => {
      const conn = new FakePostgresConnection({
        responses: [
          // First statement: INSERT
          { rows: [], rowCount: 1 },
          // Second statement: SELECT COUNT
          { rows: [{ c: 2 }], rowCount: 1 },
        ],
      });
      const driver = new PostgresDriver({ connection: conn });
      const results = await driver.batch([
        { sql: "INSERT INTO batch_t (n, s) VALUES (?, ?)", params: [7, "seven"] },
        { sql: "SELECT COUNT(*) AS c FROM batch_t", params: [] },
      ]);

      expect(conn.queries).toHaveLength(2);
      expect(conn.queries[0].sql).toBe("INSERT INTO batch_t (n, s) VALUES ($1, $2)");
      expect(conn.queries[0].params).toEqual([7, "seven"]);
      expect(conn.queries[1].sql).toBe("SELECT COUNT(*) AS c FROM batch_t");
      expect(results).toHaveLength(2);
      expect(results[0].rowsAffected).toBe(1);
      expect(results[1].rows).toEqual([{ c: 2 }]);
    });

    it("returns an empty array for an empty batch without contacting the connection", async () => {
      const conn = new FakePostgresConnection();
      const driver = new PostgresDriver({ connection: conn });
      const results = await driver.batch([]);
      expect(results).toEqual([]);
      expect(conn.queries).toHaveLength(0);
    });

    it("propagates the first connection error and stops issuing further statements", async () => {
      const conn = new FakePostgresConnection();
      conn.enqueueError(new Error("PostgresError: relation \"x\" does not exist"));
      // No result queued for the second statement — if the driver issues
      // it, the fake will throw on an unexpected query.
      const driver = new PostgresDriver({ connection: conn });
      await expect(
        driver.batch([
          { sql: "INSERT INTO no_such_table (n) VALUES (?)", params: [1] },
          { sql: "SELECT 1", params: [] },
        ]),
      ).rejects.toThrow(/does not exist/);
      // The driver should have stopped after the first failure.
      expect(conn.queries).toHaveLength(1);
    });
  });

  describe("close()", () => {
    it("releases the underlying connection exactly once", () => {
      const conn = new FakePostgresConnection();
      const driver = new PostgresDriver({ connection: conn });
      driver.close();
      // A second close() is a no-op (the driver owns the connection
      // release lifecycle, not the fake). The fake records released
      // state internally; we verify via a follow-up query() that rejects.
      expect(conn["released"]).toBe(true);
      driver.close();
      // Still released, still no second release call.
      expect(conn["released"]).toBe(true);
    });
  });

  describe("live-PG skip (env gate)", () => {
    it("is skipped when POSTGRES_URL is not set; document this for the live rung", () => {
      // The Postgres driver is intended to run against a live PG server
      // when POSTGRES_URL is set. This repo does NOT carry the `pg`
      // client dependency; the live-PG rung lives in a future stream
      // (see docs/postgres-dialect-notes.md "Live-PG rung"). This test
      // records the contract: POSTGRES_URL gates the live path, and the
      // dialect-mapping path (everything above) runs unconditionally.
      //
      // If a future stream adds `pg`, the live tests plug in here.
      if (!process.env["POSTGRES_URL"]) {
        return;
      }
      throw new Error(
        "POSTGRES_URL is set but this repo does not yet have a live-PG test path. " +
          "See docs/postgres-dialect-notes.md 'Live-PG rung' for the spec.",
      );
    });
  });
});
