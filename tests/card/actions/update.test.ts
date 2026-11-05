

import { describe, expect, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import { CardActionError, type CardActionEngine } from "../../../src/card/actions/index.js";
import {
  actionEngine,
  createActionsTestStorage,
  FIXED_TS,
  JOE,
  seedCard,
  seedStandardDeck,
  type StandardFixture,
} from "./actions-test-storage.js";

async function fresh(): Promise<StandardFixture> {
  const storage = await createActionsTestStorage();
  return seedStandardDeck(storage);
}

type Row = Record<string, unknown>;

async function cardRow(f: StandardFixture, id: number): Promise<Row> {
  const row = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [id]);
  if (row === undefined) throw new Error(`card ${id} missing`);
  return row;
}

async function changesFor(f: StandardFixture, actionId: number) {
  return f.storage.selectAll<{ field: number; value: string | null }>(
    "SELECT field, value FROM card_changes WHERE card_action_id = ? ORDER BY id",
    [actionId],
  );
}

describe("updateCard — content saves", () => {
  it("records one update action with a db_content change row; stamps the row", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const result = await engine.updateCard({ cardId: f.joeCard.id, content: "v2" });
    expect(result).not.toBeNull();

    const card = await cardRow(f, f.joeCard.id);
    expect(card).toMatchObject({ db_content: "v2", updater_id: JOE.id, name: "Pudding" });
    expect(card.updated_at).not.toBe(FIXED_TS);

    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions ORDER BY id");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      card_id: f.joeCard.id,
      action_type: 1,
      draft: 0,
      super_action_id: null,
    });
    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts");
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ card_id: f.joeCard.id, actor_id: JOE.id });

    expect(await changesFor(f, (actions[0] as { id: number }).id)).toEqual([
      { field: 2, value: "v2" },
    ]);
  });

  it("no-op saves persist nothing (idempotency — events.rb:34-37)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const result = await engine.updateCard({ cardId: f.joeCard.id, content: "v1" });
    expect(result).toBeNull();
    expect(await f.storage.count("card_actions")).toBe(0);
    expect(await f.storage.count("card_acts")).toBe(0);
    const card = await cardRow(f, f.joeCard.id);
    expect(card.updated_at).toBe(FIXED_TS);
  });

  it("throws for missing and trashed cards (fetch adds trash = 0)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await expect(engine.updateCard({ cardId: 99999, content: "x" })).rejects.toMatchObject({
      code: "not-found",
    });
    const trashed = await seedCard(f.storage, { name: "Dust", trash: true });
    await expect(engine.updateCard({ cardId: trashed.id, content: "x" })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("updateCard — simple rename", () => {
  async function renameFixture(): Promise<{ f: StandardFixture; engine: CardActionEngine }> {
    const f = await fresh();
    return { f, engine: actionEngine(f.storage) };
  }

  it("rewrites name+key columns, records a name change row (key is NOT tracked)", async () => {
    const { f, engine } = await renameFixture();
    const result = await engine.updateCard({ cardId: f.joeCard.id, name: "Souffle" });
    expect(result?.name?.equals(DeckoName.parse("Souffle"))).toBe(true);
    const card = await cardRow(f, f.joeCard.id);
    expect(card).toMatchObject({ name: "Souffle", key: "souffle" });
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions");
    expect(actions).toHaveLength(1);
    expect(await changesFor(f, (actions[0] as { id: number }).id)).toEqual([
      { field: 0, value: "Souffle" },
    ]);

    await expect(f.engine.fetchByName("Pudding")).resolves.toBeUndefined();
    await expect(f.engine.fetchByName("Souffle")).resolves.toMatchObject({ id: f.joeCard.id });
  });

  it("rejects rename + content change in one save (validate_renaming)", async () => {
    const { f, engine } = await renameFixture();
    await expect(
      engine.updateCard({ cardId: f.joeCard.id, name: "Souffle", content: "v9" }),
    ).rejects.toMatchObject({ code: "rename-conflict" });

    expect(await f.storage.count("card_actions")).toBe(0);
  });

  it("rejects renaming onto a live name; allows same-key variants", async () => {
    const { f, engine } = await renameFixture();
    await seedCard(f.storage, { name: "Souffle" });
    await expect(
      engine.updateCard({ cardId: f.joeCard.id, name: "Souffle" }),
    ).rejects.toMatchObject({ code: "name-conflict" });

    const result = await engine.updateCard({ cardId: f.joeCard.id, name: "PUDDING" });
    expect(result).not.toBeNull();
    await expect(cardRow(f, f.joeCard.id)).resolves.toMatchObject({ name: "PUDDING", key: "pudding" });
  });

  it("rejects simple->compound when the card is in use as a tag (name_events.rb:90-101)", async () => {
    const { f, engine } = await renameFixture();
    const waffle = await seedCard(f.storage, { name: "waffle" });

    await seedCard(f.storage, { leftId: waffle.id, rightId: f.joeCard.id });
    await expect(
      engine.updateCard({ cardId: f.joeCard.id, name: "Pudding+cake" }),
    ).rejects.toMatchObject({ code: "rename-conflict" });
    expect(await f.storage.count("card_actions")).toBe(0);
  });

  it("renames a trashed obstacle out of the way in the same act (rename_in_trash)", async () => {
    const { f, engine } = await renameFixture();
    const obstacle = await seedCard(f.storage, { name: "Souffle", trash: true });
    await engine.updateCard({ cardId: f.joeCard.id, name: "Souffle" });

    await expect(cardRow(f, obstacle.id)).resolves.toMatchObject({
      name: "Souffle*trash",
      trash: 1,
    });
    await expect(cardRow(f, f.joeCard.id)).resolves.toMatchObject({ name: "Souffle" });
    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts");
    expect(acts).toHaveLength(1);
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions ORDER BY id");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ card_id: obstacle.id, super_action_id: null });
    expect(actions[1]).toMatchObject({ card_id: f.joeCard.id });
  });

  it("renaming a part cascades VIRTUALLY: zero row writes for junction descendants", async () => {
    const { f, engine } = await renameFixture();
    const junction = await seedCard(f.storage, { leftId: f.joeCard.id, rightId: 8 });
    const junctionRowBefore = await cardRow(f, junction.id);

    await expect(f.engine.fetchByName("Pudding+*default")).resolves.toMatchObject({
      id: junction.id,
    });

    await engine.updateCard({ cardId: f.joeCard.id, name: "Cake" });

    const junctionRowAfter = await cardRow(f, junction.id);
    expect(junctionRowAfter).toEqual(junctionRowBefore);
    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions");
    expect(actions).toHaveLength(1);

    const fresh = await f.engine.fetchByName("Cake+*default");
    expect(fresh?.name?.s).toBe("Cake+*default");
  });
});

describe("updateCard — junction rewire", () => {
  it("rewires right_id and keeps name/key NULL; change row is right_id only", async () => {
    const f = await fresh();
    const waffle = await seedCard(f.storage, { name: "waffle" });
    const junction = await seedCard(f.storage, {
      leftId: f.joeCard.id,
      rightId: waffle.id,
      dbContent: "mix",
    });
    const engine = actionEngine(f.storage);
    const result = await engine.updateCard({ cardId: junction.id, name: "Pudding+cake" });
    expect(result?.name?.s).toBe("Pudding+cake");

    const card = await cardRow(f, junction.id);
    expect(card).toMatchObject({ name: null, key: null, left_id: f.joeCard.id });
    const cake = await f.storage.selectOne<Row>("SELECT id FROM cards WHERE key = ?", ["cake"]);
    expect(card.right_id).toBe((cake as { id: number }).id);

    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions ORDER BY id");

    expect(actions).toHaveLength(2);
    const rename = actions.find((a) => a.card_id === junction.id) as Row;
    expect(await changesFor(f, rename.id as number)).toEqual([
      { field: 5, value: String((cake as { id: number }).id) },
    ]);

    const sideAction = actions.find((a) => a.card_id !== junction.id) as Row;
    expect(sideAction).toMatchObject({ super_action_id: rename.id, action_type: 0 });
  });

  it("rejects renames that would make the card its own DIRECT ancestor", async () => {
    const f = await fresh();
    const banana = await seedCard(f.storage, { name: "banana" });
    await seedCard(f.storage, { leftId: f.joeCard.id, rightId: banana.id });
    const engine = actionEngine(f.storage);

    await expect(
      engine.updateCard({ cardId: f.joeCard.id, name: "Pudding+x" }),
    ).rejects.toMatchObject({ code: "cycle" });
    await engine.createCard({ name: "Pudding+x" });
  });

  it("rejects INDIRECT cycles through the junction graph", async () => {
    const f = await fresh();

    const waffle = await seedCard(f.storage, { name: "waffle" });
    const junction = await seedCard(f.storage, { leftId: f.joeCard.id, rightId: waffle.id });
    const engine = actionEngine(f.storage);
    await expect(
      engine.updateCard({ cardId: f.joeCard.id, name: "Pudding+waffle+cake" }),
    ).rejects.toThrowError(CardActionError);
    try {
      await engine.updateCard({ cardId: f.joeCard.id, name: "Pudding+waffle+cake" });
    } catch (e) {
      expect((e as CardActionError).code).toBe("cycle");
    }
    expect(junction.id).toBeGreaterThan(0);
    expect(await f.storage.count("card_actions")).toBe(0);
  });

  it("renames a junction to a simple name: sides clear, columns fill", async () => {
    const f = await fresh();
    const waffle = await seedCard(f.storage, { name: "waffle" });
    const junction = await seedCard(f.storage, { leftId: f.joeCard.id, rightId: waffle.id });
    const engine = actionEngine(f.storage);
    await engine.updateCard({ cardId: junction.id, name: "Batter" });
    const card = await cardRow(f, junction.id);
    expect(card).toMatchObject({ name: "Batter", key: "batter", left_id: null, right_id: null });
  });
});
