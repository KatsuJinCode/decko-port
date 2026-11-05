

import { describe, expect, it } from "vitest";
import cardModHistory, {
  HISTORY_ACTS_PER_PAGE,
  HISTORY_DIFF_ARGS,
  HISTORY_ACTION_ICONS,
  actionIconHtml,
  actionLegendHtml,
  contentLegendHtml,
  actionIds,
  allActionIds,
  historyActions,
  createAction,
  nthAction,
  lastAction,
  lastActionId,
  previousAction,
  lastChangeOn,
  lastAct,
  actedAt,
  revisedAt,
  historyCardIds,
  historyParentIds,
  historyAncestorIds,
  actionCount,
  hasEdits,
  historyActs,
  draftActs,
  revision,
  revisionAttributes,
  revisionBeforeAction,
  selectedContent,
  contentAtTimeOfSelectedAction,
  actionFromId,
  isEditConflict,
  actionChange,
  actionIsSole,
  actionValue,
  actionPreviousValue,
  allActionChanges,
  actionTypeSymbol,
  actHash,
  actionHash,
  changesHash,
  actionHashList,
  fetchAction,
} from "../../../src/card/mod-loader/mods/card-mod-history.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import type { ViewContext, ViewFn } from "../../../src/card/render/format.js";
import type { CardsRow } from "../../../src/server/schema.js";
import {
  ActWriter,
  cardFieldStateFromRow,
  type CardFieldState,
} from "../../../src/card/history/write-path.js";
import {
  createHistoryTestStorage,
  type HistoryTestStorage,
} from "../history/history-test-storage.js";

const T0 = Date.parse("2026-09-22T12:00:00.000Z");
const ACTOR_A = 7;
const ACTOR_B = 9;

function fakeClock() {
  let ticks = 0;
  return () => new Date(T0 + ticks++ * 1000);
}

interface Deck {
  storage: HistoryTestStorage;

  mainId: number;
  createActId: number;
  createActionId: number;
  update1Id: number;
  update2Id: number;
  update2ActId: number;
  draftActionId: number;
  draftActId: number;

  request(actorId?: number): ActWriter;
}

async function seededDeck(): Promise<Deck> {
  const storage = createHistoryTestStorage();
  const clock = fakeClock();
  const request = (actorId = ACTOR_A) =>
    new ActWriter({ driver: storage.driver, actorId, ipAddress: "203.0.113.9", now: clock });

  const state = (cardId: number): CardFieldState =>
    cardFieldStateFromRow(
      storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [cardId]) as never,
    );

  const w1 = request();
  const { cardId: mainId, actId: createActId, actionId: createActionId } =
    await w1.createCard({ name: "Main Card", key: "main_card", type_id: 1, db_content: "v1" });

  const update1 = await request().updateCard({
    cardId: mainId,
    before: state(mainId),
    after: { ...state(mainId), db_content: "v2" },
  });
  if (update1 === null) throw new Error("fixture: update1 recorded no action");
  const update1Id = update1.actionId;

  const update2 = await request(ACTOR_B).updateCard({
    cardId: mainId,
    before: state(mainId),
    after: { ...state(mainId), db_content: "v3" },
  });
  if (update2 === null) throw new Error("fixture: update2 recorded no action");
  const update2Id = update2.actionId;
  const update2ActId = update2.actId;

  const { actionId: draftActionId, actId: draftActId } = await request().saveDraft({
    cardId: mainId,
    content: "draft-content",
  });

  return {
    storage,
    mainId,
    createActId,
    createActionId,
    update1Id,
    update2Id,
    update2ActId,
    draftActionId,
    draftActId,
    request,
  };
}

function callView(view: ViewFn): string {
  return view(undefined as unknown as ViewContext);
}

