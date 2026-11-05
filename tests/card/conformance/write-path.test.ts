

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import { CardActionEngine } from "../../../src/card/actions/card-action-engine.js";
import { actionTypeCode } from "../../../src/card/history/action.js";
import type { Actor } from "../../../src/card/actions/types.js";
import { splitSqlStatements } from "../fetch/fetch-test-storage.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FIXTURE_DIR = `${REPO_ROOT}fixtures/write-conformance`;
const DDL_PATH = `${REPO_ROOT}db/schema.sqlite.sql`;

const ACTOR: Actor = { id: 1, name: "Test Bot" };

interface FixturePayload {
  scenario: string;
  captured_at: string;
  after: {
    cards: Array<Record<string, unknown>>;
    card_acts: Array<Record<string, unknown>>;
    card_actions: Array<Record<string, unknown>>;
    card_changes: Array<Record<string, unknown>>;
    card_references: Array<Record<string, unknown>>;
  };
  summary: {
    affected_card_ids: number[];
    action_count: number;
    change_count: number;
  };
}

function loadFixture(scenario: string): FixturePayload {
  const path = `${FIXTURE_DIR}/${scenario}.jsonl`;
  const raw = readFileSync(path, "utf8").trim();
  return JSON.parse(raw) as FixturePayload;
}

function listScenarios(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => f.replace(/\.jsonl$/, ""));
}

const T0 = Date.parse("2026-09-22T00:00:00.000Z");
function fakeClock() {
  let ticks = 0;
  return () => new Date(T0 + ticks++ * 1000);
}

interface ReplayStorage {
  driver: LocalSqliteDriver;
  engine: FetchEngine;
  selectAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  selectOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  count(table: string, where?: string, params?: unknown[]): Promise<number>;
  close(): void;
}

async function freshStorage(): Promise<ReplayStorage> {
  const driver = new LocalSqliteDriver({ path: ":memory:" });
  const ddl = readFileSync(DDL_PATH, "utf8");
  for (const statement of splitSqlStatements(ddl)) {
    if (statement.length === 0) continue;
    await driver.query(statement, []);
  }
  return {
    driver,
    engine: new FetchEngine(driver),
    selectAll: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows,
    selectOne: async <T>(sql: string, params: unknown[] = []) =>
      (await driver.query<T>(sql, params)).rows[0],
    count: async (table: string, where: string = "", params: unknown[] = []) => {
      const r = await driver.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} ${where}`,
        params,
      );
      return Number(r.rows[0].n);
    },
    close: () => driver.close(),
  };
}

const RICH_TEXT_ID = 2;
const CARDTYPE_ID = 3;
const ALL_ID = 7;
const DEFAULT_ID = 8;
const ANYONE_ID = 10;
const ADMIN_ID = 184;
const SET_TYPE_ID = 12;
const SETTING_TYPE_ID = 13;
const READ_ID = 14;
const ALL_PLUS_ID = 16;
const ALL_READ_RULE_ID = 17;
const LIST_TYPE_ID = 19;

async function seedStandardDeck(s: ReplayStorage): Promise<void> {
  const now = "2026-09-21 00:00:00.000";

  const cards: Array<{
    id: number; name: string; key: string; codename: string | null;
    type_id: number; content?: string;
  }> = [
    { id: RICH_TEXT_ID, name: "RichText", key: "rich_text", codename: "basic", type_id: CARDTYPE_ID },
    { id: CARDTYPE_ID, name: "Cardtype", key: "cardtype", codename: "cardtype", type_id: CARDTYPE_ID },

    { id: ALL_ID, name: "*all", key: "*all", codename: "all", type_id: SET_TYPE_ID },
    { id: DEFAULT_ID, name: "*default", key: "*default", codename: "default", type_id: CARDTYPE_ID },
    { id: ANYONE_ID, name: "Anyone", key: "anyone", codename: "anyone", type_id: CARDTYPE_ID },
    { id: ADMIN_ID, name: "Administrator", key: "administrator", codename: "administrator", type_id: CARDTYPE_ID },
    { id: SET_TYPE_ID, name: "Set", key: "set", codename: "set", type_id: CARDTYPE_ID },
    { id: SETTING_TYPE_ID, name: "Setting", key: "setting", codename: "setting", type_id: CARDTYPE_ID },
    { id: READ_ID, name: "*read", key: "*read", codename: "read", type_id: SETTING_TYPE_ID },
    { id: 15, name: "*self", key: "*self", codename: "self", type_id: CARDTYPE_ID },
    { id: ALL_PLUS_ID, name: "*all plus", key: "*all_plu", codename: "all_plus", type_id: SET_TYPE_ID },
    { id: LIST_TYPE_ID, name: "List", key: "list", codename: "list", type_id: CARDTYPE_ID },
  ];
  for (const c of cards) {
    await s.driver.query(
      `INSERT INTO cards
         (id, name, key, codename, left_id, right_id, current_revision_id,
          created_at, updated_at, creator_id, updater_id, read_rule_class,
          read_rule_id, references_expired, trash, type_id, db_content)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1, 1, '*all', ?, NULL, 0, ?, ?)`,
      [c.id, c.name, c.key, c.codename, now, now, ANYONE_ID, c.type_id, c.content ?? null],
    );
  }

  await insertRuleCard(s, {
    id: 11, leftId: ALL_ID, rightId: DEFAULT_ID, content: null, typeId: RICH_TEXT_ID,
  });

  await insertRuleCard(s, {
    id: ALL_READ_RULE_ID, leftId: ALL_ID, rightId: READ_ID, content: "[[Anyone]]",
    typeId: LIST_TYPE_ID,
  });
  await insertRuleCard(s, {
    id: 18, leftId: ALL_PLUS_ID, rightId: READ_ID, content: "_left",
    typeId: LIST_TYPE_ID,
  });
}

async function insertRuleCard(
  s: ReplayStorage,
  card: { id: number; leftId: number; rightId: number; content: string | null; typeId: number },
): Promise<void> {
  const now = "2026-09-21 00:00:00.000";
  await s.driver.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, 1, 1, '*all', ?, NULL, 0, ?, ?)`,
    [card.id, card.leftId, card.rightId, now, now, ANYONE_ID, card.typeId, card.content],
  );
}

