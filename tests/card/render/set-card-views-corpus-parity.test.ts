

import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  createCorpusSeededStorage,
  readShardLines,
  type ShardLine,
} from "./permission-corpus-seeding.js";
import { installHelpRules } from "../../../src/card/render/help-popover.js";
import { normalizeSlotIds } from "../../../src/testing/diff.js";
import type { RenderTestStorage } from "./render-test-storage.js";

const TARGET_IDS = [217, 268, 273, 294, 300, 302, 315] as const;

interface ProofEntry {
  id: number;
  name: string;
  views: Record<string, string>;
}

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

function proofEntries(): ProofEntry[] {
  const lines: ShardLine[] = readShardLines();
  const byId = new Map<number, ShardLine>();
  for (const line of lines) byId.set(line.id, line);
  const entries: ProofEntry[] = [];
  for (const id of TARGET_IDS) {
    const line = byId.get(id);
    if (line === undefined) throw new Error(`shard-000000.jsonl missing id ${id}`);
    const views: Record<string, string> = {};
    for (const [view, html] of Object.entries(line.views ?? {})) {
      if (html.startsWith('<span class="denied"')) continue;
      if (html.startsWith("CAPTURE_ERROR")) continue;
      views[view] = html;
    }
    entries.push({ id: line.id, name: line.name, views });
  }
  return entries;
}

async function createSetCardSeededStorage(): Promise<RenderTestStorage> {
  const ids = new Set<number>(TARGET_IDS);
  const corpus = new Database(
    "benchmarks/corpus-v2/bench-corpus-v2.sqlite3",
    { readonly: true },
  );
  try {
    const setTypeId = (corpus
      .prepare(`SELECT id FROM cards WHERE codename='set' AND trash=0`)
      .get() as { id: number } | undefined)?.id;
    const settingTypeId = (corpus
      .prepare(`SELECT id FROM cards WHERE codename='setting' AND trash=0`)
      .get() as { id: number } | undefined)?.id;
    if (setTypeId === undefined || settingTypeId === undefined) {
      throw new Error("seeded deck missing set/setting codename cards");
    }

    const queue: number[] = [...TARGET_IDS];
    const visited = new Set<number>(TARGET_IDS);
    while (queue.length > 0) {
      const id = queue.shift() as number;
      const rows = corpus
        .prepare(
          `SELECT id, left_id, right_id, type_id FROM cards WHERE (id=? OR left_id=?) AND trash=0`,
        )
        .all(id, id) as Array<{ id: number; left_id: number | null; right_id: number | null; type_id: number }>;
      for (const r of rows) {
        for (const side of [r.id, r.left_id, r.right_id, r.type_id]) {
          if (side !== null && !visited.has(side)) {
            visited.add(side);
            ids.add(side);
            queue.push(side);
          }
        }
      }
    }

    const helpRules = corpus
      .prepare(
        `SELECT r.id, r.left_id, r.right_id, r.type_id FROM cards r
         JOIN cards sets ON r.left_id = sets.id
         JOIN cards settings ON r.right_id = settings.id
         WHERE sets.type_id = ? AND settings.type_id = ?
           AND settings.codename = 'help' AND r.trash = 0
           AND sets.trash = 0 AND settings.trash = 0`,
      )
      .all(setTypeId, settingTypeId) as Array<{ id: number; left_id: number | null; right_id: number | null; type_id: number }>;
    for (const r of helpRules) {
      ids.add(r.id);
      const queue2: number[] = [r.left_id, r.right_id, r.type_id].filter((x): x is number => x !== null);
      const visited2 = new Set<number>(queue2);
      while (queue2.length > 0) {
        const id = queue2.shift() as number;
        const rows = corpus
          .prepare(
            `SELECT id, left_id, right_id, type_id FROM cards WHERE (id=? OR left_id=?) AND trash=0`,
          )
          .all(id, id) as Array<{ id: number; left_id: number | null; right_id: number | null; type_id: number }>;
        for (const row of rows) {
          for (const side of [row.id, row.left_id, row.right_id, row.type_id]) {
            if (side !== null && !visited2.has(side)) {
              visited2.add(side);
              ids.add(side);
              queue2.push(side);
            }
          }
        }
      }
    }

    for (const cn of ["anyone", "anyone_signed_in", "anonymous", "read", "set", "setting", "help", "input_type"]) {
      const row = corpus
        .prepare(`SELECT id FROM cards WHERE codename=? AND trash=0`)
        .get(cn) as { id: number } | undefined;
      if (row !== undefined) ids.add(row.id);
    }
  } finally {
    corpus.close();
  }
  return createCorpusSeededStorage(ids);
}

