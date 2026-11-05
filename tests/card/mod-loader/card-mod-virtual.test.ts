// card-mod-virtual mod-loader tests: prove the ported Card::Virtual record
// model (card-mod-virtual-0.20.0 lib/card/virtual.rb) and the abstract
// virtual_cache set module (set/abstract/virtual_cache.rb) against REAL
// storage - in-memory better-sqlite3 loaded with db/schema.sqlite.sql (the
// same fixture the history write-path tests use), rows SELECTed back and
// compared against expectations derived from the Ruby source. Each
// expectation cites the Ruby file:line it derives from.
//
// The mod declares no html views (compat report metrics.htmlViewsDeclared:
// 0, htmlViewsMissingNames: []), so the proof surface is the record model's
// SQL semantics + the set module's predicates/event bodies/manifest shape.

import { describe, expect, it, afterEach } from "vitest";
import { createHistoryTestStorage, type HistoryTestStorage } from "../history/history-test-storage.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import cardModVirtual, {
  VirtualRecordCache,
  virtualLeftId,
  virtualRightId,
  VirtualCardError,
  validateVirtualCard,
  findVirtualByCard,
  virtualFetch,
  virtualSave,
  virtualDelete,
  virtualRecordUpdate,
  virtualRowCardname,
  virtualRowCardId,
  isVirtualCard,
  virtualContent,
  virtualDbContent,
  virtualUpdatedAt,
  saveVirtualContent,
  deleteVirtualContent,
  VIRTUAL_EVENT_DECLARATIONS,
  VIRTUAL_HISTORY_ENABLED,
  VIRTUAL_FOLLOWABLE_ENABLED,
  virtualDeleteCard,
  virtualDeleteCardBang,
  saveVirtualContentEventFn,
  deleteVirtualContentEventFn,
} from "../../../src/card/mod-loader/mods/card-mod-virtual.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";
import { ActWriter, cardFieldStateFromRow } from "../../../src/card/history/write-path.js";
import type { CardsRow } from "../../../src/server/schema.js";
import { DeckoName } from "../../../src/card/name.js";

// Deterministic clock: one Virtual operation = one second on the fake clock
// (same shape as the write-path tests' fixture).
const T0 = Date.parse("2026-09-21T12:00:00.000Z");
const STAMP_1 = "2026-09-21 12:00:00.000";
const STAMP_2 = "2026-09-21 12:00:01.000";
const STAMP_3 = "2026-09-21 12:00:02.000";

function tickClock() {
  let ticks = 0;
  return () => new Date(T0 + ticks++ * 1000);
}

function cardRecord(overrides: Partial<CardRecord> & { key: string; name: DeckoName }): CardRecord {
  return {
    id: undefined,
    codename: undefined,
    leftId: undefined,
    rightId: undefined,
    typeId: 2,
    dbContent: undefined,
    trash: false,
    creatorId: undefined,
    updaterId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    currentRevisionId: undefined,
    readRuleClass: undefined,
    readRuleId: undefined,
    referencesExpired: undefined,
    isNew: false,
    fromTrash: false,
    uncacheable: false,
    ...overrides,
  };
}

// A simple (non-compound) card: left_id = its own id, right_id = the -2
// sentinel (virtual.rb:78, :86).
const SIMPLE = () =>
  cardRecord({ id: 75, key: "caesar", name: DeckoName.parse("Caesar"), dbContent: "the content" });

// A compound card with stored positive side ids (the where_card id branch,
// virtual.rb:66-68).
const COMPOUND = () =>
  cardRecord({
    id: 33,
    key: "jane_doe+books",
    name: DeckoName.parse("Jane Doe+Books"),
    leftId: 10,
    rightId: 20,
    dbContent: "junction content",
  });

interface Fixture {
  storage: HistoryTestStorage;
  clock: () => Date;
  cache: VirtualRecordCache;
}

function freshFixture(): Fixture {
  const storage = createHistoryTestStorage();
  return { storage, clock: tickClock(), cache: new VirtualRecordCache() };
}