describe("card-mod-history manifest structure", () => {
  it("names + groups + gemName mirror the gem's metadata", () => {
    expect(cardModHistory.name).toBe("history");
    expect(cardModHistory.gemName).toBe("card-mod-history");
    expect(cardModHistory.group).toBe("gem-defaults");
  });

  it("declares exactly the eleven set files the gem's set/ tree ships", () => {

    const paths = (cardModHistory.setModules ?? []).map((m) => m.setPath);
    expect(paths).toEqual([
      "all/history",
      "all/history/actions",
      "all/history/acts",
      "all/history/act_listing",
      "all/history/events",
      "all/history/export",
      "all/history/last",
      "all/history/revision",
      "all/history/selected",
      "all/history/views",
      "all/history_board",
    ]);
  });

  it("registers only :draft_legend - the one headlessly-portable html view - with no view config", () => {

    const viewsModule = (cardModHistory.setModules ?? []).find(
      (m) => m.setPath === "all/history/views",
    );
    expect(viewsModule).toBeDefined();
    const views = viewsModule!.formats?.["html"]?.views ?? [];
    expect(views.map((v) => v.view)).toEqual(["draft_legend"]);
    expect(views[0]!.config).toBeUndefined();

    for (const m of cardModHistory.setModules ?? []) {
      if (m.setPath !== "all/history/views") {
        expect(m.formats).toBeUndefined();
      }
    }
  });

  it("loads into the base basket: All::History* modules, path-sorted, and reset restores the views record", () => {
    const liveRecord: Record<string, ViewFn> = { ...HTML_VIEWS };
    expect("draft_legend" in liveRecord).toBe(false);

    const loader = new ModLoader([{ manifest: cardModHistory }], liveRecord);
    const report = loader.load();

    expect(report.modNames).toEqual(["history"]);

    expect(report.registeredSetModules).toEqual([
      "All::History",
      "All::History::ActListing",
      "All::History::Actions",
      "All::History::Acts",
      "All::History::Events",
      "All::History::Export",
      "All::History::Last",
      "All::History::Revision",
      "All::History::Selected",
      "All::History::Views",
      "All::HistoryBoard",
    ]);
    expect(report.registeredViews).toEqual(["draft_legend"]);
    expect(report.registeredSettings).toEqual([]);
    expect(report.registeredPatternCodes).toEqual([]);
    expect(typeof liveRecord["draft_legend"]).toBe("function");

    const basket = loader.setModules();
    expect(basket.nonbase.size).toBe(0);

    expect(basket.base.map((m) => m.shortname)).toEqual([
      "All::History",
      "All::History::ActListing",
      "All::History::Actions",
      "All::History::Acts",
      "All::History::Events",
      "All::History::Export",
      "All::History::Last",
      "All::History::Revision",
      "All::History::Selected",
      "All::History::Views",
      "All::HistoryBoard",
    ]);
    expect(basket.base.every((m) => m.modName === "history" && m.kind === "base")).toBe(
      true,
    );

    loader.reset();
    expect("draft_legend" in liveRecord).toBe(false);
    expect(loader.viewConfigFor("draft_legend")).toBeUndefined();
  });

  it("carries the acts_per_page default and diff_args config", () => {

    expect(HISTORY_ACTS_PER_PAGE).toBe(10);
    expect(HISTORY_DIFF_ARGS).toEqual({ diffFormat: "text" });
  });
});

