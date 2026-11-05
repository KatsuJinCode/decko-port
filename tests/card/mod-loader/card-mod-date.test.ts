// card-mod-date: registration-mechanics tests for the mod port.
//
// The gem has one declared HTML view (:core) which is already implemented
// in the engine (mod-compat-report.json verdict for this gem:
// "1/1 html views in HTML_VIEWS (0/0 mod-specific)" and
// "htmlViewsMissing": []). The engine's coreView has a `typeName ===
// "Date"` branch (views.ts:186-214) that implements
// `::Date.parse(card.content).strftime "%B %-d, %Y"` via formatDateCore
// (views.ts:235-248) - byte-for-byte the same body as set/type/date.rb:6-8.
//
// What the mod's manifest contributes on top of the engine impl is the
// SET-MODULE BASKET: every .rb file from the gem tree registers as a
// set module even when the file defines no ported view. There are 5 set
// files (all/calendar, right/when_created, right/when_last_edited,
// self/now, type/date) and all 5 enter the basket. No html views are
// declared by the mod's manifest - a mod-side :core registration would
// shadow the engine's correct impl via the mod-registrar's last-wins
// rule (loader.ts:199 `views[view] = viewFn`).
//
// CONTENT OVERRIDES — set-module def content → ContentFn exports
//
// The three `def content` overrides
// (set/right/when_created.rb:7-11, set/right/when_last_edited.rb:7-11,
// set/self/now.rb:1-3) port as ContentFn exports
// (whenCreatedContentFn / whenLastEditedContentFn / nowContentFn) +
// a dateContentOverrideEntries aggregate + a wireDateContentOverrides()
// installer. The tests call wireDateContentOverrides() in beforeAll so
// the engine's :core for the right/when_created + right/when_last_edited
// virtual cards returns the formatted timestamp (the bytes Ruby
// produces) instead of "" — the engine's renderRaw
// (format.ts:605-609) consults the content-override registry BEFORE
// falling through to dbContent.
//
// The mod-loader manifest-field seam that lets the loader populate the
// registry from the manifest is owned by the coordinator stream
// (lane A's seam + the loader's SetLoader phase population); until it
// lands, tests + boot code wire the registry via the installer export.
//
// Probe cards:
//   - Oracle Date Probe (a Date-typed card whose :core view runs through
//     the engine's existing formatDateCore; the mod does NOT register
//     its own :core for type/date to avoid shadowing the engine impl)
//   - Oracle When Created Probe+when_created (junction; with the registry
//     wired, the :core renders the strftime of left.created_at via
//     whenCreatedContentFn)
//   - Oracle When Last Edited Probe+when_last_edited (junction; with the
//     registry wired, the :core renders the strftime of left.updated_at
//     via whenLastEditedContentFn)
//   - now (the *now virtual card; the engine's :core for a *setting
//     card with typeName="setting" returns "" because cardBelongsToSet
//     for self/now requires typeName==="now" — the Self pattern matches
//     cards whose own TYPE is "now", and a +type setting has
//     typeName="setting", not "now"; same dead-code verdict in Ruby
//     since the +now card is a *setting, not a cardtype)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModDate, {
  whenCreatedContentFn,
  whenLastEditedContentFn,
  nowContentFn,
  formatDayofwkMinTz,
  dateContentOverrideEntries,
  wireDateContentOverrides,
} from "../../../src/card/mod-loader/mods/card-mod-date.js";
import {
  setDefaultContentOverrideRegistry,
  contentOverrideFor,
  type ContentOverrideRegistry,
} from "../../../src/card/render/content-overrides.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;
/** The registry wired by wireDateContentOverrides(); restored to undefined
 *  in afterAll so the test isolation matches the content-overrides.test.ts
 *  suite (tests/card/render/content-overrides.test.ts:75-77). */
let dateRegistry: ContentOverrideRegistry | undefined;

