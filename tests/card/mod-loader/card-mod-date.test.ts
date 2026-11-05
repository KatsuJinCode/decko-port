

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

let dateRegistry: ContentOverrideRegistry | undefined;

beforeAll(async () => {

  dateRegistry = wireDateContentOverrides();
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

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
  await seedCard(s, {
    id: 202,
    name: "now",
    codename: "now",
    typeId: 14,
  });

  await seedCard(s, {
    id: 220,
    name: "Date",
    codename: "date",
    typeId: 13,
  });

  await seedCard(s, {
    id: 300,
    name: "Oracle When Created Probe",
    dbContent: "created probe body",
  });
  await seedCard(s, {
    id: 301,
    leftId: 300,
    rightId: 200,
    typeId: 14,
  });

  await seedCard(s, {
    id: 310,
    name: "Oracle When Last Edited Probe",
    dbContent: "edited probe body",
  });
  await seedCard(s, {
    id: 311,
    leftId: 310,
    rightId: 201,
    typeId: 14,
  });

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

  setDefaultContentOverrideRegistry(
    undefined as unknown as ContentOverrideRegistry,
  );
  dateRegistry = undefined;
});

describe("card-mod-date formatDayofwkMinTz (en.yml:29 '%A, %B %d, %Y %I:%M %p %Z')", () => {
  it("formats the seed test timestamp '2026-09-19 00:00:00.000' as 'Saturday, September 19, 2026 12:00 AM UTC'", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );

    const expected = "Saturday, September 19, 2026 12:00 AM UTC";
    expect(formatDayofwkMinTz(new Date("2026-09-19T00:00:00.000Z"))).toBe(expected);
  });

  it("zero-pads the day-of-month and hour (en.yml %d, %I are zero-padded)", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );

    const result = formatDayofwkMinTz(new Date("2026-01-05T09:05:00.000Z"));
    expect(result).toBe("Monday, January 05, 2026 09:05 AM UTC");
  });

  it("uses PM for hours >= 12 (en.yml %p 'PM')", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );

    const result = formatDayofwkMinTz(new Date("2026-01-05T14:30:00.000Z"));
    expect(result).toBe("Monday, January 05, 2026 02:30 PM UTC");
  });

  it("handles midnight correctly (00:00 UTC -> 12:00 AM, hour 12 not 0)", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );

    const result = formatDayofwkMinTz(new Date("2026-06-15T00:00:00.000Z"));
    expect(result).toBe("Monday, June 15, 2026 12:00 AM UTC");
  });

  it("handles noon correctly (12:00 UTC -> 12:00 PM, not 00:00 PM)", async () => {
    const { formatDayofwkMinTz } = await import(
      "../../../src/card/mod-loader/mods/card-mod-date.js"
    );

    const result = formatDayofwkMinTz(new Date("2026-06-15T12:00:00.000Z"));
    expect(result).toBe("Monday, June 15, 2026 12:00 PM UTC");
  });
});

