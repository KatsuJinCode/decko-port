

import { describe, expect, it } from "vitest";
import {
  ActWriter,
  cardFieldStateFromRow,
  type CardFieldState,
} from "../../../src/card/history/write-path.js";
import { createHistoryTestStorage, type HistoryTestStorage } from "./history-test-storage.js";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

function fakeClock() {
  let ticks = 0;
  return () => new Date(T0 + ticks++ * 1000);
}

const ACTOR_A = 7;
const ACTOR_B = 9;
const IP = "203.0.113.9";

interface Fixture {
  storage: HistoryTestStorage;
  clock: () => Date;
  writer: ActWriter;

  request(actorId?: number, ip?: string): ActWriter;
}

function freshFixture(): Fixture {
  const storage = createHistoryTestStorage();
  const clock = fakeClock();
  return {
    storage,
    clock,
    writer: new ActWriter({ driver: storage.driver, actorId: ACTOR_A, ipAddress: IP, now: clock }),
    request(actorId = ACTOR_A, ip = IP) {
      return new ActWriter({ driver: storage.driver, actorId, ipAddress: ip, now: clock });
    },
  };
}

function cardRow(s: HistoryTestStorage, id: number) {
  return s.selectOne<Record<string, unknown>>("SELECT * FROM cards WHERE id = ?", [id]);
}

function acts(s: HistoryTestStorage) {
  return s.selectAll<Record<string, unknown>>("SELECT * FROM card_acts ORDER BY id");
}

function actions(s: HistoryTestStorage, cardId?: number) {
  const where = cardId === undefined ? "" : "WHERE card_id = ?";
  const params = cardId === undefined ? [] : [cardId];
  return s.selectAll<Record<string, unknown>>(
    `SELECT * FROM card_actions ${where} ORDER BY id`,
    params,
  );
}

function changes(s: HistoryTestStorage, actionId: number) {
  return s.selectAll<{ card_action_id: number; field: number; value: string | null }>(
    "SELECT card_action_id, field, value FROM card_changes WHERE card_action_id = ? ORDER BY id",
    [actionId],
  );
}

function stateOf(s: HistoryTestStorage, id: number): CardFieldState {
  return cardFieldStateFromRow(cardRow(s, id) as never);
}

async function createSimple(
  s: HistoryTestStorage,
  w: ActWriter,
  name = "Hello World",
  content = "v1",
): Promise<number> {
  const { cardId } = await w.createCard({
    name,
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    type_id: 1,
    db_content: content,
  });
  return cardId;
}

describe("createCard", () => {
  it("records act + create action and NO change rows (first_create?)", async () => {
    const f = freshFixture();
    const { cardId, actId, actionId } = await f.writer.createCard({
      name: "Hello World",
      key: "hello_world",
      type_id: 1,
      db_content: "v1",
    });

    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card).toMatchObject({
      name: "Hello World",
      key: "hello_world",
      type_id: 1,
      db_content: "v1",
      trash: 0,
      creator_id: ACTOR_A,
      updater_id: ACTOR_A,
      codename: null,
      current_revision_id: null,
      left_id: null,
      right_id: null,
    });
    expect(card.created_at).toBe(card.updated_at);
    expect(card.created_at).toBe("2026-09-19 12:00:00.000");

    const allActs = acts(f.storage);
    expect(allActs).toHaveLength(1);
    expect(allActs[0]).toMatchObject({
      id: actId,
      card_id: cardId,
      actor_id: ACTOR_A,
      acted_at: "2026-09-19 12:00:00.000",
      ip_address: IP,
    });

    const rows = actions(f.storage, cardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: actionId,
      card_act_id: actId,
      super_action_id: null,
      action_type: 0,
      draft: 0,
      comment: null,
    });

    expect(changes(f.storage, actionId)).toEqual([]);
  });

  it("stores NULL name/key for compound cards (lib/card/name/all.rb:20-21, :64-66)", async () => {
    const f = freshFixture();
    const leftId = await createSimple(f.storage, f.writer, "Left Part");
    const rightId = await createSimple(f.storage, f.writer, "Right Part");

    const { cardId } = await f.writer.createCard({
      name: null,
      key: null,
      type_id: 1,
      left_id: leftId,
      right_id: rightId,
      db_content: "",
    });
    expect(cardRow(f.storage, cardId)).toMatchObject({
      name: null,
      key: null,
      left_id: leftId,
      right_id: rightId,
    });

    await expect(
      f.writer.createCard({ name: "X", key: "x", type_id: 1, left_id: leftId }),
    ).rejects.toThrow(/compound cards/i);
  });

  it("reuses one act for several cards (act.rb:8-11 docstring example)", async () => {
    const f = freshFixture();
    await f.writer.createCard({ name: "One", key: "one", type_id: 1 });
    await f.writer.createCard({ name: "Two", key: "two", type_id: 1 });
    await f.writer.createCard({ name: "Three", key: "three", type_id: 1 });

    expect(acts(f.storage)).toHaveLength(1);
    const actionRows = actions(f.storage);
    expect(actionRows).toHaveLength(3);
    const actId = acts(f.storage)[0]!.id;
    for (const row of actionRows) {
      expect(row.card_act_id).toBe(actId);
      expect(row.action_type).toBe(0);
    }
    expect(acts(f.storage)[0]!.card_id).toBe(actionRows[0]!.card_id);
  });
});

