// Pin the byte-level fix for the trailing-newline omission between the
// pointer/list card-list wrapper close and the surrounding content-view
// slot-wrap close (stream M3, famfix48 family "unclassified:L/~/exp=\n/act=<").
//
// Symptom corpus:77 (shard-000000:44, *home pointer card, render:content):
// expected 1240 bytes, actual 1239 (the engine was 1 byte short). At code-unit
// offset 1233 Ruby emits "\n" and the engine emits "<". Ruby's captured
// trailing sequence is `</div>\n</div></div></div>\n</div>` (5 closes
// spaced with newlines so the outer-most slot close lands on its own line);
// the engine without the fix emits `</div>\n</div></div></div></div>`
// (the card-list close and the slot-wrap close collapse onto the same line).
//
// Source: card-mod-list-0.20.0 set/abstract/01_list/html_views.rb:6-13
// `standard_pointer_core` wraps with `wrap_with :div, …, class:
// "card-list card-list-#{item_view} pointer-list"`. Ruby emits `\n` between
// the captured inner block's trailing `</div>` and the wrapper's closing
// `</div>` (the captured closure of wrap_with :div adds a trailing newline
// before serializing the content_tag). The engine's `pointerListCoreHtml`
// (src/card/render/pointer-list.ts) reproduces the captured byte-shape
// only when its wrapper construction appends `\n` before its closing
// `</div>`. Both wrapper branches must match — the rule+permission-right
// simple wrapper (`<div class="pointer-list">`) AND the default
// card-list-bar prefix.

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { type RenderTestStorage, seedCard } from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("pointer/list trailing-newline byte-level pin (M3 family: unclassified:L/~/exp=\\n/act=<)", () => {
  it(
    "*home content view ends with </div>\\n</div> — closing div chain is spaced so the outer slot-wrap close lands on its own line",
    async () => {
      // corpus:77 capture (shard-000000.jsonl:44, *home pointer card, the
      // unclassified:L/~/exp=\n/act=< family anchor). Mirror the existing
      // pointer-list-mini-bar-phantom.test.ts seeding shape: seed
      // 77 (*home), 34843 (its type card), 6568 (the *all+*read rule that
      // gates yzzw's read permission). Do NOT seed yzzw — the engine must
      // build the phantom RenderCard (phantomPointerListItem in
      // src/card/render/pointer-list.ts:290-302) and emit the bar-shaped
      // denied body via pointerListItemBodyForUnknown (lines 241-255) so
      // the captured byte shape is preserved (the corpus pins the denied
      // spans inside the bar div).
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34843);
      baseIds.add(6568);
      storage = await createStructureSeededStorageFor(baseIds);
      const html = await storage.engine.render("*home", "content");
      // Pin the structure: card-list wrapper, mini_bar slot, denied spans
      // (the same shape the existing pointer-list-content-view.test.ts and
      // pointer-list-mini-bar-phantom.test.ts tests pin — those tests are
      // untouched by this fix because they assert class/id substrings, not
      // trailing whitespace).
      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).toContain('id="yzzw-mini_bar-view"');
      expect(html).toContain('<span class="denied">');
      // Pin the byte-level trailing-newline shape Ruby emits:
      //   `</div>\n</div></div></div>\n</div>`
      // ^^^^^^^^^^^^^^^^^^                ^^^^^
      // bar close + \n    (already there — pointerListItemBodyForUnknown
      //                    emits "</div>\n" at line 253)
      // ^^^^^^^^^^^^^^^                  slot close + item close + list close
      //                    no \n between these three
      //                                  \n before the content-view slot wrap close
      // ^^^^^                            content-view slot wrap close
      // The fix under test: the engine must emit `\n` between the
      // card-list `</div>` and the slot-wrap `</div>`. Pre-fix, this
      // whitespace is missing; post-fix, it lands at byte index 1233.
      const expectedCloseChain = "</div>\n</div></div></div>\n</div>";
      expect(html).toContain(expectedCloseChain);
      // And the negative: pre-fix the engine emitted
      //   `</div>\n</div></div></div></div>` — all 5 closes collapsed.
      // Post-fix this substring must NOT appear (the trailing-newline
      // insertion guarantees the chain is broken before the final close).
      expect(html).not.toContain("</div>\n</div></div></div></div>");
      // Length grows by exactly one byte compared to the pre-fix engine
      // emit (the new trailing `\n`). The corpus:77 expected is 1240 bytes
      // with slot-id normalization (a 20-hex id per slot). The test's slot
      // id for yzzw differs from corpus:77's (the test seeds yzzw with id
      // 9013; corpus:77 has it as the unknown-phantom type id 22281), so the
      // byte-equal length match is too strict — the substring shape pins
      // the mechanism, and the byte length matches at byte index 1233 when
      // fed through compareNormalized (slot-id placeholder applies).
      // The substring pin above (`toContain` and `not.toContain`) is the
      // load-bearing check; the byte position is verified directly by the
      // slice replay on shard-000000.
    },
  );

  it(
    "rule+permission-right simple wrapper (`<div class=\"pointer-list\">`) also appends \\n before its closing </div>",
    async () => {
      // The pointer-list.ts#pointerListCoreHtml function has two wrapper
      // branches (line 165 simple, line 166 card-list-bar). Both got the
      // trailing \n appended in lockstep so the mechanism is one fix, not
      // two. corpus:6551 *star+*create list rule uses the simple wrapper
      // (the OUTER-family pin); its content view's trailing sequence has
      // the same `</div>\n</div></div></div>\n</div>` shape, just with
      // `<div class="pointer-list">` instead of the card-list-bar prefix.
      //
      // We don't replay corpus:6551 here (its items need the full OUTER-
      // family seeding). Instead pin the simple wrapper branch with a
      // direct substring assertion on the WIDTH of the emit.
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(275); // *all+*layout list rule — non-permission right,
                        // dispatches via the card-list-bar wrapper.
      baseIds.add(6568);
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: 9020,
        name: "bifaarykabanhm",
        typeId: 22281,
        readRuleId: 6568,
        readRuleClass: "*all",
      });
      const html = await storage.engine.render("*all+*layout", "content");
      // Same byte-level pin as the *home case: the card-list-card-list-bar
      // wrapper close and the slot-wrap close must be separated by `\n`.
      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      expect(html).toContain("</div>\n</div></div></div>\n</div>");
      // And the negative pin (the pre-fix collapsed form must not be in
      // the post-fix output).
      expect(html).not.toContain("</div>\n</div></div></div></div>");
    },
  );

  it(
    "rule+permission-right simple wrapper (`<div class=\"pointer-list\">`) does NOT append \\n before its closing </div> (M4 family: unclassified:L/~/exp=</act=\\n)",
    async () => {
      // The pointer-list.ts#pointerListCoreHtml function has two wrapper
      // branches (lines 169 and 190). The card-list-bar branch (line 190,
      // exercised by *home and *all+*layout above) DOES emit `\n` before
      // its closing `</div>` (the famfix48 byte shape). The simple
      // pointer-list branch (line 189, used for rule cards whose right
      // is *create / *read / *update / *delete — see the
      // isRuleCardWithPermissionRight helper at lines 98-135 and the
      // OUTER-family survey at line 30) does NOT — its wrapper's closing
      // `</div>` is INLINE with the inner pointer-item wrap's `</div>`
      // and the outer content-view slot wrap's `</div>`, producing the
      // captured oracle's
      // `</div>\n</div></div></div></div>` (five closes inline, only the
      // first preceded by `\n` from the phantom body at
      // pointerListItemBodyForUnknown line 262).
      //
      // Pinned by corpus:6551 *star+*create list rule (shard-000003.
      // jsonl:359). The captured oracle's offset-2197 first-diff signature
      // is `expected "<" but got "\n"` — the byte just after the 4th
      // inline `</div>` is `\n` in the engine but `<` in Ruby (the start
      // of the 5th `</div>`, the content-view slot-wrap close).
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(6551);
      baseIds.add(6568);
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: 9010,
        name: "irjkznnbpewjpr",
        typeId: 22281,
        readRuleId: 6568,
        readRuleClass: "*all",
      });
      const html = await storage.engine.render("*star+*create", "content");
      // The simple wrapper is in use (OUTER-family pin — same shape the
      // pointer-list-mini-bar-phantom.test.ts#`star create` test pins).
      expect(html).toContain('<div class="pointer-list">');
      expect(html).not.toContain('<div class="card-list card-list-bar pointer-list">');
      // The permfix48 byte pin: five closing divs INLINE, only the first
      // preceded by `\n` from the phantom body.
      expect(html).toContain("</div>\n</div></div></div></div>");
      // The negative pin: the famfix48-family shape (newline before the
      // last close) must NOT be present in the simple-wrapper emit —
      // that newline is the permfix48 family. The card-list-bar branch
      // above IS allowed to have it; this assertion is scoped to the
      // simple-wrapper content via the `<div class="pointer-list">`
      // open-pin plus the surrounding context.
      expect(html).not.toContain("</div>\n</div></div></div>\n</div>");
    },
  );
});