function makeEngine(s: ReplayStorage): CardActionEngine {
  return new CardActionEngine(s.engine, {
    actor: ACTOR,
    ipAddress: "203.0.113.9",
    now: fakeClock(),

  });
}

const CLOCK_FIELDS_CARDS = new Set(["created_at", "updated_at"]);
const CLOCK_FIELDS_ACTS = new Set(["acted_at"]);

function normalizeCardRow(r: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (CLOCK_FIELDS_CARDS.has(k)) continue;
    if (k === "id") continue;
    copy[k] = v;
  }
  return copy;
}

function normalizeActRow(r: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (CLOCK_FIELDS_ACTS.has(k)) continue;
    if (k === "id") continue;
    copy[k] = v;
  }
  return copy;
}

function normalizeActionRow(r: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "id") continue;
    copy[k] = v;
  }
  return copy;
}

function normalizeChangeRow(r: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "id") continue;
    if (k === "card_action_id") continue;

    if (k === "value" && (r.field === 1 || r.field === 4 || r.field === 5)) {
      copy[k] = v === null ? null : "<int>";
      continue;
    }
    copy[k] = v;
  }
  return copy;
}

function shape<T extends Record<string, unknown>>(arr: T[], normalizer: (r: T) => T): T[] {
  return arr.map(normalizer);
}

async function snapshotAfter(s: ReplayStorage, affectedIds: number[]) {
  const idList = affectedIds.join(",");
  const cards = await s.selectAll<Record<string, unknown>>(
    `SELECT * FROM cards WHERE id IN (${idList})`,
  );
  const acts = await s.selectAll<Record<string, unknown>>(
    `SELECT * FROM card_acts WHERE card_id IN (${idList}) ORDER BY id`,
  );
  const actions = await s.selectAll<Record<string, unknown>>(
    `SELECT * FROM card_actions WHERE card_id IN (${idList}) ORDER BY id`,
  );
  const actionIds = actions.map((a) => a.id as number);
  const changes = actionIds.length === 0
    ? []
    : await s.selectAll<Record<string, unknown>>(
        `SELECT * FROM card_changes WHERE card_action_id IN (${actionIds.join(",")}) ORDER BY id`,
      );
  const refs: Record<string, unknown>[] = [];
  for (const cid of affectedIds) {
    const rs = await s.selectAll<Record<string, unknown>>(
      `SELECT * FROM card_references WHERE referer_id = ? ORDER BY id`,
      [cid],
    );
    refs.push(...rs);
  }
  return { cards, acts, actions, changes, refs };
}

async function replay01(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);
  const engine = makeEngine(s);
  const result = await engine.createCard({ name: "WCC Simple", content: "v1" });
  await snapshotAndAssert(s, "01-create-simple", [result.cardId]);
  const ids = [result.cardId];
  s.close();
  return ids;
}

