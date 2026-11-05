// Search read-permission regression — the three defects the tenth-item trace
// (brandonDojoTech tmp/wrong-goal-hunt/tenth-item-trace.md) confirmed against
// the corpus and live:
//
//   bug 1  PERMISSIONLESS SEARCH: runSearch passed no read filter, so LIMIT
//          closed the window before any read check — a denied card occupied
//          a result slot and readable cards beyond the window were pushed
//          out. Ruby applies the viewer's read rules at the relation level
//          BEFORE limit_and_offset (Where#permission_conditions ordering).
//          The fix rides cqlPermissionOptions into executeQuery's SQL
//          (src/card/render.ts runSearch), so the limit counts POST-filter.
//
//   bug 2  JUNCTION RESULTS: readable junction results (the corpus's
//          "Kaori Suzuki+Recommendations", id 45195) must surface in search
//          listings. The corpus rows carry NULL name/key columns; the name
//          composes through the lexicon (left_id/right_id) — the deck below
//          pins that a composed junction result renders (and that a DENIED
//          junction never does).
//
//   bug 3  FAIL-OPEN ON *TYPE PLUS RIGHT: the verdict walk's PatternCardInput
//          omitted leftTypeName, so the *type plus right candidate anchored
//          on the quick_type default ("RichText+<tag>") instead of the left
//          card's real type, missed the deck's actual rule, and fell through
//          to the *all+*read catch-all — granting anonymous a body the live
//          deck denies (corpus 51577 "+Source Content": rule 34568 =
//          "Source+Source Content+*type plus right+*read" -> "Anyone Signed
//          In"). The fix passes leftTypeName (render.ts verdictPatternInput)
//          AND fails closed when a complete deck's rule walk resolves no
//          candidate (read-rules.ts — Ruby denies on an unresolvable walk:
//          permissions.rb:139-146 read_rules_hash[nil]).
//
// Deck layout (ids stable; modeled on tests/card/permissions/read-permission
// .test.ts):
//   1  *all          codename all       typeId 2 (Set)
//   2  Set           codename set
//   3  *read         codename read
//   4  Basic
//   5  Anyone        codename anyone
//   6  Anonymous     codename anonymous
//   7  Role A        (a party Anonymous does not join)
//   8  *all+*read    -> [[Anyone]]                    grants everyone
//   9  News+*type    (set card: left 20, right 15)
//   10 News+*type+*read -> [[Role A]]                 News items: Role A only
//   15 *type         codename type
//   16 *self         codename self
//   17 *type plus right codename "type plus right"
//   18 *all plus     codename "all plus"
//   20 News          (the type card the search's type: clause names)
//   21-24, 28-29, 34  News items (readable through 8; one DENIED through 10)
//   25               DENIED junction News item (left 26, right 27)
//   26/27/32         junction side cards
//   31               READABLE junction News item (left 26, right 32) — the
//                    45195 shape (NULL name/key, sides only)
//   33               News item with NO stored read_rule_id whose live walk
//                    resolves rule 10 -> denied (invisible to the SQL id
//                    list too: NULL read_rule_id)
//   40               "Doc Alpha+Field X" junction, stored read rule 42
//                    (*type plus right class) — the 51577 shape
//   41/45            "Doc Alpha" (typeId 50 "Doc") / "Field X"
//   42               Doc+Field X+*type plus right+*read -> [[Role A]]
//   43/44            the rule's set-anchor chain (44 = Doc+Field X,
//                    43 = +*type plus right)
//   50               Doc (type card for 41)

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

/** created_at values: seedCard stamps every row identically, so the
 *  create-desc ordering the searches rely on is written here. Higher
 *  millisecond = newer = earlier in the listing. */
const T = {
  mystery: "2026-09-19 00:00:30.000", // 33 — newest, denied via the live walk
  alpha: "2026-09-19 00:00:20.000", // 21
  secret: "2026-09-19 00:00:10.000", // 22 — denied, occupies pre-fix slot 2
  gamma: "2026-09-19 00:00:09.000", // 23
  delta: "2026-09-19 00:00:08.000", // 24
  deniedJunction: "2026-09-19 00:00:07.000", // 25 — denied junction
  epsilon: "2026-09-19 00:00:06.000", // 28
  zeta: "2026-09-19 00:00:05.000", // 29
  eta: "2026-09-19 00:00:04.000", // 34
  readableJunction: "2026-09-19 00:00:03.000", // 31 — the 45195 shape
};

