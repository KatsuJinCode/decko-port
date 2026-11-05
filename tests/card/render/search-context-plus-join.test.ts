/**
 * Regression: the "+Project(s) Participating" search shape — the CQL
 * `{"type":"Project","plus":["Participant(s)",{"refer_to":"_left"}]}` that
 * serves the Person participating sections (2026-09-25 staging defect: both
 * the Brandon_WilliamsCraig and Jamie_Zimron sections rendered "0 results").
 *
 * Two stacked engine defects, both pinned here:
 *
 * 1. DECK-TABLE KEYING. The plus clause names the junction right
 *    "Participant(s)"; the corpus stores its live-Ruby key `participant_s`
 *    while the default English inflections compute `participant_` (the lone
 *    "s" segment singularizes to ""). The deck's inflection table
 *    (ORACLE_DECK_INFLECTIONS) must be applied at boot BEFORE the engine
 *    parses/keys names, so the CQL name resolver's
 *    `idsByKey.get(DeckoName.parse(name).key)` hits the stored row instead
 *    of falling back to Ruby's -999 sentinel.
 *
 * 2. HOST-NAME CONTEXT. Ruby's search runs in the search card's own name
 *    context (card-mod-search passes `context: name` to Card::Query), so
 *    `refer_to: "_left"` absolutizes against the junction's left — the host
 *    person. runSearch now passes `context: card.name.s` (src/card/render.ts);
 *    without it root.context is "" and the relative reference resolves to
 *    the sentinel even with every key resolvable.
 *
 * The seeded deck mirrors the corpus shape (Jane Doe stands in for Brandon /
 * Jamie; explicit STORED keys so seeding is independent of the engine's
 * current inflection state, exactly like a corpus written by live Ruby).
 */

import { afterEach, describe, expect, it } from "vitest";
import { executeQuery } from "../../../src/cql/execute.js";
import { DeckoName } from "../../../src/card/name.js";
import {
  applyDeckInflections,
  resetDeckInflections,
} from "../../../src/card/name/inflect.js";
import { ORACLE_DECK_INFLECTIONS } from "../../../src/card/name/oracle-deck-inflections.js";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";

afterEach(() => {
  resetDeckInflections();
});

/** The Brandon/Jamie participating-section statement (card 422's *query). */
const PARTICIPATING_CQL = JSON.stringify({
  type: "Project",
  plus: ["Participant(s)", { refer_to: "_left" }],
});

/** The corpus-shaped deck: person 500, the junction-right card 400 (stored
 *  key participant_s), two projects, their +Participant(s) junctions with
 *  live-written reference rows, and the person-scoped Search junction card.
 *  Keys are EXPLICIT so seeding never depends on the engine's inflection
 *  state — the corpus keys were written by live Ruby, not by us. */
async function seedParticipatingDeck(storage: RenderTestStorage): Promise<void> {
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
  await seedCard(storage, { id: 700, name: "Project", typeId: 2 });
  await seedCard(storage, { id: 400, name: "Participant(s)", key: "participant_s", typeId: 2 });
  await seedCard(storage, { id: 500, name: "Jane Doe", typeId: 2 });
  await seedCard(storage, { id: 600, name: "mythopsychology", typeId: 700 });
  await seedCard(storage, { id: 601, name: "NCDD", typeId: 700 });
  await seedCard(storage, {
    id: 610,
    name: "mythopsychology+Participant(s)",
    key: "mythopsychology+participant_s",
    leftId: 600,
    rightId: 400,
    typeId: 2,
  });
  await seedCard(storage, {
    id: 611,
    name: "NCDD+Participant(s)",
    key: "ncdd+participant_s",
    leftId: 601,
    rightId: 400,
    typeId: 2,
  });
  await seedCard(storage, { id: 410, name: "Participating Search", typeId: 2 });
  await seedCard(storage, {
    id: 510,
    name: "Jane Doe+Participating Search",
    key: "jane_doe+participating_search",
    leftId: 500,
    rightId: 410,
    typeId: 98,
    dbContent: PARTICIPATING_CQL,
  });
  // card_references rows the refer_to tie reads (live writes them on save:
  // referer = the +Participant(s) junction, referee = the person, ref_type L).
  await seedReference(storage, 610, 500, "jane_doe");
  await seedReference(storage, 611, 500, "jane_doe");
}

describe("participating-section search: deck-table keying + host-context _left", () => {
  it("renders both projects where the pre-fix engine returned zero rows", async () => {
    // deck boot FIRST (the Rails-initializer moment), then seed, then render
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    const storage = await createRenderTestStorage();
    try {
      await seedParticipatingDeck(storage);
      // warm the sync id map the way a host-page render does (idsByKey fills
      // only through enrichment; production enriches the host, the junction
      // right, and the type card before the search card's CQL parses)
      await storage.engine.render("Jane Doe", "content");
      await storage.engine.render("Participant(s)", "content");
      await storage.engine.render("Project", "content");

      const html = await storage.engine.render("Jane Doe+Participating Search", "content");
      expect(html).toContain("mythopsychology");
      expect(html).toContain("NCDD");
      expect(html).not.toContain("search-no-results");
    } finally {
      storage.close();
    }
  });

  it("resolves CQL name arguments through the deck lexicon without any page enrichment", async () => {
    // The statement's own name arguments ("Participant(s)", "Project") are
    // not nest references, so the page walk never enriches them and
    // idsByKey misses — Ruby answers through Card::Lexicon, the port through
    // runSearch's lexicon.peekId fallback. Prime ONLY the lexicon (what
    // origins do at boot: vm-staging-server primeEngine step 3) and render
    // the search card cold: no warm renders, no idsByKey entries.
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    const storage = await createRenderTestStorage();
    try {
      await seedParticipatingDeck(storage);
      // the async id() hits the db and warms the peek cache (the sync
      // fallback is warm-only by contract)
      await storage.fetcher.lexicon.id("Participant(s)");
      await storage.fetcher.lexicon.id("Project");

      const html = await storage.engine.render("Jane Doe+Participating Search", "content");
      expect(html).toContain("mythopsychology");
      expect(html).toContain("NCDD");
    } finally {
      storage.close();
    }
  });

  it("refer_to:_left absolutizes against the parse context (executeQuery level)", async () => {
    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    const storage = await createRenderTestStorage();
    try {
      await seedParticipatingDeck(storage);
      const resolveCardId = (nameish: string): number | undefined => {
        const byKey: Record<string, number> = {
          project: 700,
          participant_s: 400,
          jane_doe: 500,
        };
        return byKey[DeckoName.parse(nameish).key];
      };
      const statement = JSON.parse(PARTICIPATING_CQL) as Record<string, unknown>;

      // WITH the search card's name as context: _left -> Jane Doe, the
      // reference tie finds her two +Participant(s) junctions
      const withContext = await executeQuery(storage.counting, statement, {
        parse: { context: "Jane Doe+Participating Search", resolveCardId },
      });
      expect("rows" in withContext ? withContext.rows.map((r) => r.id).sort() : []).toEqual([
        600, 601,
      ]);

      // WITHOUT context (the pre-fix runSearch behavior): the relative
      // reference cannot absolutize and the query returns zero rows
      const withoutContext = await executeQuery(storage.counting, statement, {
        parse: { resolveCardId },
      });
      expect("rows" in withoutContext ? withoutContext.rows : []).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