describe("updateCard (db_content only)", () => {
  it("backfills the create action's changes from the pre-act state, then stores its own", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Hello World", "v1");
    const createRow = actions(f.storage, cardId)[0]!;

    const before = stateOf(f.storage, cardId);
    const result = (await f.request().updateCard({
      cardId,
      before,
      after: { ...before, db_content: "v2" },
    }))!;
    const { actId, actionId } = result;

    expect(acts(f.storage)).toHaveLength(2);
    expect(acts(f.storage)[1]!.id).toBe(actId);
    expect(acts(f.storage)[1]!.card_id).toBe(cardId);
    expect(acts(f.storage)[1]!.acted_at).toBe("2026-09-19 12:00:01.000");

    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card.db_content).toBe("v2");
    expect(card.updated_at).toBe("2026-09-19 12:00:01.000");
    expect(card.created_at).toBe("2026-09-19 12:00:00.000");
    expect(card.updater_id).toBe(ACTOR_A);

    const rows = actions(f.storage, cardId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: actionId, action_type: 1, draft: 0 });

    const createChanges = changes(f.storage, createRow.id as number);
    expect(createChanges).toEqual([
      { card_action_id: createRow.id, field: 0, value: "Hello World" },
      { card_action_id: createRow.id, field: 1, value: "1" },
      { card_action_id: createRow.id, field: 2, value: "v1" },
      { card_action_id: createRow.id, field: 3, value: "f" },
      { card_action_id: createRow.id, field: 4, value: null },
      { card_action_id: createRow.id, field: 5, value: null },
    ]);

    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 2, value: "v2" },
    ]);

    const maxCreateChangeId = f.storage.selectOne<{ m: number }>(
      "SELECT MAX(id) AS m FROM card_changes WHERE card_action_id = ?",
      [createRow.id as number],
    )!.m;
    const minUpdateChangeId = f.storage.selectOne<{ m: number }>(
      "SELECT MIN(id) AS m FROM card_changes WHERE card_action_id = ?",
      [actionId],
    )!.m;
    expect(maxCreateChangeId).toBeLessThan(minUpdateChangeId);
  });

  it("does not backfill again on later updates", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Hello World", "v1");
    let before = stateOf(f.storage, cardId);
    await f.request().updateCard({ cardId, before, after: { ...before, db_content: "v2" } });
    before = stateOf(f.storage, cardId);
    await f.request().updateCard({ cardId, before, after: { ...before, db_content: "v3" } });

    const rows = actions(f.storage, cardId);
    expect(rows).toHaveLength(3);
    expect(changes(f.storage, rows[0]!.id as number)).toHaveLength(6);
    expect(changes(f.storage, rows[1]!.id as number)).toEqual([
      { card_action_id: rows[1]!.id, field: 2, value: "v2" },
    ]);
    expect(changes(f.storage, rows[2]!.id as number)).toEqual([
      { card_action_id: rows[2]!.id, field: 2, value: "v3" },
    ]);
  });

  it("returns null and writes nothing for a no-op save (events.rb:34-37)", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Hello World", "v1");
    const before = stateOf(f.storage, cardId);

    const result = await f.request().updateCard({ cardId, before, after: { ...before } });
    expect(result).toBeNull();
    expect(actions(f.storage, cardId)).toHaveLength(1);
    expect(acts(f.storage)).toHaveLength(1);
    expect((cardRow(f.storage, cardId) as Record<string, unknown>).updated_at).toBe(
      "2026-09-19 12:00:00.000",
    );
  });
});

