// Migration-runner tests: the auth DDL (db/migrations/001-auth-sessions.sql)
// applies cleanly on a FRESH database (including one with no core schema at
// all — the table is standalone), is idempotent across repeated runs, and
// its statement splitter survives the migration files' comment punctuation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import {
  runAuthMigrations,
  splitSqlStatements,
} from "../../../src/card/auth/migrations.js";
import { SessionStore } from "../../../src/card/auth/session-store.js";
import { createAuthTestStorage, insertAccountCard } from "./auth-test-storage.js";

const AUTH_MIGRATION_FILE = fileURLToPath(
  new URL("../../../db/migrations/001-auth-sessions.sql", import.meta.url),
);

/** Bare driver over an empty in-memory database (NO core schema) — proves
 *  the auth migration stands alone. Same local-narrowing pattern as
 *  auth-test-storage.ts (better-sqlite3 ships no usable types here). */
interface BareStatement {
  readonly reader: boolean;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): Record<string, unknown>[];
}
class BareDriver implements SQLDatabaseDriver {
  private readonly db: {
    prepare(sql: string): BareStatement;
    close(): void;
  };
  constructor() {
    this.db = new Database(":memory:") as unknown as {
      prepare(sql: string): BareStatement;
      close(): void;
    };
  }
  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return { rows: stmt.all(...params) as T[], rowsAffected: 0 };
    }
    const info = stmt.run(...params);
    return { rows: [], rowsAffected: Number(info.changes) };
  }
  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    const results: SQLQueryResult[] = [];
    for (const s of statements) results.push(await this.query(s.sql, s.params));
    return results;
  }
  close(): void {
    this.db.close();
  }
}

describe("runAuthMigrations", () => {
  it("applies 001-auth-sessions.sql cleanly on a fresh DB with the core schema", async () => {
    const storage = createAuthTestStorage();
    const result = await runAuthMigrations(storage.driver);

    expect(result.applied).toEqual(["001-auth-sessions.sql"]);
    expect(result.skipped).toEqual([]);
    const row = storage.selectOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions'",
    );
    expect(row).toBeDefined();
  });

  it("applies cleanly on a FRESH DB with NO core schema (the auth DDL is standalone)", async () => {
    const driver = new BareDriver();
    const result = await runAuthMigrations(driver);
    expect(result.applied).toEqual(["001-auth-sessions.sql"]);

    const probe = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions'",
      [],
    );
    expect(probe.rows.length).toBe(1);
    driver.close();
  });

  it("is idempotent: a second run applies nothing and errors nowhere", async () => {
    const storage = createAuthTestStorage();
    await runAuthMigrations(storage.driver);
    const second = await runAuthMigrations(storage.driver);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["001-auth-sessions.sql"]);
    // Table still there, bookkeeping has exactly one row per version.
    const versions = storage.selectAll<{ version: string }>(
      "SELECT version FROM auth_migrations",
    );
    expect(versions).toEqual([{ version: "001-auth-sessions.sql" }]);
  });

  it("is idempotent even on a DB that already has the table but no bookkeeping (deploy-stream applied)", async () => {
    const storage = createAuthTestStorage();
    // Simulate the deploy stream: raw DDL applied, no auth_migrations row.
    storage.exec(readFileSync(AUTH_MIGRATION_FILE, "utf8"));

    const result = await runAuthMigrations(storage.driver);
    // IF NOT EXISTS makes the re-apply a no-op; the runner records it.
    expect(result.applied).toEqual(["001-auth-sessions.sql"]);
    expect(result.skipped).toEqual([]);
  });

  it("a migrated DB is immediately usable for a session round trip", async () => {
    const storage = createAuthTestStorage();
    await runAuthMigrations(storage.driver);
    insertAccountCard(storage, { id: 7, name: "Test User A" });

    const store = new SessionStore({ driver: storage.driver });
    const { token } = await store.createSession(7, { ttlSeconds: 60 });
    expect(await store.lookupSession(token)).toEqual({ id: 7, name: "Test User A" });
  });
});

describe("splitSqlStatements", () => {
  it("splits on ';' and drops trailing empties", () => {
    expect(splitSqlStatements("CREATE TABLE a (id INTEGER); CREATE INDEX i ON a (id);")).toEqual([
      "CREATE TABLE a (id INTEGER)",
      "CREATE INDEX i ON a (id)",
    ]);
  });

  it("strips line comments BEFORE splitting, so ';' inside a comment cannot fragment", () => {
    const sql = [
      "-- header; with; punctuation",
      "CREATE TABLE a (id INTEGER); -- trailing; comment",
      "",
    ].join("\n");
    expect(splitSqlStatements(sql)).toEqual(["CREATE TABLE a (id INTEGER)"]);
  });
});
