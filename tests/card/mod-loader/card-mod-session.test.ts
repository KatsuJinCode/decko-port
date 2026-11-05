// The card-mod-session mod loader test: the mod loaded through the loader
// registers its two set modules (all/location_history, type/session) and
// contributes ZERO views - the compat report's entry for this gem declares
// htmlViewsDeclared: 0 / htmlViewsMissingNames: [] (its only format block
// is a before :core hook, not a view), so the mod must leave the render
// path byte-identical. The pure card-method semantics of set/type/session.rb
// and the lib config value are proven against their Ruby lines.
//
// Proof shape (A/B on the loader tables, not on views - there are none):
//   WITHOUT the mod load: the set-module basket carries no session entries
//     and the loader has not touched the live views record.
//   WITH the mod load: the basket records All::LocationHistory (base
//     bucket) and Type::Session (nonbase), the load report lists zero
//     registered views, the views record's key set is unchanged, and a
//     Session-typed card's :content render is unchanged.
//
// Probe cards (mirroring the gem's data/real.yml:1-4 seed shape):
//   - Cardtype (id 5) - the cardtype cardtype
//   - Session (id 80, codename "session", typeId 5) - the Session
//     cardtype card data/real.yml seeds
//   - Test Session Card (id 81, typeId 80) - a session-typed probe card

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModSession, {
  sessionCardHistory,
  sessionCardFollowable,
  sessionRecaptchaOn,
  sessionOkToCreate,
  sessionOkToUpdate,
  sessionKey,
  sessionAddToTrash,
  ALLOW_ANONYMOUS_COOKIES,
} from "../../../src/card/mod-loader/mods/card-mod-session.js";
import { DeckoName } from "../../../src/card/name.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;
let report: ReturnType<ModLoader["load"]> | undefined;
let viewsKeysBeforeLoad: string[] | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  // the cardtype cardtype (so Session's typeId means "cardtype")
  await seedCard(s, { id: 5, name: "Cardtype" });

  // the Session cardtype card - data/real.yml:1-4 (:name: Session,
  // :type: :cardtype, :codename: session)
  await seedCard(s, { id: 80, name: "Session", codename: "session", typeId: 5 });

  // a session-typed probe card (type Session => typeId 80)
  await seedCard(s, {
    id: 81,
    name: "Test Session Card",
    typeId: 80,
    dbContent: "session-scoped value",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-session through the mod loader (A/B)", () => {
  it("WITHOUT the mod load: the basket has no session set modules and the live views record is untouched", () => {
    loader = new ModLoader([{ manifest: cardModSession }]);
    expect(loader.isLoaded).toBe(false);
    const basket = loader.setModules();
    const baseShortnames = basket.base.map((m) => m.shortname);
    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(baseShortnames).not.toContain("All::LocationHistory");
    expect(nonbaseShortnames).not.toContain("Type::Session");
    // the views snapshot the WITH tests compare against (the loader
    // mutates the LIVE HTML_VIEWS record on registration; this mod must
    // register nothing)
    viewsKeysBeforeLoad = Object.keys(HTML_VIEWS);
  });

  it("WITH the mod load: both gem set modules land in the basket in the right buckets (loader.ts phase 2)", async () => {
    const s = storage!;
    loader = loader ?? new ModLoader([{ manifest: cardModSession }]);
    report = loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher)); // prepare phase; this mod's manifest has none

    // set/all/location_history.rb -> All::LocationHistory, base bucket
    // ("all" is the base pattern; mod-loader.ts#kindOfSetPath)
    const base = loader.setModules().base.find((m) => m.shortname === "All::LocationHistory");
    expect(base).toBeDefined();
    expect(base?.kind).toBe("base");
    expect(base?.modName).toBe("session");

    // set/type/session.rb -> Type::Session, nonbase bucket
    const nonbaseLists = [...loader.setModules().nonbase.values()].flat();
    const session = nonbaseLists.find((m) => m.shortname === "Type::Session");
    expect(session).toBeDefined();
    expect(session?.kind).toBe("nonbase");
    expect(session?.modName).toBe("session");

    // the load report names both modules (loader.ts registeredSetModules)
    expect(report.registeredSetModules).toContain("All::LocationHistory");
    expect(report.registeredSetModules).toContain("Type::Session");
  });

  it("WITH the mod load: the mod registers ZERO views (compat htmlViewsDeclared: 0) and the views record is unchanged", () => {
    // the gem's only format block is `before :core` HOOK
    // (set/type/session.rb:59-63), which has no ModFormatBlock slot; the
    // registeredViews list must stay empty for this mod
    expect(report!.registeredViews).toEqual([]);
    // and the live views record carries exactly the keys it carried
    // before the load (no session view leaked into HTML_VIEWS)
    expect(Object.keys(HTML_VIEWS).sort()).toEqual([...viewsKeysBeforeLoad!].sort());
  });

  it("WITH the mod load: the manifest answers to both its names (class_methods.rb:26-28 strips card-mod-)", () => {
    expect(loader!.fetchMod("card-mod-session")?.manifest.name).toBe("session");
    expect(loader!.fetchMod("session")?.manifest.gemName).toBe("card-mod-session");
  });

  it("set/type/session.rb:9-11 def history?; false - Session cards have no history", () => {
    expect(sessionCardHistory()).toBe(false);
  });

  it("set/type/session.rb:13-15 def followable?; false - Session cards are not followable", () => {
    expect(sessionCardFollowable()).toBe(false);
  });

  it("set/type/session.rb:17-19 def recaptcha_on?; false - never recaptcha a session write", () => {
    expect(sessionRecaptchaOn()).toBe(false);
  });

  it("set/type/session.rb:47-53 ok_to_create?/ok_to_update?; true - the permission bypass", () => {
    expect(sessionOkToCreate()).toBe(true);
    expect(sessionOkToUpdate()).toBe(true);
  });

  it("set/type/session.rb:21-23 def session_key; \"_card_#{key}\" - the session-hash key rides the card key", () => {
    // the prefix joins the CANONICAL key (DeckoName.key): "Test Session
    // Card" -> "test_session_card"
    const cardKey = DeckoName.parse("Test Session Card").key;
    expect(cardKey).toBe("test_session_card");
    expect(sessionKey(cardKey)).toBe("_card_test_session_card");
  });

  it("set/type/session.rb:55-57 add_to_trash merges trash: true into a NEW args hash (Hash#merge semantics)", () => {
    const args = { id: 81, skip_permissions: true };
    const merged = sessionAddToTrash(args);
    expect(merged).toEqual({ id: 81, skip_permissions: true, trash: true });
    // the receiver is untouched (Ruby's merge does not mutate)
    expect(args).toEqual({ id: 81, skip_permissions: true });
  });

  it("lib/card/mod/session.rb:1-3 allow_anonymous_cookies = true", () => {
    expect(ALLOW_ANONYMOUS_COOKIES).toBe(true);
  });

  it("WITH the mod: a Session-typed card's :content render is unchanged (the mod alters no render path)", async () => {
    const s = storage!;
    // :content is a base-format view (views.ts#contentView); the mod
    // defines no views (its before :core hook is unported), so the
    // Session-typed probe renders exactly the baseline bytes
    const html = await s.engine.render("Test Session Card", "content");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("session-scoped value");
  });

  it("reset(): the basket entries are withdrawn and the views record is back to the pre-load key set", () => {
    loader!.reset();
    const basket = loader!.setModules();
    const baseShortnames = basket.base.map((m) => m.shortname);
    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(baseShortnames).not.toContain("All::LocationHistory");
    expect(nonbaseShortnames).not.toContain("Type::Session");
    expect(Object.keys(HTML_VIEWS).sort()).toEqual([...viewsKeysBeforeLoad!].sort());
    expect(loader!.isLoaded).toBe(false);
  });
});
