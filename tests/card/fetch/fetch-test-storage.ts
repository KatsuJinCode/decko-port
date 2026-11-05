// Test storage for the fetch/cache-layer tests: an in-memory better-sqlite3
// database (via the REAL LocalSqliteDriver) loaded with db/schema.sqlite.sql,
// plus plain-INSERT seed helpers. Lives INSIDE tests/card/fetch per the
// stream boundaries; seeded cards are written DIRECTLY as rows because the
// write path is another stream - this mirrors how the capture's oracle DB
// was seeded upstream.
//
// Why the DDL goes through driver.query one statement at a time:
// LocalSqliteDriver owns its connection and exposes no exec(), and
// better-sqlite3's prepare() rejects multi-statement strings. The schema
// file is machine-generated DDL (no ";" inside literals - verified by scan),
// so a quote-aware comment-stripping splitter is sufficient.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import type { CardsRow } from "../../../src/server/schema.js";
import { DeckoName } from "../../../src/card/name.js";
import { FetchEngine } from "../../../src/card/fetch.js";

/** Split a DDL file into executable statements: strip `--` comments
 *  (quote-aware - the DDL carries no "--" inside literals) and split on ";". */
export function splitSqlStatements(ddl: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "-" && ddl[i + 1] === "-") {
      while (i < ddl.length && ddl[i] !== "\n") i++;
      current += " ";
      continue;
    }
    if (ch === ";") {
      statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") statements.push(current.trim());
  return statements.filter((statement) => statement !== "");
}

/** Driver wrapper that counts queries - used to prove cache hits avoid the
 *  database (the point of the fetch cache). */
export class CountingDriver implements SQLDatabaseDriver {
  queries = 0;
  readonly statements: string[] = [];

  constructor(private readonly inner: SQLDatabaseDriver) {}

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.queries += 1;
    this.statements.push(sql);
    return this.inner.query<T>(sql, params);
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    this.queries += statements.length;
    return this.inner.batch(statements);
  }

  reset(): void {
    this.queries = 0;
    this.statements.length = 0;
  }
}

export interface FetchTestStorage {
  engine: FetchEngine;
  counting: CountingDriver;
  driver: SQLDatabaseDriver;
  /** Direct row reads for asserting seeded DB state. */
  selectAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  selectOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  close(): void;
}

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Fresh in-memory CORE-schema database behind the real LocalSqliteDriver.
 *  `engineOpts` passes through to FetchEngine (e.g. a shared store). */
export async function createFetchTestStorage(
  engineOpts: ConstructorParameters<typeof FetchEngine>[1] = {},
): Promise<FetchTestStorage> {
  const driver = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  for (const statement of splitSqlStatements(ddl)) {
    await driver.query(statement, []);
  }
  const counting = new CountingDriver(driver);
  return {
    engine: new FetchEngine(counting, engineOpts),
    counting,
    driver: counting,
    selectAll: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows,
    selectOne: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows[0],
    close: () => driver.close(),
  };
}

export const FIXED_TIMESTAMP = "2026-09-19 00:00:00.000";
const DEFAULT_TYPE_ID = 2;
const DEFAULT_ACTOR_ID = 1;

export interface SeedCardOptions {
  id?: number;
  name: string;
  /** Defaults to DeckoName.parse(name).key (what the Ruby write path stores). */
  key?: string;
  codename?: string | null;
  leftId?: number;
  rightId?: number;
  typeId?: number;
  dbContent?: string | null;
  trash?: boolean;
  creatorId?: number;
  updaterId?: number;
  createdAt?: string;
  updatedAt?: string;
  currentRevisionId?: number | null;
  readRuleClass?: string | null;
  readRuleId?: number | null;
  referencesExpired?: number | null;
}

/**
 * Insert one card row DIRECTLY (plain INSERT - the write path is another
 * stream). Column conventions follow the Ruby write path as the schema
 * records them (db/schema.sqlite.sql comments + lib/card/name/all.rb#name= /
 * #key=): simple cards store name + key columns; compound cards store NULL
 * name/key columns with left_id/right_id (the 2020 migration convention).
 * Side ids default to a lookup of already-seeded part rows by key - the
 * seed order must declare parts before junctions, like Lexicon.id would.
 */
export async function seedCard(
  storage: FetchTestStorage,
  opts: SeedCardOptions,
): Promise<CardsRow> {
  const name = DeckoName.parse(opts.name);
  let nameColumn: string | null = name.s;
  let keyColumn: string | null = opts.key ?? name.key;
  let leftId = opts.leftId ?? null;
  let rightId = opts.rightId ?? null;

  if (name.isCompound) {
    // compound rows carry NULL name/key columns; compose via side ids
    nameColumn = null;
    keyColumn = null;
    const leftKey = name.leftName?.key ?? "";
    const rightKey = name.rightName?.key ?? "";
    if (leftId === null) {
      leftId =
        (
          await storage.selectOne<{ id: number }>("SELECT id FROM cards WHERE key = ?", [
            leftKey,
          ])
        )?.id ?? null;
    }
    if (rightId === null) {
      rightId =
        (
          await storage.selectOne<{ id: number }>("SELECT id FROM cards WHERE key = ?", [
            rightKey,
          ])
        )?.id ?? null;
    }
  }

  const row = {
    id: opts.id,
    name: nameColumn,
    key: keyColumn,
    codename: opts.codename ?? null,
    left_id: leftId,
    right_id: rightId,
    current_revision_id: opts.currentRevisionId ?? null,
    created_at: opts.createdAt ?? FIXED_TIMESTAMP,
    updated_at: opts.updatedAt ?? FIXED_TIMESTAMP,
    creator_id: opts.creatorId ?? DEFAULT_ACTOR_ID,
    updater_id: opts.updaterId ?? DEFAULT_ACTOR_ID,
    read_rule_class: opts.readRuleClass ?? null,
    read_rule_id: opts.readRuleId ?? null,
    references_expired: opts.referencesExpired ?? null,
    trash: opts.trash === true ? 1 : 0,
    type_id: opts.typeId ?? DEFAULT_TYPE_ID,
    db_content: opts.dbContent ?? null,
  };

  await storage.driver.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      row.key,
      row.codename,
      row.left_id,
      row.right_id,
      row.current_revision_id,
      row.created_at,
      row.updated_at,
      row.creator_id,
      row.updater_id,
      row.read_rule_class,
      row.read_rule_id,
      row.references_expired,
      row.trash,
      row.type_id,
      row.db_content,
    ],
  );
  const inserted = (await storage.selectOne<CardsRow>(
    row.id !== undefined ? "SELECT * FROM cards WHERE id = ?" : "SELECT * FROM cards WHERE rowid = last_insert_rowid()",
    row.id !== undefined ? [row.id] : [],
  )) as CardsRow;
  return inserted;
}
