// Test storage for the auth-layer tests: a thin better-sqlite3
// SQLDatabaseDriver over an in-memory database loaded with the CORE schema
// (db/schema.sqlite.sql), synthetic account cards, and the auth layer's own
// migration applied through the real runner. All card content is SYNTHETIC
// (the stream data rule: no real deck content in tests).
//
// Lives INSIDE tests/card/auth per the stream boundaries — same pattern as
// tests/card/history/history-test-storage.ts, which documents why these
// tests narrow the better-sqlite3 surface locally instead of growing the
// shared ambient shim.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";

interface TestStatement {
  readonly reader: boolean;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): Record<string, unknown>[];
}
interface TestDatabase {
  prepare(sql: string): TestStatement;
  exec(sql: string): void;
  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
  close(): void;
}

export class AuthTestDriver implements SQLDatabaseDriver {
  readonly db: TestDatabase;

  constructor(db: TestDatabase) {
    this.db = db;
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return { rows: stmt.all(...params) as T[], rowsAffected: 0 };
    }
    const info = stmt.run(...params);
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      lastInsertRowId: Number(info.lastInsertRowid) > 0 ? Number(info.lastInsertRowid) : undefined,
    };
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    if (statements.length === 0) return [];
    const runBatch = this.db.transaction(() =>
      statements.map((s) => {
        const stmt = this.db.prepare(s.sql);
        if (stmt.reader) {
          return { rows: stmt.all(...s.params), rowsAffected: 0 } as SQLQueryResult;
        }
        const info = stmt.run(...s.params);
        return {
          rows: [] as unknown[],
          rowsAffected: Number(info.changes),
          lastInsertRowId:
            Number(info.lastInsertRowid) > 0 ? Number(info.lastInsertRowid) : undefined,
        } as SQLQueryResult;
      }),
    );
    return runBatch();
  }

  close(): void {
    this.db.close();
  }
}

export interface AuthTestStorage {
  driver: AuthTestDriver;
  /** Raw helpers for SELECTing rows back outside the driver contract. */
  selectAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  selectOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  exec(sql: string): void;
  close(): void;
}

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Fixed clock base for deterministic expiry tests: T0 plus one tick per
 *  advance() call. */
export const T0 = Date.parse("2026-09-20T12:00:00.000Z");

export function fakeClock() {
  let ticks = 0;
  const clock = () => new Date(T0 + ticks * 1000);
  return {
    clock,
    advanceSeconds(seconds: number) {
      ticks += seconds;
    },
  };
}

export interface SyntheticAccount {
  id: number;
  name: string;
  codename?: string;
}

/** Insert one synthetic user card. User cards are simple cards (name + key
 *  set — the compound-card NULL convention applies to junction cards). */
export function insertAccountCard(
  storage: AuthTestStorage,
  account: SyntheticAccount,
): void {
  const ts = "2026-09-20 11:00:00.000";
  storage.exec(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id,
        read_rule_class, read_rule_id, references_expired, trash, type_id, db_content)
     VALUES
       (${account.id}, '${account.name.replace(/'/g, "''")}',
        '${account.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}',
        ${account.codename ? `'${account.codename}'` : "NULL"},
        NULL, NULL, NULL, '${ts}', '${ts}', 1, 1, NULL, NULL, NULL, 0, 3, NULL)`,
  );
}

/** Fresh in-memory database with the CORE schema loaded. Migration
 *  application is left to each test (some tests exercise the migration
 *  itself against a bare database). */
export function createAuthTestStorage(): AuthTestStorage {
  const db = new Database(":memory:") as unknown as TestDatabase;
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  db.exec(ddl);
  return {
    driver: new AuthTestDriver(db),
    selectAll: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params) as T[],
    selectOne: <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params)[0] as T | undefined,
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
  };
}