function virtualRows(s: HistoryTestStorage) {
  return s.selectAll<Record<string, unknown>>("SELECT * FROM card_virtuals ORDER BY id");
}

/** The lexicon stub for the cardname tests: Integer#cardname = Lexicon.name
 *  (01_core_extensions/integer.rb:9-11); the caller owns id->name. */
const NAME_OF_ID = (id: number): string | undefined =>
  ({ 10: "Jane Doe", 20: "Books", 75: "Caesar" })[id];

// ---------------------------------------------------------------------------
// the mod-loads-into-loader prove: registeredEvents + eventRegistry
// (forStage / forEvent / all) — vitest path for this lane
// ---------------------------------------------------------------------------

let liveLoader: ModLoader | undefined;

afterEach(() => {
  liveLoader?.reset();
  liveLoader = undefined;
});

describe("card-mod-virtual: the manifest", () => {
  it("registers the gem's one set module, abstract/virtual_cache, with no views", () => {
    expect(cardModVirtual.name).toBe("virtual");
    expect(cardModVirtual.gemName).toBe("card-mod-virtual");
    // The setModule carries the two events[] entries (the LANDED+WIDENED
    // mod-manifest.ts ModSetModuleFile.events surface). fn is the live
    // exported stub; we assert the declaration shape + the fn identity
    // (the body itself is exercised by the eventRegistry describe block
    // below).
    expect(cardModVirtual.setModules).toEqual([
      {
        setPath: "abstract/virtual_cache",
        events: [
          {
            event: "save_virtual_content",
            at: "prepare_to_store",
            on: ["save"],
            fn: saveVirtualContentEventFn,
          },
          {
            event: "delete_virtual_content",
            at: "prepare_to_store",
            on: ["delete"],
            fn: deleteVirtualContentEventFn,
          },
        ],
      },
    ]);
  });

  it("pins the two prepare_to_store event declarations (virtual_cache.rb:21,26)", () => {
    expect(VIRTUAL_EVENT_DECLARATIONS).toEqual([
      { event: "save_virtual_content", stage: "prepare_to_store", on: "save" },
      { event: "delete_virtual_content", stage: "prepare_to_store", on: "delete" },
    ]);
  });

  it("pins history? and followable? false (virtual_cache.rb:35-41)", () => {
    expect(VIRTUAL_HISTORY_ENABLED).toBe(false);
    expect(VIRTUAL_FOLLOWABLE_ENABLED).toBe(false);
  });
});