describe("card-mod-history event declarations (events.rb)", () => {
  it("pins ALL SIX events through the ModLoader SetLoader phase", () => {

    const loader = new ModLoader([{ manifest: cardModHistory }]);
    const report = loader.load();

    expect(report.registeredEvents).toEqual([
      "update_ancestor_timestamps",
      "assign_action",
      "detect_conflict",
      "finalize_action",
      "rollback_actions",
      "finalize_act",
    ]);

    const events = loader.eventRegistry();
    expect(events.size()).toBe(6);

    expect(events.all().map((e) => `${e.modName}:${e.event}@${e.setPath}`)).toEqual([
      "history:update_ancestor_timestamps@all/history/events",
      "history:assign_action@all/history/events",
      "history:detect_conflict@all/history/events",
      "history:finalize_action@all/history/events",
      "history:rollback_actions@all/history/events",
      "history:finalize_act@all/history/events",
    ]);

    expect(events.forStage("integrate").map((e) => e.event)).toEqual([
      "update_ancestor_timestamps",
    ]);
    expect(events.forStage("initialize").map((e) => e.event)).toEqual([
      "assign_action",
    ]);
    expect(events.forStage("validate").map((e) => e.event)).toEqual([
      "detect_conflict",
    ]);
    expect(events.forStage("finalize").map((e) => e.event)).toEqual([
      "finalize_action",
    ]);
    expect(events.forStage("prepare_to_validate").map((e) => e.event)).toEqual([
      "rollback_actions",
    ]);

    expect(events.forStage("finalize").map((e) => e.event)).toEqual([
      "finalize_action",
    ]);

    expect(events.forStage("prepare_to_store")).toEqual([]);
    expect(events.forStage("store")).toEqual([]);
    expect(events.forStage("after_integrate")).toEqual([]);
    expect(events.forStage("integrate_with_delay")).toEqual([]);
    expect(events.forStage("extend")).toEqual([]);
    expect(events.forStage("extend_with_delay")).toEqual([]);
  });

  it("forEvent reads the verbatim at/on/when/after the gem declared (lib/card/set/event.rb)", () => {
    const loader = new ModLoader([{ manifest: cardModHistory }]);
    loader.load();
    const events = loader.eventRegistry();

    const updateAnc = events.forEvent("update_ancestor_timestamps");
    expect(updateAnc?.setPath).toBe("all/history/events");
    expect(updateAnc?.modName).toBe("history");
    expect(updateAnc?.at).toBe("integrate");
    expect(updateAnc?.on).toBeUndefined();
    expect(updateAnc?.when).toBeUndefined();
    expect(updateAnc?.after).toBeUndefined();

    const assignAction = events.forEvent("assign_action");
    expect(assignAction?.at).toBe("initialize");
    expect(assignAction?.when).toBe("actionable?");
    expect(assignAction?.on).toBeUndefined();
    expect(assignAction?.after).toBeUndefined();

    const detectConflict = events.forEvent("detect_conflict");
    expect(detectConflict?.at).toBe("validate");
    expect(detectConflict?.on).toEqual(["update"]);
    expect(detectConflict?.when).toBe("edit_conflict?");
    expect(detectConflict?.after).toBeUndefined();

    const finalize = events.forEvent("finalize_action");
    expect(finalize?.at).toBe("finalize");
    expect(finalize?.on).toBeUndefined();
    expect(finalize?.when).toBe("finalize_action?");
    expect(finalize?.after).toBeUndefined();

    const rollback = events.forEvent("rollback_actions");
    expect(rollback?.at).toBe("prepare_to_validate");
    expect(rollback?.on).toEqual(["update"]);
    expect(rollback?.when).toBe("rollback_request?");
    expect(rollback?.after).toBeUndefined();

    const finalizeAct = events.forEvent("finalize_act");
    expect(finalizeAct?.at).toBeUndefined();
    expect(finalizeAct?.after).toBe("finalize_action");
    expect(finalizeAct?.when).toBe("act_card?");
    expect(finalizeAct?.on).toBeUndefined();
  });

  it("the pinned event bodies are call-able (the (card, host) fn shape the seam demands)", () => {
    const loader = new ModLoader([{ manifest: cardModHistory }]);
    loader.load();

    const updateAnc = loader.eventRegistry().forEvent("update_ancestor_timestamps");
    const assignAction = loader.eventRegistry().forEvent("assign_action");
    const detectConflict = loader.eventRegistry().forEvent("detect_conflict");
    const finalize = loader.eventRegistry().forEvent("finalize_action");
    const rollback = loader.eventRegistry().forEvent("rollback_actions");
    const finalizeAct = loader.eventRegistry().forEvent("finalize_act");
    expect(updateAnc?.fn).toBeDefined();
    expect(assignAction?.fn).toBeDefined();
    expect(detectConflict?.fn).toBeDefined();
    expect(finalize?.fn).toBeDefined();
    expect(rollback?.fn).toBeDefined();
    expect(finalizeAct?.fn).toBeDefined();

    const card = { name: "x", id: 1 };
    const host = {} as Parameters<NonNullable<typeof updateAnc>["fn"]>[1];
    expect(() => updateAnc!.fn(card, host)).not.toThrow();
    expect(() => assignAction!.fn(card, host)).not.toThrow();
    expect(() => detectConflict!.fn(card, host)).not.toThrow();
    expect(() => finalize!.fn(card, host)).not.toThrow();
    expect(() => rollback!.fn(card, host)).not.toThrow();
    expect(() => finalizeAct!.fn(card, host)).not.toThrow();
  });

  it("the newly-unblocked three events land at the stages + clauses Ruby declared (events.rb:15-50)", () => {

    const loader = new ModLoader([{ manifest: cardModHistory }]);
    loader.load();
    const events = loader.eventRegistry();

    const assignAction = events.forEvent("assign_action");
    expect(assignAction).toBeDefined();
    expect(assignAction?.at).toBe("initialize");
    expect(assignAction?.when).toBe("actionable?");

    const detectConflict = events.forEvent("detect_conflict");
    expect(detectConflict).toBeDefined();
    expect(detectConflict?.at).toBe("validate");
    expect(detectConflict?.on).toEqual(["update"]);
    expect(detectConflict?.when).toBe("edit_conflict?");

    const finalizeAct = events.forEvent("finalize_act");
    expect(finalizeAct).toBeDefined();
    expect(finalizeAct?.at).toBeUndefined();
    expect(finalizeAct?.after).toBe("finalize_action");
    expect(finalizeAct?.when).toBe("act_card?");

    expect(events.size()).toBe(6);
  });

  it("reset() empties the event registry but leaves the default binding observable-identical", () => {

    const loader = new ModLoader([{ manifest: cardModHistory }]);
    loader.load();
    expect(loader.eventRegistry().size()).toBe(6);
    loader.reset();
    expect(loader.eventRegistry().size()).toBe(0);
    expect(loader.eventRegistry().all()).toEqual([]);
  });
});

