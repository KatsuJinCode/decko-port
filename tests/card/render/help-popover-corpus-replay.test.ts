// Corpus proof for the menu help popover: replays the captured Ruby views of
// shard-000000 entries whose expected HTML carries REAL help text in
// data-bs-content (where the port hardcoded the &amp;nbsp; placeholder) and
// requires byte-identical HTML.
//
// Ruby mechanism (full citation trail in docs/help-popover-parity-notes.md):
// menu.rb view :help_link -> render_help_text (card-mod-help set/all/help.rb
// help_text/wrap_help_text/help_rule_card) -> bootstrap helper.rb popover_opts
// (blank -> &nbsp;, ERB::Util attribute escaping) - with the two help-text
// sources the corpus exercises:
//   a. rule cards: card.help_rule_card&.content plus the wrap_help_text
//      d-none edit-link span (nested :edit_link of the rule card -> :rule_edit,
//      card-mod-rules set/rule/editor.rb:60-62);
//   b. setting modules: the static raw_help_text strings (setting-help-text.ts)
//      with [[link]] chunks processed at render time.
//
// PROOF ENTRIES (shard-000000; every captured view of each replayed):
//   53  *TinyMCE          setting text (tiny_mce self def, heredoc bytes)
//   61  *thanks           setting text (setting_opts help_text)
//   79  *logo             rule card (qqddl+*type+*help) + d-none span
//   81  *sidebar          setting text (sidebar self def, heredoc bytes)
//   82  *help             setting text (setting_opts help_text)
//   86  *content options  setting text (with wanted-card [[List]]/[[Pointer]]/
//                           [[Search]] link chunks)
//   241 *input type       setting text (format-level raw_help_text def)
//   247 *autoname         setting text
//   252 *content option view  setting text (double-space bytes pinned)
//   255 *layout           setting text (pipe-space link chunk)
//   256 *captcha          setting text
//   317 *structure        setting text
//   318 *default          EMPTY help (no registration, no rule) -> &nbsp;
//   89  *table of contents EMPTY help -> &nbsp;
//
// DELIBERATELY NOT PROOF ENTRIES - the rule-card menus whose captured help
// ends in the board_rules_editor setting_link (set/rule/board_rules_editor.rb:
// 21-27): the "(N <setting> rules)" count is a deck-wide aggregate Ruby
// computed at CAPTURE time; the corpus DB row set is a LATER deck state
// (e.g. Ruby captured "(49 default rules)", the seeded DB resolves to 140),
// so those bytes cannot be reproduced from the provided DB state no matter
// what the renderer does. The mechanism is pinned at unit level
// (help-popover.test.ts "RULE-card variant"). Honest remainder, documented in
// the notes doc.

import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  HandlerRegistry,
  formatReplayFailure,
  renderBytes,
  replayEntries,
  type ReplayEntry,
} from "../../../src/testing/replay.js";
import {
  CORPUS_DB,
  createPermissionSeededStorage,
  readShardLines,
} from "./permission-corpus-seeding.js";
import { installHelpRules } from "../../../src/card/render/help-popover.js";
import { seedCard } from "./render-test-storage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

const PROOF_ENTRIES: readonly number[] = [
  53, 61, 79, 81, 82, 86, 241, 247, 252, 255, 256, 317, 318, 89,
];

interface ShardLine {
  id: number;
  name: string;
  views?: Record<string, string>;
}

/** Seed the help-rule universe straight from the corpus DB with the SAME
 *  statement the resolver's prepare runs (rule cards + transitive sides +
 *  type cards): the shard seeding covers only the shard's own closure, while
 *  a card's help rule can live anywhere in the deck (e.g. *logo's help rule
 *  is qqddl+*type+*help, a shard-3 row). Idempotent against the permission
 *  seeding (same ids, same rows -> INSERT would collide only if the helper
 *  seeded a DIFFERENT row for the same id; it seeds the same corpus DB). */
