

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

const PARTICIPATING_CQL = JSON.stringify({
  type: "Project",
  plus: ["Participant(s)", { refer_to: "_left" }],
});

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

  await seedReference(storage, 610, 500, "jane_doe");
  await seedReference(storage, 611, 500, "jane_doe");
}

describe("participating-section search: deck-table keying + host-context _left", () => {
  it("renders both projects where the pre-fix engine returned zero rows", async () => {

    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    const storage = await createRenderTestStorage();
    try {
      await seedParticipatingDeck(storage);

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

    applyDeckInflections(ORACLE_DECK_INFLECTIONS);
    const storage = await createRenderTestStorage();
    try {
      await seedParticipatingDeck(storage);

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

      const withContext = await executeQuery(storage.counting, statement, {
        parse: { context: "Jane Doe+Participating Search", resolveCardId },
      });
      expect("rows" in withContext ? withContext.rows.map((r) => r.id).sort() : []).toEqual([
        600, 601,
      ]);

      const withoutContext = await executeQuery(storage.counting, statement, {
        parse: { resolveCardId },
      });
      expect("rows" in withoutContext ? withoutContext.rows : []).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
