

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";
import { CORPUS_DB } from "./permission-corpus-seeding.js";
import { createStructureSeededStorageFor } from "./structure-corpus-seeding.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
} from "../../../src/card/rules/structure.js";

describe("seedCard junction rows keep their canonical key (option b)", () => {
  it("stores the canonical key on a junction row (name stays NULL for the Lexicon's id-pair lexes)", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 901, name: "quiz", typeId: 2 });
      await seedCard(storage, { id: 902, name: "*type", typeId: 2 });
      await seedCard(storage, { id: 900, name: "quiz+*type", leftId: 901, rightId: 902, typeId: 2 });
      const result = await storage.counting.query<{ name: string | null; key: string | null }>(
        `SELECT name, "key" FROM cards WHERE id = 900`,
        [],
      );
      const row = result.rows[0];

      expect(row?.name).toBeNull();
      expect(row?.key).toBe("quiz+*type");
    } finally {
      storage.close();
    }
  });
});

describe("the *structure rule universe reaches the corpus truth on the seeded deck", () => {
  it(
    "composes 139 rule keys on the full-deck seed (the 115 vs 139 gap is closed)",
    { timeout: 600_000 },
    async () => {
      const idLister = new Database(CORPUS_DB, { readonly: true });
      const everyLiveId = (
        idLister.prepare("SELECT id FROM cards WHERE trash = 0").all() as Array<{ id: number }>
      ).map((r) => r.id);
      idLister.close();

      const storage = await createStructureSeededStorageFor(new Set(everyLiveId));
      try {
        const universe = structureUniverseFromResults(
          (await storage.fetcher.driver.batch([structureRuleUniverseStatement()]))[0],
        );

        expect(universe.size).toBe(139);

        const twoJunctionAnchors = [
          "jzuqht+qxqvhzwvkdqasbmubgttlpkc+*type_plu_right+*structure",
          "*type_plu_right+*right+*structure",
        ];
        for (const key of twoJunctionAnchors) {
          expect(universe.has(key)).toBe(true);
        }
        const typePlusRightKeys = [...universe.keys()].filter((k) =>
          /type_plu_right|type plus right/.test(k),
        );
        expect(typePlusRightKeys.length).toBeGreaterThanOrEqual(17);
      } finally {
        storage.close();
      }
    },
  );
});
