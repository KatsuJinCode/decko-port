// Regression pins for the two name-form defects the name-form trace
// (brandonDojoTech tmp/wrong-goal-hunt/name-form-trace.md) pinned with
// Ruby-executed proof (card 1.110.0 / cardname 0.20.0 / card-mod-* 0.20.0):
//
// BUG 1 — PHANTOM LIST ITEMS (trace Defect A). A pointer/list content line
// that differs in FORM from the stored card's name is key-identical to it
// (Cardname#key: stable_key singularizes "videos"->"video", downcases
// "Business"->"business", strips to "Covid-19"->"covid_19"; verified by
// executing the gems). Ruby's nest_item -> Card.fetch(item) resolves the
// line through its key and renders the REAL card under its STORED name
// (live pin: Brandon_WilliamsCraig.html renders data-card-id="23464"
// data-card-name="Brandon WilliamsCraig+video" for the authored line
// "Brandon WilliamsCraig+videos"; the string "videos" appears 0 times on
// the live page). The port's old path emitted the AUTHORED line as a
// phantom slot (renderPointerListItem's fetch miss ->
// phantomPointerListItem): the item batch lookup was junction-blind
// (`WHERE "key" IN` — junction rows carry NULL name/key) and only the
// render ROOT's items were ever pre-enriched (nested pointer/list hosts
// like +Pages inside a Person page never ran the pass, and the sync item
// dispatch has no await to repair a miss). The fix routes every item line
// through prepareItemForRender (the junction-aware Card.fetch ladder) and
// walks every pointer/list host in the prepared closure to fixpoint.
//
// BUG 2 — SLOT CARDNAME FORM (trace Defect B). Ruby's
// card-mod-format set/all/html/wrap.rb:50-53 #slot_cardname:
//     name = card.name
//     name = name.url_key if card.new? && name.compound?
// An UNSAVED COMPOUND card's slot displays the url_key form (case kept,
// underscores for spaces): live pins data-card-name=
// "Conflict_Done_Well+management" for the wanted child the Project
// template's {{+management|closed}} nest produces. The port emitted
// name.s ("Conflict Done Well+management"). The fix mirrors the exact
// transformation in slotWrap (and the pointer-item slot builder, which
// Ruby builds with the same wrap helper).
//
// Seeding shape: junction cards (the list host "Host Person+Pages", the
// item target "Host Person+video") are stored deck-convention style —
// NULL name/key rows resolved through left_id/right_id — exactly the
// shape the old junction-blind IN-query could never match.

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { seedCard, type RenderTestStorage } from "./render-test-storage.js";

// The wide-read rule card the other render tests pin readRuleId to
// (seeded into the shard universe via baseIds, same pattern as
// pointer-list-mini-bar-phantom.test.ts).
const WIDE_READ_RULE_ID = 6568;
// The corpus's codename "list" card (its id is the list cardtype's id).
const LIST_TYPE_ID = 47;

// Left/right/type card ids for the seeded fixture family (high, outside
// the corpus's 1..53069 card-id range).
const LEFT_ID = 997011; // "Host Person"
const VIDEO_ID = 997012; // "video" (stored lowercase singular)
const ITEM_JUNCTION_ID = 997013; // "Host Person+video" by sides
const PAGES_ID = 997040; // "Pages" (the list junction's right side)
const LIST_JUNCTION_ID = 997041; // "Host Person+Pages" by sides
const NEST_HOST_ID = 997015; // "Person Page" (rich-text, nests the list)
const CDW_HOST_ID = 997016; // "CDW Host" (rich-text, nests +management)

function baseIdsWithWideReadRule(): Set<number> {
  const baseIds = new Set(readShardLines().map((l) => l.id));
  baseIds.add(WIDE_READ_RULE_ID);
  return baseIds;
}

/** Seed the shared fixture family: left card, right card "video", their
 *  junction (the item target), the "Pages" right card, and the
 *  "Host Person+Pages" list junction (typeId = the list cardtype). */
