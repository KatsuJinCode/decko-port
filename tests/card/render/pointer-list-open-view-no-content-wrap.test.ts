// Pin the byte-level fix for the dispatch shape the TS engine used
// inside the open-view's accordion-body for pointer/list cardtypes
// (CLUSTER 3 set-card-pointer-list-vs-nested-content, 690 entries on
// shard-0; the narrower permfix48 family `unclassified:L/~/exp=c/act=i`
// is the rule+permission-right subset of the same mechanism).
//
// CLUSTER 3 mechanism (re-pin per cluster doc, with raw expected-byte
// citations from the captured corpus):
//
//   * RULE pointer/list cards — corpus:6551 *star+*create list rule at
//     fixtures/corpus/shard-000003.jsonl:359, render:open — Ruby emits
//     the accordion-body containing `<div class="pointer-list">`
//     directly, with NO surrounding `<div id="X-content-view" class="
//     card-slot content-view …">` slot wrap. The TS engine used to
//     emit the wrap unconditionally (matching only this rule subset);
//     the fix narrows the no-wrap branch to `isRuleCard ||
//     isRuleCardWithPermissionRight`. The rule+permission-right shape
//     (right `*create` / `*read` / `*update` / `*delete`) is the
//     permfix48-family pin — the rule cards whose OUTER wrapper is the
//     simple `<div class="pointer-list">` (the same predicate
//     pointer-list.ts#isRuleCardWithPermissionRight branches on).
//
//   * NON-RULE pointer/list cards — corpus:77 *home pointer at
//     fixtures/corpus/shard-000000.jsonl:44, render:open — Ruby emits
//     the accordion-body containing BOTH the OUTER content-view slot
//     wrap AND the inner pointer-list. Raw expected-byte citation:
//     `...<div class='accordion-body d0-card-body'>\n` +
//     `<div id="Xhome-content-view" class="card-slot content-view ALL TYPE-pointer STAR SELF-Xhome d0-card-content" data-card-id="77" data-card-name="*home" data-card-type-id="34843" data-card-type-name="Pointer" data-card-link-name="*home" data-slot-id="RANDOMIZED" data-slot="{&quot;view&quot;:&quot;content&quot;,&quot;show&quot;:[&quot;open&quot;,&quot;bar_bottom&quot;,&quot;content&quot;],&quot;hide&quot;:[&quot;bar_middle&quot;],&quot;home_view&quot;:&quot;content&quot;}"><div class="card-list card-list-bar pointer-list">...`.
//     corpus:792 Brandon WilliamsCraig+Pages list card at
//     fixtures/corpus/shard-000000.jsonl is the same shape (the
//     canonical set-card-with-right-TYPE example named in the cluster
//     doc). The OLD test pinned the inverse ("no content-view wrap")
//     which encoded the flat shape — the new pin re-pins to the
//     captured oracle with the raw expected-byte citation above.
//
// Source: card-mod-bar_and_box-0.20.0 set/all/bar.rb:9-18 view :bar_bottom
// `render :content, home_view: :content`. Per-item slots still
// dispatch through renderPointerListItem with `view:"bar"` in their
// data-slot — the change is strictly the OUTER accordion-body wrapper,
// not the per-item mini_bar slots.
//
// Cross-shard survey: the 690 cluster entries are the union of rule
// cards (corpus:6551-7118 in shard-000003, parallel entries in
// shard-000004, every entry has `id >= 6551`) and non-rule
// pointer/list cards (corpus:77 *home, corpus:792 Brandon
// WilliamsCraig+Pages, etc.). The byte-diff character pair `c/i` (or
// `i/c` depending on direction) marks the slot-wrap boundary at
// offset ~2400-2700 of every failing entry.

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