async function seedHelpRuleUniverse(storage: Awaited<ReturnType<typeof createPermissionSeededStorage>>): Promise<void> {
  const corpus = new Database(CORPUS_DB, { readonly: true });
  const setType = corpus.prepare(`SELECT id FROM cards WHERE codename = 'set' AND trash = 0`).get() as
    | { id: number }
    | undefined;
  const settingType = corpus.prepare(`SELECT id FROM cards WHERE codename = 'setting' AND trash = 0`).get() as
    | { id: number }
    | undefined;
  if (setType === undefined || settingType === undefined) {
    corpus.close();
    throw new Error("corpus DB lacks the set/setting codename cards");
  }
  const sql =
    "WITH RECURSIVE reached(id) AS (\n" +
    "  SELECT rules.id FROM cards rules\n" +
    "    JOIN cards sets ON rules.left_id = sets.id\n" +
    "    JOIN cards settings ON rules.right_id = settings.id\n" +
    "  WHERE sets.type_id = ? AND settings.type_id = ? AND settings.codename = 'help'\n" +
    "    AND rules.trash = 0 AND sets.trash = 0 AND settings.trash = 0\n" +
    "  UNION\n" +
    "  SELECT s.id FROM reached r\n" +
    "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
    "    JOIN cards s ON s.id IN (j.left_id, j.right_id) AND s.id IS NOT NULL\n" +
    "  UNION\n" +
    "  SELECT j.type_id FROM reached r\n" +
    "    JOIN cards j ON j.id = r.id AND j.type_id IS NOT NULL\n" +
    ")\n" +
    "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.id IN (SELECT id FROM reached)";
  const rows = corpus.prepare(sql).all(setType.id, settingType.id) as Array<{
    id: number;
    name: string | null;
    codename: string | null;
    left_id: number | null;
    right_id: number | null;
    trash: number;
    type_id: number;
    content: string | null;
    read_rule_id: number | null;
    read_rule_class: string | null;
  }>;
  corpus.close();
  for (const row of rows) {
    // the permission seeding may already have inserted some of these rows
    // (universe overlap); INSERT only the missing ones
    const existing = await storage.counting.query<{ id: number }>(
      "SELECT id FROM cards WHERE id = ?",
      [row.id],
    );
    if (existing.rows.length > 0) continue;
    await seedCard(storage, {
      id: row.id,
      name: row.name ?? undefined,
      codename: row.codename,
      leftId: row.left_id ?? undefined,
      rightId: row.right_id ?? undefined,
      trash: row.trash === 1,
      typeId: row.type_id,
      dbContent: row.content,
      readRuleId: row.read_rule_id,
      readRuleClass: row.read_rule_class,
    });
  }
}

describe("corpus replay: menu help popovers render Ruby's help text byte-identically", () => {
  it(
    "replays the captured views of the help-text proof entries from shard-000000",
    { timeout: 300_000 },
    async () => {
      const storage = await createPermissionSeededStorage();
      const registry = new HandlerRegistry();
      try {
        await seedHelpRuleUniverse(storage);
        const resolver = installHelpRules(storage.engine, storage.fetcher);
        await resolver.prepare();

        const lines = readShardLines() as unknown as ShardLine[];
        const byId = new Map(lines.map((l) => [l.id, l]));

        registry.register("render-engine", async ({ cardName, view }) => {
          const html = await storage.engine.render(cardName, view);
          return renderBytes(html);
        });

        const entries: ReplayEntry[] = [];
        for (const proofId of PROOF_ENTRIES) {
          const line = byId.get(proofId);
          if (line === undefined || line.views === undefined) {
            throw new Error(`corpus entry ${proofId} not found in shard (or has no captured views)`);
          }
          for (const [view, expected] of Object.entries(line.views)) {
            // The menu/help bytes are view-invariant and fully pinned by the
            // closed view (menu in the accordion subheader, body stubbed) and
            // the title view. The content/open views additionally embed each
            // card's CORE - CodeRay highlighting for *TinyMCE, the sidebar
            // layout for *sidebar, the logo upload for *logo - which are the
            // syntax-highlight/content-core streams' pending classes, not the
            // help popover; replaying them here would judge those streams.
            if (view !== "closed" && view !== "title") continue;
            entries.push({
              id: `corpus:${proofId}:render:${view}`,
              area: "render-engine",
              input: { cardName: line.name, view },
              expected,
            });
          }
        }

        const report = await replayEntries(entries, registry);
        const failures = report.entries
          .filter((e) => e.status !== "pass")
          .map((e) => (e.status === "fail" ? formatReplayFailure(e) : `${e.id}: ${e.status}`));
        if (failures.length > 0) console.log("HELP REPLAY FAILURES:\n" + failures.join("\n---\n"));
        expect(failures).toEqual([]);
      } finally {
        storage.close();
      }
    },
  );
});