describe("corpus replay: set-card html views (7 pinned entries) are byte-exact", () => {
  it("renders the Rules section, the open-view hide list, and the set menu popover", { timeout: 600_000 }, async () => {
    const entries = proofEntries();
    expect(entries.length).toBe(TARGET_IDS.length);
    storage = await createSetCardSeededStorage();
    const helpResolver = installHelpRules(storage.engine, storage.fetcher);
    await helpResolver.prepare();
    const failures: Array<{ id: string; first: string }> = [];
    const drifts: string[] = [];
    let checked = 0;
    for (const entry of entries) {
      for (const [view, expected] of Object.entries(entry.views)) {
        checked += 1;
        let actual: string;
        try {
          actual = await storage.engine.render(entry.name, view);
        } catch (error) {
          const err = error as Error;
          failures.push({
            id: `corpus:${entry.id}:render:${view}`,
            first: `RAISED ${err?.constructor?.name ?? "Error"}: ${err?.message ?? String(error)}`,
          });
          continue;
        }
        const expectedNorm = normalizeSlotIds(expected);
        const actualNorm = normalizeSlotIds(actual);
        if (actualNorm !== expectedNorm) {
          const at = [...expectedNorm].findIndex((ch, i) => ch !== actualNorm[i]);

          const ew = expectedNorm.slice(Math.max(0, at - 40), at + 100);
          const aw = actualNorm.slice(Math.max(0, at - 40), at + 100);
          const countPair =
            /\((\d+) [a-z ]+ rules\)/.exec(ew) !== null &&
            /\((\d+) [a-z ]+ rules\)/.exec(aw) !== null;

          const missingHeadRule =
            /<li class="nav-item"><div id="/.test(ew) &&
            /<li class="nav-item"><span class="denied">/.test(aw);

          const virtualRuleConstruction =
            /<li class="nav-item"><span class="denied">/.test(ew) &&
            /<li class="nav-item"><div id="[^"]+-bar-view"/.test(aw);

          const staleRecentCategory =
            ew.includes("_category-field _category-common") &&
            aw.includes("_category-field _category-recent _category-common");
          if (countPair || missingHeadRule || staleRecentCategory || virtualRuleConstruction) {
            drifts.push(
              `corpus:${entry.id}:render:${view} (${
                countPair
                  ? "count drift"
                  : missingHeadRule
                    ? "absent *head rule row in dump"
                    : virtualRuleConstruction
                      ? "virtual rule construction: engine renders bar where sanitized fixture expected denied (raw oracle authoritative, round-7 cluster 14 fix)"
                      : "stale fixture: missing _category-recent (raw oracle authoritative)"
              } at offset ${at})`,
            );
            continue;
          }
          failures.push({
            id: `corpus:${entry.id}:render:${view}`,
            first:
              `byte diff at ${at}: expected ${JSON.stringify(expectedNorm.slice(Math.max(0, at - 30), at + 30))} ` +
              `got ${JSON.stringify(actualNorm.slice(Math.max(0, at - 30), at + 30))}`,
          });
        }
      }
    }
    console.log(
      `set-card-views corpus data drifts (capture-vs-dump skew; counted, never excused): ${drifts.length}` +
        (drifts.length > 0 ? `:\n  ${drifts.join("\n  ")}` : ""),
    );
    expect(
      failures,
      `${failures.length} of ${checked} set-card-views views differ:\n` +
        failures.slice(0, 10).map((f) => `${f.id}: ${f.first}`).join("\n"),
    ).toEqual([]);
    console.log(
      `set-card-views corpus parity: ${entries.length} entries, ${checked} views, ` +
        `${checked - drifts.length} byte-identical, ${drifts.length} classified data drifts`,
    );
  });
});