describe("updateCard (name change)", () => {
  it("records the name change and updates name + key on the cards row", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Old Name", "v1");
    const before = stateOf(f.storage, cardId);

    const { actionId } = (await f.request().updateCard({
      cardId,
      before,
      after: { ...before, name: "New Name" },
      key: "new_name",
    }))!;

    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card.name).toBe("New Name");
    expect(card.key).toBe("new_name");

    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 0, value: "New Name" },
    ]);

    await expect(
      f.request().updateCard({
        cardId,
        before: stateOf(f.storage, cardId),
        after: { ...stateOf(f.storage, cardId), name: "Other" },
      }),
    ).rejects.toThrow(/requires `key`/i);
  });
});

describe("compound cards", () => {
  it("records left_id/right_id changes; the raw name attribute stays NULL", async () => {
    const f = freshFixture();
    const leftId = await createSimple(f.storage, f.writer, "Left Part");
    const rightId = await createSimple(f.storage, f.writer, "Right Part");
    const newRightId = await createSimple(f.storage, f.writer, "New Right");

    const { cardId } = await f.writer.createCard({
      name: null,
      key: null,
      type_id: 1,
      left_id: leftId,
      right_id: rightId,
    });

    const before = stateOf(f.storage, cardId);
    const { actionId } = (await f.request().updateCard({
      cardId,
      before,
      after: { ...before, right_id: newRightId },
    }))!;

    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 5, value: String(newRightId) },
    ]);

    const createRow = actions(f.storage, cardId)[0]!;
    expect(changes(f.storage, createRow.id as number)).toEqual([
      { card_action_id: createRow.id, field: 0, value: null },
      { card_action_id: createRow.id, field: 1, value: "1" },
      { card_action_id: createRow.id, field: 2, value: null },
      { card_action_id: createRow.id, field: 3, value: "f" },
      { card_action_id: createRow.id, field: 4, value: String(leftId) },
      { card_action_id: createRow.id, field: 5, value: String(rightId) },
    ]);
  });
});

describe("trashCard (delete)", () => {
  it("records a :delete action with a single trash change", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Doomed", "v1");
    const before = stateOf(f.storage, cardId);

    const { actionId } = (await f.request().trashCard({ cardId, before }))!;

    expect(actions(f.storage, cardId)).toHaveLength(2);
    expect(actions(f.storage, cardId)[1]!.action_type).toBe(2);

    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card.trash).toBe(1);
    expect(card.updated_at).toBe("2026-09-19 12:00:01.000");

    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 3, value: "t" },
    ]);

    const createRow = actions(f.storage, cardId)[0]!;
    const createChanges = changes(f.storage, createRow.id as number);
    expect(createChanges.find((c) => c.field === 3)?.value).toBe("f");
    expect(createChanges).toHaveLength(6);
  });

  it("is a no-op for an already-trashed card (trash_changed? false)", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Doomed", "v1");
    await f.request().trashCard({ cardId, before: stateOf(f.storage, cardId) });
    const rowsBefore = actions(f.storage, cardId).length;

    const result = await f.request().trashCard({ cardId, before: stateOf(f.storage, cardId) });
    expect(result).toBeNull();
    expect(actions(f.storage, cardId)).toHaveLength(rowsBefore);
  });
});