describe("card-mod-history view + legend bytes", () => {
  it(":draft_legend renders the material draft icon + 'unsaved draft' (views.rb:24-26)", () => {

    const viewsModule = cardModHistory.setModules?.find(
      (m) => m.setPath === "all/history/views",
    );
    const view = viewsModule!.formats!["html"]!.views![0]!.viewFn;
    expect(view(undefined as never)).toBe(
      '<i class="notranslate material-icons">build</i> unsaved draft',
    );
  });

  it("action_icon maps the three action types through the material basket (act_listing.rb:81-85)", () => {
    expect(HISTORY_ACTION_ICONS).toEqual({
      create: "create_action",
      update: "update_action",
      delete: "delete_action",
      draft: "draft",
    });
    expect(actionIconHtml("create")).toBe(
      '<i class="notranslate material-icons">add_circle</i>',
    );
    expect(actionIconHtml("update")).toBe(
      '<i class="notranslate material-icons">edit</i>',
    );
    expect(actionIconHtml("delete")).toBe(
      '<i class="notranslate material-icons">remove_circle</i>',
    );
  });

  it("action_legend joins 'created | updated | deleted' + optional draft legend (actions.rb:91-98)", () => {
    expect(actionLegendHtml(false)).toBe(
      '<small>Actions: <i class="notranslate material-icons">add_circle</i> created | ' +
        '<i class="notranslate material-icons">edit</i> updated | ' +
        '<i class="notranslate material-icons">remove_circle</i> deleted</small>',
    );

    expect(actionLegendHtml(true)).toBe(
      '<small>Actions: <i class="notranslate material-icons">add_circle</i> created | ' +
        '<i class="notranslate material-icons">edit</i> updated | ' +
        '<i class="notranslate material-icons">remove_circle</i> deleted | ' +
        '<i class="notranslate material-icons">build</i> unsaved draft</small>',
    );
  });

  it("content_legend emits the diff chunk markers (actions.rb:100-103; diff.rb:16-21)", () => {
    expect(contentLegendHtml()).toBe(
      "<small>Content changes: <ins class='diffins diff-added'>Additions</ins> | " +
        "<del class='diffdel diff-deleted'>Subtractions</del></small>",
    );
  });
});

describe("card-mod-history action readers (actions.rb)", () => {
  it("action_ids excludes drafts; all_action_ids includes them (actions.rb:4-10)", async () => {
    const d = await seededDeck();
    const nonDraft = await actionIds(d.storage.driver, d.mainId);
    expect(nonDraft).toEqual([d.createActionId, d.update1Id, d.update2Id]);
    const all = await allActionIds(d.storage.driver, d.mainId);
    expect(all).toEqual([d.createActionId, d.update1Id, d.update2Id, d.draftActionId]);

    expect(await actionCount(d.storage.driver, d.mainId)).toBe(4);
  });

  it("history_actions spans nestees and includes drafts (actions.rb:13-15)", async () => {
    const d = await seededDeck();
    const { cardId: nestedId } = await d
      .request()
      .createCard({ name: "Nested Card", key: "nested_card", type_id: 1, db_content: "n1" });
    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, ?, ?, 'I', 1)",
      [d.mainId, "nested_card", nestedId],
    );
    const actions = await historyActions(
      d.storage.driver,
      await historyCardIds(d.storage.driver, d.mainId),
    );
    expect(actions.map((a) => a.id)).toContain(nestedId);
    expect(actions.map((a) => a.id)).toContain(d.draftActionId);
  });

  it("create_action is the first non-draft action (actions.rb:21-23)", async () => {
    const d = await seededDeck();
    const create = await createAction(d.storage.driver, d.mainId);
    expect(create?.id).toBe(d.createActionId);
    expect(create?.action_type).toBe(0);
  });

  it("nth_action is 1-based, skips drafts, and rejects non-positive indexes (actions.rb:25-31)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    expect((await nthAction(driver, d.mainId, 1))?.id).toBe(d.createActionId);
    expect((await nthAction(driver, d.mainId, 2))?.id).toBe(d.update1Id);
    expect((await nthAction(driver, d.mainId, 3))?.id).toBe(d.update2Id);

    expect(await nthAction(driver, d.mainId, 4)).toBeUndefined();
    expect(await nthAction(driver, d.mainId, 0)).toBeUndefined();
    expect(await nthAction(driver, d.mainId, -1)).toBeUndefined();
  });
});

