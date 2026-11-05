

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement } from "../../../src/server/driver.js";
import type { CardsRow } from "../../../src/server/schema.js";
import { DeckoName } from "../../../src/card/name.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import { RenderEngine } from "../../../src/card/render.js";
import type { Actor } from "../../../src/card/actions/types.js";

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

export interface GherkinTestStorage {
  driver: SQLDatabaseDriver;
  fetcher: FetchEngine;
  renderer: RenderEngine;
  selectAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  selectOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  count(table: string): Promise<number>;
  close(): void;
}

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export async function createGherkinTestStorage(): Promise<GherkinTestStorage> {
  const driver = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  for (const statement of splitSqlStatements(ddl)) {
    await driver.query(statement, []);
  }
  const fetcher = new FetchEngine(driver);
  const renderer = new RenderEngine(fetcher);
  return {
    driver,
    fetcher,
    renderer,
    selectAll: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows,
    selectOne: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows[0],
    count: async (table) => {
      const r = await driver.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`, []);
      return Number(r.rows[0].n);
    },
    close: () => driver.close(),
  };
}

export const TYPE_IDS = {
  richText: 2,
  cardtype: 3,
  phrase: 4,
  pointer: 5,
} as const;

export const JOE_ACTOR: Actor = { id: 9, name: "Joe User" };

export async function seedCard(
  storage: GherkinTestStorage,
  opts: {
    id?: number;
    name?: string | null;
    key?: string | null;
    codename?: string | null;
    leftId?: number | null;
    rightId?: number | null;
    typeId?: number;
    dbContent?: string | null;
    trash?: boolean;
  },
): Promise<CardsRow> {
  const compound = opts.leftId !== undefined && opts.leftId !== null;
  const name = opts.name !== undefined && opts.name !== null ? DeckoName.parse(opts.name) : null;
  const nameColumn = compound ? null : (opts.name ?? null);
  const keyColumn = compound ? null : (opts.key ?? name?.key ?? null);
  await storage.driver.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id ?? null,
      nameColumn,
      keyColumn,
      opts.codename ?? null,
      opts.leftId ?? null,
      opts.rightId ?? null,
      null,
      "2026-09-19 00:00:00.000",
      "2026-09-19 00:00:00.000",
      1,
      1,
      null,
      null,
      null,
      opts.trash === true ? 1 : 0,
      opts.typeId ?? TYPE_IDS.richText,
      opts.dbContent ?? null,
    ],
  );
  const id =
    opts.id !== undefined
      ? opts.id
      : (
          await storage.selectOne<{ id: number }>(
            "SELECT id FROM cards WHERE rowid = last_insert_rowid()",
          )
        )?.id;
  const inserted = await storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [id]);
  if (inserted === undefined) throw new Error("seedCard: insert lost");
  return inserted;
}

export async function seedStandardDeck(storage: GherkinTestStorage): Promise<void> {
  await seedCard(storage, {
    id: TYPE_IDS.richText,
    name: "RichText",
    codename: "basic",
    typeId: TYPE_IDS.cardtype,
  });
  await seedCard(storage, {
    id: TYPE_IDS.cardtype,
    name: "Cardtype",
    codename: "cardtype",
    typeId: TYPE_IDS.cardtype,
  });
  await seedCard(storage, { id: 7, name: "*all", codename: "all", typeId: TYPE_IDS.cardtype });
  await seedCard(storage, {
    id: 8,
    name: "*default",
    codename: "default",
    typeId: TYPE_IDS.cardtype,
  });
  await seedCard(storage, { leftId: 7, rightId: 8, typeId: TYPE_IDS.richText });
}

export async function seedExtendedDeck(storage: GherkinTestStorage): Promise<void> {
  await seedStandardDeck(storage);
  await seedCard(storage, {
    id: TYPE_IDS.phrase,
    name: "Phrase",
    codename: "phrase",
    typeId: TYPE_IDS.cardtype,
  });
  await seedCard(storage, {
    id: TYPE_IDS.pointer,
    name: "Pointer",
    codename: "pointer",
    typeId: TYPE_IDS.cardtype,
  });
}
