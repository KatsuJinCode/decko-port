// Tests for the fetch/cache layer port (src/card/fetch.ts + src/card/fetch/*
// <- card-1.110.0 lib/card/fetch.rb, lib/card/fetch/**, lib/card/cache/**)
// against real SQLite storage seeded with plain row INSERTs. Every
// expectation cites the Ruby source it derives from.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFetchTestStorage,
  seedCard,
  type FetchTestStorage,
} from "./fetch-test-storage.js";
import { FetchEngine, isCardValue, type CardRecord, type FetchOptions } from "../../../src/card/fetch.js";
import type { SharedCacheStore } from "../../../src/card/fetch/cache.js";
import { DeckoName } from "../../../src/card/name.js";
import {
  CodenameNotFoundError,
  NameNotFoundError,
} from "../../../src/card/name/errors.js";

function mapStore(): SharedCacheStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    read: (key) => map.get(key),
    write: (key, value) => map.set(key, value),
    delete: (key) => map.delete(key),
    exist: (key) => map.has(key),
  };
}

let storage: FetchTestStorage;
let engine: FetchTestStorage["engine"];

beforeEach(async () => {
  storage = await createFetchTestStorage();
  engine = storage.engine;
});

afterEach(() => {
  storage.close();
});

/** The standard seed: two type cards, a junction pair, and a trashed card. */
async function seedStandardDeck(): Promise<void> {
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 5, name: "Search Type", typeId: 2 });
  await seedCard(storage, { id: 10, name: "Home Page", dbContent: "the home content" });
  await seedCard(storage, { id: 20, name: "Search", typeId: 5 });
  await seedCard(storage, { id: 21, name: "Home Page+search", leftId: 10, rightId: 20, dbContent: "junction content" });
  await seedCard(storage, { id: 30, name: "Ghost Card", dbContent: "gone", trash: true });
}

describe("hit / hit-cache / miss (fetch.rb#retrieve_or_new)", () => {
  it("hits the db and composes the record (retrieve.rb#retrieve_from_db)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Home Page");
    expect(card).toBeDefined();
    expect(card!.id).toBe(10);
    expect(card!.name?.s).toBe("Home Page");
    expect(card!.key).toBe("home_page");
    expect(card!.dbContent).toBe("the home content");
    expect(card!.trash).toBe(false);
    expect(card!.isNew).toBe(false);
    // first fetch went to the db
    expect(storage.counting.queries).toBeGreaterThan(0);
  });

  it("serves the second fetch of the same name entirely from cache", async () => {
    await seedStandardDeck();
    await engine.fetchByName("Home Page");
    storage.counting.reset();
    const card = await engine.fetchByName("Home Page");
    expect(card?.id).toBe(10);
    expect(storage.counting.queries).toBe(0); // cache/card_class.rb#retrieve_from_cache
  });

  it("resolves ids through the lexicon and then the cache (retrieve_from_cache_by_id)", async () => {
    await seedStandardDeck();
    const first = await engine.fetchById(10);
    storage.counting.reset();
    const second = await engine.fetchById(10);
    expect(second?.key).toBe(first?.key);
    expect(storage.counting.queries).toBe(0); // lexicon name(10) is warm too
  });

  it("misses return nil for unknown names (retrieve.rb:22-23)", async () => {
    await seedStandardDeck();
    expect(await engine.fetchByName("Nobody Home")).toBeUndefined();
  });

  it("caches the miss as a placeholder so repeat misses skip the db (store.rb#new_for_cache)", async () => {
    await seedStandardDeck();
    await engine.fetchByName("Nobody Home");
    // the placeholder is in the cache under the key (shared.rb module doc:
    // the shared cache stores records "that have been requested but are missing")
    const placeholder = engine.retrieveFromCacheByKey("nobody_home");
    expect(placeholder?.isNew).toBe(true);
    expect(placeholder?.id).toBeUndefined();
    storage.counting.reset();
    expect(await engine.fetchByName("Nobody Home")).toBeUndefined();
    expect(storage.counting.queries).toBe(0); // served from the cached placeholder
  });

  it("fetches by all three accessors to the same card", async () => {
    await seedStandardDeck();
    const byName = await engine.fetchByName("Home Page");
    const byId = await engine.fetchById(10);
    const byKey = await engine.fetchByKey("home_page");
    expect(byId?.key).toBe("home_page");
    expect(byKey?.id).toBe(10);
    expect(byId?.name?.equals(byName!.name!)).toBe(true);
    expect(byKey?.key).toBe(byName!.key);
  });

  it("fetches compound cards by name through the lexicon's side ids", async () => {
    await seedStandardDeck();
    const junction = await engine.fetchByName("Home Page+search");
    expect(junction?.id).toBe(21);
    expect(junction?.leftId).toBe(10);
    expect(junction?.rightId).toBe(20);
    // the composed (canonical) name joins the side cards' stored names -
    // the right card is stored as "Search", so that is the canonical form;
    // the KEY is built from the canonical name
    expect(junction?.name?.s).toBe("Home Page+Search");
    expect(junction?.key).toBe("home_page+search");
  });

  it("composes multi-mark args into one name (mark.rb#id_or_name flatten + compose)", async () => {
    await seedStandardDeck();
    const card = await engine.fetch("Home Page", "search");
    expect(card?.id).toBe(21);
  });

  it("fetches by codename mark (Symbol -> Codename.id!, mark.rb:20)", async () => {
    await seedStandardDeck();
    const viaObject = await engine.fetch({ codename: "basic" });
    expect(viaObject?.id).toBe(2);
    const viaString = await engine.fetch(":basic");
    expect(viaString?.id).toBe(2);
  });
});