describe("card-mod-virtual: the events surface through the loader (virtual_cache.rb:21,26)", () => {
  // The two events sit on abstract/virtual_cache (the gem's one set file)
  // and ride the SetLoader phase's events[] registration
  // (mod-loader.ts:283-293): the loader injects setPath + modName into
  // each entry's registered copy, reports the names in
  // ModLoadReport.registeredEvents, and exposes them via
  // loader.eventRegistry() (forStage / forEvent / all).

  it("load() reports both event names in registeredEvents, in declaration order", () => {
    const loader = new ModLoader([{ manifest: cardModVirtual }], { ...HTML_VIEWS });
    liveLoader = loader;
    const report = loader.load();
    // virtual_cache.rb:21 (save) declares before :26 (delete);
    // SetLoader walks the gem's setModules in path order (one file), so
    // registration order = declaration order.
    expect(report.registeredEvents).toEqual([
      "save_virtual_content",
      "delete_virtual_content",
    ]);
  });

  it("loader.eventRegistry() carries both events with setPath + modName + at + on injected", () => {
    const loader = new ModLoader([{ manifest: cardModVirtual }], { ...HTML_VIEWS });
    liveLoader = loader;
    loader.load();
    const registry = loader.eventRegistry();

    expect(registry.size()).toBe(2);
    expect(registry.all().map((e) => `${e.modName}:${e.event}:${e.setPath}`)).toEqual([
      "virtual:save_virtual_content:abstract/virtual_cache",
      "virtual:delete_virtual_content:abstract/virtual_cache",
    ]);

    // forStage preserves registration order (Ruby's same-stage execution
    // order is definition load order - lib/card/set/event.rb's stage
    // runner). Both events declare the same stage.
    expect(registry.forStage("prepare_to_store").map((e) => e.event)).toEqual([
      "save_virtual_content",
      "delete_virtual_content",
    ]);
    // Stages the mod never fires at stay empty (the cross-check that
    // forStage is a stage filter, not a total dump).
    expect(registry.forStage("validate")).toEqual([]);
    expect(registry.forStage("integrate")).toEqual([]);
    expect(registry.forStage("store")).toEqual([]);
    expect(registry.forStage("finalize")).toEqual([]);

    // forEvent returns the first registration for the name, with the
    // file coordinates + stage + on[] populated. The fn reference is the
    // same one the manifest exported (object identity preserved).
    const save = registry.forEvent("save_virtual_content");
    expect(save?.setPath).toBe("abstract/virtual_cache");
    expect(save?.modName).toBe("virtual");
    expect(save?.at).toBe("prepare_to_store");
    expect(save?.on).toEqual(["save"]);
    expect(save?.fn).toBe(saveVirtualContentEventFn);

    const del = registry.forEvent("delete_virtual_content");
    expect(del?.setPath).toBe("abstract/virtual_cache");
    expect(del?.modName).toBe("virtual");
    expect(del?.at).toBe("prepare_to_store");
    expect(del?.on).toEqual(["delete"]);
    expect(del?.fn).toBe(deleteVirtualContentEventFn);
  });

  it("the registered event fns are the documented stubs (fn returns void; no body side effects)", () => {
    // The body needs SQLDatabaseDriver + VirtualRecordCache + Date clock
    // (virtual_save / virtual_delete - virtual.rb:28-35); ModEventFn has
    // neither, so the bodies are stubs that return void without
    // performing the Virtual side effect (the header in card-mod-virtual.ts
    // names this seam + the WRITE PATH seam it leaves open).
    const loader = new ModLoader([{ manifest: cardModVirtual }], { ...HTML_VIEWS });
    liveLoader = loader;
    loader.load();
    const registry = loader.eventRegistry();

    const save = registry.forEvent("save_virtual_content");
    const del = registry.forEvent("delete_virtual_content");

    // The documented stub takes the card + host and does nothing
    // observable. We do not have a card or driver in scope here, so we
    // exercise the same fns the registry holds via the same exported
    // symbols the loader registered (object identity proves the wiring).
    const fakeCard = { name: "Probe" };
    const fakeHost = {
      fetchRenderCard: () => undefined,
      isDenied: () => false,
      batch: async () => [],
      codenames: { ensureLoaded: async () => undefined, peekId: () => undefined },
      fetchById: async () => undefined,
      cacheFetchedRecord: async () => undefined,
    } as never; // structural - ModEngineHost's full surface unused
    expect(() => save?.fn(fakeCard, fakeHost)).not.toThrow();
    expect(() => del?.fn(fakeCard, fakeHost)).not.toThrow();
  });

  it("reset() drops both events from the registry (loader round-trip)", () => {
    const loader = new ModLoader([{ manifest: cardModVirtual }], { ...HTML_VIEWS });
    liveLoader = loader;
    const report = loader.load();
    expect(report.registeredEvents).toEqual([
      "save_virtual_content",
      "delete_virtual_content",
    ]);
    loader.reset();
    expect(loader.eventRegistry().size()).toBe(0);
    expect(loader.eventRegistry().all()).toEqual([]);
    expect(loader.eventRegistry().forStage("prepare_to_store")).toEqual([]);
    expect(loader.eventRegistry().forEvent("save_virtual_content")).toBeUndefined();

    // a fresh load() reproduces the same registrations (idempotence).
    const rep2 = loader.load();
    expect(rep2.registeredEvents).toEqual([
      "save_virtual_content",
      "delete_virtual_content",
    ]);
    expect(loader.eventRegistry().size()).toBe(2);
  });
});

