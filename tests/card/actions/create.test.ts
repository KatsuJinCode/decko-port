// Action-layer tests — SET (Card.create!): row-level conformance against
// the ActWriter contract and the Ruby save semantics. Every expectation
// cites its Ruby file:method; the trail lives in docs/actions-port-notes.md.
// Synthetic fixtures only (DATA RULE).

import { describe, expect, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import {
  CardActionError,
  CardActionEngine,
} from "../../../src/card/actions/index.js";
import {
  actionEngine,
  ANON,
  createActionsTestStorage,
  JOE,
  RICH_TEXT_ID,
  seedStandardDeck,
  type StandardFixture,
} from "./actions-test-storage.js";

async function fresh(): Promise<StandardFixture> {
  const storage = await createActionsTestStorage();
  const fixture = await seedStandardDeck(storage);
  return fixture;
}

type Row = Record<string, unknown>;

async function cardRow(f: StandardFixture, id: number): Promise<Row> {
  const row = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [id]);
  if (row === undefined) throw new Error(`card ${id} missing`);
  return row;
}

describe("createCard — simple create (Set)", () => {
  it("writes the cards row, one act, one create action, NO change rows", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Hello Page", content: "body text" });

    // cards row (set_stamper — card-mod-account set/all/account.rb:20-23;
    // manage_trash forces trash false — trash.rb:23-27; current_revision_id
    // has no runtime writer — docs/history-port-notes.md section 1.4)
    const card = await cardRow(f, result.cardId);
    expect(card).toMatchObject({
      name: "Hello Page",
      key: "hello_page",
      codename: null,
      left_id: null,
      right_id: null,
      current_revision_id: null,
      trash: 0,
      type_id: RICH_TEXT_ID, // default type = *all+*default rule card's type (type.rb:3-5)
      db_content: "body text",
      creator_id: JOE.id,
      updater_id: JOE.id,
    });
    expect(card.created_at).toBe(card.updated_at);

    // exactly one act, primary card claimed (finalize_act — events.rb:48-50)
    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts ORDER BY id");
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ card_id: result.cardId, actor_id: JOE.id, ip_address: "192.0.2.7" });

    // one action, type create (0), not a draft, no super action
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      card_id: result.cardId,
      card_act_id: acts[0].id,
      super_action_id: null,
      action_type: 0, // TYPE_OPTIONS index (action.rb:42, :90-92)
      draft: 0,
      comment: null,
    });

    // first_create? skips change storage entirely (events.rb:31-32;
    // history.rb:38-40) — seed truth: card_changes.yml is empty while
    // card_actions.yml is full of create rows.
    expect(await f.storage.count("card_changes")).toBe(0);
    expect(result.verb).toBe("create");
    expect(result.name?.equals(DeckoName.parse("Hello Page"))).toBe(true);
    expect(result.subactions).toHaveLength(0);
  });

  it("resolves an explicit type by code, by name, and falls back to the default rule", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const byCode = await engine.createCard({ name: "Typed A", typeCode: "cardtype" });
    await expect(
      f.storage.selectOne<Row>("SELECT type_id FROM cards WHERE id = ?", [byCode.cardId]),
    ).resolves.toMatchObject({ type_id: 3 });
    const byName = await engine.createCard({ name: "Typed B", typeName: "RichText" });
    await expect(
      f.storage.selectOne<Row>("SELECT type_id FROM cards WHERE id = ?", [byName.cardId]),
    ).resolves.toMatchObject({ type_id: RICH_TEXT_ID });

    // unknown codename -> type_id_or_error (type.rb:104-110)
    await expect(engine.createCard({ name: "Typed C", typeCode: "nosuch" })).rejects.toMatchObject({
      code: "type-unknown",
    });
    // unknown name -> type_id_from_cardname (type.rb:100-103)
    await expect(engine.createCard({ name: "Typed D", typeName: "Ghost Type" })).rejects.toMatchObject({
      code: "type-unknown",
    });
    // an explicit id that names no live card -> validate_type (type.rb:24-30)
    await expect(engine.createCard({ name: "Typed E", typeId: 4321 })).rejects.toMatchObject({
      code: "type-unknown",
    });
  });

  it("rejects illegal names (validate_legality_of_name, name_events.rb:35-47)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await expect(engine.createCard({ name: "" })).rejects.toMatchObject({ code: "name-illegal" });
    await expect(engine.createCard({ name: "+orphan" })).rejects.toMatchObject({ code: "name-illegal" }); // name_incomplete?
    await expect(engine.createCard({ name: "a".repeat(256) })).rejects.toMatchObject({ code: "name-illegal" });
    expect(await f.storage.count("cards")).toBe(6); // nothing written
  });

  it("rejects duplicate names (validate_uniqueness_of_name, name_events.rb:19-26)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await expect(engine.createCard({ name: "Pudding" })).rejects.toMatchObject({ code: "name-conflict" });
    // case/spacing variants share a key -> same conflict
    await expect(engine.createCard({ name: "pudding" })).rejects.toMatchObject({ code: "name-conflict" });
  });

  it("rejects anonymous actors before any row is written", async () => {
    const f = await fresh();
    const before = await f.storage.count("cards");
    // null actor (Auth.current_id fallback to AnonymousID — auth/current.rb:7-9)
    const anonEngine = actionEngine(f.storage, null);
    await expect(anonEngine.createCard({ name: "Nope" })).rejects.toMatchObject({
      code: "anonymous-actor",
    });
    // an actor NAMED *anonymous (signed_in? false — auth/current.rb:43-47)
    const namedAnon = actionEngine(f.storage, ANON);
    await expect(namedAnon.createCard({ name: "Nope 2" })).rejects.toMatchObject({
      code: "anonymous-actor",
    });
    expect(await f.storage.count("cards")).toBe(before);
    expect(await f.storage.count("card_acts")).toBe(0);
  });

  it("honors the canWrite permission seam", async () => {
    const f = await fresh();
    const denying = actionEngine(f.storage, JOE, { canWrite: () => false });
    await expect(denying.createCard({ name: "Forbidden" })).rejects.toMatchObject({
      code: "permission-denied",
    });
    const allowing = actionEngine(f.storage, JOE, {
      canWrite: (card, actor) => card.isNew === true && actor.id === JOE.id,
    });
    const ok = await allowing.createCard({ name: "Allowed" });
    expect(ok.cardId).toBeGreaterThan(0);
  });
});