describe("hard vs soft failure marks (name.rb#bad_mark, codename.rb#id!)", () => {
  it("unknown names are a SOFT failure: nil (fetch never raises for unknown names)", async () => {
    await seedStandardDeck();
    expect(await engine.fetchByName("Missing")).toBeUndefined();
  });

  it("unknown ~id marks raise NotFound (Name.id_from_string! -> bad_mark, name.rb:104-106)", async () => {
    await seedStandardDeck();
    await expect(engine.fetch("~9999")).rejects.toThrow(NameNotFoundError);
    await expect(engine.fetch("~9999")).rejects.toThrow("id doesn't exist: 9999");
  });

  it("unknown codename marks raise CodenameNotFound (Codename.id!, codename.rb:89-91)", async () => {
    await seedStandardDeck();
    await expect(engine.fetch(":nope")).rejects.toThrow(CodenameNotFoundError);
    await expect(engine.fetch(":nope")).rejects.toThrow("codename doesn't exist: nope");
  });

  it("out-of-range ids return a placeholder card named per the rescue (fetch.rb:34-36)", async () => {
    await seedStandardDeck();
    const card = await engine.fetch("~99999999999999999999999");
    expect(card?.isNew).toBe(true);
    expect(card?.name?.s).toBe("card id out of range: 99999999999999999999999");
  });

  it("rejects new: opts together with skip_virtual (fetch.rb:43-47 validate_opts!)", async () => {
    await seedStandardDeck();
    await expect(
      engine.fetchWithOptions(["Home Page"], { new: {}, skipVirtual: true }),
    ).rejects.toThrow("fetch called with new args and skip_virtual");
  });
});

