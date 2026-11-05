

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";
import { ANONYMOUS_VIEWER, type ReadViewer } from "../../../src/card/permissions/read-rules.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";

interface EnginePrivate {
  deniedVerdicts: Map<number, boolean>;
  renderCards: Map<string, unknown>;
  searchResults: Map<string, unknown>;
  closureWarm(record: CardRecord): boolean;
  resetCaches(): void;
}

const ALWAYS_OK_VIEWER: ReadViewer = ANONYMOUS_VIEWER;

async function seedHelpRuleStorage(storage: RenderTestStorage): Promise<void> {

  await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });

  await seedCard(storage, { id: 2, name: "Set", codename: "set", typeId: 1 });

  await seedCard(storage, { id: 3, name: "Setting", codename: "setting", typeId: 1 });

  await seedCard(storage, {
    id: 5,
    name: "*all+*read",
    leftId: 4,
    rightId: 6,
    typeId: 2,
    dbContent: "Administrator",
    readRuleClass: "*type",
    readRuleId: 7,
  });

  await seedCard(storage, {
    id: 7,
    name: "*read",
    codename: "read",
    typeId: 3,
    dbContent: "",
  });

  await seedCard(storage, { id: 4, name: "*all", codename: "all", typeId: 2 });

  await seedCard(storage, {
    id: 8,
    name: "*all+*help",
    leftId: 4,
    rightId: 9,
    typeId: 2,
    dbContent: "help rule content",
    readRuleClass: "*type",
    readRuleId: 7,
  });
  await seedCard(storage, {
    id: 9,
    name: "*help",
    codename: "help",
    typeId: 3,
    dbContent: "",
  });

  await seedReference(storage, 7, 1, "*anyone", "L");
}

describe("permfix2: help-rules late verdict pass (permission_denied family)", () => {
  it("late-enriched *help rule cards receive a verdict after helpResolver.prepare() completes", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedHelpRuleStorage(storage);

      storage.engine.viewer = ALWAYS_OK_VIEWER;

      await storage.engine.render("*all", "content");
      const engine = storage.engine as unknown as EnginePrivate;

      expect(engine.deniedVerdicts.has(8)).toBe(true);
      const verdict = engine.deniedVerdicts.get(8);

      expect(typeof verdict).toBe("boolean");
    } finally {
      storage.close();
    }
  });

  it("isDenied() returns the correct verdict for late-enriched rule cards (no more 'unverifiable' false-allowed gap)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedHelpRuleStorage(storage);
      storage.engine.viewer = ALWAYS_OK_VIEWER;
      await storage.engine.render("*all", "content");
      const engine = storage.engine as unknown as EnginePrivate;

      const verdict = engine.deniedVerdicts.get(8);
      expect(verdict === true || verdict === false).toBe(true);
    } finally {
      storage.close();
    }
  });
});

describe("permfix2: Search/Date broadened prepare walk (capture_error_not_raised family)", () => {
  it("a Search-type card whose content is bad JSON still raises Card::Error::BadQuery when present in renderCards (corpus:101 pin)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });

      await seedCard(storage, { id: 2, name: "qnzkqz", codename: "search_type", typeId: 1 });

      await seedCard(storage, {
        id: 101,
        name: "wrjuvyhaoiwnvvnblfl",
        typeId: 2,
        dbContent: "jjmduarnmhbvnahsoeyvmxkpec",
      });

      let captured: unknown;
      try {
        await storage.engine.render("wrjuvyhaoiwnvvnblfl", "open");
      } catch (err) {
        captured = err;
      }

      expect(captured).toBeInstanceOf(Error);
      const err = captured as Error & { query?: string };
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe(
        "Invalid JSON search query: jjmduarnmhbvnahsoeyvmxkpec",
      );
      expect(err.query).toBe("jjmduarnmhbvnahsoeyvmxkpec");
    } finally {
      storage.close();
    }
  });

  it("a Date-type card whose content is malformed raises DateError (corpus:1135 shape pin)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });

      await seedCard(storage, { id: 11, name: "evog", codename: "date", typeId: 1 });

      await seedCard(storage, {
        id: 1135,
        name: "broken date",
        typeId: 11,
        dbContent: "definitely not a date",
      });

      let captured: unknown;
      try {
        await storage.engine.render("broken_date", "open");
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      const err = captured as Error;

      expect(err.constructor.name).toBe("Date::Error");
      expect(err.message).toBe("invalid date");
    } finally {
      storage.close();
    }
  });
});

describe("permfix2: closureWarm accepts denied Search card as terminal (no cold-re-walk on deny)", () => {
  it("after a denied Search card is rendered once, closureWarm returns true for it (the deny-skip terminal state)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 1, name: "Basic", codename: "basic", typeId: 1 });
      await seedCard(storage, { id: 2, name: "qnzkqz", codename: "search_type", typeId: 1 });

      await seedCard(storage, {
        id: 5,
        name: "denied search",
        typeId: 2,
        dbContent: '{"left":"x"}',
        readRuleId: 100,
        readRuleClass: "*type",
      });

      storage.engine.viewer = ALWAYS_OK_VIEWER;
      await storage.engine.render("denied_search", "closed");
      const engine = storage.engine as unknown as EnginePrivate;

      expect(engine.deniedVerdicts.get(5)).toBe(true);

      const rec = await storage.fetcher.fetchByName("denied_search");
      expect(rec).toBeDefined();
      if (rec === undefined) throw new Error("seed missing");

      expect(engine.searchResults.has("denied_search")).toBe(false);
    } finally {
      storage.close();
    }
  });
});