beforeAll(async () => {
  // Wire the mod's content overrides before the engine starts rendering;
  // the engine's :core for the right/when_created + right/when_last_edited
  // virtual cards consults this registry via resolveContentOverride
  // (format.ts:605-609). The default-default binding is process-wide;
  // reset to undefined in afterAll.
  dateRegistry = wireDateContentOverrides();
  storage = await createRenderTestStorage();
  const s = storage;

  // codename registry seed cards (the registry's peekId reads
  // cards.codename; the type cards are referenced as the set/setting
  // join's typeId side)
  await seedCard(s, { id: 2, name: "RichText" }); // the cardtypes' type card
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  // the right-anchor phrase setting cards (the *when created /
  // *when last edited / now phrase settings; their ids are the right_id
  // side of every <X>+when_created / <X>+when_last_edited / now
  // junction row). real.yml:7-12 declares these with codenames but no
  // explicit type - phrase is the implicit default for settings.
  await seedCard(s, {
    id: 200,
    name: "when_created",
    codename: "when_created",
    typeId: 14, // phrase (setting type)
  });
  await seedCard(s, {
    id: 201,
    name: "when_last_edited",
    codename: "when_last_edited",
    typeId: 14,
  });
  await seedCard(s, {
    id: 202,
    name: "now",
    codename: "now",
    typeId: 14,
  });

  // the Date cardtype (real.yml:2-6 declares Date as a cardtype with
  // codename 'date'). The Date cardtype's row IS the codename anchor
  // for `date` (no separate *date setting card exists - the right/when_*
  // set modules' right side is a *setting card; the type/date set
  // module's anchor is the Date cardtype itself).
  await seedCard(s, {
    id: 220,
    name: "Date",
    codename: "date",
    typeId: 13, // Cardtype's own type
  });

  // Oracle When Created Probe+when_created (junction: real left).
  // The engine's :core for this virtual right card returns "" (no
  // dbContent); the mod's set-module content override is not ported
  // (engine surface gap).
  await seedCard(s, {
    id: 300,
    name: "Oracle When Created Probe",
    dbContent: "created probe body",
  });
  await seedCard(s, {
    id: 301,
    leftId: 300,
    rightId: 200, // +when_created
    typeId: 14, // setting type (junctions are setting-typed)
  });

  // Oracle When Last Edited Probe+when_last_edited (junction: real left)
  await seedCard(s, {
    id: 310,
    name: "Oracle When Last Edited Probe",
    dbContent: "edited probe body",
  });
  await seedCard(s, {
    id: 311,
    leftId: 310,
    rightId: 201, // +when last edited
    typeId: 14,
  });

  // Oracle Date Probe (a Date-typed card with valid date content; the
  // mod does NOT register its own :core for type/date - the engine's
  // coreView branch (views.ts:186) renders formatDateCore). The Date
  // typeId points to the Date cardtype card (id 220) so the engine's
  // typeName lookup yields "Date" and the typeName === "Date" branch
  // fires.
  await seedCard(s, {
    id: 330,
    name: "Oracle Date Probe",
    dbContent: "2026-03-15",
    typeId: 220,
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
  // Unbind the date content-override registry (matches
  // content-overrides.test.ts:75-77 reset semantics).
  setDefaultContentOverrideRegistry(
    undefined as unknown as ContentOverrideRegistry,
  );
  dateRegistry = undefined;
});

// ---------------------------------------------------------------------------
// the formatDayofwkMinTz helper (exported from the mod) - byte-for-byte
// shape of card-1.110.0 config/locales/en.yml:29's '%A, %B %d, %Y %I:%M %p'
// applied to a UTC stored timestamp
// ---------------------------------------------------------------------------

describe("card-mod-date formatDayofwkMinTz (en.yml:29 '%A, %B %d, %Y %I:%M %p %Z')", () => {
  it("formats the seed test timestamp '2026-09-19 00:00:00.000' as 'Saturday, September 19, 2026 12:00 AM UTC'", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );
    // 2026-09-19 is a Saturday; midnight UTC -> hour 0 in 12-hour = 12,
    // so %I='12', %p='AM'.
    const expected = "Saturday, September 19, 2026 12:00 AM UTC";
    expect(formatDayofwkMinTz(new Date("2026-09-19T00:00:00.000Z"))).toBe(expected);
  });

  it("zero-pads the day-of-month and hour (en.yml %d, %I are zero-padded)", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );
    // 2026-01-05 is a Monday at 09:05 UTC -> '%d' = '05', '%I' = '09'
    const result = formatDayofwkMinTz(new Date("2026-01-05T09:05:00.000Z"));
    expect(result).toBe("Monday, January 05, 2026 09:05 AM UTC");
  });

  it("uses PM for hours >= 12 (en.yml %p 'PM')", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );
    // 2026-01-05 14:30 UTC -> 2:30 PM
    const result = formatDayofwkMinTz(new Date("2026-01-05T14:30:00.000Z"));
    expect(result).toBe("Monday, January 05, 2026 02:30 PM UTC");
  });

  it("handles midnight correctly (00:00 UTC -> 12:00 AM, hour 12 not 0)", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );
    // Ruby's %I on hour 0 returns '12' (12 AM). The helper's
    // `hour24 % 12 === 0 ? 12 : hour24 % 12` branch handles it.
    const result = formatDayofwkMinTz(new Date("2026-06-15T00:00:00.000Z"));
    expect(result).toBe("Monday, June 15, 2026 12:00 AM UTC");
  });

  it("handles noon correctly (12:00 UTC -> 12:00 PM, not 00:00 PM)", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );
    // Ruby's %I on hour 12 returns '12' (12 PM). The helper's branch
    // `hour24 % 12 === 0 ? 12 : hour24 % 12` catches this (12 % 12 = 0
    // -> 12).
    const result = formatDayofwkMinTz(new Date("2026-06-15T12:00:00.000Z"));
    expect(result).toBe("Monday, June 15, 2026 12:00 PM UTC");
  });
});

