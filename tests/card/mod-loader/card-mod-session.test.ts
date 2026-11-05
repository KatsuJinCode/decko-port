

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

  await seedCard(s, { id: 5, name: "Cardtype" });

  await seedCard(s, { id: 80, name: "Session", codename: "session", typeId: 5 });

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

    viewsKeysBeforeLoad = Object.keys(HTML_VIEWS);
  });

  it("WITH the mod load: both gem set modules land in the basket in the right buckets (loader.ts phase 2)", async () => {
    const s = storage!;
    loader = loader ?? new ModLoader([{ manifest: cardModSession }]);
    report = loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const base = loader.setModules().base.find((m) => m.shortname === "All::LocationHistory");
    expect(base).toBeDefined();
    expect(base?.kind).toBe("base");
    expect(base?.modName).toBe("session");

    const nonbaseLists = [...loader.setModules().nonbase.values()].flat();
    const session = nonbaseLists.find((m) => m.shortname === "Type::Session");
    expect(session).toBeDefined();
    expect(session?.kind).toBe("nonbase");
    expect(session?.modName).toBe("session");

    expect(report.registeredSetModules).toContain("All::LocationHistory");
    expect(report.registeredSetModules).toContain("Type::Session");
  });

  it("WITH the mod load: the mod registers ZERO views (compat htmlViewsDeclared: 0) and the views record is unchanged", () => {

    expect(report!.registeredViews).toEqual([]);

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

    const cardKey = DeckoName.parse("Test Session Card").key;
    expect(cardKey).toBe("test_session_card");
    expect(sessionKey(cardKey)).toBe("_card_test_session_card");
  });

  it("set/type/session.rb:55-57 add_to_trash merges trash: true into a NEW args hash (Hash#merge semantics)", () => {
    const args = { id: 81, skip_permissions: true };
    const merged = sessionAddToTrash(args);
    expect(merged).toEqual({ id: 81, skip_permissions: true, trash: true });

    expect(args).toEqual({ id: 81, skip_permissions: true });
  });

  it("lib/card/mod/session.rb:1-3 allow_anonymous_cookies = true", () => {
    expect(ALLOW_ANONYMOUS_COOKIES).toBe(true);
  });

  it("WITH the mod: a Session-typed card's :content render is unchanged (the mod alters no render path)", async () => {
    const s = storage!;

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