describe("actor passthrough", () => {
  it("keeps creator_id, moves updater_id, and gives each save its own act", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Shared", "v1");

    const { actId } = (await f.request(ACTOR_B, "198.51.100.7").updateCard({
      cardId,
      before: stateOf(f.storage, cardId),
      after: { ...stateOf(f.storage, cardId), db_content: "v2" },
    }))!;

    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card.creator_id).toBe(ACTOR_A);
    expect(card.updater_id).toBe(ACTOR_B);

    const allActs = acts(f.storage);
    expect(allActs).toHaveLength(2);
    expect(allActs[1]).toMatchObject({ id: actId, actor_id: ACTOR_B, ip_address: "198.51.100.7" });
  });
});

describe("act sharing and the act's primary card", () => {
  it("records several cards' actions under one act with card_id = act card", async () => {
    const f = freshFixture();
    const mainId = await createSimple(f.storage, f.writer, "Main");
    const subId = await createSimple(f.storage, f.writer, "Sub");

    const request = f.request();
    const mainResult = (await request.updateCard({
      cardId: mainId,
      before: stateOf(f.storage, mainId),
      after: { ...stateOf(f.storage, mainId), db_content: "main v2" },
    }))!;
    const subResult = (await request.updateCard({
      cardId: subId,
      before: stateOf(f.storage, subId),
      after: { ...stateOf(f.storage, subId), db_content: "sub v2" },
      superActionId: mainResult.actionId,
      isActCard: false,
    }))!;

    expect(acts(f.storage)).toHaveLength(2);
    const updateAct = acts(f.storage)[1]!;
    expect(updateAct.card_id).toBe(mainId);
    expect(subResult.actId).toBe(updateAct.id);
    expect(subResult.actionId).not.toBe(mainResult.actionId);
    expect(
      (
        f.storage.selectOne<{ super_action_id: number }>(
          "SELECT super_action_id FROM card_actions WHERE id = ?",
          [subResult.actionId],
        )!
      ).super_action_id,
    ).toBe(mainResult.actionId);
  });

  it("creates one act for a subcard-first submission and points it at the act card", async () => {

    const f = freshFixture();
    await f.writer.createCard({
      name: "Sub First",
      key: "sub_first",
      type_id: 1,
      isActCard: false,
    });
    expect(acts(f.storage)[0]!.card_id).toBeNull();
    const main = await f.writer.createCard({ name: "Main", key: "main", type_id: 1, isActCard: true });

    expect(acts(f.storage)).toHaveLength(1);
    expect(acts(f.storage)[0]!.card_id).toBe(main.cardId);
  });
});

