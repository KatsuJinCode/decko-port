

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  CORPUS_DB,
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { prewarmStaticDeck } from "../../../benchmarks/corpus-v2/prewarm-static-deck.js";

function bytesEqualModuloRandomSlotId(actual: string, expected: string): boolean {
  const norm = (s: string): string => s.replace(/data-slot-id="[^"]*"/g, 'data-slot-id="RANDOMIZED"');
  return norm(actual) === norm(expected);
}

describe("closed-view hot-spot: applyStructureContent sync pattern input", () => {
  it(
    "renders ynxkmsesggismplqulbsud:closed in O(renderCards) with byte parity",
    { timeout: 600_000 },
    async () => {
      const corpus = new Database(CORPUS_DB, { readonly: true });
      const ids = corpus.prepare("SELECT id FROM cards WHERE trash = 0").all().map((r: any) => r.id);
      corpus.close();
      const storage = await createStructureSeededStorageFor(new Set(ids));
      const tPre = Date.now();
      await prewarmStaticDeck(storage);
      console.log("[bench] prewarm ms:", Date.now() - tPre);

      const targetName = "ynxkmsesggismplqulbsud";
      let expectedClosed = "";
      for (const line of readShardLines()) {
        if (line.name === targetName && line.views && line.views.closed) {
          expectedClosed = line.views.closed as string;
          break;
        }
      }
      expect(expectedClosed).not.toBe("");

      const tSettle = Date.now();
      const settled = await storage.engine.render(targetName, "closed");
      console.log("[bench] first render (settle) ms:", Date.now() - tSettle);
      expect(bytesEqualModuloRandomSlotId(settled, expectedClosed)).toBe(true);

      const engAny = storage.engine as unknown as {
        structureProcessed: Set<string>;
      };
      engAny.structureProcessed = new Set();
      const tCold = Date.now();
      const coldActual = await storage.engine.render(targetName, "closed");
      const coldMs = Date.now() - tCold;
      console.log(`[bench] cold-equivalent closed-view render ms: ${coldMs}`);

      expect(coldMs).toBeLessThan(10_000);
      expect(bytesEqualModuloRandomSlotId(coldActual, expectedClosed)).toBe(true);

      engAny.structureProcessed = new Set();
      const tCold2 = Date.now();
      const coldActual2 = await storage.engine.render(targetName, "closed");
      const coldMs2 = Date.now() - tCold2;
      console.log(`[bench] cold-equivalent closed-view render (run 2) ms: ${coldMs2}`);
      expect(coldMs2).toBeLessThan(10_000);
      expect(bytesEqualModuloRandomSlotId(coldActual2, expectedClosed)).toBe(true);

      const tWarm = Date.now();
      const warmActual = await storage.engine.render(targetName, "closed");
      const warmMs = Date.now() - tWarm;
      console.log(`[bench] warm closed-view render ms: ${warmMs}`);
      expect(warmMs).toBeLessThan(1_000);
      expect(bytesEqualModuloRandomSlotId(warmActual, expectedClosed)).toBe(true);

      storage.close();
    }
  );
});