describe("card-mod-history last-action readers (last.rb)", () => {
  it("last_action is the newest non-draft action (last.rb:49-55)", async () => {
    const d = await seededDeck();
    expect((await lastAction(d.storage.driver, d.mainId))?.id).toBe(d.update2Id);
    expect(await lastActionId(d.storage.driver, d.mainId)).toBe(d.update2Id);
  });

  it("previous_action indexes the non-draft list but reads the predecessor from all actions (last.rb:87-95)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;

    expect(await previousAction(driver, d.mainId, d.createActionId)).toBeUndefined();

    expect((await previousAction(driver, d.mainId, d.update2Id))?.id).toBe(d.update1Id);

    expect(await previousAction(driver, d.mainId, d.draftActionId)).toBeUndefined();
  });

  it("last_change_on walks the branches of last.rb:9-47", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;

    expect((await lastChangeOn(driver, d.mainId, "db_content"))?.value).toBe("v3");

    expect(
      (await lastChangeOn(driver, d.mainId, "db_content", { before: d.update2Id }))?.value,
    ).toBe("v2");

    expect(
      await lastChangeOn(driver, d.mainId, "db_content", { before: d.createActionId }),
    ).toBeUndefined();

    expect(
      (await lastChangeOn(driver, d.mainId, "db_content", { notAfter: d.update2Id }))?.value,
    ).toBe("v3");
    expect(
      (await lastChangeOn(driver, d.mainId, "db_content", { notAfter: d.update1Id }))?.value,
    ).toBe("v2");

    expect(
      (
        await lastChangeOn(driver, d.mainId, "db_content", {
          notAfter: d.draftActionId,
          includingDrafts: true,
        })
      )?.value,
    ).toBe("draft-content");
    expect(
      (await lastChangeOn(driver, d.mainId, "db_content", { notAfter: d.draftActionId }))
        ?.value,
    ).toBe("v3");

    expect((await lastChangeOn(driver, d.mainId, "name"))?.value).toBe("Main Card");

    expect(await lastChangeOn(driver, 99999, "db_content")).toBeUndefined();
  });

  it("last_change_on with before: throws when the card has no create action (Ruby nil.id raise)", async () => {
    const d = await seededDeck();
    const { cardId: bareId } = await d
      .request()
      .createCard({ name: "Bare Card", key: "bare_card", type_id: 1, db_content: null });

    d.storage.exec("DELETE FROM card_changes WHERE card_action_id IN (SELECT id FROM card_actions WHERE card_id = ?)", [bareId]);
    d.storage.exec("DELETE FROM card_actions WHERE card_id = ?", [bareId]);
    await expect(
      lastChangeOn(d.storage.driver, bareId, "db_content", { before: 1 }),
    ).rejects.toThrow("no create action");
  });

  it("a sole create action synthesizes its changes from the current row (changes.rb:55-64)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const { cardId: freshId, actionId: freshActionId } = await d
      .request()
      .createCard({ name: "Fresh Card", key: "fresh_card", type_id: 2, db_content: "now" });
    const fresh = (await fetchAction(driver, freshActionId))!;

    expect(await actionIsSole(driver, fresh)).toBe(true);
    expect(await allActionChanges(driver, freshActionId)).toEqual([]);

    const content = await actionChange(driver, fresh, "db_content");
    expect(content).toEqual({ cardActionId: freshActionId, field: "db_content", value: "now" });
    expect((await actionChange(driver, fresh, "trash"))?.value).toBe(false);
    expect((await actionChange(driver, fresh, "type_id"))?.value).toBe(2);

    expect(await actionValue(driver, fresh, "type_id")).toBe(2);
    expect(await actionValue(driver, fresh, "name")).toBe("Fresh Card");

    await d.request().updateCard({
      cardId: freshId,
      before: cardFieldStateFromRow(
        d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [freshId]) as never,
      ),
      after: {
        ...cardFieldStateFromRow(
          d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [freshId]) as never,
        ),
        db_content: "next",
      },
    });
    expect(await actionIsSole(driver, fresh)).toBe(false);
    expect((await actionChange(driver, fresh, "db_content"))?.value).toBe("now");
  });

  it("previous_value reads the most recent earlier change (changes.rb:17-22, 34-44)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const update2 = (await fetchAction(driver, d.update2Id))!;
    expect(await actionPreviousValue(driver, update2, "db_content")).toBe("v2");
    const create = (await fetchAction(driver, d.createActionId))!;
    expect(await actionPreviousValue(driver, create, "db_content")).toBeUndefined();
  });

  it("last_act prefers the later of the act-on-self and the act of the last action (last.rb:69-91)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;

    const lastOwnAct = d.storage.selectOne<{ id: number }>(
      "SELECT id FROM card_acts WHERE card_id = ? ORDER BY id DESC LIMIT 1",
      [d.mainId],
    )!.id;
    expect(lastOwnAct).toBe(d.draftActId);
    expect((await lastAct(driver, d.mainId))?.id).toBe(lastOwnAct);
    expect(await actedAt(driver, d.mainId)).not.toBeNull();

    const w = d.request();
    const { cardId: hostId } = await w.createCard({
      name: "Host Card",
      key: "host_card",
      type_id: 1,
      db_content: "h1",
    });
    await w.updateCard({
      cardId: hostId,
      before: cardFieldStateFromRow(
        d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [hostId]) as never,
      ),
      after: {
        ...cardFieldStateFromRow(
          d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [hostId]) as never,
        ),
        db_content: "h2",
      },
    });
    const { cardId: subId } = await d
      .request()
      .createCard({ name: "Sub Card", key: "sub_card", type_id: 1, db_content: "s1" });
    await d.request().updateCard({
      cardId: subId,
      before: cardFieldStateFromRow(
        d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [subId]) as never,
      ),
      after: {
        ...cardFieldStateFromRow(
          d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [subId]) as never,
        ),
        db_content: "s2",
      },
      isActCard: false,
    });
    const subLastActionActId = d.storage.selectOne<{ card_act_id: number }>(
      "SELECT card_act_id FROM card_actions WHERE card_id = ? ORDER BY id DESC LIMIT 1",
      [subId],
    )!.card_act_id;

    expect((await lastAct(driver, subId))?.id).toBe(subLastActionActId);
    expect((await lastAct(driver, subId))?.card_id).not.toBe(subId);

    await d.request().saveDraft({ cardId: subId, content: "sub-draft" });
    const newerOwnActId = d.storage.selectOne<{ id: number }>(
      "SELECT id FROM card_acts WHERE card_id = ? ORDER BY id DESC LIMIT 1",
      [subId],
    )!.id;
    expect(newerOwnActId).not.toBe(subLastActionActId);
    expect((await lastAct(driver, subId))?.id).toBe(newerOwnActId);
  });

  it("revised_at falls back to now when there is no last action (last.rb:5-7)", async () => {
    const d = await seededDeck();
    const revised = await revisedAt(d.storage.driver, d.mainId);
    expect(revised).toBe(
      d.storage.selectOne<{ acted_at: string }>(
        "SELECT acted_at FROM card_acts WHERE id = ?",
        [d.update2ActId],
      )!.acted_at,
    );
    const at = new Date(Date.parse("2027-01-01T00:00:00.000Z"));

    d.storage.exec("DELETE FROM card_actions WHERE card_id = ?", [d.mainId]);
    expect(await revisedAt(d.storage.driver, d.mainId, () => at)).toBe(
      "2027-01-01 00:00:00.000",
    );
  });
});

