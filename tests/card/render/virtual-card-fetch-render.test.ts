// Virtual-card fetch + render regression (the 25 id:null disputed records of
// the corpus-v2 recapture, tmp/recapture-deck/enumeration/null-id-disputed.json).
//
// Ruby mechanism under test (every claim cited in
// src/card/fetch/virtual-cards.ts):
//   - a COMPOUND name mark never resolves an ORPHAN junction row (left_id/
//     right_id NULL) — the Lexicon compound path (lexicon.rb#name_to_lex)
//     resolves [id(left), id(right)] and queries left_id/right_id, never the
//     junction key; Ruby then returns the card as VIRTUAL when a *structure
//     rule applies (states.rb:44-50 `virtual?`), with the rule template as
//     content (content/all.rb:8-10) and the RULE CARD's type (type.rb:78-80
//     type_id_from_template).
//   - the denied-view contract: a virtual card is KNOWN (no alter_unknown),
//     so the view gate denies non-perms-:none views for a viewer the SELF
//     read rule excludes — `<span class="denied"><!-- Sorry, you don't have
//     permission (read) --></span>` — while :title (perms :none) renders.
//
// Seeds mirror the corpus rows the disputed set carries (orphan junction row
// + a `*right`-anchored structure rule + a `*self` read rule granting a role
// the anonymous viewer lacks).

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

const BASIC_TYPE_ID = 3;
const SET_TYPE_ID = 4;

async function seedCorpusShapedDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions) => seedCard(storage, opts);

  // Codename cards the permission math and type codes read.
  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID }); // the catch-all set anchor
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "orvipveb", codename: "basic", typeId: 5 }); // the Basic type card (anonymized name)
  seed({ id: 4, name: "exi", codename: "set", typeId: 5 }); // the Set type card (anonymized name)
  seed({ id: 5, name: "*structure", codename: "structure", typeId: SET_TYPE_ID });
  seed({ id: 6, name: "*right", codename: "right", typeId: SET_TYPE_ID });
  seed({ id: 7, name: "*self", codename: "self", typeId: SET_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: BASIC_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: BASIC_TYPE_ID });
  seed({ id: 20, name: "Role_A1", typeId: BASIC_TYPE_ID }); // a role the viewer does not hold

  // The bootstrap read rule: *all+*read -> anyone (keeps hasReadRules +
  // hasCatchAllReadRule true, so the live rule walk runs; ref = anyone).
  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");

  // Left and right side cards of the virtual junction (real, simple).
  seed({ id: 40, name: "ylfetacflzl", typeId: BASIC_TYPE_ID, dbContent: "left body" });
  seed({ id: 41, name: "ytyovdhppytn", typeId: BASIC_TYPE_ID, dbContent: "right body" });

  // The structure rule `ytyovdhppytn+*right+*structure` (RIGHT-pattern rule;
  // its set card `ytyovdhppytn+*right` is a structural junction row) — the
  // rule card's TYPE is the Basic type card (3), its content the template.
  seed({ id: 50, name: "ytyovdhppytn+*right", leftId: 41, rightId: 6, typeId: SET_TYPE_ID });
  seed({
    id: 51,
    name: "ytyovdhppytn+*right+*structure",
    leftId: 50,
    rightId: 5,
    typeId: BASIC_TYPE_ID, // <- the virtual card's type source
    dbContent: "<p>{{xxxx}}</p>",
  });
  // The `*self+*right+*structure` rule (RIGHT pattern for every `+*self`
  // name) — typed Set, the corpus's group-B winner. Its set card
  // `*self+*right` is the structural junction row the universe statement
  // composes the rule key from.
  seed({ id: 53, name: "*self+*right", leftId: 7, rightId: 6, typeId: SET_TYPE_ID });
  seed({ id: 52, name: "*self+*right+*structure", leftId: 53, rightId: 5, typeId: SET_TYPE_ID, dbContent: "crgazjzllxoccqgh" });

  // The ORPHAN junction row: name+key stored, left_id/right_id NULL — the
  // row shape the corpus carries for every id:null disputed name. Invisible
  // to name-based fetch (the Lexicon compound path), present for id fetch.
  seed({ id: 60, name: "ylfetacflzl+ytyovdhppytn", typeId: BASIC_TYPE_ID, dbContent: "<p>{{xxxx}}</p>" });

  // The SELF read rule over the virtual card's name. Its reference grants
  // ANYONE (the corpus's own shape: rule 9038 content "Role_A1", reference
  // -> the anyone card) — but for an ID-LESS card Ruby drops the SELF
  // candidate from rule_lookup_keys (nil anchor id), so this rule never
  // decides the verdict; the RSTAR rule below does.
  seed({
    id: 61,
    name: "ylfetacflzl+ytyovdhppytn+*self+*read",
    rightId: 2,
    typeId: SET_TYPE_ID,
    dbContent: "Role_A1",
  });
  await seedReference(storage, 61, 9, "anyone");
  // The `*all plus+*read` rule (RSTAR candidate) grants Role_A1 only — the
  // rule Ruby's permission_rule_id answers for the virtual card (oracle
  // probe: permission_rule_id(:read) = the `*all plus+*read` card, hash
  // miss -> denied).
  seed({ id: 62, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "Role_A1" });
  await seedReference(storage, 62, 20, "role_a1");

  // Wire the virtual-card hook the corpus seeding factory wires (same
  // statement + maps over the seeded deck).
  const result = await storage.fetcher.driver.batch([structureRuleUniverseStatement()]);
  storage.fetcher.virtualCardLookup = createVirtualCardLookup(storage.fetcher, {
    contents: structureUniverseFromResults(result[0]),
    ruleTypeIds: structureRuleTypesFromResults(result[0]),
  });
  return storage;
}