describe("trash exclusion (retrieve.rb#retrieval_from_db_query)", () => {
  it("excludes trashed cards from name lookups (query[:trash] = false)", async () => {
    await seedStandardDeck();
    expect(await engine.fetchByName("Ghost Card")).toBeUndefined();
  });

  it("excludes trashed cards from id lookups", async () => {
    await seedStandardDeck();
    expect(await engine.fetchById(30)).toBeUndefined();
  });

  it("look_in_trash returns the trashed card object (fetch.rb:49-51)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Ghost Card", { lookInTrash: true });
    expect(card?.id).toBe(30);
    expect(card?.trash).toBe(true);
  });

  it("look_in_trash drops cached new? placeholders to read the db version (retrieve.rb:15-17)", async () => {
    await seedStandardDeck();
    await engine.fetchByName("Never Existed"); // placeholder cached
    // now look_in_trash must NOT serve the cached placeholder: it goes to db
    expect(await engine.fetchByName("Never Existed", { lookInTrash: true })).toBeUndefined();
    // and the placeholder is still cached for non-trash lookups
    expect(engine.retrieveFromCacheByKey("never_existed")?.isNew).toBe(true);
  });

  it("compound fetches whose side card is trashed resolve to nil (lexicon side lookup is trash:false)", async () => {
    await seedCard(storage, { id: 10, name: "Left Part" });
    await seedCard(storage, { id: 11, name: "Doomed Right", trash: true });
    await seedCard(storage, { id: 12, name: "Left Part+Doomed Right", leftId: 10, rightId: 11 });
    expect(await storage.engine.fetchByName("Left Part+Doomed Right")).toBeUndefined();
  });
});

describe("row composition (the table -> attribute map)", () => {
  it("reads simple names from the column (name/all.rb#name: left_id ? lexicon : column)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Home Page");
    expect(card?.name?.s).toBe("Home Page");
  });

  it("composes compound names via the lexicon, not the (NULL) column (name/all.rb:13)", async () => {
    await seedStandardDeck();
    const junction = await engine.fetchById(21);
    // composed from the side cards' stored names: "Home Page" + "Search"
    expect(junction?.name?.s).toBe("Home Page+Search");
    expect(junction?.key).toBe("home_page+search");
    const row = await storage.selectOne<{ name: string | null; key: string | null }>(
      "SELECT name, key FROM cards WHERE id = 21",
    );
    expect(row?.name).toBeNull(); // the 2020-migration convention: compound columns are NULL
    expect(row?.key).toBeNull();
  });

  it("resolves the type card's name through fetch (type.rb#type_name quick_fetch(type_id)&.name)", async () => {
    await seedStandardDeck();
    const search = await engine.fetchByName("Search");
    expect(search?.typeId).toBe(5);
    // the type CARD itself fetches fine
    const typeCard = await engine.fetchById(5);
    expect(typeCard?.name?.s).toBe("Search Type");
  });

  it("card_actions/card_changes do not participate in fetch composition", async () => {
    await seedStandardDeck();
    // history rows exist for the card but the fetch ignores them entirely:
    // composition reads cards columns only (card-mod-history lib/card/action.rb)
    await storage.driver.query(
      `INSERT INTO card_acts (id, card_id, actor_id, acted_at, ip_address)
       VALUES (1, 10, 1, '2026-09-19 00:00:00.000', '127.0.0.1')`,
      [],
    );
    await storage.driver.query(
      `INSERT INTO card_actions (id, card_id, card_act_id, action_type, draft)
       VALUES (1, 10, 1, 1, 0)`,
      [],
    );
    await storage.driver.query(
      `INSERT INTO card_changes (id, card_action_id, field, value)
       VALUES (1, 1, 2, 'HISTORY content, not current content')`,
      [],
    );
    const card = await engine.fetchByName("Home Page");
    expect(card?.dbContent).toBe("the home content"); // cards.db_content, not the change
  });
});

