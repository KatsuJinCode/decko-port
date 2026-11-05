

import { describe, expect, it } from "vitest";
import { formatDateCore } from "../../../src/card/render/views.js";
import { isValidDateContent, dateError } from "../../../src/card/render/errors.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("formatDateCore — ::Date.parse(str).strftime('%B %-d, %Y')", () => {
  it.each([
    ["2023-01-15", "January 15, 2023"],
    ["2024-12-03", "December 3, 2024"],
    ["2020-02-29", "February 29, 2020"],
    ["2025-07-04", "July 4, 2025"],
    ["2000-01-01", "January 1, 2000"],
    ["1999-12-31", "December 31, 1999"],
  ])("'%s' -> '%s'", (input, expected) => {
    expect(formatDateCore(input)).toBe(expected);
  });

  it("unpadded day matches Ruby's %-d (no leading zero)", () => {

    const result = formatDateCore("2025-07-04");
    expect(result).toBe("July 4, 2025");
    expect(result).not.toContain(" 04,");
    expect(result).not.toContain(" 07,");
  });

  it("month is the full English name (Ruby's %B), not abbreviated", () => {

    expect(formatDateCore("2023-01-15").split(",")[0]).toMatch(/^January \d+$/);
    expect(formatDateCore("2023-09-15").split(",")[0]).toMatch(/^September \d+$/);
    expect(formatDateCore("2023-09-15").split(",")[0]).not.toMatch(/^Sep\b/);
  });

  it("UTC date components — no local-timezone day shift", () => {

    expect(formatDateCore("2023-01-15")).toBe("January 15, 2023");
    expect(formatDateCore("2023-01-01")).toBe("January 1, 2023");
    expect(formatDateCore("2023-12-31")).toBe("December 31, 2023");
  });

  it("non-parseable content throws Date::Error (Ruby parity)", () => {

    for (const bad of ["brcvtwrvz", "kieqzamnqc", "iaqgzhboog", "", "not-a-date"]) {
      if (isValidDateContent(bad)) continue;
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

describe("Date-type card :content view — strftime-equivalent core body", () => {
  it("renders '%B %-d, %Y' for an ISO-8601 date content", async () => {

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

      expect(html).toContain("January 15, 2023");

      expect(html).not.toContain("{{");
      expect(html).not.toContain("}}");
    } finally {
      storage.close();
    }
  });

  it("renders different months and days correctly across the calendar", async () => {

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

      expect(html).toContain("open_valid_date-open-view");
    } finally {
      storage.close();
    }
  });
});

describe("captured corpus — Date-type card byte surface", () => {
  it("shard-000000 carries zero Date cards with valid content (parity expectation)", async () => {

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

    expect(dateCards.length).toBeGreaterThan(0);

    const validInShard = dateCards.filter((c) => isValidDateContent(c.content));
    expect(validInShard).toEqual([]);
  });

  it("captured :open and :content of invalid Date cards emit CAPTURE_ERROR sentinels (corpus parity)", async () => {

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

    expect(entry1135!.views.open).toBe("CAPTURE_ERROR: Date::Error: invalid date");
    expect(entry1135!.views.content).toBe("CAPTURE_ERROR: Date::Error: invalid date");

    expect(entry1135!.views.closed.startsWith("CAPTURE_ERROR")).toBe(false);

    expect(entry1135!.views.title.startsWith("CAPTURE_ERROR")).toBe(false);

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

describe("dateError factory — Ruby shape preservation", () => {
  it("the factory raises Date::Error with the literal 'invalid date' message", () => {
    const err = dateError();
    expect(err.constructor.name).toBe("Date::Error");
    expect(err.message).toBe("invalid date");
  });
});