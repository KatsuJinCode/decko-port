// Stream E2 — Date cardtype html views.
//
// The card-mod-date-0.20.0 html format defines exactly one view override
// for Date-type cards (card-mod-date-0.20.0 set/type/date.rb:1-9):
//
//     format :html do
//       def input_type
//         :calendar
//       end
//
//       view :core do
//         ::Date.parse(card.content).strftime "%B %-d, %Y"
//       end
//     end
//
// The :core body runs `Date.parse` on the card content and renders a
// "Month Day, Year" string via strftime ("%B %-d, %Y": full month name,
// unpadded day, 4-digit year). The capture shape is:
//
//     "2023-01-15" -> "January 15, 2023"
//     "2024-12-03" -> "December 3, 2024"
//     "2020-02-29" -> "February 29, 2020"  (leap day)
//
// CAPTURED CORPUS STATE
//
// The corpus sweep (fixtures/corpus/shard-*.jsonl, 48 shards total) found
// 4021 Date-type cards (type_code === "date") — every single one carries
// random non-date content (or empty content). The corpus was generated
// to exercise the INVALID-date raise path (wave D's M4 stream — see
// tests/card/render/date-error.test.ts and the comments at
// render.ts:866-872): the prepare phase validates Date content BEFORE
// any view body runs, raising Date::Error with the literal message
// "invalid date". The :open and :content views for every Date card in
// the corpus are pinned as CAPTURE_ERROR sentinels (e.g. corpus:1135:
//   "CAPTURE_ERROR: Date::Error: invalid date").
//
// ZERO captured Date cards carry valid content, so there are zero
// captured :core / :content / :open renders of the strftime output to
// byte-compare against. The byte-parity test for the VALID path is
// therefore constructed deterministically (synthetic dates seeded via
// render-test-storage.ts), with the strftime equivalence verified
// against the literal Ruby strftime "%B %-d, %Y" shape. The captured
// INVALID path is already pinned in tests/card/render/date-error.test.ts
// (read-only per the stream contract — M4 stream owns it) and is not
// duplicated here.
//
// REFERENCE Ruby strftime: `Date#strftime("%B %-d, %Y")`
//   %B  -> full month name, English
//   %-d -> day-of-month, no leading zero
//   %Y  -> 4-digit year, zero-padded

import { describe, expect, it } from "vitest";
import { formatDateCore } from "../../../src/card/render/views.js";
import { isValidDateContent, dateError } from "../../../src/card/render/errors.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

// ---------------------------------------------------------------------------
// the strftime equivalence helper itself (pure function)
// ---------------------------------------------------------------------------

describe("formatDateCore — ::Date.parse(str).strftime('%B %-d, %Y')", () => {
  it.each([
    ["2023-01-15", "January 15, 2023"],
    ["2024-12-03", "December 3, 2024"],
    ["2020-02-29", "February 29, 2020"], // leap day — month-day-year valid
    ["2025-07-04", "July 4, 2025"], // unpadded day (%-d shape)
    ["2000-01-01", "January 1, 2000"], // century boundary
    ["1999-12-31", "December 31, 1999"], // year-end
  ])("'%s' -> '%s'", (input, expected) => {
    expect(formatDateCore(input)).toBe(expected);
  });

  it("unpadded day matches Ruby's %-d (no leading zero)", () => {
    // "2025-07-04" -> "July 4, 2025" (NOT "July 04, 2025"); this is the
    // Ruby %-d shape (the JS getUTCDate() integer is already unpadded).
    const result = formatDateCore("2025-07-04");
    expect(result).toBe("July 4, 2025");
    expect(result).not.toContain(" 04,");
    expect(result).not.toContain(" 07,");
  });

  it("month is the full English name (Ruby's %B), not abbreviated", () => {
    // The full month names ("January", "September") are spelled out;
    // abbreviated forms ("Jan", "Sep") would be Ruby's %b shape, not
    // the %B shape we want. The full names happen to CONTAIN the
    // abbreviation as a substring, so the assertion checks the full
    // name as the first 8/9 chars of the month token — not a literal
    // not-contains check.
    expect(formatDateCore("2023-01-15").split(",")[0]).toMatch(/^January \d+$/);
    expect(formatDateCore("2023-09-15").split(",")[0]).toMatch(/^September \d+$/);
    expect(formatDateCore("2023-09-15").split(",")[0]).not.toMatch(/^Sep\b/);
  });

  it("UTC date components — no local-timezone day shift", () => {
    // ISO 8601 (YYYY-MM-DD) is parsed by JS as midnight UTC. Reading
    // the day via getUTCDate/getUTCFullYear avoids the day-before
    // shift a local-timezone read would produce in any zone west of
    // UTC (midnight UTC Jan 15 is 4pm Jan 14 in US/Pacific).
    expect(formatDateCore("2023-01-15")).toBe("January 15, 2023");
    expect(formatDateCore("2023-01-01")).toBe("January 1, 2023");
    expect(formatDateCore("2023-12-31")).toBe("December 31, 2023");
  });

  it("non-parseable content throws Date::Error (Ruby parity)", () => {
    // Belt-and-suspenders: the prepare phase raises Date::Error before
    // any view body runs, so formatDateCore should never see invalid
    // content in production. If it does (a future caller bypasses the
    // prepare phase), the Ruby-shaped raise is correct.
    for (const bad of ["brcvtwrvz", "kieqzamnqc", "iaqgzhboog", "", "not-a-date"]) {
      if (isValidDateContent(bad)) continue; // isValidDateContent is stricter for empty
      let captured: unknown;
      try {
        formatDateCore(bad);
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).constructor.name).toBe("Date::Error");
      expect((captured as Error).message).toBe("invalid date");
    }
  });
});

