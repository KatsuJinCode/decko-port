// Test storage for the action-layer tests: an in-memory better-sqlite3
// database (via the REAL LocalSqliteDriver) loaded with db/schema.sqlite.sql,
// a FetchEngine over it, and synthetic fixture seeds. Lives INSIDE
// tests/card/actions per the stream boundaries. Seed cards are written
// DIRECTLY as rows (plain INSERT) — exactly how the fetch stream seeds and
// how the capture's oracle DB was seeded upstream; the ACTION layer under
// test is the only code writing through the history machinery.
//
// All fixture content is synthetic (DATA RULE: no real SourceDeck content).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import type { CardsRow } from "../../../src/server/schema.js";
import { DeckoName } from "../../../src/card/name.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import { CardActionEngine } from "../../../src/card/actions/card-action-engine.js";
import type { Actor } from "../../../src/card/actions/types.js";
import { splitSqlStatements } from "../fetch/fetch-test-storage.js";

export interface ActionsTestStorage {
  driver: SQLDatabaseDriver;
  engine: FetchEngine;
  close(): void;
  selectAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  selectOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  count(table: string): Promise<number>;
}

export async function createActionsTestStorage(): Promise<ActionsTestStorage> {
  const driver = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(
    fileURLToPath(new URL("../../../db/schema.sqlite.sql", import.meta.url)),
    "utf8",
  );
  for (const statement of splitSqlStatements(ddl)) {
    await driver.query(statement, []);
  }
  return {
    driver,
    engine: new FetchEngine(driver),
    close: () => driver.close(),
    selectAll: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows,
    selectOne: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows[0],
    count: async (table) => {
      const r = await driver.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`, []);
      return Number(r.rows[0].n);
    },
  };
}

// ---------------------------------------------------------------------------

/** Deterministic clock: one writer operation = one second from T0. */
const T0 = Date.parse("2026-09-20T08:00:00.000Z");
export function fakeClock() {
  let ticks = 0;
  return () => new Date(T0 + ticks++ * 1000);
}

export const JOE: Actor = { id: 9, name: "Joe User" };
export const ANON: Actor = { id: 2, name: "*anonymous" };
export const IP = "192.0.2.7";

/** A fresh engine bound to the fixture's clock. */
export function actionEngine(
  storage: ActionsTestStorage,
  actor: Actor | null = JOE,
  opts: { now?: () => Date; canWrite?: ConstructorParameters<typeof CardActionEngine>[1]["canWrite"] } = {},
): CardActionEngine {
  return new CardActionEngine(storage.engine, {
    actor,
    ipAddress: IP,
    now: opts.now ?? fakeClock(),
    canWrite: opts.canWrite,
  });
}

export interface SeedOptions {
  id?: number;
  name?: string | null;
  key?: string | null;
  codename?: string | null;
  leftId?: number | null;
  rightId?: number | null;
  typeId?: number;
  dbContent?: string | null;
  trash?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Insert one cards row DIRECTLY, mirroring the Ruby write path's column
 *  conventions: simple cards carry name+key columns; compound cards carry
 *  NULL name/key with left_id/right_id (2020 Lexicon migration). */
export async function seedCard(storage: ActionsTestStorage, opts: SeedOptions): Promise<CardsRow> {
  const name = opts.name !== undefined && opts.name !== null ? DeckoName.parse(opts.name) : null;
  const compound = opts.leftId !== undefined && opts.leftId !== null;
  const row = {
    id: opts.id,
    name: compound ? null : (name?.s ?? null),
    key: compound ? null : (opts.key ?? name?.key ?? null),
    codename: opts.codename ?? null,
    left_id: opts.leftId ?? null,
    right_id: opts.rightId ?? null,
    current_revision_id: null,
    created_at: opts.createdAt ?? FIXED_TS,
    updated_at: opts.updatedAt ?? FIXED_TS,
    creator_id: 1,
    updater_id: 1,
    read_rule_class: null,
    read_rule_id: null,
    references_expired: null,
    trash: opts.trash === true ? 1 : 0,
    type_id: opts.typeId ?? RICH_TEXT_ID,
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
  const id =
    row.id !== undefined
      ? row.id
      : (
          await storage.selectOne<{ id: number }>(
            "SELECT id FROM cards WHERE rowid = last_insert_rowid()",
          )
        )?.id;
  const inserted = await storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [id]);
  if (inserted === undefined) throw new Error("seedCard: insert lost");
  return inserted;
}

export const FIXED_TS = "2026-09-01 00:00:00.000";
export const RICH_TEXT_ID = 2;
export const CARDTYPE_ID = 3;

export interface StandardFixture {
  storage: ActionsTestStorage;
  /** The fetch/cache engine (for coherence assertions after actions). */
  engine: FetchEngine;
  /** RichText (codename basic, id RICH_TEXT_ID) and Cardtype rows. */
  richText: CardsRow;
  cardtype: CardsRow;
  /** A non-codenamed live card to mutate. */
  joeCard: CardsRow;
}

/** Seed the synthetic minimum every action test needs: the type cards
 *  (RichText/basic + Cardtype/cardtype), the `*all`/`*default` setting
 *  cards, the `*all+*default` rule card whose type_id is
 *  Card.default_type_id (mod/core/set/all/type.rb:3-5), and one plain
 *  content card. Mirrors the seed-shape of
 *  card-1.110.0/mod/core/data/fixtures/real/cards.yml (ids 2, 3, 7, 8, 11). */
export async function seedStandardDeck(storage: ActionsTestStorage): Promise<StandardFixture> {
  const richText = await seedCard(storage, {
    id: RICH_TEXT_ID,
    name: "RichText",
    codename: "basic",
    typeId: CARDTYPE_ID,
  });
  const cardtype = await seedCard(storage, {
    id: CARDTYPE_ID,
    name: "Cardtype",
    codename: "cardtype",
    typeId: CARDTYPE_ID,
  });
  const all = await seedCard(storage, { id: 7, name: "*all", codename: "all", typeId: CARDTYPE_ID });
  const def = await seedCard(storage, {
    id: 8,
    name: "*default",
    codename: "default",
    typeId: CARDTYPE_ID,
  });
  // cards_011 in the real seed: "*all+*default", type_id 2 (the basic type)
  await seedCard(storage, { leftId: all.id, rightId: def.id, typeId: RICH_TEXT_ID });
  const joeCard = await seedCard(storage, { id: 50, name: "Pudding", dbContent: "v1" });
  return { storage, engine: storage.engine, richText, cardtype, joeCard };
}