describe("drafts", () => {
  it("records act + draft action + one change without touching the cards row", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Drafty", "published");
    const contentBefore = (cardRow(f.storage, cardId) as Record<string, unknown>).db_content;
    const actsBefore = acts(f.storage).length;
    const actionsBefore = actions(f.storage, cardId).length;

    const { actId, actionId } = await f.request().saveDraft({ cardId, content: "draft text" });

    const act = acts(f.storage).find((a) => a.id === actId)!;
    expect(act).toMatchObject({ card_id: cardId, actor_id: ACTOR_A });
    const draftRow = actions(f.storage, cardId).find((a) => a.id === actionId)!;
    expect(draftRow).toMatchObject({ draft: 1, action_type: 1, super_action_id: null });
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 2, value: "draft text" },
    ]);

    expect((cardRow(f.storage, cardId) as Record<string, unknown>).db_content).toBe(contentBefore);
    expect(acts(f.storage).length).toBe(actsBefore + 1);
    expect(actions(f.storage, cardId).length).toBe(actionsBefore + 1);
  });

  it("clears the same actor's earlier drafts when saving a new draft (clear_drafts)", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Drafty", "v1");
    await f.request().saveDraft({ cardId, content: "draft 1" });
    await f.request().saveDraft({ cardId, content: "draft 2" });

    const drafts = actions(f.storage, cardId).filter((a) => a.draft === 1);
    expect(drafts).toHaveLength(1);

    expect(changes(f.storage, drafts[0]!.id as number)).toEqual([
      { card_action_id: drafts[0]!.id, field: 2, value: "draft 2" },
    ]);
  });

  it("a real save clears the actor's drafts but keeps other actors' drafts", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Drafty", "v1");
    await f.request().saveDraft({ cardId, content: "a's draft" });

    await f.request(ACTOR_B).saveDraft({ cardId, content: "b's draft" });

    const before = stateOf(f.storage, cardId);
    await f.request().updateCard({ cardId, before, after: { ...before, db_content: "v2" } });

    const drafts = actions(f.storage, cardId).filter((a) => a.draft === 1);
    expect(drafts).toHaveLength(1);
    expect(changes(f.storage, drafts[0]!.id as number)[0]!.value).toBe("b's draft");
  });

  it("counts drafts in action_count, so another actor's draft suppresses the create backfill", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Drafty", "v1");
    await f.request(ACTOR_B).saveDraft({ cardId, content: "b's draft" });

    const before = stateOf(f.storage, cardId);
    const { actionId } = (await f.request().updateCard({
      cardId,
      before,
      after: { ...before, db_content: "v2" },
    }))!;
    const createRow = actions(f.storage, cardId)[0]!;
    expect(changes(f.storage, createRow.id as number)).toEqual([]);
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 2, value: "v2" },
    ]);
  });

  it("same-actor drafts are cleared BEFORE the count, so the backfill still fires", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Drafty", "v1");
    await f.request().saveDraft({ cardId, content: "own draft" });

    const before = stateOf(f.storage, cardId);
    const { actionId } = (await f.request().updateCard({
      cardId,
      before,
      after: { ...before, db_content: "v2" },
    }))!;
    const createRow = actions(f.storage, cardId)[0]!;
    expect(changes(f.storage, createRow.id as number)).toHaveLength(6);
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 2, value: "v2" },
    ]);
    expect(actions(f.storage, cardId).filter((a) => a.draft === 1)).toHaveLength(0);
  });
});

describe("update_ancestor_timestamps", () => {
  it("bumps ancestor updated_at/updater_id (events.rb:1-7)", async () => {
    const f = freshFixture();
    const parentId = await createSimple(f.storage, f.writer, "Parent");
    const childId = await createSimple(f.storage, f.writer, "Child");

    await f.request().updateCard({
      cardId: childId,
      before: stateOf(f.storage, childId),
      after: { ...stateOf(f.storage, childId), db_content: "child v2" },
    });
    expect((cardRow(f.storage, parentId) as Record<string, unknown>).updated_at).toBe(
      "2026-09-19 12:00:00.000",
    );

    const grandparentId = await createSimple(f.storage, f.writer, "Grandparent");
    const parentState = stateOf(f.storage, parentId);
    await f.request().updateCard({
      cardId: parentId,
      before: parentState,
      after: { ...parentState, db_content: "parent v2" },
      ancestorCardIds: [grandparentId],
    });

    const grandparent = cardRow(f.storage, grandparentId) as Record<string, unknown>;
    expect(grandparent.updater_id).toBe(ACTOR_A);
    expect(grandparent.updated_at).toBe("2026-09-19 12:00:04.000");
  });
});

describe("legacy revision tables", () => {

  it("leaves card_revisions empty and current_revision_id NULL", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Rev", "v1");
    let before = stateOf(f.storage, cardId);
    await f.request().updateCard({ cardId, before, after: { ...before, db_content: "v2" } });
    await f.request().trashCard({ cardId, before: stateOf(f.storage, cardId) });

    expect(f.storage.selectAll("SELECT * FROM card_revisions")).toEqual([]);
    expect((cardRow(f.storage, cardId) as Record<string, unknown>).current_revision_id).toBeNull();
  });
});

describe("storage contract", () => {
  it("refuses to update a missing cards row", async () => {
    const f = freshFixture();
    const ghost: CardFieldState = {
      name: "Ghost",
      type_id: 1,
      db_content: null,
      trash: 0,
      left_id: null,
      right_id: null,
    };
    await expect(
      f.request().updateCard({ cardId: 999999, before: ghost, after: { ...ghost, db_content: "x" } }),
    ).rejects.toThrow(/not updated/);
  });
});
