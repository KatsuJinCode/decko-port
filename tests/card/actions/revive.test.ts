

import { describe, expect, it } from "vitest";
import { actionEngine, createActionsTestStorage, seedCard, seedStandardDeck } from "./actions-test-storage.js";

async function fresh() {
  const storage = await createActionsTestStorage();
  return seedStandardDeck(storage);
}

type Row = Record<string, unknown>;

describe("createCard — revival from trash", () => {
  it("reuses the trashed row id; the new action is a :create on the old card", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const original = await seedCard(f.storage, { name: "Phoenix", dbContent: "old" });

    await engine.updateCard({ cardId: original.id, content: "mid" });
    await engine.deleteCard({ cardId: original.id });
    const actionsBefore = await f.storage.selectAll<Row>(
      "SELECT id FROM card_actions WHERE card_id = ?",
      [original.id],
    );
    expect(actionsBefore).toHaveLength(2);

    const result = await engine.createCard({ name: "Phoenix", content: "reborn" });
    expect(result.cardId).toBe(original.id);

    const card = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [
      original.id,
    ]);
    expect(card).toMatchObject({ name: "Phoenix", key: "phoenix", trash: 0, db_content: "reborn" });

    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts ORDER BY id");
    expect(acts).toHaveLength(3);
    expect(acts[2]).toMatchObject({ card_id: original.id });
    const actions = await f.storage.selectAll<Row>(
      "SELECT * FROM card_actions WHERE card_id = ? ORDER BY id",
      [original.id],
    );
    expect(actions).toHaveLength(3);
    expect(actions[2]).toMatchObject({
      card_act_id: (acts[2] as { id: number }).id,
      action_type: 0,
      draft: 0,
    });

    const changes = await f.storage.selectAll<{ field: number; value: string | null }>(
      "SELECT field, value FROM card_changes WHERE card_action_id = ? ORDER BY field",
      [(actions[2] as { id: number }).id],
    );
    expect(changes).toEqual([
      { field: 2, value: "reborn" },
      { field: 3, value: "f" },
    ]);

    expect(changes).toHaveLength(2);
    const fetchAgain = await f.engine.fetchByName("Phoenix");
    expect(fetchAgain?.id).toBe(original.id);
  });

  it("revival without explicit content resets content and keeps nothing hidden", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const original = await seedCard(f.storage, { name: "Lantern", dbContent: "glow" });
    await engine.deleteCard({ cardId: original.id });
    await engine.createCard({ name: "Lantern" });

    const card = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [
      original.id,
    ]);
    expect(card).toMatchObject({ db_content: null, trash: 0, type_id: 2 });
  });

  it("revives junction rows when both sides are live again", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const banana = await seedCard(f.storage, { name: "banana" });
    const junction = await seedCard(f.storage, { leftId: f.joeCard.id, rightId: banana.id });
    await engine.deleteCard({ cardId: junction.id });
    const result = await engine.createCard({ name: "Pudding+banana", content: "again" });
    expect(result.cardId).toBe(junction.id);
    const card = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [junction.id]);
    expect(card).toMatchObject({ trash: 0, left_id: f.joeCard.id, right_id: banana.id });

    const pairs = await f.storage.selectAll<Row>(
      "SELECT id FROM cards WHERE left_id = ? AND right_id = ?",
      [f.joeCard.id, banana.id],
    );
    expect(pairs).toHaveLength(1);
  });

  it("a name held by a LIVE card still conflicts after another card's revival", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const doomed = await seedCard(f.storage, { name: "Ghost" });
    await engine.deleteCard({ cardId: doomed.id });

    await engine.createCard({ name: "Ghost", content: "back" });
    await expect(engine.createCard({ name: "GHOST" })).rejects.toMatchObject({
      code: "name-conflict",
    });
  });
});
