

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";
import { quietDenial } from "../../../src/card/permissions/index.js";
import type { FetchEngine } from "../../../src/card/fetch.js";

const SET_TYPE_ID = 2;
const NEWS_TYPE_ID = 20;
const SEARCH_TYPE_ID = 30;

const T = {
  mystery: "2026-09-19 00:00:30.000",
  alpha: "2026-09-19 00:00:20.000",
  secret: "2026-09-19 00:00:10.000",
  gamma: "2026-09-19 00:00:09.000",
  delta: "2026-09-19 00:00:08.000",
  deniedJunction: "2026-09-19 00:00:07.000",
  epsilon: "2026-09-19 00:00:06.000",
  zeta: "2026-09-19 00:00:05.000",
  eta: "2026-09-19 00:00:04.000",
  readableJunction: "2026-09-19 00:00:03.000",
};

async function seedDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "Role A" });

  await seedCard(s, { id: 30, name: "Search", codename: "search_type", typeId: SET_TYPE_ID });

  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });
  await seedCard(s, { id: 17, name: "*type plus right", codename: "type_plus_right" });
  await seedCard(s, { id: 18, name: "*all plus", codename: "all_plus" });

  await seedCard(s, { id: 8, leftId: 1, rightId: 3, dbContent: "[[Anyone]]" });
  await seedReference(s, 8, 5, "anyone");

  await seedCard(s, { id: 20, name: "News", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 9, leftId: 20, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 10, leftId: 9, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 10, 7, "role_a");

  await seedCard(s, {
    id: 21, name: "News Alpha", typeId: NEWS_TYPE_ID, dbContent: "alpha body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 22, name: "News Secret", typeId: NEWS_TYPE_ID, dbContent: "secret body",
    readRuleId: 10, readRuleClass: "*type",
  });
  await seedCard(s, {
    id: 23, name: "News Gamma", typeId: NEWS_TYPE_ID, dbContent: "gamma body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 24, name: "News Delta", typeId: NEWS_TYPE_ID, dbContent: "delta body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, { id: 26, name: "Junction Left", typeId: 4 });
  await seedCard(s, { id: 27, name: "Field One", typeId: 4 });
  await seedCard(s, { id: 32, name: "Field Two", typeId: 4 });
  await seedCard(s, {
    id: 25, leftId: 26, rightId: 27, typeId: NEWS_TYPE_ID, dbContent: "denied junction body",
    readRuleId: 10, readRuleClass: "*type",
  });
  await seedCard(s, {
    id: 28, name: "News Epsilon", typeId: NEWS_TYPE_ID, dbContent: "epsilon body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 29, name: "News Zeta", typeId: NEWS_TYPE_ID, dbContent: "zeta body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 34, name: "News Eta", typeId: NEWS_TYPE_ID, dbContent: "eta body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 31, leftId: 26, rightId: 32, typeId: NEWS_TYPE_ID, dbContent: "readable junction body",
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 33, name: "News Mystery", typeId: NEWS_TYPE_ID, dbContent: "mystery body",
  });

  for (const [id, at] of Object.entries(T)) {
    await s.counting.query(`UPDATE cards SET created_at = ? WHERE id = ?`, [at, Number(id)]);
  }

  await seedCard(s, { id: 50, name: "Doc", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 41, name: "Doc Alpha", typeId: 50 });
  await seedCard(s, { id: 45, name: "Field X", typeId: 4 });
  await seedCard(s, { id: 44, leftId: 50, rightId: 45, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 43, leftId: 44, rightId: 17, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 42, leftId: 43, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 42, 7, "role_a");
  await seedCard(s, {
    id: 40, leftId: 41, rightId: 45, typeId: 4, dbContent: "field x secret body",
    readRuleId: 42, readRuleClass: "*type plus right",
  });

  await seedCard(s, {
    id: 60, name: "news search three", typeId: SEARCH_TYPE_ID,
    dbContent: '{"type":"News","sort":"create","dir":"desc","limit":"3"}',
    readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 61, name: "news search nine", typeId: SEARCH_TYPE_ID,
    dbContent: '{"type":"News","sort":"create","dir":"desc","limit":"9"}',
    readRuleId: 8, readRuleClass: "*all",
  });
}

let storage: RenderTestStorage | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck(storage);

  await storage.engine.render("News", "title");
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("search read-permission: denied cards filtered BEFORE the limit (trace bug 1)", () => {
  it("limit 3 returns the three NEWEST READABLE items — the denied rank-2 card never occupies a slot", async () => {
    const html = await storage!.engine.render("news search three", "content");

    expect(html).toContain("News Alpha");
    expect(html).toContain("News Gamma");
    expect(html).toContain("News Delta");
    expect(html).not.toContain("News Secret");
    expect(html).not.toContain("secret body");

    const slots = html.match(/<div class="search-result-item[^"]*">/g) ?? [];
    expect(slots.length).toBe(3);

    expect(html).not.toContain('class="denied"');
  });

  it("the pre-fix window shows the regression: WITHOUT the filter the denied card would be rank 2", async () => {

    const executed = storage!.counting.statements.filter((sql) =>
      /FROM cards\s+\w+/.test(sql) && /read_rule_id IN/.test(sql) && /LIMIT 3\b/.test(sql),
    );
    expect(executed.length).toBeGreaterThan(0);
    for (const sql of executed) {
      expect(sql.indexOf("read_rule_id IN")).toBeGreaterThan(-1);
      expect(sql.indexOf("read_rule_id IN")).toBeLessThan(sql.indexOf("LIMIT 3"));
    }
  });

  it("a NULL read_rule_id row whose live walk denies never surfaces (33)", async () => {
    const html = await storage!.engine.render("news search nine", "content");
    expect(html).not.toContain("News Mystery");
    expect(html).not.toContain("mystery body");
  });

  it("limit 9 reaches past the denied rows — the 45195 shape (readable junction) renders", async () => {

    const html = await storage!.engine.render("news search nine", "content");
    const slots = html.match(/<div class="search-result-item[^"]*">/g) ?? [];
    expect(slots.length).toBe(7);

    expect(html).toContain("Junction Left+Field Two");

    expect(html).not.toContain("Junction Left+Field One");
    expect(html).not.toContain("denied junction body");
    expect(html).not.toContain('class="denied"');
  });
});

describe("read verdict: *type plus right rule evaluated from the LEFT side's type (trace bug 3)", () => {
  it("denies the junction whose *type plus right read rule grants Role A only", async () => {

    expect(
      await storage!.engine.render("Doc Alpha+Field X", "open"),
    ).toBe(quietDenial());
    expect(
      await storage!.engine.render("Doc Alpha+Field X", "content"),
    ).toBe(quietDenial());
  });

  it("the live-walk deny is not a stored-id echo: the walk alone denies a no-stored-rule twin", async () => {

    const s = storage!;
    await seedCard(s, { id: 51, name: "Doc Beta", typeId: 50 });
    await seedCard(s, { id: 47, leftId: 51, rightId: 45, typeId: 4, dbContent: "twin secret body" });
    const html = await s.engine.render("Doc Beta+Field X", "open");
    expect(html).toBe(quietDenial());
    expect(html).not.toContain("twin secret body");
  });

  it("fails CLOSED when a complete deck's rule walk resolves no candidate", async () => {

    const { canReadByRuleLookup } = await import("../../../src/card/permissions/index.js");
    const emptyFetcher = {
      driver: { query: async () => ({ rows: [] }), batch: async () => [] },
    } as unknown as FetchEngine;
    const base = {
      readableRuleIds: new Set<number>(),
      alwaysOk: false,
      parties: [5, 6],
    };
    const complete = await canReadByRuleLookup(
      emptyFetcher,
      { name: "Some Card", id: 1, typeId: 4 },
      { ...base, hasReadRules: true, hasCatchAllReadRule: true },
    );
    expect(complete).toBe(false);
    const partial = await canReadByRuleLookup(
      emptyFetcher,
      { name: "Some Card", id: 1, typeId: 4 },
      { ...base, hasReadRules: true, hasCatchAllReadRule: false },
    );
    expect(partial).toBeUndefined();
  });
});