describe("card-mod-history revisions (revision.rb) + selected content (selected.rb)", () => {
  it("revision_attributes: own change, else last-change-not-after, else current attribute (revision.rb:14-19)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const update2 = (await fetchAction(driver, d.update2Id))!;
    const attrs = await revisionAttributes(driver, d.mainId, update2);

    expect(attrs.db_content).toBe("v3");

    expect(attrs.name).toBe("Main Card");

    expect(attrs.trash).toBe("f");

    expect(attrs.type_id).toBe("1");
  });

  it("revision + revision_before_action (revision.rb:1-26)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;

    const beforeUpdate2 = await revision(driver, d.mainId, d.update2Id, true);
    expect(beforeUpdate2?.db_content).toBe("v2");

    const beforeCreate = await revision(driver, d.mainId, d.createActionId, true);
    expect(beforeCreate).toEqual({ trash: true });

    const atUpdate1 = await revision(driver, d.mainId, d.update1Id);
    expect(atUpdate1?.db_content).toBe("v2");

    expect(await revision(driver, d.mainId, 999999)).toBeUndefined();
  });

  it("selected content reads db_content at the selected action, drafts included (selected.rb:37-49)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    expect(await contentAtTimeOfSelectedAction(driver, d.mainId, d.update1Id)).toBe("v2");

    expect(await contentAtTimeOfSelectedAction(driver, d.mainId, d.draftActionId)).toBe(
      "draft-content",
    );
    expect(await selectedContent(driver, d.mainId, d.update1Id, "current")).toBe("v2");
    expect(await selectedContent(driver, d.mainId, d.draftActionId, "current")).toBe(
      "draft-content",
    );
  });

  it("action_from_id requires an integer-ish id on self (selected.rb:76-89)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    expect((await actionFromId(driver, d.mainId, d.update1Id))?.id).toBe(d.update1Id);
    expect((await actionFromId(driver, d.mainId, String(d.update1Id)))?.id).toBe(
      d.update1Id,
    );

    const { cardId: otherId } = await d
      .request()
      .createCard({ name: "Other Card", key: "other_card", type_id: 1, db_content: null });
    const otherSave = await d.request().updateCard({
      cardId: otherId,
      before: cardFieldStateFromRow(
        d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [otherId]) as never,
      ),
      after: {
        ...cardFieldStateFromRow(
          d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [otherId]) as never,
        ),
        db_content: "o2",
      },
    });
    if (otherSave === null) throw new Error("fixture: other-card update recorded no action");
    expect(await actionFromId(driver, d.mainId, otherSave.actionId)).toBeUndefined();

    expect(await actionFromId(driver, d.mainId, "standard")).toBeUndefined();
  });
});