describe("virtual-card fetch (states.rb#virtual?)", () => {
  it("fetchByName resolves an orphan junction name as the virtual card: rule template content + rule card type", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.fetchByName("ylfetacflzl+ytyovdhppytn");
      expect(card).toBeDefined();
      expect(card?.id).toBeUndefined(); // no row: Ruby card.id nil
      expect(card?.isNew).toBe(true);
      expect(card?.name?.s).toBe("ylfetacflzl+ytyovdhppytn");
      expect(card?.key).toBe("ylfetacflzl+ytyovdhppytn");
      expect(card?.typeId).toBe(BASIC_TYPE_ID); // type.rb:78-80 from the rule card
      expect(card?.dbContent).toBe("<p>{{xxxx}}</p>"); // content/all.rb:8-10
    } finally {
      storage.close();
    }
  });

  it("the +*self name takes the *self+*right rule's Set type", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.fetchByName("ylfetacflzl+ytyovdhppytn+*self");
      expect(card).toBeDefined();
      expect(card?.typeId).toBe(SET_TYPE_ID);
      expect(card?.dbContent).toBe("crgazjzllxoccqgh");
    } finally {
      storage.close();
    }
  });

  it("skip_virtual (Card[]) still returns nil for the virtual name", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.bracket("ylfetacflzl+ytyovdhppytn");
      expect(card).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("a compound name under no structure rule stays unknown (fetch nil)", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.fetchByName("ylfetacflzl+never_structured");
      expect(card).toBeUndefined();
    } finally {
      storage.close();
    }
  });
});

describe("virtual-card render (the denied-view contract)", () => {
  it("closed/content/open render the quiet denial; title renders", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const denied = '<span class="denied"><!-- Sorry, you don\'t have permission (read) --></span>';
      expect(await storage.engine.render("ylfetacflzl+ytyovdhppytn", "closed")).toBe(denied);
      expect(await storage.engine.render("ylfetacflzl+ytyovdhppytn", "content")).toBe(denied);
      expect(await storage.engine.render("ylfetacflzl+ytyovdhppytn", "open")).toBe(denied);
      const title = await storage.engine.render("ylfetacflzl+ytyovdhppytn", "title");
      expect(title).toContain('class="card-title" title="ylfetacflzl+ytyovdhppytn"');
    } finally {
      storage.close();
    }
  });
});
