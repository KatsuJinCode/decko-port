// History WRITE PATH tests: prove src/card/history/write-path.ts against
// REAL storage — in-memory better-sqlite3 loaded with db/schema.sqlite.sql,
// rows SELECTed back and compared against expectations derived from the
// Ruby truth. Each expectation cites the Ruby file:method it derives from;
// the full trail lives in docs/history-port-notes.md.
//
// Request model: one ActWriter = one save request = one act (Ruby:
// Director.run_act binds the act for the request, director/all.rb:114-119;
// every card saved inside the request shares it). Tests therefore build a
// NEW writer per save request, sharing one fake clock per fixture.

import { describe, expect, it } from "vitest";
import {
  ActWriter,
  cardFieldStateFromRow,
  type CardFieldState,
} from "../../../src/card/history/write-path.js";
import { createHistoryTestStorage, type HistoryTestStorage } from "./history-test-storage.js";

// Deterministic clock: one writer operation = one second on the fake clock.
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
  writer: ActWriter; // the first request's writer
  /** A new save request: fresh act, same DB, shared clock. */
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

// ---------------------------------------------------------------------------

describe("createCard", () => {
  it("records act + create action and NO change rows (first_create?)", async () => {
    const f = freshFixture();
    const { cardId, actId, actionId } = await f.writer.createCard({
      name: "Hello World",
      key: "hello_world",
      type_id: 1,
      db_content: "v1",
    });

    // cards row: stamps + stamper (card-mod-account set/all/account.rb:20-23
    // event :set_stamper — updater_id = Auth.current_id; creator_id on
    // create); trash forced false (trash.rb:23-27 event :manage_trash);
    // never-written columns stay NULL (no writer exists for
    // current_revision_id in card-1.110.0 — lib/cardio/seed.rb:86 is the
    // only reference; read_rule_* / references_expired are other streams).
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

    // act row: actor passthrough (act.rb:131-134 assign_actor), acted_at =
    // create-timestamp (act.rb:64-68), ip from Env at Act.new
    // (director/class_methods.rb:27-29).
    const allActs = acts(f.storage);
    expect(allActs).toHaveLength(1);
    expect(allActs[0]).toMatchObject({
      id: actId,
      card_id: cardId, // finalize_act, events.rb:48-50
      actor_id: ACTOR_A,
      acted_at: "2026-09-19 12:00:00.000",
      ip_address: IP,
    });

    // action row: action_type 0 = :create (action.rb:42 TYPE_OPTIONS.index),
    // draft false, comment NULL (core never writes it — the only core-suite
    // writer is card-mod-carrierwave attachment.rb:23), super_action NULL.
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

    // first_create? (set/all/history.rb:38-40) skips change storage
    // (events.rb:31-32): a plain create leaves card_changes EMPTY. Seed
    // truth: mod/core/data/fixtures/real/card_changes.yml is `{}` while
    // card_actions.yml carries rows 1..N of action_type 0.
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

    // and refuses the contradictory shape
    await expect(
      f.writer.createCard({ name: "X", key: "x", type_id: 1, left_id: leftId }),
    ).rejects.toThrow(/compound cards/i);
  });

  it("reuses one act for several cards (act.rb:8-11 docstring example)", async () => {
    const f = freshFixture();
    await f.writer.createCard({ name: "One", key: "one", type_id: 1 });
    await f.writer.createCard({ name: "Two", key: "two", type_id: 1 });
    await f.writer.createCard({ name: "Three", key: "three", type_id: 1 });

    // one act (one request), three create actions, act's primary card =
    // the request's act card (the first card here)
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

    // new act row for the second save (one act per save request)
    expect(acts(f.storage)).toHaveLength(2);
    expect(acts(f.storage)[1]!.id).toBe(actId);
    expect(acts(f.storage)[1]!.card_id).toBe(cardId);
    expect(acts(f.storage)[1]!.acted_at).toBe("2026-09-19 12:00:01.000"); // clock ticked

    // cards row: content updated, updated_at bumped, updater_id set,
    // created_at untouched (Rails timestamps: created only on create)
    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card.db_content).toBe("v2");
    expect(card.updated_at).toBe("2026-09-19 12:00:01.000");
    expect(card.created_at).toBe("2026-09-19 12:00:00.000");
    expect(card.updater_id).toBe(ACTOR_A);

    // two actions now: create + update (action_type 1)
    const rows = actions(f.storage, cardId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: actionId, action_type: 1, draft: 0 });

    // first_change? (history.rb:32-36) fired: the create action now carries
    // one change per TRACKED_FIELDS entry, valued with the pre-act state
    // (store_card_changes_for_create_action, events.rb:95-100; values come
    // from attribute_before_act, lib/card/dirty.rb:23-33). Serialized per
    // AR Type::Text: type_id "1", trash "f", numbers as strings.
    const createChanges = changes(f.storage, createRow.id as number);
    expect(createChanges).toEqual([
      { card_action_id: createRow.id, field: 0, value: "Hello World" }, // name
      { card_action_id: createRow.id, field: 1, value: "1" }, // type_id
      { card_action_id: createRow.id, field: 2, value: "v1" }, // db_content
      { card_action_id: createRow.id, field: 3, value: "f" }, // trash
      { card_action_id: createRow.id, field: 4, value: null }, // left_id
      { card_action_id: createRow.id, field: 5, value: null }, // right_id
    ]);

    // store_card_changes (events.rb:102-106): the update action carries only
    // the changed field with the NEW value
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 2, value: "v2" },
    ]);

    // ordering guarantee (events.rb:29-31 NOTE): the create action's change
    // ids sort BEFORE the first update's, because last_change_on orders by id
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
    expect(rows).toHaveLength(3); // create + 2 updates
    expect(changes(f.storage, rows[0]!.id as number)).toHaveLength(6); // backfilled once
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

    // name is tracked (field 0); key is NOT a tracked field
    // (change.rb:25 TRACKED_FIELDS has no :key) — no key change row.
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 0, value: "New Name" },
    ]);

    // a name change without a key is refused (name= writes key=,
    // lib/card/name/all.rb:20-23)
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

    // raw name attribute did not change (NULL -> NULL), so no :name change
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 5, value: String(newRightId) },
    ]);

    // the create backfill (on the compound card's first update) stores the
    // raw attribute values: name NULL, side ids serialized as strings
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

    // delete = update save with trash: true (trash.rb:11-21 add_to_trash);
    // identify_action (director/all.rb:19-28) maps trash && trash_changed?
    // to :delete -> action_type 2
    expect(actions(f.storage, cardId)).toHaveLength(2);
    expect(actions(f.storage, cardId)[1]!.action_type).toBe(2);

    const card = cardRow(f.storage, cardId) as Record<string, unknown>;
    expect(card.trash).toBe(1);
    expect(card.updated_at).toBe("2026-09-19 12:00:01.000");

    // the delete action's only changed field is trash (value serialized "t")
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 3, value: "t" },
    ]);

    // first_change? fires for delete too (history.rb:32-33 "# = update or
    // delete"): the create action got its backfill with the pre-trash state
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
    expect(card.creator_id).toBe(ACTOR_A); // creator stamped once (set_stamper)
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

    // one submission updates two cards: main (the act card) and its subcard —
    // both in ONE act (act.rb:8-11). The subcard action carries the
    // supercard's action as super_action_id (events.rb:88-92).
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

    expect(acts(f.storage)).toHaveLength(2); // create act + this update act
    const updateAct = acts(f.storage)[1]!;
    expect(updateAct.card_id).toBe(mainId); // act card = the request's first card
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
    // Ruby: the act row inserts with card_id NULL and finalize_act points it
    // at the act card afterwards (Act.new has no card_id,
    // director/class_methods.rb:27-29; events.rb:48-50).
    const f = freshFixture();
    await f.writer.createCard({
      name: "Sub First",
      key: "sub_first",
      type_id: 1,
      isActCard: false, // subcard-first orchestration: the act card comes later
    });
    expect(acts(f.storage)[0]!.card_id).toBeNull(); // inserted NULL, like Ruby
    const main = await f.writer.createCard({ name: "Main", key: "main", type_id: 1, isActCard: true });

    // same request -> same act, now pointed at the act card
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

    // fresh act (history.rb:88-94 acts.create), draft action (draft: true,
    // action_type :update, card_id set at build), one db_content change
    const act = acts(f.storage).find((a) => a.id === actId)!;
    expect(act).toMatchObject({ card_id: cardId, actor_id: ACTOR_A });
    const draftRow = actions(f.storage, cardId).find((a) => a.id === actionId)!;
    expect(draftRow).toMatchObject({ draft: 1, action_type: 1, super_action_id: null });
    expect(changes(f.storage, actionId)).toEqual([
      { card_action_id: actionId, field: 2, value: "draft text" },
    ]);

    // save_draft aborts the act before the row save (content.rb:12-15
    // `save_content_draft content; abort :success`) — db_content untouched
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
    // only the newest draft's change survives (super -> clear_drafts deletes
    // the old draft action AND its changes — action.rb:30-33 dependent)
    expect(changes(f.storage, drafts[0]!.id as number)).toEqual([
      { card_action_id: drafts[0]!.id, field: 2, value: "draft 2" },
    ]);
  });

  it("a real save clears the actor's drafts but keeps other actors' drafts", async () => {
    const f = freshFixture();
    const cardId = await createSimple(f.storage, f.writer, "Drafty", "v1");
    await f.request().saveDraft({ cardId, content: "a's draft" });

    await f.request(ACTOR_B).saveDraft({ cardId, content: "b's draft" });

    // actor A saves for real: set_content clear_drafts removes A's draft
    // only (content/all.rb:33-35 drafts.created_by(Auth.current_id))
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

    // action_count (history.rb:42-44) has NO draft filter, so with the draft
    // still present the count is 3, not 2 — first_change? is false and the
    // create action gets no backfill (Ruby relies on the same count).
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

    // Ruby order: clear_drafts runs in the :store stage, the action count in
    // :finalize — the actor's own draft is gone by then (content.rb:8).
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
    const parentId = await createSimple(f.storage, f.writer, "Parent"); // tick 0
    const childId = await createSimple(f.storage, f.writer, "Child"); // tick 1

    await f.request().updateCard({
      cardId: childId, // tick 2
      before: stateOf(f.storage, childId),
      after: { ...stateOf(f.storage, childId), db_content: "child v2" },
    });
    expect((cardRow(f.storage, parentId) as Record<string, unknown>).updated_at).toBe(
      "2026-09-19 12:00:00.000", // untouched by the child's save
    );

    const grandparentId = await createSimple(f.storage, f.writer, "Grandparent"); // tick 3
    const parentState = stateOf(f.storage, parentId);
    await f.request().updateCard({
      cardId: parentId, // tick 4
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
  // Finding encoded as a regression guard: card-1.110.0 has NO runtime
  // writer for card_revisions or cards.current_revision_id. The legacy
  // revisions were moved into acts/actions/changes by migration
  // 20141001105348_move_revisions_to_actions.rb, and seed.rb:86 strips
  // current_revision_id from seed dumps. "Revisions" today are virtual —
  // reconstructed from changes (set/all/history/revision.rb).
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