async function seedListFixture(storage: RenderTestStorage): Promise<void> {
  await seedCard(storage, {
    id: LEFT_ID,
    name: "Host Person",
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: VIDEO_ID,
    name: "video",
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: ITEM_JUNCTION_ID,
    leftId: LEFT_ID,
    rightId: VIDEO_ID,
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: PAGES_ID,
    name: "Pages",
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: LIST_JUNCTION_ID,
    leftId: LEFT_ID,
    rightId: PAGES_ID,
    typeId: LIST_TYPE_ID,
    dbContent: "Host Person+videos\n",
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
}

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("list-item key resolution + unsaved-compound slot_cardname (name-form trace pins)", () => {
  it(
    "a list line whose form differs from the stored junction name resolves to the real card and renders its stored name",
    async () => {
      // Trace example 1/3 shape: the list authors the PLURAL line
      // "Host Person+videos"; the stored junction is
      // "Host Person+video". Ruby resolves the line through its key
      // (videos ≡ video) to the junction card and displays the stored
      // name.
      const baseIds = baseIdsWithWideReadRule();
      storage = await createStructureSeededStorageFor(baseIds);
      await seedListFixture(storage);
      const html = await storage.engine.render("Host Person+Pages", "content");
      // The RESOLVED card's slot: stored name displayed (live pin:
      // data-card-name="Brandon WilliamsCraig+video"), not the authored
      // line.
      expect(html).toContain('data-card-name="Host Person+video"');
      expect(html).not.toContain("Host Person+videos");
      // A real card's slot, not the phantom: the phantom's pinned type
      // (swtktey/22281) must be gone. Merged semantics (lane-deferred):
      // the item slot shape is READ-DENIAL-gated — a READABLE item keeps
      // the `bar-view` slot nestRecord produced, with the resolved
      // card's data-card-id (both oracles: corpus v2 229/229 mini_bar
      // slots wrap read-DENIED items while readable items keep bar-view;
      // live Aikido_Oak_Cliff.html likewise). The retired unconditional
      // swap's safeKey concern survives in the bar-view id: it is built
      // from the RESOLVED card ("...+video"), never the authored
      // "+videos" line.
      expect(html).not.toContain("swtktey");
      expect(html).toContain(`id="host_person-video-bar-view"`);
      expect(html).toMatch(/class="card-slot bar-view [^"]*"/);
      expect(html).not.toContain('id="host_person-video-mini_bar-view"');
      expect(html).toContain(`data-card-id="${ITEM_JUNCTION_ID}"`);
    },
  );

  it(
    "a pointer/list card nested inside a page (not the render root) pre-enriches its items through the same key resolution",
    async () => {
      // The nested-host gap: +Pages inside a Person page. The prefetch
      // closure chases the {{...}} nest ref to the list card but never
      // its plain-text item lines, and the sync item dispatch cannot
      // await a repair — the prepare-phase closure walk must cover the
      // nested host.
      const baseIds = baseIdsWithWideReadRule();
      storage = await createStructureSeededStorageFor(baseIds);
      await seedListFixture(storage);
      await seedCard(storage, {
        id: NEST_HOST_ID,
        name: "Person Page",
        typeId: 2,
        dbContent: "{{Host Person+Pages}}",
        readRuleId: WIDE_READ_RULE_ID,
        readRuleClass: "*all",
      });
      // The shared shard universe seeds the deck's `*all+*default html
      // view` rule (22769) with its ANONYMIZED value ("fnvmwmg" — the
      // corpus anonymizer tokenized the rule's phrase content, and no
      // such view exists in any engine registry, so a bare nest would
      // throw UnsupportedViewError). The production deck's rule value is
      // "content" — round 10 live-verified on all 12 captured pages
      // (format.ts#defaultNestView docstring). Pin the production value
      // so the bare nest resolves the deck rule to the content view
      // exactly as the live wire does, and the test exercises what it
      // exists for: the nested host's prepare-phase item pre-enrich.
      await storage.counting.query(
        "UPDATE cards SET db_content = 'content' WHERE id = 22769 AND key = '*all+*default_html_view'",
        [],
      );
      const html = await storage.engine.render("Person Page", "open");
      expect(html).toContain('data-card-name="Host Person+video"');
      expect(html).not.toContain("Host Person+videos");
      expect(html).not.toContain("swtktey");
    },
  );

  it(
    "an unsaved compound card's slot displays the url_key form (wrap.rb:50-53 slot_cardname)",
    async () => {
      // Trace example 2: the wanted child "Conflict Done Well+
      // management" (absent on live TOO — live renders it as a WANTED
      // card). Live pin (Conflict_Done_Well.html): the slot carries
      // data-card-name="Conflict_Done_Well+management" — url_key form,
      // case retained, underscores for spaces. The port emitted the
      // spaced name.s form.
      const baseIds = baseIdsWithWideReadRule();
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: CDW_HOST_ID,
        name: "CDW Host",
        typeId: 2,
        dbContent: "{{+management|open}}",
        readRuleId: WIDE_READ_RULE_ID,
        readRuleClass: "*all",
      });
      const html = await storage.engine.render("CDW Host", "open");
      expect(html).toContain('data-card-name="CDW_Host+management"');
      expect(html).not.toContain('data-card-name="CDW Host+management"');
    },
  );
});
