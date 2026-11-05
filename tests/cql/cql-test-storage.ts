

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { LocalSqliteDriver } from "../../src/server/drivers/local-sqlite.js";
import { registerSqliteRegexpFunction } from "../../src/cql/sqlite-regexp.js";
import { FetchEngine } from "../../src/card/fetch.js";
import { DeckoName } from "../../src/card/name.js";
import { splitSqlStatements } from "../card/render/render-test-storage.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface CqlTestStorage {
  driver: LocalSqliteDriver;
  fetcher: FetchEngine;
  close(): void;
}

export async function createCqlTestStorage(): Promise<CqlTestStorage> {
  const driver = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(`${REPO_ROOT}db/schema.sqlite.sql`, "utf8");
  for (const statement of splitSqlStatements(ddl)) {
    await driver.query(statement, []);
  }
  registerSqliteRegexpFunction(driver);
  const fetcher = new FetchEngine(driver);
  return { driver, fetcher, close: () => driver.close() };
}

export interface CqlSeedCard {
  id: number;

  name?: string;
  codename?: string;
  leftId?: number;
  rightId?: number;
  typeId?: number;
  dbContent?: string;
}

export const ORACLE_DECK_CARDS: CqlSeedCard[] = [

  { id: 1, name: "Decko Bot", codename: "decko_bot", typeId: 2 },
  { id: 2, name: "RichText", codename: "basic", typeId: 3 },
  { id: 3, name: "Cardtype", codename: "cardtype", typeId: 3 },
  { id: 4, name: "List", codename: "list", typeId: 3 },
  { id: 5, name: "Set", codename: "set", typeId: 3 },
  { id: 98, name: "Search", codename: "search_type", typeId: 3 },

  { id: 7, name: "*all", typeId: 2 },
  { id: 8, name: "*default", typeId: 2 },
  { id: 9, name: "*read", codename: "read", typeId: 6 },
  { id: 12, name: "description", typeId: 2 },
  { id: 18, name: "User", typeId: 2 },
  { id: 21, name: "*type", typeId: 2 },
  { id: 26, name: "*right", typeId: 2 },
  { id: 27, name: "*self", codename: "self", typeId: 2 },
  { id: 60, name: "*content options", typeId: 2 },
  { id: 155, name: "*to", typeId: 2 },
  { id: 158, name: "*from", typeId: 2 },
  { id: 161, name: "*cc", typeId: 2 },
  { id: 164, name: "*bcc", typeId: 2 },
  { id: 168, name: "*attach", typeId: 2 },
  { id: 272, name: "*roles", typeId: 2 },
  { id: 302, name: "*script", typeId: 2 },
  { id: 349, name: "*style", typeId: 2 },
  { id: 483, name: "*recent settings", typeId: 2 },

  { id: 10, name: "*all+*read", leftId: 7, rightId: 9, typeId: 2 },
  { id: 11, name: "*all+*default", leftId: 7, rightId: 8, typeId: 2 },
  { id: 14, name: "Cardtype+description", leftId: 3, rightId: 12, typeId: 2 },
  { id: 19, name: "User+description", leftId: 18, rightId: 12, typeId: 2 },
  { id: 29, name: "Cardtype+*type", leftId: 3, rightId: 21, typeId: 2 },
  { id: 156, name: "*to+*right", leftId: 155, rightId: 26, typeId: 2 },
  { id: 159, name: "*from+*right", leftId: 158, rightId: 26, typeId: 2 },
  { id: 162, name: "*cc+*right", leftId: 161, rightId: 26, typeId: 2 },
  { id: 165, name: "*bcc+*right", leftId: 164, rightId: 26, typeId: 2 },
  { id: 169, name: "*attach+*right", leftId: 168, rightId: 26, typeId: 2 },
  { id: 273, name: "*roles+*right", leftId: 272, rightId: 26, typeId: 2 },
  { id: 303, name: "*script+*right", leftId: 302, rightId: 26, typeId: 2 },
  { id: 350, name: "*style+*right", leftId: 349, rightId: 26, typeId: 2 },
  { id: 484, name: "*recent settings+*self", leftId: 483, rightId: 27, typeId: 2 },

  { id: 100, name: "*search", typeId: 98 },
  { id: 101, name: "*recent", typeId: 98 },
  { id: 157, name: "*to+*right+*content options", leftId: 156, rightId: 60, typeId: 98 },
  { id: 160, name: "*from+*right+*content options", leftId: 159, rightId: 60, typeId: 98 },
  { id: 163, name: "*cc+*right+*content options", leftId: 162, rightId: 60, typeId: 98 },
  { id: 166, name: "*bcc+*right+*content options", leftId: 165, rightId: 60, typeId: 98 },
  { id: 170, name: "*attach+*right+*content options", leftId: 169, rightId: 60, typeId: 98 },
  { id: 275, name: "*roles+*right+*content options", leftId: 273, rightId: 60, typeId: 98 },
  { id: 278, name: "Cards with accounts", typeId: 98 },
  { id: 304, name: "*script+*right+*content options", leftId: 303, rightId: 60, typeId: 98 },
  { id: 352, name: "*style+*right+*content options", leftId: 350, rightId: 60, typeId: 98 },
  { id: 487, name: "*recent settings+*self+*content options", leftId: 484, rightId: 60, typeId: 98 },
  { id: 614, name: "Oracle Search", typeId: 98, dbContent: '{"left":"Oracle Junction","sort":"name"}' },

  { id: 605, name: "Oracle Basics", typeId: 2, dbContent: "A plain basic card for oracle capture." },
  { id: 606, name: "Oracle Junction", typeId: 2, dbContent: "Junction parent card." },
  { id: 607, name: "child_one", typeId: 2 },
  { id: 608, name: "Oracle Junction+child_one", leftId: 606, rightId: 607, typeId: 2, dbContent: "first child" },
  { id: 609, name: "child_two", typeId: 2 },
  { id: 610, name: "Oracle Junction+child_two", leftId: 606, rightId: 609, typeId: 2, dbContent: "second child" },
  {
    id: 611,
    name: "Oracle Rich",
    typeId: 2,
    dbContent: "<p>Rich text with an inclusion: {{Oracle Rich+rich_child}}</p>",
  },
  { id: 612, name: "rich_child", typeId: 2 },
  { id: 613, name: "Oracle Rich+rich_child", leftId: 611, rightId: 612, typeId: 2, dbContent: "the nested child body" },
  { id: 615, name: "Oracle Restricted", typeId: 2, dbContent: "Only administrators can read me." },
  { id: 616, name: "Oracle Restricted+*self", leftId: 615, rightId: 27, typeId: 5, dbContent: "" },
  { id: 617, name: "Oracle Restricted+*self+*read", leftId: 616, rightId: 9, typeId: 4, dbContent: "Administrator" },
];

