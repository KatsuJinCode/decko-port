// Pin the junction-key seeding contract (R4 permission lane, lead option
// (b)): the test storage's seedCard stores the corpus name/key on junction
// rows instead of forcing NULL, because the *structure rule universe
// statement (src/card/rules/structure.ts:78-99) composes 2-junction set
// anchors from the STORED key columns — with junction keys forced NULL the
// seeded universe measured 115 vs the corpus truth 139 (probe, 2026-09-23:
// corpus universe rows=139 composed-key non-null=139; SEEDED storage
// universe size=115; after junction-key restore size=139, 39 keys added,
// incl. the type_plus_right shapes the R3 records lane flagged).
//
// Corpus facts the fixture-level pins stand on (bench-corpus-v2.sqlite3,
// probed read-only): junction rows carry name and key on 40,070 of 40,090
// rows; key === name on all 49,809 named rows (the corpus writes the
// verbatim name, which equals the canonical key for these names).
//
// Fetch resolution is deliberately NOT part of this contract: compound
// marks resolve through left_id/right_id (src/card/fetch/retrieve.ts:272 +
// the Lexicon), never through the junction row's own key column — the
// junction-key restore flipped zero renders and zero read verdicts in the
// probe's A/B.

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
      // The KEY is the corpus-carried column the universe SQL composes from
      // (src/card/rules/structure.ts:82-86); the NAME stays NULL so
      // DbLexicon.idToLex keeps the [left_id, right_id] lex shape the
      // synchronous junction resolution reads (lexicon.ts:127-144) — see
      // the seedCard doc for the R3 name+key regression mechanism.
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
        // The corpus truth (probe: corpus universe rows=139, all with
        // non-null composed keys).
        expect(universe.size).toBe(139);

        // 2-junction anchors the forced-NULL convention dropped: the
        // type_plus_right shapes the R3 records lane flagged (17 sets) and
        // the probe's added-key samples. Spelling note: the universe keys
        // are CANONICAL keys (DeckoName.key stems "plus" -> "plu"), which is
        // exactly the spelling the candidate walk (resolveStructuredContent
        // -> DeckoName.parse(candidate).key) looks up — the restore makes
        // both forms resolve.
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