// ---------------------------------------------------------------------------
// A/B tests for the mod's set-module basket (no view registration - the
// mod defers to the engine's :core for everything)
// ---------------------------------------------------------------------------

describe("card-mod-date through the mod loader (A/B)", () => {
  it("WITHOUT the mod: a fresh ModLoader's basket is empty before load() is called", () => {
    // The ModLoader constructor (mod-loader.ts:101-104) seeds
    // `this.views = new ViewRegistrationTable(views)` and `this.basket
    // = new SetModuleBasket()`; the basket is empty until load()
    // walks the manifest's setModules. The SetModuleBasket starts
    // empty (mod-registrar.ts:77-104) and is process-wide per loader
    // instance, NOT shared across instances.
    const blankLoader = new ModLoader([{ manifest: cardModDate }]);
    const blankShortnames = [
      ...blankLoader.setModules().base.map((m) => m.shortname),
      ...blankLoader.setModules().abstract.map((m) => m.shortname),
      ...[...blankLoader.setModules().nonbase.values()].flat().map((m) => m.shortname),
    ];
    blankLoader.load();
    expect(blankShortnames).not.toContain("All::Calendar");
    expect(blankShortnames).not.toContain("Right::WhenCreated");
    expect(blankShortnames).not.toContain("Right::WhenLastEdited");
    expect(blankShortnames).not.toContain("Self::Now");
    expect(blankShortnames).not.toContain("Type::Date");
    blankLoader.reset();
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    l.load();

    const basket = l.setModules();
    expect(basket.base.map((m) => m.shortname)).toContain("All::Calendar");
    const nonbase = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbase).toContain("Right::WhenCreated");
    expect(nonbase).toContain("Right::WhenLastEdited");
    expect(nonbase).toContain("Self::Now");
    expect(nonbase).toContain("Type::Date");
  });

  it("WITH the mod: every set module carries the modName 'date'", () => {
    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    l.load();

    const basket = l.setModules();
    const all = [
      ...basket.base,
      ...basket.abstract,
      ...[...basket.nonbase.values()].flat(),
    ];
    for (const mod of all) expect(mod.modName).toBe("date");
  });

  it("WITH the mod: load()'s registeredSetModules count is exactly 5 (every Ruby file)", () => {
    // The gem's tree has five .rb set files: all/calendar, right/when_created,
    // right/when_last_edited, self/now, type/date.
    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    const report = l.load();
    expect(report.registeredSetModules).toHaveLength(5);
    expect(report.registeredSetModules).toEqual(
      expect.arrayContaining([
        "All::Calendar",
        "Right::WhenCreated",
        "Right::WhenLastEdited",
        "Self::Now",
        "Type::Date",
      ]),
    );
  });

  it("WITH the mod: the mod registers NO views (mod-compat-report verdict 1/1 in HTML_VIEWS, 0 mod-specific)", () => {
    // The compat report's verdict for this gem is "1/1 html views in
    // HTML_VIEWS (0/0 mod-specific)" and "htmlViewsMissing": []. The
    // engine's coreView already implements every byte the gem's :core
    // view produces; the faithful move is to NOT register :core here
    // (a mod-side registration would shadow the engine's correct impl
    // via the mod-registrar's last-wins rule).
    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    const report = l.load();
    expect(report.registeredViews).toEqual([]);
  });

  it("WITH the mod: the mod's manifest name + gem name match the gem tree", () => {
    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    const report = l.load();
    expect(report.modNames).toContain("date");
  });
});

// ---------------------------------------------------------------------------
// the engine's :core for the Date cardtype - the engine-side impl the
// mod defers to
// ---------------------------------------------------------------------------

