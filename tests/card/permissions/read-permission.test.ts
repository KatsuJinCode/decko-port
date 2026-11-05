// Read-permission enforcement tests — the READ side of the rule algebra
// (card-mod-permissions set/all/permissions.rb#ok_to_read? +
// card-mod-account set/abstract/account_holder.rb#read_rules_hash).
//
// Deck layout (ids stable so the reference rows are readable):
//   1  *all            codename all      typeId 2 (Set)   - the catch-all set
//   2  Set             codename set                       - the Set TYPE card
//   3  *read           codename read                      - the read setting
//   4  Basic                                              - the Basic type card
//   5  Anyone          codename anyon...                  - the always-party
//   6  Anonymous       codename anonym...                 - the corpus viewer
//   7  Role A                                             - a party Anonymous
//                                                         does not join
//   8  *all+*read      left 1 right 3    [[Anyone]]       - grants everyone
//   9  Basic+*type     typeId 2 (Set)                     - the Basic type set
//   10 Basic+*type+*read left 9 right 3  [[Role A]]       - grants Role A only
//   11 Readable Thing  typeId 4 read_rule_id 8            - readable
//   12 Secret Thing    typeId 4 read_rule_id 10           - DENIED for Anonymous
//   13 Page With Secret typeId 4 read_rule_id 8, nests 12 - readable, embeds
//                                                         the denial span
//   14 Mystery Thing   typeId 4 read_rule_id NULL          - fallback rule walk
//                                                         finds the *type rule
//                                                         (10) first -> denied
//
// The byte oracle for every denial shape is the corpus capture
// (fixtures/corpus/*): `<span class="denied"><!-- Sorry, you don't have
// permission (read) --></span>`, replacing the ENTIRE view output
// (no card-slot wrapper).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { quietDenial } from "../../../src/card/permissions/index.js";

const SET_TYPE_ID = 2;
const BASIC_TYPE_ID = 4;

let storage: RenderTestStorage | undefined;
/** Twin deck WITHOUT read rules - same three content cards, no permission
 *  data. The query-shape pins compare the two cold renders (the folded
 *  permission statements must add statements, never round trips). */
let ruleless: RenderTestStorage | undefined;

async function seedPermissionDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "Role A" });
  // The pattern cards every real deck bootstraps (the rule walk composes
  // junction candidates like Basic+*type+*read through them).
  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });
  // *all+*read -> [[Anyone]]: everyone may read through this rule.
  await seedCard(s, {
    id: 8, leftId: 1, rightId: 3, dbContent: "[[Anyone]]",
  });
  await seedReference(s, 8, 5, "anyone");
  // Basic+*type+*read -> [[Role A]]: members only. The Basic+*type set
  // card is a junction row (NULL name/key, side ids per the 2020
  // convention seedCard mirrors).
  await seedCard(s, { id: 9, leftId: 4, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 10, leftId: 9, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 10, 7, "role_a");
  // The governed cards (read_rule_id = the DATA side, set on Ruby's save).
  await seedCard(s, {
    id: 11, name: "Readable Thing", typeId: BASIC_TYPE_ID,
    dbContent: "readable body", readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 12, name: "Secret Thing", typeId: BASIC_TYPE_ID,
    dbContent: "secret body", readRuleId: 10, readRuleClass: "*type",
  });
  await seedCard(s, {
    id: 13, name: "Page With Secret", typeId: BASIC_TYPE_ID,
    dbContent: "before {{Secret Thing}} after", readRuleId: 8,
    readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 14, name: "Mystery Thing", typeId: BASIC_TYPE_ID,
    dbContent: "mystery body",
  });
}

async function seedRulelessDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, {
    id: 11, name: "Readable Thing", typeId: BASIC_TYPE_ID,
    dbContent: "readable body",
  });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedPermissionDeck(storage);
  ruleless = await createRenderTestStorage();
  await seedRulelessDeck(ruleless);
}, 60_000);

afterAll(() => {
  storage?.close();
  ruleless?.close();
});