// ---------------------------------------------------------------------------
// end-to-end through the render engine — :content view delegates to :core
// ---------------------------------------------------------------------------

describe("Date-type card :content view — strftime-equivalent core body", () => {
  it("renders '%B %-d, %Y' for an ISO-8601 date content", async () => {
    // Card A: a Date-type card carrying ISO content "2023-01-15".
    // The captured corpus has zero such cards (every Date card in the
    // corpus carries random non-date content for the M4 invalid sweep);
    // this test seeds the card directly via render-test-storage.ts.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 500,
        name: "valid date one",
        typeId: 90,
        dbContent: "2023-01-15",
      });
      const html = await storage.engine.render("valid_date_one", "content");
      // :content view wraps :core via slotWrap (the captured slot
      // structure). The core body itself is the strftime result.
      expect(html).toContain("January 15, 2023");
      // No nest-syntax scan: the strftime output is plain text.
      expect(html).not.toContain("{{");
      expect(html).not.toContain("}}");
    } finally {
      storage.close();
    }
  });

  it("renders different months and days correctly across the calendar", async () => {
    // Multiple date shapes — covers the strftime format's month set
    // and unpadded-day case in a single run.
    const cases = [
      { id: 510, name: "december", date: "2024-12-03", expect: "December 3, 2024" },
      { id: 511, name: "february", date: "2020-02-29", expect: "February 29, 2020" },
      { id: 512, name: "july", date: "2025-07-04", expect: "July 4, 2025" },
    ];
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      for (const c of cases) {
        await seedCard(storage, { id: c.id, name: c.name, typeId: 90, dbContent: c.date });
      }
      for (const c of cases) {
        const html = await storage.engine.render(c.name, "content");
        expect(html, `rendered ${c.name} (${c.date})`).toContain(c.expect);
      }
    } finally {
      storage.close();
    }
  });

  it(":open view (via bar_bottom -> :content) also contains the strftime output", async () => {
    // The bar_bottom chain routes through :content (views.ts:418:
    //   `barBottomView: () => fmt.renderView("content", { home_view: "content" })`),
    // which routes through :core, which is the Date :core override.
    // A Date card rendered via :open MUST therefore contain the
    // strftime output (assuming the prepare phase accepts the content).
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 520,
        name: "open valid date",
        typeId: 90,
        dbContent: "2023-01-15",
      });
      const html = await storage.engine.render("open valid date", "open");
      expect(html).toContain("January 15, 2023");
      // :open renders the accordion + bar_body + bar_bottom -> :content;
      // the slot id the :open view emits is `${safeKey}-open-view`.
      expect(html).toContain("open_valid_date-open-view");
    } finally {
      storage.close();
    }
  });
});

// ---------------------------------------------------------------------------
// the captured corpus state — pinned for the stream's "what did you find?"
// ---------------------------------------------------------------------------