describe("WITH the mod: the engine's :core for the Date cardtype (views.ts:186-214 + formatDateCore)", () => {
  it("Oracle Date Probe's :core renders the strftime '%B %-d, %Y' format", async () => {
    // The engine's formatDateCore parses card.dbContent ('2026-03-15')
    // and emits 'March 15, 2026' (views.ts:235-248: month=long 'March',
    // day=15, year=2026). The mod's set/type/date.rb:6-8 view is the
    // exact same byte shape; the engine impl is what the test exercises.
    const s = storage!;
    const html = await s.engine.render("Oracle Date Probe", "core");
    expect(html).toBe("March 15, 2026");
  });

  it("the mod does NOT shadow the engine's :core (loader.reset() leaves it intact)", async () => {
    // If the mod registered its own :core for type/date, the
    // mod-registrar's last-wins rule (loader.ts:199) would shadow the
    // engine's correct implementation. The mod's manifest leaves the
    // :core view registration empty (mod-manifest.ts#setModules:
    // formats.html.views: []); the engine impl is the canonical view.
    // We assert that rendering 'Oracle Date Probe' :core produces the
    // strftime format (the engine impl's signature).
    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    l.load();
    const s = storage!;
    const html = await s.engine.render("Oracle Date Probe", "core");
    expect(html).toBe("March 15, 2026");
  });
});

// ---------------------------------------------------------------------------
// the engine's :core for the right/when_created / right/when_last_edited
// virtual cards — the mod's set-module content overrides ported as
// ContentFn exports, wired via the per-set content-override registry
// (content-overrides.ts + format.ts:605-609).
//
// CURRENT VERDICT (mod-loader surface limitation, see viewsMissing in the
// lane result): the engine surfaces the prefetched left card's
// `updatedAt` as the empty string (the seed row carries
// "2026-09-19 00:00:00.000", but the warmed render-card mapping does not
// surface it as a non-empty value today). The ContentFns are correct
// per the Ruby body; they defensively return "" for empty timestamps
// (the same bytes Ruby returns when left.real? is true but the stored
// timestamp is unset). Once the engine warms the left card's
// created_at / updated_at columns through its render-card mapping, the
// ContentFns will emit the formatted date string. The exports are the
// integration surface the mod-loader-stream's `contentOverrides` manifest
// field will consume once it lands.
// ---------------------------------------------------------------------------

describe("WITH the mod: the engine's :core for the right/when_created / when_last_edited virtual cards", () => {
  it("Oracle When Created Probe+when_created :core resolves through the wired registry (localized left.created_at)", async () => {
    // The render path's resolveContentOverride (format.ts:606) walks the
    // wired registry, finds the right/when_created ContentFn, calls it.
    // The ContentFn looks up the left card via fetchRenderCard and reads
    // its created_at; the prefetch walk now carries cards.created_at
    // through to the composed record, so the seeded "2026-09-19
    // 00:00:00.000" localizes through card_dayofwk_min_tz
    // (en.yml:29 '%A, %B %d, %Y %I:%M %p %Z') - the byte shape
    // when_created.rb:7-11 produces.
    const s = storage!;
    const html = await s.engine.render(
      "Oracle When Created Probe+when_created",
      "core",
    );
    expect(html).toBe("Saturday, September 19, 2026 12:00 AM UTC");
  });

  it("Oracle When Last Edited Probe+when last edited :core resolves through the wired registry (localized left.updated_at)", async () => {
    // Same shape: the right/when_last_edited ContentFn fires; the left
    // card's updated_at rides the prefetch row to the composed record,
    // so the seeded timestamp localizes (anchor-distinct from
    // when_created - cardBelongsToSet keys the right pattern on the
    // part's name key).
    const s = storage!;
    const html = await s.engine.render(
      "Oracle When Last Edited Probe+when last edited",
      "core",
    );
    expect(html).toBe("Saturday, September 19, 2026 12:00 AM UTC");
  });

  it("the 'now' card :core renders the localized render-time now (self/now matches the card named 'now' by key)", async () => {
    // Ruby's now.rb:1-3 `def content; I18n.localize(Time.now, ...); end`
    // is the source. The Self pattern's anchor is the card's OWN key
    // (08_self.rb), so the card named "now" IS in the self/now set and
    // its def content fires - the bytes are the localized wall-clock
    // instant at render time (non-deterministic by nature; the shape is
    // card_dayofwk_min_tz: '<Wday>, <Month> <D>, <YYYY> <HH>:<MM> <AM|PM> UTC').
    const s = storage!;
    const html = await s.engine.render("now", "core");
    expect(html).toMatch(
      /^[A-Za-z]+, [A-Za-z]+ \d{1,2}, \d{4} \d{2}:\d{2} (AM|PM) UTC$/,
    );
  });
});

// ---------------------------------------------------------------------------
// loader reset semantics
// ---------------------------------------------------------------------------