describe("pointer/list open-view accordion-body omits the content-view slot wrap (permfix48 family: unclassified:L/~/exp=c/act=i)", () => {
  it(
    "*star+*create list rule open view: accordion-body contains the pointer-list directly (no X-content-view wrap)",
    async () => {
      // corpus:6551 *star+*create (the family anchor). Seed the card +
      // its type card + its read rule (mirror the pointer-list-trailing-
      // newline.test.ts seeding shape for the same family). The items
      // (irjkznnbpewjpr, wautvrx) have NO rows in the corpus db (verified
      // directly) — do NOT seed them: the oracle's mini_bar slots came
      // from the UNKNOWN-card path (bar.rb:9 `unknown: :mini_bar` on a
      // fetch miss), which the phantom path covers. Seeding them as real
      // denied rows routed the render through the readable-card denial
      // shape, which the dual-lane raw oracle renders as the bare quiet
      // span instead.
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(6551);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);
      const html = await storage.engine.render("*star+*create", "open");
      // Sanity: the outer open-view slot is present (the test render must
      // produce a recognizable open view, not a closed stub).
      expect(html).toContain('id="Xstar-Xcreate-open-view"');
      // The accordion-body is present.
      expect(html).toContain("accordion-body");
      // The pointer-list wrapper is present (the OUTER-family pin —
      // same wrapper pointer-list-content-view.test.ts and the trailing-
      // newline test pin for content view).
      expect(html).toContain('<div class="pointer-list">');
      // The per-item mini_bar slot is present (renderPointerListItem
      // path is unchanged by this fix).
      expect(html).toContain('id="irjkznnbpewjpr-mini_bar-view"');
      // The byte-level pin (the load-bearing check): the accordion-body
      // contains the pointer-list directly, NOT inside a
      // `X-content-view` slot wrap. Pre-fix, the engine emitted
      // `<div id="Xstar-Xcreate-content-view" class="card-slot
      // content-view …"><div class="pointer-list">`; post-fix, the
      // accordion-body opens straight into the pointer-list. The
      // negative assertion pins the absence of the inner content-view
      // slot inside the accordion-body.
      const accordionBodyIdx = html.indexOf("accordion-body");
      const accordionBodySlice = html.slice(accordionBodyIdx);
      expect(accordionBodySlice).not.toContain(
        'id="Xstar-Xcreate-content-view"',
      );
      expect(accordionBodySlice).not.toContain("card-slot content-view");
      // And the positive assertion: the pointer-list opens directly
      // after the accordion-body div.
      expect(accordionBodySlice).toMatch(
        /accordion-body[^>]*>\s*<div class="pointer-list">/,
      );
    },
  );

  it(
    "*home pointer open view: the options-card parse boundary raises (corpus:77 truth) — and with a valid *content options rule the card-list-bar wrapper renders INSIDE a content-view slot wrap (CLUSTER 3 set-card-pointer-list-vs-nested-content)",
    async () => {
      // Corpus:77 (shard-000000.jsonl id=77, *home pointer) :open captured
      // CAPTURE_ERROR: Card::Error::BadQuery: Invalid JSON search query: fr
      // — *all's db_content "fr", reached through the options-card chain
      // (standard_pointer_core -> item_view_options -> item_type_name ->
      // options_card -> *all). The pre-options-boundary engine emitted the
      // card-list-bar wrapper bytes here instead; the boundary (see
      // options-card-cql-parse-boundary.test.ts) closes that divergence.
      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(77);
      baseIds.add(34843);
      baseIds.add(22283);
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: 9020,
        name: "yzzw",
        typeId: 22281,
        readRuleId: 22283,
        readRuleClass: "*type",
      });
      let captured: unknown;
      try {
        await storage.engine.render("*home", "open");
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).constructor.name).toBe("Card::Error::BadQuery");
      expect((captured as Error).message).toBe("Invalid JSON search query: fr");

      // The card-list-bar wrapper-branch structure pin (the shape this
      // file exists for): a pointer whose *content options rule parses as
      // valid CQL JSON stops the boundary (cql_search.rb:14-18 answers
      // item_type_id from cql_hash[:type] — no raise), so :open renders.
      //
      // CLUSTER 3 (set-card-pointer-list-vs-nested-content, 690 entries
      // on shard-0): Ruby's captured bytes for corpus:77 *home
      // (fixtures/corpus/shard-000000.jsonl:44) emit the open-view
      // accordion-body containing BOTH the OUTER content-view slot wrap
      // AND the inner pointer-list — raw expected-byte citation:
      //   "...<div class='accordion-body d0-card-body'>\n" +
      //   "<div id=\"Xhome-content-view\" class=\"card-slot content-view ALL TYPE-pointer STAR SELF-Xhome d0-card-content\" data-card-id=\"77\" data-card-name=\"*home\" data-card-type-id=\"34843\" data-card-type-name=\"Pointer\" data-card-link-name=\"*home\" data-slot-id=\"RANDOMIZED\" data-slot=\"{&quot;view&quot;:&quot;content&quot;,&quot;show&quot;:[&quot;open&quot;,&quot;bar_bottom&quot;,&quot;content&quot;],&quot;hide&quot;:[&quot;bar_middle&quot;],&quot;home_view&quot;:&quot;content&quot;}\"><div class=\"card-list card-list-bar pointer-list\">..."
      // The OLD assertion (the pre-fix pin) asserted no content-view
      // wrap — matching the previous flat pointer-list emit, but
      // contradicting Ruby's captured bytes. The OLD pin encoded the
      // flat shape; the new pin re-pins to the captured oracle with the
      // raw expected-byte citation above. The fix in
      // src/card/render/views.ts#barBottomView narrows the no-wrap
      // branch to rule cards (isRuleCard OR isRuleCardWithPermissionRight);
      // non-rule pointer/list cards (the *home probe here) now dispatch
      // through `content` so the slot wrap reappears.
      await seedCard(storage, { id: 9021, name: "wrapper probe", typeId: 34843, dbContent: "" });
      await seedCard(storage, {
        id: 9022,
        name: "wrapper probe+*self",
        leftId: 9021,
        rightId: 264,
        typeId: 259,
      });
      await seedCard(storage, {
        id: 9023,
        name: "wrapper probe+*self+*content options",
        leftId: 9022,
        rightId: 86,
        typeId: 30,
        dbContent: '{"type":"Basic"}',
      });
      const html = await storage.engine.render("wrapper_probe", "open");
      // The card-list wrapper is in use (the probe pointer does not match
      // the rule+permission-right shape).
      expect(html).toContain('<div class="card-list card-list-bar pointer-list">');
      // CLUSTER 3: the card-list is now wrapped in a content-view slot
      // inside the accordion-body (the captured oracle for corpus:77
      // *home and the 690-entry shard-0 cluster). The probe name
      // substitutes for *home here; same shape — the slot id uses the
      // safe-key, the slot wraps the pointer-list.
      expect(html).toContain('id="wrapper_probe-content-view"');
      expect(html).toContain('class="card-slot content-view');
      // Byte-level shape: the accordion-body contains the content-view
      // slot BEFORE the pointer-list, matching the captured oracle's
      // ordering (`accordion-body > content-view-slot > card-list > ...`).
      const accordionBodyIdx = html.indexOf("accordion-body");
      const accordionBodySlice = html.slice(accordionBodyIdx);
      expect(accordionBodySlice).toMatch(
        /accordion-body[^>]*>\s*<div id="wrapper_probe-content-view"[^>]*card-slot content-view[^>]*>\s*<div class="card-list card-list-bar pointer-list">/,
      );
    },
  );
});