describe("card-mod-virtual: virtual.rb key derivation (left_id/right_id)", () => {
  it("simple cards key on their own id and the -2 right sentinel (virtual.rb:74-88)", () => {
    const card = SIMPLE();
    expect(virtualLeftId(card)).toBe(75); // :78 the else branch (card.id)
    expect(virtualRightId(card)).toBe(-2); // :86 the else branch
  });

  it("compound cards pass positive stored ids through (virtual.rb:75-76, 83-84)", () => {
    const card = COMPOUND();
    expect(virtualLeftId(card)).toBe(10);
    expect(virtualRightId(card)).toBe(20);
  });

  it("non-positive stored ids fall to the side cards (virtual.rb:76,84 `card.left&.id`)", () => {
    const card = cardRecord({
      key: "x",
      name: DeckoName.parse("Jane Doe+Books"),
      leftId: 0, // not positive -> left&.id
      rightId: -1, // not positive -> right&.id
    });
    expect(virtualLeftId(card, { leftCardId: 10 })).toBe(10);
    expect(virtualRightId(card, { rightCardId: 20 })).toBe(20);
    expect(virtualLeftId(card)).toBeUndefined(); // nil left card stays nil
  });
});

describe("card-mod-virtual: virtual.rb validate_card (virtual.rb:90-104)", () => {
  it("raises with the card NAME as the message and the descriptive text in the backtrace slot", () => {
    // Ruby's 3-arg Kernel#raise: raise Card::Error, card.name, "count not
    // cacheable: ..." (virtual.rb:103) - message = the name (a String is
    // not a Card, so Card::Error#initialize keeps it verbatim,
    // lib/card/error.rb:21-26), descriptive string = backtrace arg.
    const card = cardRecord({ key: "orphan+child", name: DeckoName.parse("Orphan+Child") });
    expect(() => validateVirtualCard(card)).toThrow(VirtualCardError);
    try {
      validateVirtualCard(card);
      expect.unreachable("validate_card should have raised");
    } catch (e) {
      const err = e as VirtualCardError;
      expect(err.message).toBe("Orphan+Child"); // raise arg 2
      expect(err.cardName).toBe("Orphan+Child");
      expect(err.backtraceText).toBe("count not cacheable: card Orphan+Child needs left_id");
    }
  });

  it("checks left_id before right_id on compound cards (virtual.rb:92-97)", () => {
    const card = cardRecord({
      key: "x",
      name: DeckoName.parse("Jane Doe+Books"),
      leftId: 10,
      // right id missing entirely
    });
    expect(() => validateVirtualCard(card)).toThrow(VirtualCardError);
    try {
      validateVirtualCard(card);
    } catch (e) {
      expect((e as VirtualCardError).backtraceText).toBe(
        "count not cacheable: card Jane Doe+Books needs right_id",
      );
    }
  });

  it("needs id on simple cards without one (virtual.rb:98-99)", () => {
    const card = SIMPLE();
    card.id = undefined;
    expect(() => validateVirtualCard(card)).toThrow(VirtualCardError);
    try {
      validateVirtualCard(card);
    } catch (e) {
      expect((e as VirtualCardError).backtraceText).toBe("count not cacheable: card Caesar needs id");
    }
  });

  it("valid cards pass (virtual.rb:101 return unless reason)", () => {
    expect(() => validateVirtualCard(SIMPLE())).not.toThrow();
    expect(() => validateVirtualCard(COMPOUND())).not.toThrow();
  });
});