describe("card-mod-date loader reset", () => {
  it("loader.reset() empties the set-module basket", () => {
    const l = new ModLoader([{ manifest: cardModDate }]);
    l.load();
    expect(l.setModules().base.length).toBeGreaterThan(0);
    expect(l.setModules().nonbase.size).toBeGreaterThan(0);

    l.reset();
    expect(l.setModules().base).toEqual([]);
    expect(l.setModules().nonbase.size).toBe(0);
    loader = l;
  });

  it("loader.reset() leaves the engine's :core untouched (the mod did not register one)", async () => {
    // The mod registers no views; reset() removes the basket
    // registrations but the engine's :core view stays the same.
    // Oracle Date Probe :core renders 'March 15, 2026' both before
    // and after the mod's load+reset cycle.
    const l = new ModLoader([{ manifest: cardModDate }]);
    l.load();
    const s = storage!;
    const beforeReset = await s.engine.render("Oracle Date Probe", "core");
    expect(beforeReset).toBe("March 15, 2026");

    l.reset();
    const afterReset = await s.engine.render("Oracle Date Probe", "core");
    expect(afterReset).toBe("March 15, 2026");
    loader = l;
  });
});

// ---------------------------------------------------------------------------
// the ContentFn exports — the per-set content overrides the mod loader
// (once the coordinator's manifest-field seam is in place) reads from the
// manifest. Each export is byte-equivalent to the Ruby `def content` body
// cited in the header of each export in card-mod-date.ts.
// ---------------------------------------------------------------------------

describe("card-mod-date ContentFn exports (set-module def content ports)", () => {
  it("dateContentOverrideEntries exports the three gem-tree overrides in setPath order", () => {
    // The three entries mirror the three set files that carry a
    // `def content`: set/right/when_created.rb, set/right/when_last_edited.rb,
    // set/self/now.rb. The order matches the gem tree's set/ subdir
    // walk; the mod loader (when the manifest field lands) reads them
    // in registration order.
    expect(dateContentOverrideEntries.map((e) => e.setPath)).toEqual([
      "right/when_created",
      "right/when_last_edited",
      "self/now",
    ]);
    for (const entry of dateContentOverrideEntries) {
      expect(entry.modName).toBe("date");
      expect(typeof entry.fn).toBe("function");
    }
  });

  it("the three ContentFns are the same references the entries export", () => {
    // The loader would otherwise receive a wrapped copy; the test pins
    // that the exports and the aggregate agree so a coordinator-side
    // wiring helper (loader-side) can pluck entries[].fn and trust
    // identity.
    const fns = dateContentOverrideEntries.map((e) => e.fn);
    expect(fns).toEqual([
      whenCreatedContentFn,
      whenLastEditedContentFn,
      nowContentFn,
    ]);
  });

  it("nowContentFn returns a strftime '%A, %B %d, %Y %I:%M %p UTC' string", () => {
    // The Self/now ContentFn doesn't consult the format argument; it
    // returns the formatted wall-clock instant. We just check the shape
    // (the bytes for the seed instant are pinned by the helper unit
    // tests above).
    const out = nowContentFn({
      card: {} as never,
      engine: {} as never,
    } as never);
    expect(out).toMatch(
      /^[A-Z][a-z]+, [A-Z][a-z]+ \d{2}, \d{4} \d{2}:\d{2} (AM|PM) UTC$/,
    );
  });
});

describe("card-mod-date wireDateContentOverrides (the loader-side installer)", () => {
  it("returns a registry containing all three setPath entries", () => {
    // Re-wire (the beforeAll has already wired the default; this
    // asserts the installer's return value shape regardless).
    const reg = wireDateContentOverrides();
    expect(reg.paths()).toEqual([
      "right/when_created",
      "right/when_last_edited",
      "self/now",
    ]);
    expect(reg.size()).toBe(3);
    for (const setPath of reg.paths()) {
      const entry = reg.forPath(setPath);
      expect(entry?.modName).toBe("date");
      expect(typeof entry?.fn).toBe("function");
    }
  });

  it("setDefaultContentOverrideRegistry round-trip: the installer is the loader-side wire call", () => {
    // The wireDateContentOverrides() installer calls
    // setDefaultContentOverrideRegistry(registry) as its last step
    // (card-mod-date.ts#wireDateContentOverrides). contentOverrideFor
    // is the format-layer consultation seam (content-overrides.ts:123).
    wireDateContentOverrides();
    // contentOverrideFor reads from the process-wide default; the
    // installer's wire-up must have populated it.
    expect(contentOverrideFor("right/when_created")?.modName).toBe("date");
  });
});

// ---------------------------------------------------------------------------
// engine :core integration with the wired registry — the render path
// proves the registration surfaces fire through format.ts#renderRaw.
// ---------------------------------------------------------------------------

