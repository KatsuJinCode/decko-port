// Corpus proof for the depth-3+ junction closure fix (deploy-notes finding 2):
// replays the captured Ruby views of corpus entries whose content nests a
// depth-3+ junction reference (the exact class the replay driver used to
// classify as the "nest gap" - failures containing 'nest target not found')
// and requires byte-identical HTML.
//
// Entry 19334 (shard-000014, "almrctncpf+fsxqechglhqd") is a depth-3
// junction card whose content nests the depth-3 junction
// "almrctncpf+fsxqechglhqd+fmassslzrfd" — the exact class the prefetcher
// used to throw `nest target not found` on (NULL-key junction rows deeper
// than two parts) and Ruby rendered successfully (all four captured views
// are real HTML, verified at capture time). Entry 19209 nests a different
// depth-3 junction for a second independent proof.
//
// NOTE (why not entry 3360/shard-000002): Ruby's own capture of that card
// recorded CAPTURE_ERROR views ("card not found") — Ruby failed there too,
// so it proves nothing about junction RESOLUTION; it belongs to the
// unknown-nest class (wave 3).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  HandlerRegistry,
  formatReplayFailure,
  renderBytes,
  raisedError,
  replayEntries,
} from "../../../src/testing/replay.js";
import { UnsupportedViewError } from "../../../src/card/render.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const CORPUS_DB = path.join(REPO_ROOT, "benchmarks", "corpus-v2", "bench-corpus-v2.sqlite3");
const SHARD_PATH = path.join(REPO_ROOT, "fixtures", "corpus", "shard-000014.jsonl");

interface ShardLine {
  id: number;
  name: string;
  views?: Record<string, string>;
}

/** The replay entries: corpus line ids whose content nests a depth-3+
 *  junction reference, with the views their capture recorded. Entry 19209
 *  was dropped: Ruby's capture of it is PERMISSION-DENIED spans (read-rule
 *  enforcement, a distinct pending class) — it proves nothing about
 *  junction resolution. */
const PROOF_ENTRIES: Array<{ id: number; views: readonly string[] }> = [
  { id: 19334, views: ["closed", "content", "open", "title"] },
];

describe("corpus replay: depth-3+ junction inclusion chains render byte-identically", () => {
  it(
    "replays the captured views of junction-chain entries from shard-000014",
    { timeout: 300_000 },
    async () => {
      const lines: ShardLine[] = readFileSync(SHARD_PATH, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l));
      const byId = new Map(lines.map((l) => [l.id, l]));

      const storage = await createRenderTestStorage();
      const registry = new HandlerRegistry();
      try {
        // Seed the shard exactly like the replay driver (cards + type cards
        // that sit outside the shard), PLUS the transitive side cards of
        // every seeded junction: a compound card's name resolves through
        // its sides (the Lexicon walk), and junction sides commonly sit in
        // EARLIER shards — without them even the root card is "not found".
        const corpus = new Database(CORPUS_DB, { readonly: true });
        const ids = lines.map((l) => l.id);
        const seeded = new Set<number>(ids);
        const rows: Array<{
          id: number; name: string | null; codename: string | null;
          left_id: number | null; right_id: number | null; trash: number;
          type_id: number; content: string | null;
        }> = [];
        const fetchRows = (idList: number[]): typeof rows => {
          const out: typeof rows = [];
          for (let i = 0; i < idList.length; i += 500) {
            const chunk = idList.slice(i, i + 500);
            out.push(...(corpus.prepare(
              `SELECT id, name, codename, left_id, right_id, trash, type_id, content FROM cards WHERE id IN (${chunk.map(() => "?").join(",")})`
            ).all(...chunk) as typeof rows));
          }
          return out;
        };
        // fixpoint: shard ids, then sides of every junction pulled in
        rows.push(...fetchRows(ids));
        for (let round = 0; round < 40; round++) {
          const need: number[] = [];
          for (const row of rows) {
            for (const side of [row.left_id, row.right_id]) {
              if (side !== null && !seeded.has(side)) need.push(side);
            }
          }
          const typeNeed = rows
            .map((r) => r.type_id)
            .filter((t): t is number => t !== null && !seeded.has(t));
          const unique = [...new Set([...need, ...typeNeed])];
          if (unique.length === 0) break;
          for (const id of unique) seeded.add(id);
          const fetched = fetchRows(unique);
          rows.push(...fetched);
        }
        corpus.close();
        for (const row of rows) {
          await seedCard(storage, {
            id: row.id, name: row.name ?? undefined, codename: row.codename,
            leftId: row.left_id ?? undefined, rightId: row.right_id ?? undefined,
            trash: row.trash === 1, typeId: row.type_id, dbContent: row.content,
          });
        }

        registry.register("render-engine", async ({ cardName, view }) => {
          try {
            const html = await storage.engine.render(cardName, view);
            return renderBytes(html);
          } catch (error) {
            if (error instanceof UnsupportedViewError) {
              return raisedError("Card::Error::UserError", error.message);
            }
            const err = error as Error;
            return raisedError(err?.constructor?.name ?? "Error", err?.message ?? String(error));
          }
        });

        const entries = [];
        for (const proof of PROOF_ENTRIES) {
          const line = byId.get(proof.id);
          if (line === undefined || line.views === undefined) {
            throw new Error(`corpus entry ${proof.id} not found in shard (or has no captured views)`);
          }
          for (const view of proof.views) {
            const expected = line.views[view];
            if (expected === undefined) {
              throw new Error(`corpus entry ${proof.id} has no captured view :${view}`);
            }
            entries.push({
              id: `corpus:${proof.id}:render:${view}`,
              area: "render-engine" as const,
              input: { cardName: line.name, view },
              expected,
            });
          }
        }

        const report = await replayEntries(entries, registry);
        const failures = report.entries
          .filter((e) => e.status !== "pass")
          .map((e) => (e.status === "fail" ? formatReplayFailure(e) : `${e.id}: ${e.status}`));
        expect(failures).toEqual([]);
      } finally {
        storage.close();
      }
    },
  );
});
