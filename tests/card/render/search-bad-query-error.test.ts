

import { describe, expect, it } from "vitest";
import {
  BAD_QUERY_CLASS_NAME,
  BadQueryError,
  badQuery,
  emptyQueryError,
} from "../../../src/card/render/errors.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("Card::Error::BadQuery — search-card JSON parse failure (M4)", () => {

  it("class name is the Ruby literal 'Card::Error::BadQuery'", () => {

    expect(BadQueryError.name).toBe(BAD_QUERY_CLASS_NAME);
    expect(BAD_QUERY_CLASS_NAME).toBe("Card::Error::BadQuery");
  });

  it("constructor.name matches the corpus sentinel's class prefix", () => {
    const err = badQuery("yzzw");

    expect(err.constructor.name).toBe("Card::Error::BadQuery");
    expect(err.name).toBe("Card::Error::BadQuery");
  });

  it("message echoes the raw query verbatim, matching the corpus format", () => {
    const err = badQuery("yzzw");
    expect(err.message).toBe("Invalid JSON search query: yzzw");
    const long = badQuery("a".repeat(64));
    expect(long.message).toBe(`Invalid JSON search query: ${"a".repeat(64)}`);
  });

  it("empty-query branch produces the distinct 'can't run search with empty content' message", () => {

    const err = emptyQueryError();
    expect(err.constructor.name).toBe("Card::Error::BadQuery");
    expect(err.message).toBe("can't run search with empty content");
  });

  it("rendering :open of a Search-type card with non-JSON content raises BadQueryError", async () => {
    const storage = await createRenderTestStorage();
    try {

      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 77,
        name: "*home",
        codename: "home",
        typeId: 98,
        dbContent: "yzzw",
      });
      let captured: unknown;
      try {
        await storage.engine.render("*home", "open");
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      const err = captured as Error & { query?: string };
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: yzzw");
      expect(err.query).toBe("yzzw");
    } finally {
      storage.close();
    }
  });

  it("rendering :content of a Search-type card with non-JSON content raises BadQueryError", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 101,
        name: "broken search one",
        typeId: 98,
        dbContent: "jjmduarnmhbvnahsoeyvmxkpec",
      });
      let captured: unknown;
      try {
        await storage.engine.render("broken_search_one", "content");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: jjmduarnmhbvnahsoeyvmxkpec");
    } finally {
      storage.close();
    }
  });

  it("rendering :open of a Search-type card with empty content raises the empty-query branch", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 200,
        name: "empty search",
        typeId: 98,
        dbContent: "",
      });
      let captured: unknown;
      try {
        await storage.engine.render("empty_search", "open");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("can't run search with empty content");
    } finally {
      storage.close();
    }
  });

  it("valid JSON search content renders without raising (sanity check)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 300,
        name: "valid search",
        typeId: 98,
        dbContent: '{"left":"anything","limit":0}',
      });
      const html = await storage.engine.render("valid_search", "open");
      expect(typeof html).toBe("string");

      expect(html).toContain("valid_search-open-view");
    } finally {
      storage.close();
    }
  });

  it("rendering :open of a Search-type card whose type card name is NOT 'Search' still raises BadQueryError (corpus:101 corpus-shaped fixture)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });

      await seedCard(storage, { id: 30, name: "qnzkqz", codename: "search_type", typeId: 2 });

      await seedCard(storage, {
        id: 101,
        name: "wrjuvyhaoiwnvvnblfl",
        typeId: 30,
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

  it("rendering :content of a Search-type card whose type card name is NOT 'Search' still raises BadQueryError (corpus:101 :content view)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 30, name: "qnzkqz", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 101,
        name: "wrjuvyhaoiwnvvnblfl content",
        typeId: 30,
        dbContent: "jjmduarnmhbvnahsoeyvmxkpec",
      });
      let captured: unknown;
      try {
        await storage.engine.render("wrjuvyhaoiwnvvnblfl_content", "content");
      } catch (err) {
        captured = err;
      }
      const err = captured as Error;
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe(
        "Invalid JSON search query: jjmduarnmhbvnahsoeyvmxkpec",
      );
    } finally {
      storage.close();
    }
  });

  it("rendering :closed and :title of a Search-type card with non-JSON content does NOT raise (capture census: 105/105 real bytes)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 30, name: "qnzkqz", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 101,
        name: "broken search card",
        typeId: 30,
        dbContent: "jjmduarnmhbvnahsoeyvmxkpec",
      });
      const closedHtml = await storage.engine.render("broken_search_card", "closed");
      expect(closedHtml).toContain("broken_search_card-closed-view");
      const titleHtml = await storage.engine.render("broken_search_card", "title");
      expect(typeof titleHtml).toBe("string");

      let openCaptured: unknown;
      try {
        await storage.engine.render("broken_search_card", "open");
      } catch (err) {
        openCaptured = err;
      }
      expect((openCaptured as Error)?.constructor.name).toBe("Card::Error::BadQuery");
    } finally {
      storage.close();
    }
  });

  it("a search-TYPE rule card (right part a setting) with non-JSON content does NOT raise on :open (capture census: rule search cards render real bytes)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 30, name: "qnzkqz", codename: "search_type", typeId: 2 });

      await seedCard(storage, { id: 260, name: "exi", codename: "set", typeId: 2 });
      await seedCard(storage, { id: 261, name: "Setting", codename: "setting", typeId: 2 });
      await seedCard(storage, { id: 270, name: "Lesson", typeId: 2 });
      await seedCard(storage, { id: 271, name: "*right", typeId: 261 });
      await seedCard(storage, {
        id: 272,
        name: "Lesson+*right",
        leftId: 270,
        rightId: 271,
        typeId: 260,
      });
      await seedCard(storage, {
        id: 273,
        name: "*content options",
        typeId: 261,
      });
      await seedCard(storage, {
        id: 274,
        name: "Lesson+*right+*content options",
        leftId: 272,
        rightId: 273,
        typeId: 30,
        dbContent: "lkxchgttdixjvgdasd",
      });

      const openHtml = await storage.engine.render("Lesson+*right+*content_options", "open");
      expect(typeof openHtml).toBe("string");
      expect(openHtml).not.toContain("CAPTURE_ERROR");

      await seedCard(storage, {
        id: 275,
        name: "plain broken search",
        typeId: 30,
        dbContent: "lkxchgttdixjvgdasd",
      });
      let captured: unknown;
      try {
        await storage.engine.render("plain_broken_search", "open");
      } catch (err) {
        captured = err;
      }
      expect((captured as Error)?.constructor.name).toBe("Card::Error::BadQuery");
    } finally {
      storage.close();
    }
  });

  it("the raised error reproduces the exact CAPTURE_ERROR sentinel bytes the corpus:77 capture recorded", () => {

    const err = badQuery("fr");
    const sentinel = `CAPTURE_ERROR: ${err.constructor.name}: ${err.message}`;
    expect(sentinel).toBe(
      "CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: fr",
    );
  });
});