describe("card-mod-history conflict guard + counters (events.rb, history.rb)", () => {
  it("edit_conflict? fires only for stale edits last saved by someone else (events.rb:65-72)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;

    expect(await isEditConflict(driver, d.mainId, d.update1Id, ACTOR_A)).toBe(true);

    expect(await isEditConflict(driver, d.mainId, d.update1Id, ACTOR_B)).toBe(false);

    expect(await isEditConflict(driver, d.mainId, d.update2Id, ACTOR_A)).toBe(false);

    expect(await isEditConflict(driver, d.mainId, null, ACTOR_A)).toBe(false);
    expect(await isEditConflict(driver, d.mainId, undefined, ACTOR_A)).toBe(false);
  });

  it("has_edits? detects acts the card's account is responsible for (history.rb:47-49)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const { cardId: accountId } = await d
      .request()
      .createCard({ name: "Joe User", key: "joe_user", type_id: 1, db_content: null });
    expect(await hasEdits(driver, accountId)).toBe(false);
    d.storage.exec(
      "INSERT INTO card_acts (card_id, actor_id, acted_at, ip_address) VALUES (?, ?, ?, ?)",
      [d.mainId, accountId, "2026-09-22 12:00:00.000", "203.0.113.9"],
    );
    expect(await hasEdits(driver, accountId)).toBe(true);
  });

  it("history_card_ids / history_parent_ids / history_ancestor_ids walk the inclusion graph (history.rb:11-27)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const { cardId: aId } = await d
      .request()
      .createCard({ name: "Node A", key: "node_a", type_id: 1, db_content: null });
    const { cardId: bId } = await d
      .request()
      .createCard({ name: "Node B", key: "node_b", type_id: 1, db_content: null });
    const { cardId: cId } = await d
      .request()
      .createCard({ name: "Node C", key: "node_c", type_id: 1, db_content: null });

    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, '', ?, 'I', 1)",
      [aId, bId],
    );
    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, '', ?, 'I', 1)",
      [bId, cId],
    );

    expect(await historyCardIds(driver, aId)).toEqual([bId, aId]);

    expect(await historyParentIds(driver, cId)).toEqual([bId]);

    expect(await historyAncestorIds(driver, cId)).toEqual([bId, aId]);

    expect(await historyAncestorIds(driver, aId)).toEqual([]);

    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, '', ?, 'L', 1)",
      [cId, aId],
    );
    expect(await historyParentIds(driver, aId)).toEqual([]);
  });

  it("history_ancestor_ids recurses only through fetchable cards (the id.card&. hop)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const { cardId: gId } = await d
      .request()
      .createCard({ name: "Chain Grand", key: "chain_grand", type_id: 1, db_content: null });
    const { cardId: pId } = await d
      .request()
      .createCard({ name: "Chain Parent", key: "chain_parent", type_id: 1, db_content: null });
    const { cardId: kId } = await d
      .request()
      .createCard({ name: "Chain Kid", key: "chain_kid", type_id: 1, db_content: null });

    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, '', ?, 'I', 1)",
      [gId, pId],
    );
    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, '', ?, 'I', 1)",
      [pId, kId],
    );

    expect(await historyAncestorIds(driver, kId)).toEqual([pId, gId]);

    await d.request().trashCard({
      cardId: pId,
      before: cardFieldStateFromRow(
        d.storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = ?", [pId]) as never,
      ),
    });
    expect(await historyAncestorIds(driver, kId)).toEqual([pId]);
  });
});

