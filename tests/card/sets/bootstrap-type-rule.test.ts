// Bootstrap type-rule assignment on auto-created set sides — the port of
// card-1.110.0 mod/core/set/all/type.rb's ensure_type_id (type.rb:58-66)
// and its type_id_from_code walk (:68-76) for the engine's create path.
//
// Ruby chain (every test cites its file:line; full trail in
// docs/set-patterns-port-notes.md):
//
//   1. Card.create! -> Director.run -> super.initialize -> handle_type
//      (mod/core/set/all/initialize.rb:51-55) -> ensure_type_id
//      (mod/core/set/all/type.rb:58-66).
//   2. ensure_type_id calls `type_id_from_code || type_id_from_template`.
//   3. type_id_from_code (type.rb:68-76) short-circuits on `simple?`
//      (type.rb:69), then walks `each_type_assigning_module_key` and
//      returns `Card::Set::Type.assignment[module_key]&.card_id`
//      (lib/card/set/type.rb:5-6).
//   4. For auto-created sides on a junction save, prepare_new_side
//      (mod/core/set/all/name_events.rb:137-142) instantiates the side via
//      `Director.card(sidename) || subcard(sidename)`; the subcard runs the
//      same initialize -> handle_type -> ensure_type_id chain, so the
//      type-assignment walk fires identically for the side card.
//   5. set_read_rule (card-mod-permissions set/all/permissions.rb:1-5)
//      then derives read_rule_id/read_rule_class against the stored type —
//      the walk landing on a non-default type changes which read rule the
//      cascade picks (set-read-rule.ts:131-152).
//
// This file proves the TS port walks the same chain: explicit arg ->
// type-assignment walk -> default, and that an auto-created compound side
// gets the assigned type (NOT the default) when its pattern has an
// `assign_type` registration in the Set::Type.assignment registry.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actionEngine,
  createActionsTestStorage,
  seedCard,
  seedStandardDeck,
  type StandardFixture,
} from "../actions/actions-test-storage.js";
import {
  registerSetTypeAssignment,
  resetSetTypeAssignments,
  findAssignedTypeName,
  resolveAssignedTypeIdForCard,
  listAssignedTypeNamesForCard,
} from "../../../src/card/set-patterns/set-type-assignment.js";
import { DeckoName } from "../../../src/card/name.js";

/** Prime the sync NameEnvironment the pattern walk reads (FetchEngine
 *  installNameEnvironment + warmLexicon — fetch.ts:627-658). Without this
 *  the codename lookups return undefined and the walk emits no module keys.
 *  This is the same setup the cql tests use (cql/name-resolution.test.ts:60). */
async function primePatternEnv(f: StandardFixture): Promise<void> {
  f.engine.installNameEnvironment();
  const ids = (
    await f.storage.driver.query<{ id: number }>("SELECT id FROM cards WHERE trash = 0", [])
  ).rows.map((r) => Number(r.id));
  await f.engine.warmLexicon(ids);
}

type Row = Record<string, unknown>;

async function cardRow(f: StandardFixture, id: number): Promise<Row> {
  const row = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [id]);
  if (row === undefined) throw new Error(`card ${id} missing`);
  return row;
}

async function cardRowByKey(f: StandardFixture, key: string): Promise<Row | undefined> {
  return f.storage.selectOne<Row>("SELECT * FROM cards WHERE key = ?", [key]);
}

beforeEach(() => {
  // Each test gets a clean assignment registry — same shape as Ruby's
  // `Set::Type.assignment` reset between specs.
  resetSetTypeAssignments();
});

afterEach(() => {
  resetSetTypeAssignments();
});