describe("captured corpus — Date-type card byte surface", () => {
  it("shard-000000 carries zero Date cards with valid content (parity expectation)", async () => {
    // The corpus generation (build_corpus_v2.py + the deck builder) seeds
    // every Date card with random non-date strings to exercise the
    // Date::Error raise path (wave D's M4 stream — already ported in
    // render.ts:866-872 + errors.ts#dateError). This test pins the
    // "zero valid" state so a future corpus regeneration that DID
    // include valid dates would surface here as a flag to revisit the
    // byte-parity expectation for the valid path.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = new URL("../../..", import.meta.url);
    const repoRoot = url.pathname.replace(/^\//, "");
    const shardPath = path.join(repoRoot, "fixtures/corpus/shard-000000.jsonl");
    const text = await fs.readFile(shardPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const dateCards: Array<{ id: number; content: string }> = [];
    for (const line of lines) {
      const entry = JSON.parse(line) as {
        id: number;
        record?: { type_code?: string; content?: string };
      };
      if (entry.record?.type_code === "date") {
        dateCards.push({ id: entry.id, content: entry.record.content ?? "" });
      }
    }
    // The corpus sweep found 24 Date cards in shard-000000.
    expect(dateCards.length).toBeGreaterThan(0);
    // NONE of them carry parseable date content (the corpus is
    // designed to exercise the invalid sweep only).
    const validInShard = dateCards.filter((c) => isValidDateContent(c.content));
    expect(validInShard).toEqual([]);
  });

  it("captured :open and :content of invalid Date cards emit CAPTURE_ERROR sentinels (corpus parity)", async () => {
    // The corpus pins :open and :content as CAPTURE_ERROR sentinels for
    // every Date card with invalid content (see corpus:1135 in shard-
    // 000000.jsonl — id=1135, content "brcvtwrvz", both :open and
    // :content are the literal `CAPTURE_ERROR: Date::Error: invalid
    // date`). The port's prepare-phase raise (render.ts:866-872) is
    // what produces those sentinel bytes in the corpus-v2 replay
    // handler; this test seeds the exact corpus entry and confirms the
    // engine still raises the same class+message (date-error.test.ts
    // pins the same property with synthetic seeds; this one confirms
    // the corpus data shape and the engine agree on the INVALID path).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = new URL("../../..", import.meta.url);
    const repoRoot = url.pathname.replace(/^\//, "");
    const shardPath = path.join(repoRoot, "fixtures/corpus/shard-000000.jsonl");
    const text = await fs.readFile(shardPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const entry1135 = lines
      .map((l) => JSON.parse(l))
      .find((e: { id: number }) => e.id === 1135) as
      | { id: number; name: string; record: { content: string; type_code: string }; views: Record<string, string> }
      | undefined;
    expect(entry1135).toBeDefined();
    // The captured corpus pins the SENTINEL shape for :open and :content.
    expect(entry1135!.views.open).toBe("CAPTURE_ERROR: Date::Error: invalid date");
    expect(entry1135!.views.content).toBe("CAPTURE_ERROR: Date::Error: invalid date");
    // The :closed view DOES render (it does not call :core for its body
    // — closed is the accordion stub form), so it has actual bytes.
    expect(entry1135!.views.closed.startsWith("CAPTURE_ERROR")).toBe(false);
    // The :title view is also real (it does not touch Date.parse).
    expect(entry1135!.views.title.startsWith("CAPTURE_ERROR")).toBe(false);

    // The TS engine reproduces the same raise for the same seeded card.
    // Note: the test seeds with a SIMPLE name ("broken_date_one") so the
    // render pipeline reaches the prepare-phase Date validator; a compound
    // name like the captured corpus entry ("evog+*right+*default") would
    // require seeding the +evog and +*default side cards (junction rows
    // the captured seed has, but the render-test-storage seedCard helper
    // does not produce for free). The data shape under test is the
    // engine's Date validator behavior on invalid content — the seed
    // name shape does not affect that validator.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 90, name: "Date", codename: "date", typeId: 2 });
      await seedCard(storage, {
        id: 1135,
        name: "broken_date_one",
        typeId: 90,
        dbContent: "brcvtwrvz",
      });
      let captured: unknown;
      try {
        await storage.engine.render("broken_date_one", "content");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err.constructor.name).toBe("Date::Error");
      expect(err.message).toBe("invalid date");
    } finally {
      storage.close();
    }
  });
});

// ---------------------------------------------------------------------------
// the dateError factory — the port's Ruby-shaped raise (this stream also
// relies on dateError() for the belt-and-suspenders throw in formatDateCore)
// ---------------------------------------------------------------------------

describe("dateError factory — Ruby shape preservation", () => {
  it("the factory raises Date::Error with the literal 'invalid date' message", () => {
    const err = dateError();
    expect(err.constructor.name).toBe("Date::Error");
    expect(err.message).toBe("invalid date");
  });
});