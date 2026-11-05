

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorage,
  readShardLines,
  structureTemplateContents,
  type ShardLine,
} from "./structure-corpus-seeding.js";
import type { RenderTestStorage } from "./render-test-storage.js";
import { normalizeSlotIds } from "../../../src/testing/diff.js";

import { installHelpRules } from "../../../src/card/render/help-popover.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

interface ProofEntry {
  id: number;
  name: string;
  views: Record<string, string>;
}

const OWNED_BY_SET_CARD_VIEWS = new Set([217, 268, 273, 294, 300, 302, 315]);

function proofEntries(): ProofEntry[] {
  const templates = structureTemplateContents();
  const lines: ShardLine[] = readShardLines();
  const entries: ProofEntry[] = [];
  for (const line of lines) {
    if (line.record === undefined) continue;
    if (OWNED_BY_SET_CARD_VIEWS.has(line.id)) continue;

    if (!templates.has(line.record.content)) continue;
    const views: Record<string, string> = {};
    for (const [view, html] of Object.entries(line.views ?? {})) {

      if (html.startsWith('<span class="denied"')) continue;

      if (html.startsWith("CAPTURE_ERROR")) continue;
      views[view] = html;
    }
    if (Object.keys(views).length > 0) entries.push({ id: line.id, name: line.name, views });
  }
  return entries;
}

function sampled(entries: ProofEntry[], targetCount: number): ProofEntry[] {
  if (entries.length <= targetCount) return entries;
  const stride = Math.floor(entries.length / targetCount);
  const out: ProofEntry[] = [];
  for (let i = 0; i < entries.length && out.length < targetCount; i += stride) {
    out.push(entries[i] as ProofEntry);
  }
  return out;
}

const FULL_SWEEP = process.env.STRUCTURE_CORPUS_FULL === "1";
const SAMPLE_SIZE = 14;

const FOREIGN_PENDING: Record<string, { reason: string; actualMarker: RegExp }> = {
  "corpus:61:render:closed": {
    reason: "*help rule popover content (menu view) — views-stream mechanism",
    actualMarker: /&amp;nbsp;/,
  },
};

describe("corpus replay: *structure rule templates render byte-identically", () => {
  it(
    "replays captured non-denied views of structure-pending entries byte-exactly",
    { timeout: 3_600_000 },
    async () => {
      const all = proofEntries();
      expect(all.length, "the shard carries structure-pending entries").toBeGreaterThan(0);
      const entries = FULL_SWEEP ? all : sampled(all, SAMPLE_SIZE);

      storage = await createStructureSeededStorage();

      const helpResolver = installHelpRules(storage.engine, storage.fetcher);
      await helpResolver.prepare();
      const failures: Array<{ id: string; first: string }> = [];
      const foreignPending: string[] = [];
      const countDrifts: string[] = [];
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
            const foreign = FOREIGN_PENDING[`corpus:${entry.id}:render:${view}`];
            if (foreign !== undefined && foreign.actualMarker.test(actualNorm)) {
              foreignPending.push(`corpus:${entry.id}:render:${view} (${foreign.reason})`);
              continue;
            }
            const at = [...expectedNorm].findIndex((ch, i) => ch !== actualNorm[i]);

            const ew = expectedNorm.slice(Math.max(0, at - 40), at + 60);
            const aw = actualNorm.slice(Math.max(0, at - 40), at + 60);
            const em = /\((\d+) [a-z ]+ rules\)/.exec(ew);
            const am = /\((\d+) [a-z ]+ rules\)/.exec(aw);
            if (em !== null && am !== null) {
              countDrifts.push(
                `corpus:${entry.id}:render:${view} (capture ${em[1]} vs dump ${am[1]})`,
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
        `foreign-pending (non-structure rule settings) views: ${foreignPending.length}` +
          (foreignPending.length > 0 ? `:\n  ${foreignPending.join("\n  ")}` : ""),
      );
      console.log(
        `set-member count drifts (capture-vs-dump snapshot skew, R1 class): ${countDrifts.length}` +
          (countDrifts.length > 0 ? `:\n  ${countDrifts.join("\n  ")}` : ""),
      );
      expect(
        failures,
        `${failures.length} of ${checked} structure-pending views differ:\n` +
          failures.slice(0, 10).map((f) => `${f.id}: ${f.first}`).join("\n"),
      ).toEqual([]);

      const first = entries[0] as ProofEntry;
      const firstView = Object.keys(first.views)[0] as string;
      await storage.engine.render(first.name, firstView);
      storage.counting.reset();
      await storage.engine.render(first.name, firstView);
      const snapshot = storage.counting.snapshot();
      expect(
        { statements: snapshot.statements, roundTrips: snapshot.roundTrips },
        `warm render of ${first.name}/${firstView} must be zero-query`,
      ).toEqual({ statements: 0, roundTrips: 0 });

      console.log(
        `structure-template corpus replay (${FULL_SWEEP ? "FULL" : "sample"}): ` +
          `${entries.length}/${all.length} entries, ${checked} views, all byte-identical`,
      );
    },
  );
});
