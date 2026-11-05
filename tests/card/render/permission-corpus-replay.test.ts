// Corpus byte-parity for the read-permission denial: replays captured
// corpus views that Ruby rendered as the quiet denial span
// (`<span class="denied"><!-- Sorry, you don't have permission (read)
// --></span>`) and requires byte-identical output from the ported engine —
// plus readable controls from the same shard, which must still render in
// full.
//
// Ruby truth (the oracle): the corpus capture ran as the ANONYMOUS viewer.
// A card whose applicable *read rule does not grant Anyone/Anonymous
// (card-mod-permissions set/all/permissions.rb#ok_to_read? through
// card-mod-account set/abstract/account_holder.rb#read_rules_hash) renders
// the quiet denial span for :closed/:open/:content — the span REPLACES the
// whole view including the card-slot wrapper — while :title keeps
// rendering (perms :none, card-mod-format set/all/title.rb:2, the
// base-format directive the html-format body redefinition inherits).
//
// Entry picks are FIXED corpus ids. The denied picks are structural (any
// card whose captured view is the span); the readable/title/mid picks are
// shard entries whose captured bytes are already repertoired by the
// engine (their other view classes are landed), so a failure here is a
// permission-layer failure, not cross-stream noise.
//
// Seeding (permission-corpus-seeding.ts) carries the FULL read-rule
// context — stored read_rule_id columns, every *read rule card, the rules'
// card_references party grants, the codename cards. That is exactly the
// enrichment the corpus replay flip (permissionPending -> JUDGED) needs.

import { describe, expect, it } from "vitest";
import { normalizeSlotIds } from "../../../src/testing/diff.js";
import {
  createPermissionSeededStorage,
  readShardLines,
  type ShardLine,
} from "./permission-corpus-seeding.js";

const DENIED_PREFIX = '<span class="denied">';

/** Render + byte-compare against the captured HTML (slot-id sentinel
 *  normalized on both sides, the replay harness's contract). */
function expectBytes(actual: string, expected: string, label: string): void {
  expect(normalizeSlotIds(actual), label).toBe(normalizeSlotIds(expected));
}

function byId(lines: ShardLine[], id: number): ShardLine {
  const line = lines.find((l) => l.id === id);
  if (line === undefined) throw new Error(`corpus entry ${id} not in shard`);
  return line;
}

/** The (entry id, view) pairs each class pins. Ids are shard-000000
 *  entries — see the module doc for how they were chosen. */
const DENIED_PICKS: Array<{ id: number; view: string }> = [
  { id: 28, view: "closed" }, // "*all+*default" - a rule card denied whole
  { id: 34, view: "open" }, // "*children+*right+*structure" - compound card
  { id: 34, view: "content" },
  { id: 41, view: "closed" },
  { id: 44, view: "content" },
  { id: 95, view: "open" },
];

const READABLE_PICKS: Array<{ id: number; view: string }> = [
  { id: 1, view: "closed" },
  { id: 1, view: "content" },
  { id: 15, view: "open" },
  { id: 55, view: "content" },
  { id: 66, view: "open" },
];

const DENIED_TITLE_PICKS: Array<{ id: number }> = [{ id: 28 }, { id: 33 }];

/** corpus:581:content - a readable host whose captured view embeds the
 *  denial span for nested denied cards; renders byte-identically. */
const MID_DENIED_PICKS: Array<{ id: number; view: string }> = [
  { id: 581, view: "content" },
];

describe("corpus replay: read-permission denial renders byte-identically", () => {
  it(
    "replays denied + readable captured views from shard-000000",
    { timeout: 600_000 },
    async () => {
      const storage = await createPermissionSeededStorage();
      try {
        const lines = readShardLines();

        for (const { id, view } of DENIED_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.[view];
          if (expected === undefined) throw new Error(`corpus:${id} has no :${view}`);
          expect(
            expected.startsWith(DENIED_PREFIX),
            `corpus:${id}:${view} is a denied capture`,
          ).toBe(true);
          expectBytes(
            await storage.engine.render(line.name, view),
            expected,
            `denied corpus:${id}:${view} (${line.name})`,
          );
        }
        for (const { id, view } of READABLE_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.[view];
          if (expected === undefined) throw new Error(`corpus:${id} has no :${view}`);
          expectBytes(
            await storage.engine.render(line.name, view),
            expected,
            `readable corpus:${id}:${view} (${line.name})`,
          );
        }
        for (const { id } of DENIED_TITLE_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.title;
          if (expected === undefined) throw new Error(`corpus:${id} has no :title`);
          expectBytes(
            await storage.engine.render(line.name, "title"),
            expected,
            `denied-title corpus:${id}:title (${line.name})`,
          );
        }
        for (const { id, view } of MID_DENIED_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.[view];
          if (expected === undefined) throw new Error(`corpus:${id} has no :${view}`);
          expectBytes(
            await storage.engine.render(line.name, view),
            expected,
            `mid-denied corpus:${id}:${view} (${line.name})`,
          );
        }
      } finally {
        storage.close();
      }
    },
  );
});
