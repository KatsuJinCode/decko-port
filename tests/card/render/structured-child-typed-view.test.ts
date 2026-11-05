// Structured/missing-child typed-view regression (the structchild lane, worktree
// decko-ts-lane-structchild). The class: a nest whose target has NO row but
// whose field template exists renders the oracle's typed new-card view; the
// engine denied it instead. Two stacked mechanisms, both ported from Ruby:
//
// 1. THE DENIAL (permissions.rb:52-58 + 66-72 permission_rule_id): a compound
//    card whose winning live read rule's content is the `_left` reference
//    delegates the verdict to its LEFT card's own rule walk
//    (left_permission_rule_id, left_or_new(skip_virtual: true)). Without the
//    delegation the walk evaluated viewer membership in the DELEGATING rule's
//    grants — `_left` names no party, so every id-less compound child under
//    the deck's `*all plus+*read -> _left` rule denied (the corpus's
//    PCTS+legacy class: 1,835 oracle pages carry such child slots, all
//    failing before this port).
//
// 2. THE TYPE + SET KEYS (new_card_template via the structure universe +
//    pattern/all.rb#patterns): the virtual child takes the *structure rule
//    card's TYPE (type.rb:78-80 type_id_from_template) and its safe_set_keys
//    drop the SELF token (a NEW card's pattern list starts at
//    concrete_patterns[1..]). Oracle pin (expected-v2 page-lane
//    recapture-raw-shard-000001.jsonl, PCTS): `class="card-slot closed-view
//    ALL ALL_PLUS TYPE-rich_text RIGHT-legacy
//    TYPE_PLUS_RIGHT-project-legacy" data-card-name="PCTS+legacy"
//    data-card-type-id="3" data-card-type-name="RichText"` — no SELF, no
//    data-card-id.
//
// Ruby probes that pinned the mechanism (structured-child-type-probe.rb /
// structured-child-render-probe.rb against the corpus deck):
//   Card.new(name: "PCTS+legacy").type_id => 3 (RichText, from
//   `Project+legacy+*type plus right+*structure` id 22060);
//   ok?(:read) => true; state => :virtual; safe_set_keys => "ALL ALL_PLUS
//   TYPE-rich_text RIGHT-legacy TYPE_PLUS_RIGHT-project-legacy".

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
  type SeedOptions,
} from "./render-test-storage.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  structureRuleTypesFromResults,
} from "../../../src/card/rules/structure.js";
import { createVirtualCardLookup } from "../../../src/card/fetch/virtual-cards.js";

// SET_TYPE_ID is the ID OF THE CARD WHOSE CODENAME IS "set" (the Set
// cardtype row): the read-rule-cache join (statement 2) matches
// read_rules.left_id -> sets.type_id = that id, so every set-pattern row's
// typeId must be it, not a free constant.
const SET_TYPE_ID = 3;
const TYPE_TYPE_ID = 4; // the type-card type (the "Basic" cardtype row's type)
const RICHTEXT_TYPE_ID = 4; // the RichText type card row (codename basic)
const SETTING_TYPE_ID = 4;

/** The deck: HostA (type ProjectT) nests {{+legacy|closed}}; the field
 *  template `ProjectT+legacy+*type plus right+*structure` (typed RichText)
 *  exists; the deck's compound read rule `*all plus+*read` is the corpus's
 *  `_left` delegation; `*all+*read` grants anyone. NO row for HostA+legacy. */
async function seedStructuredChildDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions): void => void seedCard(storage, opts);

  // Codename cards the permission math / pattern registry / type codes read.
  // (cards.codename is UNIQUE — the deck's RichText card carries the basic
  // codename exactly like the corpus rows.)
  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "Set", codename: "set", typeId: TYPE_TYPE_ID });
  seed({ id: 4, name: "RichText", codename: "basic", typeId: TYPE_TYPE_ID });
  seed({ id: 5, name: "*structure", codename: "structure", typeId: SETTING_TYPE_ID });
  seed({ id: 6, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });
  seed({ id: 7, name: "*type plus right", codename: "type_plus_right", typeId: SETTING_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: TYPE_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: TYPE_TYPE_ID });

  // The bootstrap read rule: *all+*read -> anyone.
  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");
  // The compound-card read rule the corpus deck carries: *all plus+*read ->
  // `_left` — the DELEGATING rule (names no party; the verdict must come
  // from the left card's own walk).
  seed({ id: 31, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "_left" });

  // The host: type ProjectT (type card id 20), structured content nests the
  // missing +legacy child (closed view, the PCTS template's shape).
  seed({ id: 20, name: "ProjectT", typeId: TYPE_TYPE_ID }); // a cardtype row
  seed({ id: 40, name: "HostA", typeId: 20, dbContent: "<p>{{+legacy|closed}}</p>" });

  // The right-side card of the field (real, simple) — no HostA+legacy row.
  seed({ id: 41, name: "legacy", typeId: TYPE_TYPE_ID });

  // The type_plus_right SET card chain: ProjectT+legacy (junction) +
  // *type plus right (the set card `ProjectT+legacy+*type plus right`).
  seed({ id: 50, name: "ProjectT+legacy", leftId: 20, rightId: 41, typeId: SET_TYPE_ID });
  seed({ id: 51, name: "ProjectT+legacy+*type plus right", leftId: 50, rightId: 7, typeId: SET_TYPE_ID });

  // The field template: the *structure rule ON that set, typed RichText —
  // the virtual child's type source (type.rb:78-80).
  seed({
    id: 52,
    name: "ProjectT+legacy+*type plus right+*structure",
    leftId: 51,
    rightId: 5,
    typeId: RICHTEXT_TYPE_ID,
    dbContent: "<p>{{_left+Description}}</p>",
  });

  // Wire the virtual-card hook (same statement + maps the corpus seeding
  // factory wires).
  const result = await storage.fetcher.driver.batch([structureRuleUniverseStatement()]);
  storage.fetcher.virtualCardLookup = createVirtualCardLookup(storage.fetcher, {
    contents: structureUniverseFromResults(result[0]),
    ruleTypeIds: structureRuleTypesFromResults(result[0]),
  });
  return storage;
}