describe("read permission: the Anonymous viewer (the corpus actor)", () => {
  it("renders a card readable through *all+*read -> Anyone in full", async () => {
    const s = storage!;
    for (const view of ["open", "content", "closed", "title"]) {
      const html = await s.engine.render("Readable Thing", view);
      expect(html).not.toContain('class="denied"');
    }
    expect(await s.engine.render("Readable Thing", "content")).toContain("readable body");
  });

  it("replaces the whole :open/:closed/:content view with Ruby's quiet denial span", async () => {
    const s = storage!;
    const span = quietDenial();
    expect(span).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission (read) --></span>',
    );
    for (const view of ["open", "closed", "content"]) {
      expect(await s.engine.render("Secret Thing", view)).toBe(span);
    }
  });

  it("still renders :title of a denied card (perms :none, title.rb:2)", async () => {
    const s = storage!;
    expect(await s.engine.render("Secret Thing", "title")).toBe(
      '<span class="card-title" title="Secret Thing">Secret Thing</span>',
    );
  });

  it("renders :menu of a denied card as blank (menu.rb:8 denial: :blank)", async () => {
    const s = storage!;
    expect(await s.engine.render("Secret Thing", "menu")).toBe("");
  });

  it("denies the nest, never the host: denied card content is not processed", async () => {
    const s = storage!;
    const html = await s.engine.render("Page With Secret", "content");
    expect(html).toContain(quietDenial());
    expect(html).toContain("before");
    expect(html).toContain("after");
    expect(html).not.toContain("secret body");
  });

  it("resolves cards without a stored read_rule_id through the live rule walk", async () => {
    const s = storage!;
    // Mystery Thing has no stored read_rule_id: the fallback walk finds
    // Basic+*type+*read ([[Role A]] only) BEFORE *all+*read -> denied.
    expect(await s.engine.render("Mystery Thing", "content")).toBe(quietDenial());
  });

  it("renders rule-less decks in full (the documented synthetic-seed divergence)", async () => {
    const s = ruleless!;
    // Ruby on a deck without *any* read rule denies (read_rules_hash is
    // empty); every real deck bootstraps *all+*read (card/auth/setup.rb:44),
    // so the port treats the rule-less seed as "no permission data" and
    // renders. This is what keeps every existing rule-less render test
    // meaningful. See docs/permissions-port-notes.md.
    const html = await s.engine.render("Readable Thing", "content");
    expect(html).toContain("readable body");
    expect(html).not.toContain('class="denied"');
  });
});

describe("read permission query shape (decko-commons/decko#1282)", () => {
  it("cold render: permission resolution rides the closure batch (one round trip, three folded statements)", async () => {
    const cold = await createRenderTestStorage();
    try {
      await seedPermissionDeck(cold);
      cold.counting.reset();
      await cold.engine.render("Readable Thing", "open");
      const stats = cold.engine.lastRenderStats;
      // The whole closure walk AND the permission state resolved in ONE
      // driver.batch (one round trip stays one round trip).
      expect(stats?.batches).toBe(1);
      // 3 read-permission + 1 codename codehash (rule? ids) + 1 *structure
      // rule universe (the structured-content stream rides the same batch,
      // appended AFTER the permission statements — the parser reads the
      // permission results by fixed index 0..2) + 1 *default rule universe
      // (round 9: the new-child template type rides the same batch — the
      // *default universe is parsed from the slot right after the
      // *structure universe) + 1 *default_html_view rule universe (round
      // 10: the deck's bare-nest default view folded on the same batch.
      // R17: one fewer - the *default html view universe left the fold
      // (A-36 correction: default_nest_view is process config,
      // html.rb:17-19, never a deck rule).
      expect(stats?.additionalResults?.length).toBe(6);
    } finally {
      cold.close();
    }
  });

  it("warm re-render of a denied card issues zero queries", async () => {
    const s = storage!;
    await s.engine.render("Secret Thing", "open");
    s.counting.reset();
    expect(await s.engine.render("Secret Thing", "open")).toBe(quietDenial());
    expect(s.counting.snapshot()).toEqual({ statements: 0, roundTrips: 0 });
  });

  it("resetCaches clears the permission state (re-resolution works)", async () => {
    const s = storage!;
    s.engine.resetCaches();
    expect(await s.engine.render("Secret Thing", "content")).toBe(quietDenial());
    expect(await s.engine.render("Readable Thing", "content")).toContain("readable body");
  });
});
