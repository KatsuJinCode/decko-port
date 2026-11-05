

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

    const card = await cardRow(f, result.cardId);
    expect(card).toMatchObject({
      name: "Hello Page",
      key: "hello_page",
      codename: null,
      left_id: null,
      right_id: null,
      current_revision_id: null,
      trash: 0,
      type_id: RICH_TEXT_ID,
      db_content: "body text",
      creator_id: JOE.id,
      updater_id: JOE.id,
    });
    expect(card.created_at).toBe(card.updated_at);

    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts ORDER BY id");
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ card_id: result.cardId, actor_id: JOE.id, ip_address: "192.0.2.7" });

    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      card_id: result.cardId,
      card_act_id: acts[0].id,
      super_action_id: null,
      action_type: 0,
      draft: 0,
      comment: null,
    });

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

    await expect(engine.createCard({ name: "Typed C", typeCode: "nosuch" })).rejects.toMatchObject({
      code: "type-unknown",
    });

    await expect(engine.createCard({ name: "Typed D", typeName: "Ghost Type" })).rejects.toMatchObject({
      code: "type-unknown",
    });

    await expect(engine.createCard({ name: "Typed E", typeId: 4321 })).rejects.toMatchObject({
      code: "type-unknown",
    });
  });

  it("rejects illegal names (validate_legality_of_name, name_events.rb:35-47)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await expect(engine.createCard({ name: "" })).rejects.toMatchObject({ code: "name-illegal" });
    await expect(engine.createCard({ name: "+orphan" })).rejects.toMatchObject({ code: "name-illegal" });
    await expect(engine.createCard({ name: "a".repeat(256) })).rejects.toMatchObject({ code: "name-illegal" });
    expect(await f.storage.count("cards")).toBe(6);
  });

  it("rejects duplicate names (validate_uniqueness_of_name, name_events.rb:19-26)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await expect(engine.createCard({ name: "Pudding" })).rejects.toMatchObject({ code: "name-conflict" });

    await expect(engine.createCard({ name: "pudding" })).rejects.toMatchObject({ code: "name-conflict" });
  });

  it("rejects anonymous actors before any row is written", async () => {
    const f = await fresh();
    const before = await f.storage.count("cards");

    const anonEngine = actionEngine(f.storage, null);
    await expect(anonEngine.createCard({ name: "Nope" })).rejects.toMatchObject({
      code: "anonymous-actor",
    });

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

    const result = await engine.createCard({ name: "Pudding+banana", content: "mix" });
    const card = await cardRow(f, result.cardId);
    expect(card).toMatchObject({
      name: null,
      key: null,
      left_id: f.joeCard.id,
      db_content: "mix",
    });

    const right = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE key = ?", ["banana"]);
    expect(right).toMatchObject({ name: "banana", left_id: null });
    expect(card.right_id).toBe((right as { id: number }).id);

    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts");
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ card_id: result.cardId });
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions ORDER BY id");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ card_id: (right as { id: number }).id, action_type: 0 });
    expect(actions[1]).toMatchObject({ card_id: result.cardId, action_type: 0 });

    expect(actions[0]).toMatchObject({ super_action_id: actions[1].id });
    expect(result.subactions).toHaveLength(1);
    expect(result.subactions[0]).toMatchObject({ cardId: (right as { id: number }).id });

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
    expect(result.subactions).toHaveLength(0);
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