async function seedDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "Role A" });
  // The Search type card (the codename the prepareSearches gate matches).
  await seedCard(s, { id: 30, name: "Search", codename: "search_type", typeId: SET_TYPE_ID });
  // Pattern cards the candidate composition joins through.
  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });
  await seedCard(s, { id: 17, name: "*type plus right", codename: "type_plus_right" });
  await seedCard(s, { id: 18, name: "*all plus", codename: "all_plus" });
  // *all+*read -> [[Anyone]]: everyone may read through this rule.
  await seedCard(s, { id: 8, leftId: 1, rightId: 3, dbContent: "[[Anyone]]" });
  await seedReference(s, 8, 5, "anyone");
  // The News type card + its *type set + the Role-A-only read rule.
  await seedCard(s, { id: 20, name: "News", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 9, leftId: 20, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 10, leftId: 9, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 10, 7, "role_a");
  // News items. Readable ones carry rule 8 (*all); denied ones rule 10
  // (*type -> Role A). Junction rows: NULL name/key, sides only (the seedCard
  // convention mirroring the 2020 Lexicon migration).
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
  // Distinct created_at per row — the create-desc ordering the searches read.
  for (const [id, at] of Object.entries(T)) {
    await s.counting.query(`UPDATE cards SET created_at = ? WHERE id = ?`, [at, Number(id)]);
  }
  // The *type plus right shape (51577): a junction field whose read rule
  // hangs on "<left type>+<right part>+*type plus right".
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
  // The search cards (readable through *all).
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
  // Warm the sync id map so the CQL type: clause resolves (the search card's
  // JSON content has no nest references, so the closure walk never enriches
  // the News type card on its own).
  await storage.engine.render("News", "title");
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("search read-permission: denied cards filtered BEFORE the limit (trace bug 1)", () => {
  it("limit 3 returns the three NEWEST READABLE items — the denied rank-2 card never occupies a slot", async () => {
    const html = await storage!.engine.render("news search three", "content");
    // The pre-fix window was ranks {1,2,3} = Alpha, Secret, Gamma (Secret
    // denied at render, slot lost). Post-fix the SQL excludes Secret before
    // the limit: Alpha, Gamma, Delta.
    expect(html).toContain("News Alpha");
    expect(html).toContain("News Gamma");
    expect(html).toContain("News Delta");
    expect(html).not.toContain("News Secret");
    expect(html).not.toContain("secret body");
    // Exactly the statement's limit of result items, all readable.
    const slots = html.match(/<div class="search-result-item[^"]*">/g) ?? [];
    expect(slots.length).toBe(3);
    // No denied placeholder anywhere in the listing (Ruby never renders one
    // — the rows never reach the list).
    expect(html).not.toContain('class="denied"');
  });

  it("the pre-fix window shows the regression: WITHOUT the filter the denied card would be rank 2", async () => {
    // The SQL must carry the read-rule condition. Pin the mechanism: the
    // executed statement contains the read_rule_id IN (...) clause and the
    // LIMIT comes AFTER it in the same WHERE (the relation-level ordering
    // Ruby's Where#permission_conditions + limit_and_offset produce).
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
    // 9 items ordered create-desc over the readable set: Alpha, Gamma,
    // Delta, Epsilon, Zeta, Eta, junction 31 (the denied 22/25 and 33 fall
    // out BEFORE the limit, so rank 8 — outside the pre-fix window — is
    // reachable).
    const html = await storage!.engine.render("news search nine", "content");
    const slots = html.match(/<div class="search-result-item[^"]*">/g) ?? [];
    expect(slots.length).toBe(7);
    // Junction result renders with its COMPOSED name (name column NULL,
    // composed from left_id/right_id through the lexicon). The :bar item
    // shows the composed name; the bar view itself carries no body.
    expect(html).toContain("Junction Left+Field Two");
    // The denied junction (same left, other field) never renders.
    expect(html).not.toContain("Junction Left+Field One");
    expect(html).not.toContain("denied junction body");
    expect(html).not.toContain('class="denied"');
  });
});

describe("read verdict: *type plus right rule evaluated from the LEFT side's type (trace bug 3)", () => {
  it("denies the junction whose *type plus right read rule grants Role A only", async () => {
    // The stored rule (42) does not grant anonymous; the live walk must
    // resolve the SAME rule through the correctly-anchored candidate
    // ("Doc+Field X+*type plus right+*read") — reachable only with
    // leftTypeName. Pre-fix the anchor fell back to "RichText+Field X",
    // the walk fell through to *all+*read, and the body leaked.
    expect(
      await storage!.engine.render("Doc Alpha+Field X", "open"),
    ).toBe(quietDenial());
    expect(
      await storage!.engine.render("Doc Alpha+Field X", "content"),
    ).toBe(quietDenial());
  });

  it("the live-walk deny is not a stored-id echo: the walk alone denies a no-stored-rule twin", async () => {
    // A twin junction with NO stored read_rule_id — the verdict comes from
    // the live walk only, which must find rule 42 first (precedence: the
    // type plus right candidate sits ABOVE *all plus / *all in the lookup
    // order) and deny, never fall through to the catch-all.
    const s = storage!;
    await seedCard(s, { id: 51, name: "Doc Beta", typeId: 50 });
    await seedCard(s, { id: 47, leftId: 51, rightId: 45, typeId: 4, dbContent: "twin secret body" });
    const html = await s.engine.render("Doc Beta+Field X", "open");
    expect(html).toBe(quietDenial());
    expect(html).not.toContain("twin secret body");
  });

  it("fails CLOSED when a complete deck's rule walk resolves no candidate", async () => {
    // canReadByRuleLookup's no-candidate branch, unit-tested against an
    // empty driver (the real deck's catch-all would always resolve): a
    // complete deck's unresolved walk denies (Ruby: permission_rule_id ->
    // nil -> read_rules_hash[nil] -> deny); a partial deck's stays the
    // documented allow (undefined).
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