describe("card-mod-history act listings (acts.rb, act.rb:46-52)", () => {
  it("history_acts returns the acts behind the card's history, newest first (acts.rb:2-4)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const acts = await historyActs(
      driver,
      await historyCardIds(driver, d.mainId),
      { currentUserId: ACTOR_A, withDrafts: true },
    );

    const ids = acts.map((a) => a.id);
    expect(ids).toContain(d.draftActId);
    expect(ids).toContain(d.update2ActId);
    expect(ids).toContain(d.createActId);
    expect(ids).toEqual([...ids].sort((x, y) => y - x));

    const noDrafts = await historyActs(driver, [d.mainId], {
      currentUserId: ACTOR_A,
      withDrafts: false,
    });
    expect(noDrafts.map((a) => a.id)).not.toContain(d.draftActId);
  });

  it("history_acts applies the viewable filter per action card (act.rb:54-59, callback shape)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;

    const { cardId: secretId } = await d
      .request()
      .createCard({ name: "Secret Card", key: "secret_card", type_id: 1, db_content: "s" });
    d.storage.exec(
      "INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present) VALUES (?, '', ?, 'I', 1)",
      [d.mainId, secretId],
    );
    const acts = await historyActs(
      driver,
      await historyCardIds(driver, d.mainId),
      {
        currentUserId: ACTOR_A,
        withDrafts: true,
        isActionViewable: (cardId) => cardId !== secretId,
      },
    );
    const secretActIds = d.storage
      .selectAll<{ id: number }>(
        "SELECT DISTINCT card_acts.id FROM card_acts JOIN card_actions ON card_actions.card_act_id = card_acts.id WHERE card_actions.card_id = ?",
        [secretId],
      )
      .map((r) => r.id);
    for (const secretAct of secretActIds) {
      expect(acts.map((a) => a.id)).not.toContain(secretAct);
    }
  });

  it("draft_acts maps the current user's draft actions to their acts (acts.rb:6-8)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const mine = await draftActs(driver, d.mainId, ACTOR_A);
    expect(mine.map((a) => a.id)).toEqual([d.draftActId]);

    expect(await draftActs(driver, d.mainId, ACTOR_B)).toEqual([]);
  });
});

describe("card-mod-history export hashes (export.rb:24-47)", () => {
  it("action_hash_list merges each act's hash under the action's own", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const list = await actionHashList(
      driver,
      await historyActions(driver, [d.mainId]),
    );
    const update2Hash = list.find((h) => h["action_id"] === d.update2Id)!;
    expect(update2Hash).toMatchObject({
      act_id: d.update2ActId,
      actor_id: ACTOR_B,
      act_card_id: d.mainId,
      card_id: d.mainId,
      action_type: "update",
      comment: null,
    });
    const createHash = list.find((h) => h["action_id"] === d.createActionId)!;

    expect((createHash["changes"] as Record<string, unknown>)["db_content"]).toBe("v1");
    expect(createHash["action_type"]).toBe("create");
  });

  it("action_type reads :draft when the draft flag is set (action.rb:96-100)", async () => {
    const d = await seededDeck();
    const driver = d.storage.driver;
    const draft = (await fetchAction(driver, d.draftActionId))!;
    expect(actionTypeSymbol(draft)).toBe("draft");
    const update = (await fetchAction(driver, d.update2Id))!;
    expect(actionTypeSymbol(update)).toBe("update");
  });

  it("act_hash / action_hash / changes_hash shapes (export.rb:24-47)", () => {
    expect(
      actHash({
        id: 5,
        card_id: 2,
        actor_id: 7,
        acted_at: "2026-09-22 12:00:00.000",
        ip_address: null,
      }),
    ).toEqual({
      act_id: 5,
      actor_id: 7,
      acted_at: "2026-09-22 12:00:00.000",
      act_card_id: 2,
    });
    expect(
      changesHash([
        { cardActionId: 1, field: "db_content", value: "x" },
        { cardActionId: 1, field: "name", value: "n" },
        { cardActionId: 1, field: "db_content", value: "y" },
      ]),
    ).toEqual({ db_content: "y", name: "n" });
    expect(
      actionHash(
        {
          id: 9,
          card_id: 2,
          card_act_id: 5,
          super_action_id: null,
          action_type: 2,
          draft: 0,
          comment: "hi",
        },
        [{ cardActionId: 9, field: "trash", value: "t" }],
      ),
    ).toEqual({
      action_id: 9,
      card_id: 2,
      action_type: "delete",
      comment: "hi",
      changes: { trash: "t" },
    });
  });
});