describe("card-mod-virtual: Virtual.save / fetch / delete against storage", () => {
  it("save on a simple card INSERTs left_id=id, right_id=-2, NULL left_key (virtual.rb:52-58)", async () => {
    const { storage, clock, cache } = freshFixture();
    const saved = await virtualSave(storage.driver, SIMPLE(), cache, clock());

    expect(saved).toMatchObject({
      left_id: 75,
      right_id: -2,
      left_key: null, // simple names have no left_key
      content: "the content",
      updated_at: STAMP_1,
    });
    const rows = virtualRows(storage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ left_id: 75, right_id: -2, left_key: null, content: "the content" });
    expect(cache.has("caesar")).toBe(true); // cached under card.key (virtual.rb:29)
  });

  it("save on a compound card INSERTs its side ids and the left part's key (virtual.rb:54-56)", async () => {
    const { storage, clock, cache } = freshFixture();
    const saved = await virtualSave(storage.driver, COMPOUND(), cache, clock());
    expect(saved).toMatchObject({
      left_id: 10,
      right_id: 20,
      left_key: "jane_doe", // card.name.left_key (virtual.rb:56)
      content: "junction content",
    });
  });

  it("re-saving changed content UPDATEs content+updated_at; same content only touches (virtual.rb:8-11,43-50)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    await virtualSave(storage.driver, card, cache, clock()); // create, STAMP_1

    // Re-save with UNCHANGED content: create_or_update finds the row and
    // Virtual#update takes the touch branch (content == new_content).
    await virtualSave(storage.driver, card, cache, clock());
    let rows = virtualRows(storage);
    expect(rows).toHaveLength(1); // updated in place, no second row
    expect(rows[0]).toMatchObject({ content: "the content", updated_at: STAMP_2 });

    card.dbContent = "changed content";
    await virtualSave(storage.driver, card, cache, clock());
    rows = virtualRows(storage);
    expect(rows[0]).toMatchObject({ content: "changed content", updated_at: STAMP_3 });
  });

  it("fetch answers from the temp cache ahead of the db (cache.rb:8-11 doc, temporary.rb:47-50)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    await virtualSave(storage.driver, card, cache, clock());

    // Tamper UNDERNEATH the cache: the temp cache is "ahead of the
    // database" (lib/card/cache.rb:8-11), so the cached row still answers.
    storage.exec("UPDATE card_virtuals SET content = 'tampered' WHERE left_id = 75");
    const fetched = await virtualFetch(storage.driver, card, cache, clock());
    expect(fetched.content).toBe("the content");
  });

  it("fetch on a card with no row CREATES it (virtual.rb:24 find_by_card || create)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    const fetched = await virtualFetch(storage.driver, card, cache, clock());
    expect(fetched.content).toBe("the content");
    expect(virtualRows(storage)).toHaveLength(1); // materialized by the read
  });

  it("find_by_card resolves through the left_key branch when left_id is unresolvable (virtual.rb:64-72)", async () => {
    const { storage, clock, cache } = freshFixture();
    // A row stored under the left_key branch's shape: NULL left_id.
    storage.exec(
      "INSERT INTO card_virtuals (left_id, right_id, left_key, content, updated_at) VALUES (NULL, 20, 'jane_doe', 'legacy row', ?)",
      [STAMP_1],
    );
    // Compound card with NO resolvable left id: where_card falls to
    // left_key = card.name.left_key ("jane_doe") + right_id 20.
    const card = cardRecord({
      key: "jane_doe+books",
      name: DeckoName.parse("Jane Doe+Books"),
      leftId: undefined,
      rightId: 20,
    });
    const found = await findVirtualByCard(storage.driver, card);
    expect(found?.content).toBe("legacy row");

    // And fetch ADOPTS that row instead of creating a duplicate.
    const fetched = await virtualFetch(storage.driver, card, cache, clock());
    expect(fetched.id).toBe(found?.id);
    expect(virtualRows(storage)).toHaveLength(1);
  });

  it("delete drops the cache entry and the row (virtual.rb:32-35)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    await virtualSave(storage.driver, card, cache, clock());
    expect(virtualRows(storage)).toHaveLength(1);

    await virtualDelete(storage.driver, card, cache);
    expect(virtualRows(storage)).toHaveLength(0); // row gone
    expect(cache.has("caesar")).toBe(false); // cache entry gone (virtual.rb:33)

    // Deleting again is a no-op (`find_by_card&.delete` - virtual.rb:34).
    await expect(virtualDelete(storage.driver, card, cache)).resolves.toBeUndefined();
  });

  it("record-level update: same content touches only, changed content writes both (virtual.rb:8-11)", async () => {
    const { storage, clock } = freshFixture();
    const SEEDED_STAMP = "2026-09-21 11:59:00.000";
    storage.exec(
      "INSERT INTO card_virtuals (left_id, right_id, left_key, content, updated_at) VALUES (75, -2, NULL, 'same', ?)",
      [SEEDED_STAMP],
    );
    const row = (await findVirtualByCard(storage.driver, SIMPLE()))!;

    await virtualRecordUpdate(storage.driver, row, "same", clock()); // touch
    let rows = virtualRows(storage);
    expect(rows[0]).toMatchObject({ content: "same", updated_at: STAMP_1 }); // stamp moved, content kept

    await virtualRecordUpdate(storage.driver, row, "different", clock()); // update!
    rows = virtualRows(storage);
    expect(rows[0]).toMatchObject({ content: "different", updated_at: STAMP_2 });
    expect(row.content).toBe("different"); // update! assigns the attribute
    // both paths return the new content (virtual.rb:10)
    await expect(virtualRecordUpdate(storage.driver, row, "different", clock())).resolves.toBe("different");
  });
});

