// Action-layer tests — DELETE (Card#delete! = trash flip): action typing,
// the protected-card guard, the child cascade, and idempotency. Ruby cites
// inline; trail in docs/actions-port-notes.md. Synthetic fixtures only.

import { describe, expect, it } from "vitest";
import { CardActionError } from "../../../src/card/actions/index.js";
import {
  actionEngine,
  createActionsTestStorage,
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

async function changesFor(f: StandardFixture, actionId: number) {
  return f.storage.selectAll<{ field: number; value: string | null }>(
    "SELECT field, value FROM card_changes WHERE card_action_id = ? ORDER BY id",
    [actionId],
  );
}

describe("deleteCard — trash flip", () => {
  it("is an UPDATE save with trash: true -> a :delete action (trash.rb:11-21, :70-72)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    const result = await engine.deleteCard({ cardId: f.joeCard.id });
    expect(result?.verb).toBe("delete");

    const card = await f.storage.selectOne<Row>("SELECT trash FROM cards WHERE id = ?", [
      f.joeCard.id,
    ]);
    expect(card).toMatchObject({ trash: 1 }); // the row stays, flipped

    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      card_id: f.joeCard.id,
      action_type: 2, // :delete — identify_action's trash branch fires FIRST
      super_action_id: null,
    });
    // one change row: trash, serialized "t" (changeValueForField —
    // change.ts; AR Boolean cast + Type::Text serialize)
    expect(await changesFor(f, (actions[0] as { id: number }).id)).toEqual([
      { field: 3, value: "t" },
    ]);
    const acts = await f.storage.selectAll<Row>("SELECT * FROM card_acts");
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ card_id: f.joeCard.id, actor_id: JOE.id });

    // fetch now misses it; look_in_trash finds it (retrieve adds trash = 0)
    await expect(f.engine.fetchByName("Pudding")).resolves.toBeUndefined();
    await expect(f.engine.fetchByName("Pudding", { lookInTrash: true })).resolves.toMatchObject({
      trash: true,
    });
  });

  it("is idempotent: deleting an already-trashed card persists nothing", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await engine.deleteCard({ cardId: f.joeCard.id });
    const result = await engine.deleteCard({ cardId: f.joeCard.id });
    expect(result).toBeNull();
    expect(await f.storage.count("card_actions")).toBe(1);
  });

  it("refuses codenamed (system) cards (validate_delete, trash.rb:31-34)", async () => {
    const f = await fresh();
    const engine = actionEngine(f.storage);
    await expect(engine.deleteCard({ cardId: 2 })).rejects.toMatchObject({
      code: "protected-card",
    }); // RichText carries codename "basic"
    expect(await f.storage.count("card_actions")).toBe(0);
  });

  it("throws for missing cards and rejects anonymous actors", async () => {
    const f = await fresh();
    await expect(actionEngine(f.storage).deleteCard({ cardId: 31337 })).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(
      actionEngine(f.storage, null).deleteCard({ cardId: f.joeCard.id }),
    ).rejects.toMatchObject({ code: "anonymous-actor" });
  });
});

describe("deleteCard — child cascade (delete_children, trash.rb:52-59)", () => {
  it("deletes junction children recursively; PARTS survive", async () => {
    const f = await fresh();
    const banana = await seedCard(f.storage, { name: "banana" });
    const junction = await seedCard(f.storage, { leftId: f.joeCard.id, rightId: banana.id });
    const nested = await seedCard(f.storage, { leftId: junction.id, rightId: 8 }); // (Pudding+banana)+*default
    const engine = actionEngine(f.storage);
    const result = await engine.deleteCard({ cardId: f.joeCard.id });

    expect(result?.subactions.map((s) => s.cardId).sort()).toEqual([junction.id, nested.id].sort());
    // the part "banana" is NOT a child of Pudding — only junctions are
    // (descendants.rb:26-31: left_id/right_id edges); it survives
    await expect(
      f.storage.selectOne<Row>("SELECT trash FROM cards WHERE id = ?", [banana.id]),
    ).resolves.toMatchObject({ trash: 0 });

    const actions = await f.storage.selectAll<Row>("SELECT * FROM card_actions ORDER BY id");
    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({ card_id: f.joeCard.id, action_type: 2 });
    // every child's super_action_id points at its DIRECT parent's action
    // (super_action = @supercard.current_action — events.rb:85-92)
    expect(actions[1]).toMatchObject({
      card_id: junction.id,
      action_type: 2,
      super_action_id: (actions[0] as { id: number }).id,
    });
    expect(actions[2]).toMatchObject({
      card_id: nested.id,
      action_type: 2,
      super_action_id: (actions[1] as { id: number }).id,
    });
    // one act for the whole cascade
    expect(await f.storage.count("card_acts")).toBe(1);
  });

  it("deletes each diamond child exactly once (visited set)", async () => {
    const f = await fresh();
    const banana = await seedCard(f.storage, { name: "banana" });
    await seedCard(f.storage, { leftId: f.joeCard.id, rightId: banana.id }); // Pudding+banana
    await seedCard(f.storage, { leftId: banana.id, rightId: f.joeCard.id }); // banana+Pudding
    const engine = actionEngine(f.storage);
    const result = await engine.deleteCard({ cardId: f.joeCard.id });
    expect(result?.subactions).toHaveLength(2); // not 3, not duplicated
    expect(await f.storage.count("card_actions")).toBe(3);
  });

  it("subcard deletes skip validate_delete down the tree (validate: false)", async () => {
    const f = await fresh();
    // a codenamed card as the RIGHT side of a junction with Pudding
    await seedCard(f.storage, { leftId: f.joeCard.id, rightId: 2 }); // Pudding+RichText
    const engine = actionEngine(f.storage);
    const result = await engine.deleteCard({ cardId: f.joeCard.id });
    // RichText itself survives (it is a PART), but the junction is deleted
    // without its own codename check — Ruby: director/store.rb:70-73
    // (`@card.save! validate: false, as_subcard: true`)
    expect(result?.subactions).toHaveLength(1);
    const junction = await f.storage.selectOne<Row>(
      "SELECT trash FROM cards WHERE left_id = ? AND right_id = ?",
      [f.joeCard.id, 2],
    );
    expect(junction).toMatchObject({ trash: 1 });
    await expect(
      f.storage.selectOne<Row>("SELECT trash FROM cards WHERE id = ?", [2]),
    ).resolves.toMatchObject({ trash: 0 });
  });
});