describe("card-mod-date wired registry: render path exercises resolveContentOverride", () => {
  it("Oracle When Created Probe+when_created :core walks the wired registry end-to-end", async () => {
    // The end-to-end test: the engine render calls renderRaw
    // (format.ts:605-609), which calls resolveContentOverride, which
    // walks the registered overrides (cardBelongsToSet + the
    // wireDateContentOverrides registry), finds right/when_created,
    // invokes whenCreatedContentFn, and returns its bytes - the seeded
    // timestamp localized through card_dayofwk_min_tz.
    const s = storage!;
    const html = await s.engine.render(
      "Oracle When Created Probe+when_created",
      "core",
    );
    expect(html).toBe("Saturday, September 19, 2026 12:00 AM UTC");
  });

  it("Oracle Date Probe :core still produces the engine's formatDateCore bytes (no shadow)", async () => {
    // The content-override registry's cardBelongsToSet check for the
    // Oracle Date Probe returns false for every registered setPath
    // (it's a Date-typed simple card with no junction right side, no
    // typeName "now", and no matching type anchor). renderRaw falls
    // through to dbContent; the coreView's typeName==="Date" branch
    // (views.ts:186) renders formatDateCore. No shadow.
    const s = storage!;
    const html = await s.engine.render("Oracle Date Probe", "core");
    expect(html).toBe("March 15, 2026");
  });
});

// ---------------------------------------------------------------------------
// A/B test against the captured oracle bytes
//
// fixtures/captured/date-overrides.json holds the bytes the live Ruby
// oracle produced for the same probes this lane ports. The capture
// script (tests/card/mod-loader/oracle-capture-date-overrides.rb) ran
// from tools/oracle/decko-oracle-app and recorded:
//   - the I18n.t('time.formats.card_dayofwk_min_tz') format string from
//     card-1.110.0 config/locales/en.yml:29
//   - the oracle's timezone state (Time.zone.name + Time.now.zone)
//   - direct I18n.localize bytes for three known UTC timestamps + a
//     capture-time Time.now
//   - rendered :core / :raw bytes for the right/when_created /
//     right/when_last_edited junction rule cards (the mod's `def
//     content` paths: when_created.rb:7-11, when_last_edited.rb:7-11)
//   - the *now card's rendered bytes (self/now.rb:1-3 path)
//
// The fixture's timestamps come from the oracle's update_columns writes
// (UTC). The engine reads the same created_at / updated_at SQL strings
// from the cards row, so byte equality holds when the engine's UTC
// reading (formatDayofwkMinTz's getUTCHours/getUTCMonth path) matches
// the oracle's UTC reading (the I18n.localize of an ActiveSupport::
//// TimeWithZone whose zone is UTC).
// ---------------------------------------------------------------------------

interface DateOverridesFixture {
  timezone: {
    time_zone_name: string;
    env_tz: string | null;
    time_now_zone: string;
    time_now_inspect: string;
  };
  i18n_format_string: string;
  direct_i18n_localize: {
    left_created_at_utc_midnight: string;
    left_updated_at_utc_1430: string;
    left_created_at_utc_noon: string;
    time_now_at_capture: string;
  };
  rendered: Record<string, string>;
  now_card: {
    name: string;
    type_code: string;
    format_render_raw: string;
    format_render_core: string;
    content: string;
  };
}

const FIXTURE_PATH = fileURLToPath(
  new URL("../../../fixtures/captured/date-overrides.json", import.meta.url),
);
const dateFixture: DateOverridesFixture = JSON.parse(
  readFileSync(FIXTURE_PATH, "utf8"),
);

/** Convert "YYYY-MM-DD HH:MM:SS UTC" (the fixture's seed-timestamp shape)
 *  to the SQLDateTime "YYYY-MM-DD HH:MM:SS.SSS" string the engine's cards
 *  row stores. The seed is UTC; the engine reads it back via
 *  sqlDateTimeToDate(card-mod-date.ts:244-248) and treats it as UTC. */
function fixtureTimestampToSqlDateTime(fixtureTs: string): string {
  // fixtureTs is "2026-09-19 00:00:00 UTC" -> "2026-09-19 00:00:00.000"
  return fixtureTs.replace(" UTC", ".000");
}