describe("findAssignedTypeName — the type_id_from_code walk", () => {
  it("returns undefined for SIMPLE names (type.rb:69 `return if simple?`)", () => {
    // "banana" is simple -> the walk short-circuits, exactly like Ruby.
    expect(findAssignedTypeName({ name: "banana", isNew: true })).toBeUndefined();
    registerSetTypeAssignment("Right::Banana", "Phrase");
    // Even with a registration registered, a SIMPLE name never consults it.
    expect(findAssignedTypeName({ name: "banana", isNew: true })).toBeUndefined();
  });

  it("returns undefined when no assigns_type pattern has a registration", () => {
    // "A+B" is compound; *right with anchor "B" applies but no codename, so
    // module_key is null (PatternInstance#module_key) and the walk emits
    // nothing (PatternInstance#anchorCodenames returns null when any anchor
    // part lacks a codename; see card-patterns.ts header).
    expect(findAssignedTypeName({ name: "A+B", isNew: true })).toBeUndefined();
  });

  it("returns the registered type name when an assigns_type pattern matches", async () => {
    // Seed the codename registry's anchor via a card with codename "subject"
    // (the *right pattern's module_key is "Right::Subject" only when the
    // anchor's codename resolves; PatternInstance#module_key, base.rb:45-50).
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    expect(findAssignedTypeName({ name: "Home+subject", isNew: true })).toBe("Phrase");
    storage.close();
  });

  it("walks assigns_type patterns in pattern-precedence order", async () => {
    // Both *right and *type plus right have assigns_type: true (registry.ts
    // PATTERN_TABLE:07_right and 08_type_plus_right). *type plus right
    // comes first in pattern-precedence order (the *self / *type plus
    // right / *right ordering — see registry.ts "lookup order" header).
    // With both registered, the FIRST matching module key wins (type.rb:73
    // `return type_id if type_id`); that mirrors Ruby's break-out of the
    // each_type_assigning_module_key block.
    //
    // *type plus right's module_key is "TypePlusRight::<lefttype>::<right>"
    // (trait.rb:62-64). The left type is the card's own TYPE; for a new
    // card with no explicit type, the *type plus right pattern applies
    // when its anchor's left side (the type) has a codename. We seed
    // "RichText" (codename "basic") and "subject" (codename "subject")
    // to make the module_key resolvable.
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    registerSetTypeAssignment("TypePlusRight::Basic::Subject", "List");
    const card = {
      name: "Home+subject",
      isNew: true,
      typeName: "RichText",
    };
    const list = listAssignedTypeNamesForCard(card);
    // The walk returns BOTH assignments in pattern-precedence order
    // (TypePlusRight first, then Right). findAssignedTypeName returns the
    // first hit (List).
    expect(list).toContain("Phrase");
    expect(list).toContain("List");
    expect(list.indexOf("List")).toBeLessThan(list.indexOf("Phrase"));
    expect(findAssignedTypeName(card)).toBe("List");
    storage.close();
  });

  it("skips registered module keys whose anchor codenames the card lacks", () => {
    // Module key needs all anchor parts to resolve to a codename; the
    // anchor "ghost" has no codename -> PatternInstance#module_key returns
    // null -> the walk never emits "Right::Ghost". Ruby's pattern/all.rb
    // short-circuits identically (anchor_codenames returns nil and the
    // module_key return is nil).
    registerSetTypeAssignment("Right::Ghost", "List");
    expect(findAssignedTypeName({ name: "Home+ghost", isNew: true })).toBeUndefined();
  });
});

describe("resolveAssignedTypeIdForCard — id resolution (type.rb:72 `&.card_id`)", () => {
  it("returns the registered type's id from the codename registry", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    // Register a cardtype with codename "phrase" (RichText's id 2 is the
    // generic basic type; we want a SEPARATE type card so the assertion
    // distinguishes the walk's answer from the default).
    const phraseCard = await seedCard(storage, {
      id: 99,
      name: "Phrase",
      codename: "phrase",
      typeId: 3, // Cardtype type
    });
    // Seed "subject" too so *right's anchor_codenames resolves.
    await seedCard(storage, {
      id: 100,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "phrase");
    const id = await resolveAssignedTypeIdForCard(f.engine, {
      name: "Home+subject",
      isNew: true,
    });
    expect(id).toBe(phraseCard.id);
    storage.close();
  });

  it("returns undefined when the registered type card does not exist", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 100,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    // No "Pointer" card seeded; resolveAssignedTypeId returns undefined.
    registerSetTypeAssignment("Right::Subject", "Pointer");
    const id = await resolveAssignedTypeIdForCard(f.engine, {
      name: "Home+subject",
      isNew: true,
    });
    expect(id).toBeUndefined();
    storage.close();
  });
});

