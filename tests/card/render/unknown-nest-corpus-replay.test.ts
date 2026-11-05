// Corpus proof for the unknown-nest fix: replays the captured Ruby views of
// corpus entries whose content nests cards that DO NOT EXIST (the unknown-
// card nest class) and requires byte-identical HTML.
//
// Ruby mechanism (card-1.110.0): a nest fetch miss does not raise -
// format/nest/fetch.rb#new_card calls `Card.fetch cardish, new: new_card_args`
// and fetch/results.rb returns the NEW unknown card (`card if new_opts ||
// card.known?`). The requested view then routes through view/permission.rb
// #alter_unknown -> format/error.rb#view_for_unknown: the default :titled
// nest view has no `unknown:` config, so it substitutes :unknown, whose
// createable branch is create-denied for the captured deck's anonymous
// viewer - the nest renders the EMPTY STRING (pinned below by entries whose
// expected HTML shows `<p></p>` where `{{absent}}` stood).
//
// Entries (fixtures/corpus/shard-000000.jsonl; all captured views replayed):
//   640  uiqxodma               one absent-target nest (minimal oracle:
//                               expected content view is `<p></p>`)
//   643  zwtal                  one absent-target nest
//   639  tgpqpf                 three absent-target nests inside blockquote
//                               + hr markup
//   1120 bxhxfeqsnktaziadgdhcr  four absent-target nests
//
// These entries are the shard-0 nestGap class the replay driver used to
// count as `nest target not found` failures (docs/unknown-nest-notes.md).
// Before this fix the TS engine threw `nest target not found` from
// src/card/render/format.ts where Ruby rendered empty strings.
//
// Deliberately NOT proof entries:
//   636 (the `{{}}` blank-reference edge case) and 650/1121/1123/1213:
//   636's slot classes carry the RULE set-key the set-keys stream has in
//   flight (observed-not-mine failure class), and 650/1121/1123/1213 are
//   structure-rule cards - their captured record.content is the *structure
//   rule template, not db_content (the replay driver's structure-pending
//   class), so they judge the rules stream, not the nest renderer. The
//   `{{}}` blank reference is exercised at unit level in
//   unknown-nest-blank-reference.test.ts instead.

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
const SHARD_PATH = path.join(REPO_ROOT, "fixtures", "corpus", "shard-000000.jsonl");

interface ShardLine {
  id: number;
  name: string;
  views?: Record<string, string>;
}

const PROOF_ENTRIES: readonly number[] = [640, 643, 639, 1120];

describe("corpus replay: unknown-card nests render Ruby's unknown views byte-identically", () => {
  it(
    "replays the captured views of absent-target nest entries from shard-000000",
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
        // every seeded junction - the same seeding loop
        // tests/card/render/junction-depth-corpus-replay.test.ts uses.
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
          rows.push(...fetchRows(unique));
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
        for (const proofId of PROOF_ENTRIES) {
          const line = byId.get(proofId);
          if (line === undefined || line.views === undefined) {
            throw new Error(`corpus entry ${proofId} not found in shard (or has no captured views)`);
          }
          for (const [view, expected] of Object.entries(line.views)) {
            entries.push({
              id: `corpus:${proofId}:render:${view}`,
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