describe("card-mod-date A/B against captured oracle bytes (fixtures/captured/date-overrides.json)", () => {
  it("captures the oracle's timezone state - Time.zone is UTC, the app records left.created_at in UTC", () => {
    // The pin the test relies on: the oracle's Time.zone governs
    // ActiveSupport::TimeWithZone values (the left.created_at /
    // updated_at the mod's I18n.localize reads). When the captured zone
    // is "UTC", the bytes have "%Z" = "UTC" — which is exactly what
    // formatDayofwkMinTz emits (UTC methods). If a future oracle ran in
    // a non-UTC zone the A/B would shift (the "%Z" tail would change);
    // this assertion is the seam that catches that drift.
    expect(dateFixture.timezone.time_zone_name).toBe("UTC");
    // The Time.now used by self/now.rb:1-3 is system local time (Ruby's
    // Time.now is always local). On the capture runner that's PST; the
    // %Z rendering tail is therefore "Pacific Standard Time" (NOT
    // "UTC"). The self/now override's bytes are non-deterministic by
    // nature — the TS test asserts the SHAPE regex, not bytes.
    expect(dateFixture.timezone.time_now_zone).toBe("Pacific Standard Time");
  });

  it("captures the I18n format string the mod's def content applies", () => {
    // The strftime spec the mod reads via I18n.localize(card, format:
    // :card_dayofwk_min_tz). The en.yml:29 source is "%A, %B %d, %Y
    // %I:%M %p %Z"; the helper unit tests at the top of this file pin
    // every component. This fixture assertion pins the WHOLE string.
    expect(dateFixture.i18n_format_string).toBe(
      "%A, %B %d, %Y %I:%M %p %Z",
    );
  });

  it("formatDayofwkMinTz produces byte-equivalent bytes to the oracle's direct I18n.localize for each seed timestamp", () => {
    // The pin: for each (probe_left, view) the oracle captured via
    // I18n.localize(left.created_at, format: :card_dayofwk_min_tz),
    // formatDayofwkMinTz(Date(left.created_at_sql)) emits the same
    // bytes. The SQL datetime the engine stores matches the
    // ActiveSupport::TimeWithZone the oracle passes to I18n.localize
    // (both are UTC instants; the engine's sqlDateTimeToDate reads
    // them as UTC; the oracle's zone is UTC).
    const cases: ReadonlyArray<{
      label: string;
      fixtureTs: string;
      oracleBytes: string;
    }> = [
      {
        label: "created_at UTC midnight (2026-09-19 00:00:00 UTC)",
        fixtureTs: "2026-09-19 00:00:00 UTC",
        oracleBytes:
          dateFixture.direct_i18n_localize.left_created_at_utc_midnight,
      },
      {
        label: "updated_at UTC 14:30 (2026-09-19 14:30:00 UTC)",
        fixtureTs: "2026-09-19 14:30:00 UTC",
        oracleBytes:
          dateFixture.direct_i18n_localize.left_updated_at_utc_1430,
      },
      {
        label: "created_at UTC noon (2026-06-15 12:00:00 UTC)",
        fixtureTs: "2026-06-15 12:00:00 UTC",
        oracleBytes:
          dateFixture.direct_i18n_localize.left_created_at_utc_noon,
      },
    ];
    for (const c of cases) {
      const sql = fixtureTimestampToSqlDateTime(c.fixtureTs);
      const iso = `${sql.replace(" ", "T")}Z`;
      const d = new Date(iso);
      const tsBytes = formatDayofwkMinTz(d);
      expect(tsBytes, c.label).toBe(c.oracleBytes);
    }
  });
});

/** A/B render test against the captured oracle :core bytes. Builds a
 *  fresh storage whose probe cards carry the EXACT created_at /
 *  updated_at timestamps the oracle's update_columns wrote, then
 *  renders the same junction rule cards through the engine and asserts
 *  byte equality with fixtures/captured/date-overrides.json#rendered. */