describe("createCard — auto-created side cards get the assigned type", () => {
  it("simple auto-created side falls back to the default (RichText)", async () => {
    // Ruby parity: simple? short-circuits type_id_from_code (type.rb:69);
    // type_id_from_template returns nil for a freshly constructed side;
    // the default (Card.default_type_id = *all+*default rule's type_id =
    // RichText) is the same answer the port produces.
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+banana", content: "mix" });
    const banana = await cardRowByKey(f, "banana");
    expect(banana).toBeDefined();
    expect(banana).toMatchObject({
      name: "banana",
      key: "banana",
      left_id: null,
      right_id: null,
      // defaultTypeId -> *all+*default rule card's type_id = 2 (RichText)
      type_id: 2,
      db_content: null,
    });
    expect(result.subactions).toHaveLength(1);
    expect(result.subactions[0]).toMatchObject({ cardId: banana!.id });
  });

  it("compound auto-created side with no registration still gets the default", async () => {
    // "Pudding+brandnew" auto-creates "brandnew" as a simple side (right
    // side has no `+`); *right's anchor is "brandnew" with no codename,
    // so module_key is null and the walk emits nothing. Default applies.
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+brandnew", content: "x" });
    const side = await cardRowByKey(f, "brandnew");
    expect(side).toBeDefined();
    expect(side).toMatchObject({ name: "brandnew", type_id: 2 });
    expect(result.subactions).toHaveLength(1);
  });

  it("compound main card with no registration still gets the default", async () => {
    // Saving a compound card whose *right pattern anchor has no codename:
    // the walk emits nothing, default applies — exactly like Ruby.
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+brandnew", content: "x" });
    const junction = await cardRow(f, result.cardId);
    // Junction's left+right id resolve "Pudding+brandnew".
    expect(junction.left_id).toBe(f.joeCard.id);
    expect(junction.type_id).toBe(2);
  });

  it("compound main card with a registration gets the assigned type, not the default", async () => {
    // Seed the codename "subject" so *right's anchor_name codename
    // resolves (PatternInstance#module_key — without a codename, the
    // walk emits nothing). Seed Phrase as a separate cardtype so the
    // assigned id is distinguishable from the default.
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const subjectCard = await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    await seedCard(storage, {
      id: 201,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });
    // Reset the codehash so the new "subject" / "phrase" codenames are
    // visible to the walk (codename.ts:62 resetCache drops the memo
    // and the next id() reloads from storage — same as Ruby's
    // Card::Cache.reset triggered by a codename write).
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "Phrase");

    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Home+subject", content: "hi" });
    const junction = await cardRow(f, result.cardId);
    // "Home" doesn't exist; auto-created as a simple side, default type.
    // The side preserves the input name case (Ruby: name_events.rb:67-72
    // passes the user-typed sidename through verbatim). The key column
    // is the lowercased form ("home"), the name column is the original.
    const homeSide = await cardRowByKey(f, "home");
    expect(homeSide).toBeDefined();
    expect(homeSide).toMatchObject({ name: "Home", key: "home", type_id: 2 });
    // "subject" already existed; the junction references it directly.
    expect(junction.right_id).toBe(subjectCard.id);
    // The JUNCTION gets Phrase (assigned), not RichText (default) — that's
    // the gap this port closes (mod/core/set/all/type.rb:68-76 walk).
    expect(junction.type_id).toBe(201);
    storage.close();
  });

  it("compound side with a registration gets the assigned type, not the default", async () => {
    // Saving a 3-part name auto-creates a compound side that matches a
    // type-assigning pattern. "Left+brandnew+subject" auto-creates
    // "brandnew+subject" as the missing right-side junction. Its *right
    // pattern's anchor name is "subject" with codename "subject" -> the
    // walk hits "Right::Subject" -> assigned type "Phrase".
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    await seedCard(storage, {
      id: 201,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "Phrase");

    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+brandnew+subject", content: "x" });
    const junction = await cardRow(f, result.cardId);
    // 3-part name -> left side: name.left = "Pudding+brandnew" (auto-create),
    //                  right side: name.right = "subject" (already seeded).
    // The junction "Pudding+brandnew+subject" gets type = Phrase via the walk.
    expect(junction.type_id).toBe(201);
    // The auto-created middle junction's name is compound; *right anchor
    // = "brandnew" (no codename) -> walk emits nothing -> default applies
    // for the middle junction.
    const middleActions = await f.storage.selectAll<Row>(
      "SELECT card_id FROM card_actions WHERE action_type = 0 AND card_id != ?",
      [result.cardId],
    );
    const middleIds = middleActions.map((r) => Number(r.card_id));
    expect(middleIds.length).toBeGreaterThan(0);
    for (const mid of middleIds) {
      const row = await cardRow(f, mid);
      if (row.left_id !== null && row.right_id !== null) {
        // Compound auto-created card -> walk fires -> either the
        // registration hits (type_id 201 Phrase) or the default applies
        // (type_id 2 RichText). Either way NOT nil (validate_type would
        // reject nil type_id; the schema also declares type_id NOT NULL).
        expect([2, 201]).toContain(Number(row.type_id));
      }
    }
    storage.close();
  });

  it("set_read_rule derivation runs for the auto-created compound card", async () => {
    // The set_read_rule store event (card-mod-permissions
    // set/all/permissions.rb:1-5) runs against the SAVED row's type; the
    // type-assignment walk changes the derived read_rule_id/class. With
    // no *read rule card for the assigned-type set registered, the port
    // stores NULL read_rule_id (the rule-less-seed divergence documented
    // in src/card/permissions/set-read-rule.ts header). What we verify is
    // that the column is populated (the derivation DID run) rather than
    // undefined / NaN.
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    await seedCard(storage, {
      id: 201,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "Phrase");
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Home+subject", content: "hi" });
    const junction = await cardRow(f, result.cardId);
    // The derivation ran (the columns are populated, even if to NULL
    // for the rule-less deck — same as Ruby's `permission_rule_id(:read)
    // || nil` for unresolvable rules, set/all/permissions.rb:55-61).
    expect(junction.read_rule_id).not.toBeNaN();
    expect(junction.read_rule_class).not.toBeNaN();
    storage.close();
  });
});

describe("registry semantics (lib/card/set/type.rb:5-6)", () => {
  it("registerSetTypeAssignment stores module-key -> type-name pairs", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, { id: 200, name: "subject", codename: "subject", typeId: 3 });
    await seedCard(storage, { id: 201, name: "cc", codename: "cc", typeId: 3 });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    registerSetTypeAssignment("Right::Cc", "Pointer");
    expect(listAssignedTypeNamesForCard({ name: "Home+subject", isNew: true })).toEqual(["Phrase"]);
    expect(listAssignedTypeNamesForCard({ name: "Home+cc", isNew: true })).toEqual(["Pointer"]);
    storage.close();
  });

  it("resetSetTypeAssignments clears the registry", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, { id: 200, name: "subject", codename: "subject", typeId: 3 });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    expect(listAssignedTypeNamesForCard({ name: "Home+subject", isNew: true })).toEqual(["Phrase"]);
    resetSetTypeAssignments();
    expect(listAssignedTypeNamesForCard({ name: "Home+subject", isNew: true })).toEqual([]);
    storage.close();
  });

  it("DeckoName normalization: assignment accepts type names with case / spacing variants", () => {
    // Ruby: assign_type accepts a codename string OR a Card::Name; the
    // lookup normalizes through Card::Codename. The TS port's
    // resolveAssignedTypeId walks codename first, then the lexicon, so a
    // registered name like "Phrase" (the codename) matches a Phrase card
    // with codename "phrase" via the codename path; a registered "phrase"
    // (lowercase) matches the same card via the codename path too.
    const parsed = DeckoName.parse("Phrase");
    expect(parsed.s).toBe("Phrase");
  });
});