export async function seedOracleCaptureDeck(storage: CqlTestStorage): Promise<void> {
  const insert =
    "INSERT INTO cards (id, name, key, codename, left_id, right_id, current_revision_id, " +
    "created_at, updated_at, creator_id, updater_id, read_rule_class, read_rule_id, " +
    "references_expired, trash, type_id, db_content) " +
    "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 1, NULL, NULL, NULL, 0, ?, ?)";
  for (const card of [...ORACLE_DECK_CARDS].sort((a, b) => a.id - b.id)) {
    const compound = card.name !== undefined && card.name.includes("+");
    if (compound && (card.leftId === undefined || card.rightId === undefined)) {
      throw new Error(`compound seed ${card.id} (${card.name}) needs leftId and rightId`);
    }
    const nameColumn = compound ? null : (card.name ?? null);
    const keyColumn = compound || card.name === undefined ? null : DeckoName.parse(card.name).key;
    await storage.driver.query(insert, [
      card.id,
      nameColumn,
      keyColumn,
      card.codename ?? null,
      compound ? card.leftId! : null,
      compound ? card.rightId! : null,
      "2026-09-19 00:00:00.000",
      "2026-09-19 00:00:00.000",
      card.typeId ?? 2,
      card.dbContent ?? null,
    ]);
  }
}