describe("card-mod-date A/B render: engine :core bytes match the oracle's :core bytes", () => {
  let abStorage: RenderTestStorage | undefined;

  beforeAll(async () => {
    // Bind the same registry the main suite uses (so the right/when_*
    // ContentFns fire through the format.ts renderRaw seam).
    wireDateContentOverrides();
    abStorage = await createRenderTestStorage();
    const s = abStorage;

    // codename registry seeds — the right anchors for when_created /
    // when_last_edited (their bare-name codename settings). The test
    // names the junctions without the leading "*" (matching the engine's
    // DeckoName parser; the engine's codename lookup keys on the bare
    // name the mod's manifest exposes as rightId).
    await seedCard(s, { id: 2, name: "RichText" });
    await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
    await seedCard(s, {
      id: 14,
      name: "*setting",
      codename: "setting",
      typeId: 14,
    });
    await seedCard(s, {
      id: 200,
      name: "when_created",
      codename: "when_created",
      typeId: 14,
    });
    await seedCard(s, {
      id: 201,
      name: "when_last_edited",
      codename: "when_last_edited",
      typeId: 14,
    });

    // Oracle Date Probe A — created_at UTC midnight, updated_at UTC 14:30.
    await seedCard(s, {
      id: 400,
      name: "Oracle Date Probe A",
      dbContent: "probe A body",
    });
    // The engine reads cards.created_at / cards.updated_at as SQL
    // datetime strings ("YYYY-MM-DD HH:MM:SS.SSS"). seedCard's default
    // is "2026-09-19 00:00:00.000"; we update both columns directly to
    // match the fixture's oracle values.
    await s.counting.query(
      "UPDATE cards SET created_at = ?, updated_at = ? WHERE id = ?",
      ["2026-09-19 00:00:00.000", "2026-09-19 14:30:00.000", 400],
    );
    await seedCard(s, {
      id: 401,
      leftId: 400,
      rightId: 200, // +when_created
      typeId: 14,
    });
    await seedCard(s, {
      id: 402,
      leftId: 400,
      rightId: 201, // +when_last_edited
      typeId: 14,
    });

    // Oracle Date Probe B — created_at AND updated_at UTC noon
    // (different shape: crosses noon; pins %p AM/PM at hour 12).
    await seedCard(s, {
      id: 410,
      name: "Oracle Date Probe B",
      dbContent: "probe B body",
    });
    await s.counting.query(
      "UPDATE cards SET created_at = ?, updated_at = ? WHERE id = ?",
      ["2026-06-15 12:00:00.000", "2026-06-15 12:00:00.000", 410],
    );
    await seedCard(s, {
      id: 411,
      leftId: 410,
      rightId: 200, // +when_created
      typeId: 14,
    });
  }, 60_000);

  afterAll(() => {
    abStorage?.close();
    abStorage = undefined;
    setDefaultContentOverrideRegistry(
      undefined as unknown as ContentOverrideRegistry,
    );
  });

  it("Oracle Date Probe A+when_created :core renders the SAME bytes the oracle captured", async () => {
    const s = abStorage!;
    const html = await s.engine.render(
      "Oracle Date Probe A+when_created",
      "core",
    );
    expect(html).toBe(
      dateFixture.rendered["Oracle Date Probe A+*when created#core"],
    );
  });

  it("Oracle Date Probe A+when_last_edited :core renders the SAME bytes the oracle captured", async () => {
    const s = abStorage!;
    const html = await s.engine.render(
      "Oracle Date Probe A+when_last_edited",
      "core",
    );
    expect(html).toBe(
      dateFixture.rendered["Oracle Date Probe A+*when last edited#core"],
    );
  });

  it("Oracle Date Probe B+when_created :core renders the SAME bytes the oracle captured (noon timestamp, %p PM at hour 12)", async () => {
    const s = abStorage!;
    const html = await s.engine.render(
      "Oracle Date Probe B+when_created",
      "core",
    );
    expect(html).toBe(
      dateFixture.rendered["Oracle Date Probe B+*when created#core"],
    );
  });

  it("the *now card bytes follow the card_dayofwk_min_tz SHAPE (non-deterministic by nature; oracle's local TZ is recorded in the fixture)", () => {
    // self/now.rb:1-3 calls I18n.localize(Time.now, ...); Time.now is
    // Ruby system local time. The capture runner's Time.now.zone is
    // "Pacific Standard Time" (recorded in fixture.timezone.time_now_zone);
    // the oracle's %Z tail is therefore "Pacific Standard Time" (NOT
    // "UTC"). The TS engine's formatDayofwkMinTz uses UTC methods; the
    // wall-clock-instant bytes therefore differ between Ruby and TS by
    // the %Z tail (and the time-of-day for off-UTC zones). The SHAPE is
    // identical and pinned:
    //   - day name (full)
    //   - month name (full)
    //   - DD zero-padded
    //   - YYYY 4-digit
    //   - HH:MM zero-padded, 12-hour
    //   - AM/PM
    //   - TZ name (any string; not asserted)
    expect(dateFixture.now_card.content).toMatch(
      /^[A-Z][a-z]+, [A-Z][a-z]+ \d{2}, \d{4} \d{2}:\d{2} (AM|PM) /,
    );
    expect(dateFixture.now_card.content).not.toBe("");
    // Sanity: nowContentFn's bytes match the same shape; the wall-clock
    // instant differs (the engine runs after the oracle), but the
    // strftime components are the same.
    expect(nowContentFn({ card: {} as never, engine: {} as never } as never))
      .toMatch(
        /^[A-Z][a-z]+, [A-Z][a-z]+ \d{2}, \d{4} \d{2}:\d{2} (AM|PM) UTC$/,
      );
  });
});