describe("fetch cache scoping and writes (cache/card_class.rb#write_to_cache)", () => {
  it("writes fetched cards to the cache under their KEY (write_to_cache: cache.write card.key, card)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Home Page");
    const cached = engine.retrieveFromCacheByKey("home_page");
    expect(cached?.id).toBe(card?.id);
  });

  it("scopes reads temp-first then shared; local_only reads temp only", async () => {
    // lib/card/cache.rb: temp is request-local, shared is cross-process;
    // retrieve_from_cache(local_only) reads cache.temp.read ONLY
    // (cache/card_class.rb:13-15) and write_to_cache(local_only) writes
    // temp only (cache/card_class.rb:28-30).
    const store = mapStore();
    const first = await createFetchTestStorage({ sharedStore: store });
    try {
      await seedCard(first, { id: 10, name: "Home Page" });
      const second = new FetchEngine(first.counting, { sharedStore: store });

      await first.engine.fetchByName("Home Page"); // writes temp1 AND shared
      first.counting.reset();

      // engine2 has an empty temp but sees the shared entry
      expect((await second.fetchByName("Home Page"))?.id).toBe(10);
      expect(first.counting.queries).toBe(0); // served from the shared cache

      // local_only bypasses the shared level: a THIRD engine with an empty
      // temp must go all the way to the db
      const third = new FetchEngine(first.counting, { sharedStore: store });
      expect((await third.fetchByName("Home Page", { localOnly: true }))?.id).toBe(10);
      expect(first.counting.queries).toBeGreaterThan(0);
    } finally {
      first.close();
    }
  });

  it("local_only fetches write the temp cache only (write_to_cache local_only)", async () => {
    const store = mapStore();
    const first = await createFetchTestStorage({ sharedStore: store });
    try {
      await seedCard(first, { id: 10, name: "Home Page" });
      const sharedKeys = () => [...store.map.keys()].filter((k) => k.endsWith("/home_page"));
      expect(sharedKeys()).toHaveLength(0);
      await first.engine.fetchByName("Home Page", { localOnly: true });
      expect(sharedKeys()).toHaveLength(0); // nothing reached the shared level
      expect(first.engine.retrieveFromCacheByKey("home_page", true)?.id).toBe(10);
    } finally {
      first.close();
    }
  });

  it("uncacheable cards never enter the cache (store.rb:13 !card&.uncacheable?)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Home Page");
    expect(card).toBeDefined();
    engine.expireName("Home Page");
    // the guard lives in store.rb#update_cache? - exercise it through the
    // private hook (the write path is what sets @uncacheable in Ruby)
    card!.uncacheable = true;
    (
      engine as unknown as {
        storeCard: (card: CardRecord, opts: FetchOptions) => void;
      }
    ).storeCard(card!, {});
    expect(engine.retrieveFromCacheByKey("home_page")).toBeUndefined();
  });
});

describe("cache invalidation (cache/all.rb#expire)", () => {
  it("expireName drops the cached card so the next fetch re-reads the db", async () => {
    await seedStandardDeck();
    await engine.fetchByName("Home Page");
    // simulate a write-path change behind the cache's back
    await storage.driver.query("UPDATE cards SET db_content = 'updated content' WHERE id = 10", []);
    expect((await engine.fetchByName("Home Page"))?.dbContent).toBe("the home content"); // stale
    engine.expireName("Home Page"); // cache/card_class.rb#expire
    expect((await engine.fetchByName("Home Page"))?.dbContent).toBe("updated content");
  });

  it("expireCard deletes both key versions (name + nameBeforeAct, cache/all.rb:104-108)", async () => {
    await seedStandardDeck();
    const card = (await engine.fetchByName("Home Page"))!;
    // a rename leaves the OLD key version in the cache (write-path behavior)
    engine.cardCache.write("old_name", card);
    card.nameBeforeAct = DeckoName.parse("Old Name");
    engine.expireCard(card);
    expect(engine.retrieveFromCacheByKey("home_page")).toBeUndefined();
    expect(engine.retrieveFromCacheByKey("old_name")).toBeUndefined();
  });

  it("expireCard deletes the legacy '~id' key too (cache/all.rb#expire_id id_string)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Home Page");
    engine.cardCache.write("~10", "some-legacy-entry");
    engine.expireCard(card!);
    expect(engine.cardCache.read("~10")).toBeUndefined();
  });

  it("expiring a compound card expires its LEFT card recursively (cache/all.rb#expire_left)", async () => {
    await seedStandardDeck();
    await engine.fetchByName("Home Page");
    await engine.fetchByName("Home Page+search");
    expect(engine.retrieveFromCacheByKey("home_page")).toBeDefined();
    const junction = (await engine.fetchByName("Home Page+search"))!;
    engine.expireCard(junction);
    expect(engine.retrieveFromCacheByKey("home_page+search")).toBeUndefined();
    expect(engine.retrieveFromCacheByKey("home_page")).toBeUndefined(); // left card expired too
  });
});