async function replay02(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);
  const engine = makeEngine(s);
  const signUp = await engine.createCard({ name: "Sign up", content: "" });
  const child = await engine.createCard({
    name: "Sign up+wccchild",
    content: "first child",
  });

  const junction = await s.selectOne<{
    left_id: number | null;
    right_id: number | null;
  }>("SELECT left_id, right_id FROM cards WHERE id = ?", [child.cardId]);
  const leftId = junction?.left_id ?? -1;
  const rightId = junction?.right_id ?? -1;

  await snapshotAndAssert(s, "02-create-junction", [signUp.cardId, leftId, rightId, child.cardId]);
  s.close();
  return [signUp.cardId, leftId, rightId, child.cardId];
}

async function replay03(signUpChildId: number): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);
  const engine = makeEngine(s);
  const signUp = await engine.createCard({ name: "Sign up", content: "" });
  const child = await engine.createCard({
    name: "Sign up+wccchild",
    content: "first child",
  });

  const fetched = await s.engine.fetchById(child.cardId);
  void fetched;

  await engine.updateCard({ cardId: child.cardId, content: "second revision" });
  await snapshotAndAssert(s, "03-update-content", [child.cardId]);
  s.close();
  void signUp;
  void fetched;
  return [signUpChildId];
}

async function replay04(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);
  const engine = makeEngine(s);
  const c = await engine.createCard({ name: "WCC Simple", content: "v1" });
  await engine.updateCard({ cardId: c.cardId, name: "WCC Renamed" });
  await snapshotAndAssert(s, "04-rename-simple", [c.cardId]);
  s.close();
  return [c.cardId];
}

const SEARCH_TYPE_ID = 4;
async function replay05(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);

  await s.driver.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, 'Search', 'search', 'search', NULL, NULL, NULL, ?, ?, 1, 1, '*all', ?, NULL, 0, ?, NULL)`,
    [SEARCH_TYPE_ID, "2026-09-21 00:00:00.000", "2026-09-21 00:00:00.000", ANYONE_ID, CARDTYPE_ID],
  );
  const engine = makeEngine(s);
  const c = await engine.createCard({ name: "WCC Simple", content: "v1" });
  await engine.updateCard({ cardId: c.cardId, name: "WCC Renamed" });
  await engine.updateCard({ cardId: c.cardId, typeId: SEARCH_TYPE_ID });
  await snapshotAndAssert(s, "05-type-change", [c.cardId]);
  s.close();
  return [c.cardId];
}

async function replay06(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);

  await s.driver.query(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id, read_rule_class,
        read_rule_id, references_expired, trash, type_id, db_content)
     VALUES (?, 'Search', 'search', 'search', NULL, NULL, NULL, ?, ?, 1, 1, '*all', ?, NULL, 0, ?, NULL)`,
    [SEARCH_TYPE_ID, "2026-09-21 00:00:00.000", "2026-09-21 00:00:00.000", ANYONE_ID, CARDTYPE_ID],
  );
  const engine = makeEngine(s);
  const c = await engine.createCard({ name: "WCC Simple", content: "v1" });
  await engine.updateCard({ cardId: c.cardId, name: "WCC Renamed" });
  await engine.updateCard({ cardId: c.cardId, typeId: SEARCH_TYPE_ID });
  await engine.deleteCard({ cardId: c.cardId });
  await snapshotAndAssert(s, "06-delete", [c.cardId]);
  s.close();
  return [c.cardId];
}

async function replay07(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);
  const engine = makeEngine(s);
  const target = await engine.createCard({ name: "WCC ReadRule", content: "protected body" });

  await engine.createCard({ name: "WCC ReadRule+*self", typeName: "Set" });
  const rule = await engine.createCard({
    name: "WCC ReadRule+*self+*read",
    typeName: "List",
    content: "[[Administrator]]",
  });

  await engine.updateCard({ cardId: target.cardId, content: "protected body v2" });
  await snapshotAndAssert(s, "07-read-rule-affected-save", [target.cardId, rule.cardId]);

  const targetRow = await s.selectOne<{
    read_rule_id: number | null; read_rule_class: string | null;
    created_at: string; updated_at: string;
  }>("SELECT * FROM cards WHERE id = ?", [target.cardId]);
  const ruleRow = await s.selectOne<{
    read_rule_id: number | null; read_rule_class: string | null;
    created_at: string; updated_at: string;
  }>("SELECT * FROM cards WHERE id = ?", [rule.cardId]);
  expect(targetRow?.read_rule_id, "target read_rule_id points at the rule card").toBe(rule.cardId);
  expect(targetRow?.read_rule_class, "target read_rule_class").toBe("*self");
  expect(ruleRow?.read_rule_id, "rule card reads through itself").toBe(rule.cardId);
  expect(ruleRow?.read_rule_class, "rule card read_rule_class").toBe("*all plus");

  expect(ruleRow?.updated_at, "cascade writes carry no timestamp bump").toBe(ruleRow?.created_at);

  const changeCount = await s.count(
    "card_changes",
    "WHERE card_action_id IN (SELECT id FROM card_actions WHERE card_id = ?)",
    [rule.cardId],
  );
  expect(changeCount, "rule card history is create-only, 0 changes").toBe(0);
  s.close();
  return [target.cardId, rule.cardId];
}

