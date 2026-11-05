// M4 — render-time validation: the Search card's :core view JSON-parses
// the card's content (card-mod-search-0.20.0 set/abstract/cql_search.rb
// #parse_json_cql). On JSON::ParserError Ruby raises
// `Card::Error::BadQuery, "Invalid JSON search query: #{query}"` and the
// html :open / :content views surface that raise verbatim. The corpus
// capture pins the exact sentinel bytes in
// fixtures/corpus/shard-000000.jsonl:
//   - id=77 (*home, content="yzzw") views.open   -> CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: fr
//   - id=101 (wrjuvyhaoiwnvvnblfl, content="jjmdu...") views.open/content -> same class
//   - id=274 (*all) views.open/content -> same class
//   - id=305 (*help+*right) views.open/content -> same class
//   - id=470 (ppqhuslzzya) views.open/content -> same class
//   - id=817 (zbxggwfbwlmurtwz) views.open/content -> same class (long query)
//
// The replay handler (benchmarks/corpus-v2/replay-shard.test.ts — read-only
// per the stream contract) emits the CAPTURE_ERROR sentinel from
// `error.constructor.name`; the port must raise a class whose
// `constructor.name` is literally "Card::Error::BadQuery" and whose
// message echoes the raw query — exactly what Ruby recorded.

