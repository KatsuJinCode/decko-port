// Cross-check: run the SAME conformance suite against @libsql/client with a
// file: URL, wrapped in SQLDatabaseDriver. This is NOT a shipped adapter —
// @libsql/client is a devDependency and production HTTP traffic goes through
// LibSqlHttpAdapter — it exists to prove the conformance suite is strict
// against a second independent implementation (and to document how the
// official client's types line up with our driver contract).
//
// Feasibility notes (why the wrapper lives here and not in src/):
// - The client's ResultSet maps cleanly onto SQLQueryResult: rows are
//   index-and-name accessible, rowsAffected is a number, lastInsertRowId is
//   `bigint | undefined`. Only awkwardness: InStatement args are typed
//   InValue[], so our `unknown[]` params need a cast — safe for the scalar
//   params this contract supports.

import { describe, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type Client, type InValue } from "@libsql/client";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import { runDriverConformance } from "./conformance.js";

class LibSqlClientFileDriver implements SQLDatabaseDriver {
  constructor(private readonly client: Client) {}

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    const rs = await this.client.execute({ sql, args: params as InValue[] });
    return {
      rows: rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]))) as T[],
      rowsAffected: rs.rowsAffected,
      lastInsertRowId: rs.lastInsertRowid,
    };
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    // "write" mode wraps the batch in a transaction, matching the atomic
    // batch semantics of LocalSqliteDriver and D1.
    const rss = await this.client.batch(
      statements.map((s) => ({ sql: s.sql, args: s.params as InValue[] })),
      "write",
    );
    return rss.map((rs) => ({
      rows: rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]))),
      rowsAffected: rs.rowsAffected,
      lastInsertRowId: rs.lastInsertRowid,
    }));
  }

  close(): void {
    this.client.close();
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "decko-libsql-file-test-"));
const dbPath = path.join(tempDir, "decko-test.db").replace(/\\/g, "/");

afterAll(() => {
  // Swallow cleanup failures: the native libsql handle can hold the file
  // lock briefly after close() on Windows. Temp litter is acceptable.
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* temp litter is acceptable */
  }
});

describe("cross-check: @libsql/client file: URL", () => {
  let driver: LibSqlClientFileDriver;
  runDriverConformance("conformance: @libsql/client (file: URL, cross-check)", () => {
    driver = new LibSqlClientFileDriver(createClient({ url: "file:" + dbPath }));
    return { driver, dispose: () => driver.close() };
  });
});