/** The delegation unit deck: a STORED compound row without a read_rule_id
 *  (the live-walk fallback surface) under the same `_left` rule.
 *  - HostB readable (*all+*read -> anyone) -> HostB+child readable.
 *  - HostC denied (HostC+*self+*read -> Role_A only; the REAL left keeps its
 *    SELF candidate) -> HostC+child denied through the delegation. */
async function seedLeftDelegationDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions): void => void seedCard(storage, opts);

  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "Set", codename: "set", typeId: SET_TYPE_ID });
  seed({ id: 13, name: "*self", codename: "self", typeId: SET_TYPE_ID });
  seed({ id: 4, name: "Basic", typeId: TYPE_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: TYPE_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: TYPE_TYPE_ID });
  seed({ id: 11, name: "Role_A", typeId: TYPE_TYPE_ID });

  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");
  seed({ id: 31, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "_left" });
  // HostC's SELF read rule: Role_A only (the REAL left's live walk denies).
  seed({ id: 32, name: "HostC+*self+*read", leftId: 33, rightId: 2, typeId: SET_TYPE_ID, dbContent: "Role_A" });
  await seedReference(storage, 32, 11, "role_a");

  seed({ id: 33, name: "HostC", typeId: TYPE_TYPE_ID, dbContent: "denied host body" });
  seed({ id: 34, name: "HostB", typeId: TYPE_TYPE_ID, dbContent: "readable host body" });
  seed({ id: 12, name: "child", typeId: TYPE_TYPE_ID });
  // The stored compound rows WITHOUT read_rule_id: the live walk decides.
  seed({ id: 35, name: "HostB+child", leftId: 34, rightId: 12, typeId: TYPE_TYPE_ID, dbContent: "readable child body" });
  seed({ id: 36, name: "HostC+child", leftId: 33, rightId: 12, typeId: TYPE_TYPE_ID, dbContent: "denied child body" });
  return storage;
}

describe("structured/missing children: the typed new-card view (PCTS+legacy class)", () => {
  it("renders the missing +legacy nest as the typed virtual child, not a denial", async () => {
    const storage = await seedStructuredChildDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const html = await storage.engine.render("HostA", "content");
      // The denial span is GONE (the pre-fix engine emitted
      // `<span class="denied">` for this nest).
      expect(html).not.toContain('class="denied"');
      // The typed new-card slot: no data-card-id (no row), the field
      // template's type, the new-card set keys (no SELF token).
      expect(html).toContain('data-card-name="HostA+legacy"');
      expect(html).toContain(`data-card-type-id="${RICHTEXT_TYPE_ID}"`);
      expect(html).toContain('data-card-type-name="RichText"');
      expect(html).toContain("closed-view ALL ALL_PLUS TYPE-rich_text RIGHT-legacy TYPE_PLUS_RIGHT-project_t-legacy");
      expect(html).not.toContain("SELF-host_a-legacy");
    } finally {
      storage.close();
    }
  });

  it("fetchByName still resolves the child as the virtual card: template content + rule type", async () => {
    const storage = await seedStructuredChildDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const card = await storage.fetcher.fetchByName("HostA+legacy");
      expect(card).toBeDefined();
      expect(card?.id).toBeUndefined();
      expect(card?.isNew).toBe(true);
      expect(card?.typeId).toBe(RICHTEXT_TYPE_ID);
      expect(card?.dbContent).toBe("<p>{{_left+Description}}</p>");
    } finally {
      storage.close();
    }
  });
});

describe("the _left read-rule delegation (permissions.rb:52-72)", () => {
  it("a compound row without read_rule_id reads through its left card's rule", async () => {
    const storage = await seedLeftDelegationDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const html = await storage.engine.render("HostB+child", "content");
      expect(html).not.toContain('class="denied"');
      expect(html).toContain("readable child body");
      const host = await storage.engine.render("HostB", "content");
      expect(host).toContain("readable host body");
    } finally {
      storage.close();
    }
  });

  it("the delegation follows a DENIED left card to the denial span", async () => {
    const storage = await seedLeftDelegationDeck();
    try {
      storage.fetcher.installNameEnvironment();
      // Control: the denied left itself.
      const host = await storage.engine.render("HostC", "content");
      expect(host).toContain('class="denied"');
      // The child: *all plus+*read wins the walk, its _left content delegates
      // to HostC's own walk (SELF rule -> Role_A only) -> denied.
      const html = await storage.engine.render("HostC+child", "content");
      expect(html).toContain('class="denied"');
      expect(html).not.toContain("denied child body");
    } finally {
      storage.close();
    }
  });
});