describe("fetch-with-new results (results.rb, the fetch side of fetch-or-new)", () => {
  it("new: {} returns a placeholder card for unknown names (new_result_card)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Brand New", { new: {} });
    expect(card).toBeDefined();
    expect(card!.isNew).toBe(true);
    expect(card!.id).toBeUndefined();
    expect(card!.name?.s).toBe("Brand New");
    expect(card!.key).toBe("brand_new");
  });

  it("the placeholder is cached while the returned card is a distinct dup (renew dups, store.rb vs results.rb)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchByName("Brand New", { new: {} });
    const cached = engine.retrieveFromCacheByKey("brand_new");
    expect(cached?.isNew).toBe(true);
    void card;
  });

  it("without new opts, the same fetch returns nil (results.rb:21 card.known?)", async () => {
    await seedStandardDeck();
    expect(await engine.fetchByName("Brand New")).toBeUndefined();
  });

  it("skip_virtual returns nil for new cards (results.rb:28-30)", async () => {
    await seedStandardDeck();
    expect(await engine.fetchByName("Brand New", { skipVirtual: true })).toBeUndefined();
  });

  it("Card[] is skip_virtual fetch (card_class.rb:42-44)", async () => {
    await seedStandardDeck();
    expect((await engine.bracket("Home Page"))?.id).toBe(10);
    expect(await engine.bracket("Brand New")).toBeUndefined();
  });

  it("quick_fetch combines skip_virtual and skip_modules (card_class.rb:54-56)", async () => {
    await seedStandardDeck();
    expect((await engine.quickFetch("Home Page"))?.id).toBe(10);
  });

  it("eager_cache merges type attrs into the placeholder (store.rb:30-32)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchWithOptions(["Eager Card"], {
      eagerCache: true,
      new: { typeId: 3 },
    });
    expect(card?.typeId).toBe(3);
  });
});

describe("blank marks (retrieve.rb:7 present? guard, store.rb:48-50 reusable?)", () => {
  it("fetching a blank name returns nil and caches no placeholder", async () => {
    await seedStandardDeck();
    expect(await engine.fetchByName("")).toBeUndefined();
    expect(engine.retrieveFromCacheByKey("")).toBeUndefined();
  });

  it("a blank name with new opts still yields a placeholder (reusable? allows it)", async () => {
    await seedStandardDeck();
    const card = await engine.fetchWithOptions([""], { new: {} });
    expect(card?.isNew).toBe(true);
  });
});

describe("attribute fetchers (card_class.rb:71-94)", () => {
  it("cardId: integers pass through, names resolve via lexicon (Card.id)", async () => {
    await seedStandardDeck();
    expect(await engine.cardId(10)).toBe(10);
    expect(await engine.cardId("Home Page")).toBe(10);
    expect(await engine.cardId({ codename: "basic" })).toBe(2);
    expect(await engine.cardId("Missing Forever")).toBeUndefined();
  });

  it("fetchTypeId returns the type_id (fetch_type_id, card_class.rb:92-94)", async () => {
    await seedStandardDeck();
    expect(await engine.fetchTypeId("Home Page")).toBe(2);
  });
});

describe("cache value typing", () => {
  it("isCardValue distinguishes card records from other cache values", () => {
    expect(isCardValue({ key: "a", typeId: 1, trash: false })).toBe(true);
    expect(isCardValue({ key: "a" })).toBe(false);
    expect(isCardValue("string")).toBe(false);
    expect(isCardValue(null)).toBe(false);
  });
});