describe("createCard — junction create (compound names)", () => {
  it("creates a junction row with NULL name/key; missing sides become subcards", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    // post-2020 junction truth: name/key columns NULL, left_id/right_id set
    // (20200718051236_compound_names_do_not_store_name_and_key.rb).
    const result = await engine.createCard({ name: "Pudding+banana", content: "mix" });
    const card = await cardRow(f, result.cardId);
    expect(card).toMatchObject({
      name: null,
      key: null,
      left_id: f.joeCard.id,
      db_content: "mix",
    });
    // the side "banana" did not exist: it became a subcard create in the
    // SAME act (prepare_new_side, name_events.rb:118-125)
    const right = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE key = ?", ["banana"]);
    expect(right).toMatchObject({ name: "banana", left_id: null });
    expect(card.right_id).toBe((right as { id: number }).id);

    // one act; junction is the act card; TWO actions: side + junction
    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts");
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ card_id: result.cardId }); // junction claims the act
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions ORDER BY id");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ card_id: (right as { id: number }).id, action_type: 0 });
    expect(actions[1]).toMatchObject({ card_id: result.cardId, action_type: 0 });
    // side subcard's super_action_id = the junction's action
    // (super_action = @supercard.current_action — events.rb:85-92)
    expect(actions[0]).toMatchObject({ super_action_id: actions[1].id });
    expect(result.subactions).toHaveLength(1);
    expect(result.subactions[0]).toMatchObject({ cardId: (right as { id: number }).id });

    // the composed name round-trips through fetch
    const fetched = await f.engine.fetchByName("Pudding+banana");
    expect(fetched?.name?.s).toBe("Pudding+banana");
  });

  it("dedupes repeated sides (A+A gets ONE new side card, Director.card staging)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+Pudding" });
    const card = await cardRow(f, result.cardId);
    expect(card.left_id).toBe(f.joeCard.id);
    expect(card.right_id).toBe(f.joeCard.id);
    expect(result.subactions).toHaveLength(0); // both sides already existed
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions");
    expect(actions).toHaveLength(1);
  });

  it("rejects a compound create whose name already exists (live junction)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await engine.createCard({ name: "Pudding+waffle" });
    await expect(engine.createCard({ name: "Pudding+waffle" })).rejects.toMatchObject({
      code: "name-conflict",
    });
  });
});