describe("card-mod-virtual: Virtual#cardname / #card_id (virtual.rb:13-19)", () => {
  it("composes the side ids' names through Card::Name.compose", () => {
    const row = {
      id: 1,
      left_id: 10,
      right_id: 20,
      content: null,
      left_key: null,
      updated_at: null,
    };
    const name = virtualRowCardname(row, NAME_OF_ID);
    expect(name?.s).toBe("Jane Doe+Books"); // [left_id, right_id].cardname
  });

  it("hands the composed mark to the Card.fetch analog and returns its result (virtual.rb:13-15)", () => {
    const row = { id: 1, left_id: 10, right_id: 20, content: null, left_key: null, updated_at: null };
    const composed = virtualRowCardname(row, NAME_OF_ID)!;
    // The mark passed to the fetcher IS the composed cardname (Card.fetch's
    // mark, lib/card/mark.rb:20-23); compared by identity below.
    expect(
      virtualRowCardId(row, (name) => (name === composed ? { cardId: 33 } : undefined), NAME_OF_ID),
    ).toEqual({ cardId: 33 });
    expect(virtualRowCardId(row, () => undefined, NAME_OF_ID)).toBeUndefined();
  });

  it("a row without both side ids has no cardname", () => {
    const row = { id: 1, left_id: 10, right_id: null, content: null, left_key: null, updated_at: null };
    expect(virtualRowCardname(row, NAME_OF_ID)).toBeUndefined();
  });
});