describe("card-mod-date through the mod loader (A/B)", () => {
  it("WITHOUT the mod: a fresh ModLoader's basket is empty before load() is called", () => {

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

describe("WITH the mod: the engine's :core for the Date cardtype (views.ts:186-214 + formatDateCore)", () => {
  it("Oracle Date Probe's :core renders the strftime '%B %-d, %Y' format", async () => {

    const s = storage!;
    const html = await s.engine.render("Oracle Date Probe", "core");
    expect(html).toBe("March 15, 2026");
  });

  it("the mod does NOT shadow the engine's :core (loader.reset() leaves it intact)", async () => {

    const l = new ModLoader([{ manifest: cardModDate }]);
    loader = l;
    l.load();
    const s = storage!;
    const html = await s.engine.render("Oracle Date Probe", "core");
    expect(html).toBe("March 15, 2026");
  });
});

describe("WITH the mod: the engine's :core for the right/when_created / when_last_edited virtual cards", () => {
  it("Oracle When Created Probe+when_created :core resolves through the wired registry (localized left.created_at)", async () => {

    const s = storage!;
    const html = await s.engine.render(
      "Oracle When Created Probe+when_created",
      "core",
    );
    expect(html).toBe("Saturday, September 19, 2026 12:00 AM UTC");
  });

  it("Oracle When Last Edited Probe+when last edited :core resolves through the wired registry (localized left.updated_at)", async () => {

    const s = storage!;
    const html = await s.engine.render(
      "Oracle When Last Edited Probe+when last edited",
      "core",
    );
    expect(html).toBe("Saturday, September 19, 2026 12:00 AM UTC");
  });

  it("the 'now' card :core renders the localized render-time now (self/now matches the card named 'now' by key)", async () => {

    const s = storage!;
    const html = await s.engine.render("now", "core");
    expect(html).toMatch(
      /^[A-Za-z]+, [A-Za-z]+ \d{1,2}, \d{4} \d{2}:\d{2} (AM|PM) UTC$/,
    );
  });
});

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

describe("card-mod-date ContentFn exports (set-module def content ports)", () => {
  it("dateContentOverrideEntries exports the three gem-tree overrides in setPath order", () => {

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

    const fns = dateContentOverrideEntries.map((e) => e.fn);
    expect(fns).toEqual([
      whenCreatedContentFn,
      whenLastEditedContentFn,
      nowContentFn,
    ]);
  });

  it("nowContentFn returns a strftime '%A, %B %d, %Y %I:%M %p UTC' string", () => {

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

    wireDateContentOverrides();

    expect(contentOverrideFor("right/when_created")?.modName).toBe("date");
  });
});

describe("card-mod-date wired registry: render path exercises resolveContentOverride", () => {
  it("Oracle When Created Probe+when_created :core walks the wired registry end-to-end", async () => {

    const s = storage!;
    const html = await s.engine.render(
      "Oracle When Created Probe+when_created",
      "core",
    );
    expect(html).toBe("Saturday, September 19, 2026 12:00 AM UTC");
  });

  it("Oracle Date Probe :core still produces the engine's formatDateCore bytes (no shadow)", async () => {

    const s = storage!;
    const html = await s.engine.render("Oracle Date Probe", "core");
    expect(html).toBe("March 15, 2026");
  });
});

//// TimeWithZone whose zone is UTC).

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

function fixtureTimestampToSqlDateTime(fixtureTs: string): string {

  return fixtureTs.replace(" UTC", ".000");
}

describe("card-mod-date A/B against captured oracle bytes (fixtures/captured/date-overrides.json)", () => {
  it("captures the oracle's timezone state - Time.zone is UTC, the app records left.created_at in UTC", () => {

    expect(dateFixture.timezone.time_zone_name).toBe("UTC");

    expect(dateFixture.timezone.time_now_zone).toBe("Pacific Standard Time");
  });

  it("captures the I18n format string the mod's def content applies", () => {

    expect(dateFixture.i18n_format_string).toBe(
      "%A, %B %d, %Y %I:%M %p %Z",
    );
  });

  it("formatDayofwkMinTz produces byte-equivalent bytes to the oracle's direct I18n.localize for each seed timestamp", () => {

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

describe("card-mod-date A/B render: engine :core bytes match the oracle's :core bytes", () => {
  let abStorage: RenderTestStorage | undefined;

  beforeAll(async () => {

    wireDateContentOverrides();
    abStorage = await createRenderTestStorage();
    const s = abStorage;

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

    await seedCard(s, {
      id: 400,
      name: "Oracle Date Probe A",
      dbContent: "probe A body",
    });

    await s.counting.query(
      "UPDATE cards SET created_at = ?, updated_at = ? WHERE id = ?",
      ["2026-09-19 00:00:00.000", "2026-09-19 14:30:00.000", 400],
    );
    await seedCard(s, {
      id: 401,
      leftId: 400,
      rightId: 200,
      typeId: 14,
    });
    await seedCard(s, {
      id: 402,
      leftId: 400,
      rightId: 201,
      typeId: 14,
    });

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
      rightId: 200,
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

    expect(dateFixture.now_card.content).toMatch(
      /^[A-Z][a-z]+, [A-Z][a-z]+ \d{2}, \d{4} \d{2}:\d{2} (AM|PM) /,
    );
    expect(dateFixture.now_card.content).not.toBe("");

    expect(nowContentFn({ card: {} as never, engine: {} as never } as never))
      .toMatch(
        /^[A-Z][a-z]+, [A-Z][a-z]+ \d{2}, \d{4} \d{2}:\d{2} (AM|PM) UTC$/,
      );
  });
});