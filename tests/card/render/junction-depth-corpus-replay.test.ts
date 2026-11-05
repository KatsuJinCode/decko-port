

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