describe("card-mod-virtual: the abstract virtual_cache set module", () => {
  it("virtual? is new? (virtual_cache.rb:3-5; states.rb#new?)", () => {
    const fresh = SIMPLE();
    fresh.isNew = true; // new_record?
    expect(isVirtualCard(fresh)).toBe(true);
    expect(isVirtualCard({ ...fresh, fromTrash: true })).toBe(true); // revived-from-trash counts
    expect(isVirtualCard({ ...fresh, isNew: false })).toBe(false); // saved card
    expect(isVirtualCard({ ...fresh, isNew: true, trash: true })).toBe(false); // trashed is not new?
  });

  it("virtual_content is the PENDING db_content attribute (virtual_cache.rb:9-11)", () => {
    expect(virtualContent(SIMPLE())).toBe("the content");
    expect(virtualContent(cardRecord({ key: "x", name: DeckoName.parse("X") }))).toBeUndefined();
  });

  it("db_content override materializes the row and answers the cached content (virtual_cache.rb:13-15)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    // First read: no row exists -> fetch CREATES it (the read materializes).
    await expect(virtualDbContent(storage.driver, card, cache, clock())).resolves.toBe("the content");
    expect(virtualRows(storage)).toHaveLength(1);

    // A later save flows into the same read.
    card.dbContent = "newer content";
    await virtualSave(storage.driver, card, cache, clock());
    await expect(virtualDbContent(storage.driver, card, cache, clock())).resolves.toBe("newer content");
  });

  it("updated_at override answers the CACHED row's stamp (virtual_cache.rb:17-19)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    await expect(virtualUpdatedAt(storage.driver, card, cache, clock())).resolves.toBe(STAMP_1);
    // Second read: a cache HIT (no clock tick, no re-query) - and NOT the
    // cards row's stamp, the card_virtuals row's (virtual_cache.rb:17-19).
    await expect(virtualUpdatedAt(storage.driver, card, cache, clock())).resolves.toBe(STAMP_1);
  });

  it("save_virtual_content event body saves then returns the abort :success marker (virtual_cache.rb:21-24)", async () => {
    const { storage, clock, cache } = freshFixture();
    await expect(saveVirtualContent(storage.driver, SIMPLE(), cache, clock())).resolves.toBe("success");
    expect(virtualRows(storage)).toHaveLength(1); // the Virtual side effect ran
  });

  it("delete_virtual_content aborts (marker) only on unreal cards (virtual_cache.rb:26-29)", async () => {
    const { storage, clock, cache } = freshFixture();
    const card = SIMPLE();
    card.isNew = true; // unreal (new?) -> abort :success unless real?
    await virtualSave(storage.driver, card, cache, clock());
    await expect(deleteVirtualContent(storage.driver, card, cache)).resolves.toBe("success");
    expect(virtualRows(storage)).toHaveLength(0); // Virtual.delete ran first

    const real = SIMPLE(); // isNew false -> real -> NO abort
    await virtualSave(storage.driver, real, cache, clock());
    await expect(deleteVirtualContent(storage.driver, real, cache)).resolves.toBeUndefined();
    expect(virtualRows(storage)).toHaveLength(0); // row still deleted
  });
});

describe("card-mod-virtual: delete/delete! are update trash: true (virtual_cache.rb:43-51)", () => {
  it("delete delegates to the write path's trash save and flips the row (virtual_cache.rb:43-46)", async () => {
    const { storage } = freshFixture();
    const clock = tickClock();
    const writer = new ActWriter({ driver: storage.driver, actorId: 7, ipAddress: "203.0.113.9", now: clock });
    storage.exec(
      "INSERT INTO cards (id, name, key, created_at, updated_at, creator_id, updater_id, trash, type_id, db_content) " +
        "VALUES (301, 'Virtual Delete Probe', 'virtual_delete_probe', ?, ?, 7, 7, 0, 2, 'body')",
      [STAMP_1, STAMP_1],
    );
    const before = cardFieldStateFromRow(
      storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = 301") as CardsRow,
    );
    const saved = await virtualDeleteCard(writer, { cardId: 301, before });
    expect(saved).not.toBeNull(); // update succeeded
    expect((await storage.driver.query<{ trash: number }>("SELECT trash FROM cards WHERE id = 301", [])).rows[0]?.trash).toBe(1);
    // the trash flip is a :delete action (write-path trashCard -> identify_action)
    expect((await storage.driver.query<{ action_type: number }>("SELECT action_type FROM card_actions WHERE card_id = 301", [])).rows[0]?.action_type).toBe(2);
  });

  it("delete! raises where update! would (virtual_cache.rb:48-51 - no-op save)", async () => {
    const { storage } = freshFixture();
    const clock = tickClock();
    const writer = new ActWriter({ driver: storage.driver, actorId: 7, ipAddress: "203.0.113.9", now: clock });
    storage.exec(
      "INSERT INTO cards (id, name, key, created_at, updated_at, creator_id, updater_id, trash, type_id, db_content) " +
        "VALUES (302, 'Already Trashed Probe', 'already_trashed_probe', ?, ?, 7, 7, 1, 2, 'body')",
      [STAMP_1, STAMP_1],
    );
    const before = cardFieldStateFromRow(
      storage.selectOne<CardsRow>("SELECT * FROM cards WHERE id = 302") as CardsRow,
    );
    // trash: true on an already-trashed card is a no-op save -> update! raises
    await expect(virtualDeleteCardBang(writer, { cardId: 302, before })).rejects.toThrow(
      "Failed to save the record",
    );
  });
});