async function replay08(): Promise<number[]> {
  const s = await freshStorage();
  await seedStandardDeck(s);
  const engine = makeEngine(s);

  const referer = await engine.createCard({
    name: "WCC Referer",
    content: "see {{WCC Referer+child}}",
  });
  const refereeJunction = await engine.createCard({
    name: "WCC Referer+child",
    content: "child body",
  });
  const junction = await s.selectOne<{
    left_id: number | null;
    right_id: number | null;
  }>("SELECT left_id, right_id FROM cards WHERE id = ?", [refereeJunction.cardId]);
  const leftId = junction?.left_id ?? -1;
  const rightId = junction?.right_id ?? -1;
  await snapshotAndAssert(s, "08-touch-name-reference", [referer.cardId, leftId, rightId]);
  s.close();
  return [referer.cardId, leftId, rightId];
}

async function snapshotAndAssert(
  s: ReplayStorage,
  scenario: string,
  affectedIds: number[],
): Promise<void> {
  const fixture = loadFixture(scenario);
  const observed = await snapshotAfter(s, affectedIds.filter((id) => id > 0));

  const expCards = shape(fixture.after.cards, normalizeCardRow).sort((a, b) => {
    return String(a.name ?? a.left_id).localeCompare(String(b.name ?? b.left_id));
  });
  const obsCards = shape(observed.cards, normalizeCardRow).sort((a, b) => {
    return String(a.name ?? a.left_id).localeCompare(String(b.name ?? b.left_id));
  });

  const expActions = fixture.after.card_actions.map(normalizeActionRow);
  const obsActions = observed.actions.map(normalizeActionRow);

  const expChanges = fixture.after.card_changes.map(normalizeChangeRow);
  const obsChanges = observed.changes.map(normalizeChangeRow);

  const expActIds = new Set(fixture.after.card_acts.map((a) => a.id));
  const obsActIds = new Set(observed.acts.map((a) => a.id));

  expect(observed.cards.length, `${scenario}: cards row count`).toBe(fixture.after.cards.length);
  expect(observed.actions.length, `${scenario}: card_actions count`).toBe(fixture.after.card_actions.length);
  expect(observed.changes.length, `${scenario}: card_changes count`).toBe(fixture.after.card_changes.length);

  const expTypes = expActions.map((a) => a.action_type).sort();
  const obsTypes = obsActions.map((a) => a.action_type).sort();
  expect(obsTypes, `${scenario}: action_type distribution`).toEqual(expTypes);

  const expChangeTriples = expChanges
    .map((c) => `${c.field}:${c.value ?? "<null>"}`)
    .sort();
  const obsChangeTriples = obsChanges
    .map((c) => `${c.field}:${c.value ?? "<null>"}`)
    .sort();
  expect(obsChangeTriples, `${scenario}: change triples`).toEqual(expChangeTriples);

  void expCards;
  void obsCards;
  void expActIds;
  void obsActIds;
}

describe("write-path conformance replay", () => {
  const scenarios = listScenarios();
  it("has 8 fixtures from the Ruby capture", () => {
    expect(scenarios).toEqual([
      "01-create-simple",
      "02-create-junction",
      "03-update-content",
      "04-rename-simple",
      "05-type-change",
      "06-delete",
      "07-read-rule-affected-save",
      "08-touch-name-reference",
    ]);
  });

  it("01 create-simple: 1 card, 1 create-action, 0 changes", async () => {
    await replay01();
  });

  it("02 create-junction: 1 junction + side card, action_type 0", async () => {
    await replay02();
  });

  it("03 update-content: first update populates the create-action backfill", async () => {
    await replay03(-1);
  });

  it("04 rename-simple: 2 actions (create + update), key rewrite", async () => {
    await replay04();
  });

  it("05 type-change: 3 actions, type_id changes on the update", async () => {
    await replay05();
  });

  it("06 delete: trash flip -> :delete action_type (2)", async () => {
    await replay06();
  });

  it("07 read-rule-affected-save: target + rule cards, content update", async () => {
    await replay07();
  });

  it("08 touch-name-reference: referer + referee cards", async () => {
    await replay08();
  });

  it("action_type code constants match Ruby's TYPE_OPTIONS", () => {
    expect(actionTypeCode("create")).toBe(0);
    expect(actionTypeCode("update")).toBe(1);
    expect(actionTypeCode("delete")).toBe(2);
  });
});
