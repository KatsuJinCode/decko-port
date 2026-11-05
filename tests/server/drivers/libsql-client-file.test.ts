

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

  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {

  }
});

describe("cross-check: @libsql/client file: URL", () => {
  let driver: LibSqlClientFileDriver;
  runDriverConformance("conformance: @libsql/client (file: URL, cross-check)", () => {
    driver = new LibSqlClientFileDriver(createClient({ url: "file:" + dbPath }));
    return { driver, dispose: () => driver.close() };
  });
});