import { describe, expect, it } from "vitest";
import {
  BAD_QUERY_CLASS_NAME,
  BadQueryError,
  badQuery,
  emptyQueryError,
} from "../../../src/card/render/errors.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("Card::Error::BadQuery — search-card JSON parse failure (M4)", () => {
  // ----- the class itself ---------------------------------------------------

  it("class name is the Ruby literal 'Card::Error::BadQuery'", () => {
    // Pinned against the corpus CAPTURE_ERROR sentinel prefix — the
    // replay handler compares this string verbatim.
    expect(BadQueryError.name).toBe(BAD_QUERY_CLASS_NAME);
    expect(BAD_QUERY_CLASS_NAME).toBe("Card::Error::BadQuery");
  });

  it("constructor.name matches the corpus sentinel's class prefix", () => {
    const err = badQuery("yzzw");
    // The replay handler reads err.constructor.name (benchmarks/corpus-v2/
    // replay-shard.test.ts render handler fallback path) — that must be
    // the Ruby class string, not the TS-local binding name.
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
    // cql_search.rb:36-38 — the empty case raises BEFORE JSON.parse, with
    // a different message; port parity means both branches throw the
    // SAME class (BadQuery) but with their own message text.
    const err = emptyQueryError();
    expect(err.constructor.name).toBe("Card::Error::BadQuery");
    expect(err.message).toBe("can't run search with empty content");
  });

  // ----- the render pipeline surfaces the raise ----------------------------

  it("rendering :open of a Search-type card with non-JSON content raises BadQueryError", async () => {
    const storage = await createRenderTestStorage();
    try {
      // The corpus card id=77: name "*home", codename "home", type_id
      // pointing at a non-JSON Search. The capture recorded the raise on
      // its :open view (which delegates to :core -> :card_list ->
      // executeSearch -> runSearch).
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
    // Corpus pin: id=101 / id=274 / id=305 — both :open AND :content
    // views surface the raise (the :content view delegates to :core ->
    // :card_list -> executeSearch, identical code path to :open).
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
    // cql_search.rb:36-38 — empty content short-circuits to the
    // dedicated message; the port must distinguish this from the
    // invalid-JSON branch so the same Ruby parity holds.
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
    // Pin that the new validation ONLY fires on parse failures — valid
    // CQL JSON must still render normally (the captured smoke fixture
    // oracle-replay.test.ts covers the happy path).
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
      // No results, but the card_list shape renders.
      expect(html).toContain("valid_search-open-view");
    } finally {
      storage.close();
    }
  });

  // ----- corpus-shaped fixture: search-type card name is NOT "Search" ------
  //
  // The unit fixtures above seed the Search type card with `name: "Search"`
  // — the original (reverted) gate `card.typeName === "Search"` matched
  // them and hid the bug from the test bed. The corpus capture records
  // search-type cards with a different type card name: corpus:101's record
  // pins `"type":"qnzkqz","type_code":"search_type"` — the type card is
  // named "qnzkqz" but its codename is "search_type". This fixture
  // reproduces that shape so the codename-keyed gate is locked by the
  // parity: a future revert to typeName would leave corpus-shaped search
  // cards silently un-parsed (the 3,122-entry BadQuery bucket the
  // diagnose finds). Same class of fix as date-error.test.ts (the date
  // fixture pins type card name "evog" / codename "date").

  it("rendering :open of a Search-type card whose type card name is NOT 'Search' still raises BadQueryError (corpus:101 corpus-shaped fixture)", async () => {
    // Corpus pin: id=101 (wrjuvyhaoiwnvvnblfl, content
    // "jjmduarnmhbvnahsoeyvmxkpec") type="qnzkqz" type_code="search_type"
    // — the type card's NAME is the random string "qnzkqz", but its
    // codename (the codehash lookup) is "search_type". The prepare
    // phase's Search gate (render.ts:1100) was previously keyed on
    // typeName === "Search", which silently skipped this corpus entry,
    // and JSON.parse was never called on the content — the BadQuery
    // sentinel was never raised (3,122 captures hit this bucket).
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      // The corpus-shaped type card: name="qnzkqz" (NOT "Search"),
      // codename="search_type".
      await seedCard(storage, { id: 30, name: "qnzkqz", codename: "search_type", typeId: 2 });
      // The simple card shape whose :open view raises — mirrors id=101's
      // content. The content MUST be raw non-JSON so JSON.parse throws,
      // matching the corpus content "jjmduarnmhbvnahsoeyvmxkpec" shape
      // (random alphabetic).
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
    // Same corpus-shaped type card (qnzkqz / search_type) + content
    // shape, but the :content view is also captured as
    //   CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: jjmdu...
    // for id=101 (the corpus pins both views). The :content view
    // dispatches through :core -> :card_list -> executeSearch, the same
    // path :open takes, so the codename-keyed gate fires here too.
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
    // Corpus arbiter (R4 lazy-parse seam): across all 105 corpus search-type
    // cards, :closed and :title captured REAL bytes (105/105 each) while
    // :open/:content captured CAPTURE_ERROR on the 24 invalid-content cards.
    // Ruby parses only the result-rendering views; the raise lives at the
    // dispatch boundary (engine.resolveView), view-gated on :open/:content.
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
      // The parsing views still raise at the dispatch boundary.
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
    // Corpus arbiter (R4 lazy-parse seam, rule asymmetry): search-type RULE
    // cards — 3-part name, right part a setting ("*layout+*right+*content
    // options", corpus:316/571/9610) — captured REAL :open/:content bytes
    // (48 *content options + 27 *structure rules, zero CAPTURE_ERROR), while
    // every CAPTURE_ERROR search card is non-rule. Ruby's dispatched view for
    // a rule card is not the cardtype's parse view, so the boundary skips
    // rule cards (computeIsRuleSync). Non-rule search cards still raise.
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 30, name: "qnzkqz", codename: "search_type", typeId: 2 });
      // The rule predicate's type anchors (render.ts computeIsRuleSync):
      // left part's type is the SET cardtype, right part's type is the
      // SETTING cardtype.
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
        typeId: 30, // search TYPE card: the cardtype is search, the SET says rule
        dbContent: "lkxchgttdixjvgdasd",
      });
      // The rule card renders (no parse) — the corpus shape.
      const openHtml = await storage.engine.render("Lesson+*right+*content_options", "open");
      expect(typeof openHtml).toBe("string");
      expect(openHtml).not.toContain("CAPTURE_ERROR");
      // A NON-rule search card with the same content shape still raises.
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

  // ----- the corpus-v2 replay sentinel contract ----------------------------

  it("the raised error reproduces the exact CAPTURE_ERROR sentinel bytes the corpus:77 capture recorded", () => {
    // Direct byte-equality pin: corpus:77:open expected
    //   CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: fr
    // (the corpus id=77 capture's stored content was "fr"; the TS port
    // raises with whatever raw content it sees, byte-exact).
    const err = badQuery("fr");
    const sentinel = `CAPTURE_ERROR: ${err.constructor.name}: ${err.message}`;
    expect(sentinel).toBe(
      "CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: fr",
    );
  });
});
