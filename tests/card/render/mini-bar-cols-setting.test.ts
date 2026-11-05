// Bar column-split setting (card-mod-bar_and_box-0.20.0 set/all/bar.rb:2-6
// + card-mod-rules-0.20.0 set/rule/bar_view.rb:2-3): the .bar-left /
// .bar-right bootstrap col numbers the :bar / :mini_bar / :closed / :open
// views emit. The default is "9, 3" (the *all set module); the *rule set
// module overrides to "6, 6" for cards matching the *rule pattern. The
// corpus entry that proves the override is entry 67 (kfnvyby+*type+*thanks)
// — a rule card whose captured :closed bytes carry "bar-left col-6" and
// "bar-right col-6".
//
// What this test pins:
//   1. The bar-cols helper's three precedence levels (default, *rule
//      pattern, rule-card content) — pure-unit tests, no engine.
//   2. Default-case rendering: a non-rule card renders col-9/col-3.
//   3. Rule-case rendering: a rule-pattern card renders col-6/col-6.
//   4. Byte parity against the captured corpus:67 :closed bytes.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";
import {
  DEFAULT_MINI_BAR_COLS,
  RULE_MINI_BAR_COLS,
  parseBarCols,
  readMiniBarCols,
} from "../../../src/card/render/bar-cols.js";
import type { RenderCard } from "../../../src/card/render/format.js";
import { DeckoName } from "../../../src/card/name.js";
import { normalizeSlotIds } from "../../../src/testing/diff.js";
import { readShardLines } from "./permission-corpus-seeding.js";
import { createStructureSeededStorage } from "./structure-corpus-seeding.js";
import { installHelpRules } from "../../../src/card/render/help-popover.js";

const BASIC_TYPE_ID = 2;
const SET_TYPE_ID = 10;
const SETTING_TYPE_ID = 11;

describe("bar-cols helper (pure unit)", () => {
  it("parseBarCols: '6, 6' -> [6, 6]", () => {
    expect(parseBarCols("6, 6")).toEqual([6, 6]);
  });
  it("parseBarCols: '6 6' (whitespace) -> [6, 6]", () => {
    expect(parseBarCols("6 6")).toEqual([6, 6]);
  });
  it("parseBarCols: trailing whitespace tolerated", () => {
    expect(parseBarCols("  9 , 3  ")).toEqual([9, 3]);
  });
  it("parseBarCols: empty / undefined -> undefined", () => {
    expect(parseBarCols("")).toBeUndefined();
    expect(parseBarCols(undefined)).toBeUndefined();
  });
  it("parseBarCols: non-numeric or single value -> undefined", () => {
    expect(parseBarCols("a, b")).toBeUndefined();
    expect(parseBarCols("6")).toBeUndefined();
  });
  it("readMiniBarCols: rule-card content '4, 8' wins over *rule default", () => {
    const card: RenderCard = stubCard("ALL ALL_PLUS RULE SELF-x");
    expect(readMiniBarCols(card, "4, 8")).toEqual([4, 8]);
  });
  it("readMiniBarCols: *rule pattern (RULE in setKeys) -> RULE_MINI_BAR_COLS", () => {
    const card: RenderCard = stubCard("ALL ALL_PLUS TYPE-x RSTAR RULE SELF-x");
    expect([...readMiniBarCols(card)]).toEqual([...RULE_MINI_BAR_COLS]);
    expect([...readMiniBarCols(card)]).toEqual([6, 6]);
  });
  it("readMiniBarCols: non-rule card -> DEFAULT_MINI_BAR_COLS", () => {
    const card: RenderCard = stubCard("ALL TYPE-x SELF-x");
    expect([...readMiniBarCols(card)]).toEqual([...DEFAULT_MINI_BAR_COLS]);
    expect([...readMiniBarCols(card)]).toEqual([9, 3]);
  });
  it("readMiniBarCols: empty/unparseable rule content falls through to set-pattern default", () => {
    const ruleCard: RenderCard = stubCard("ALL ALL_PLUS RULE SELF-x");
    expect([...readMiniBarCols(ruleCard, "")]).toEqual([6, 6]);
    expect([...readMiniBarCols(ruleCard, "garbage")]).toEqual([6, 6]);
    const basicCard: RenderCard = stubCard("ALL TYPE-x SELF-x");
    expect([...readMiniBarCols(basicCard, "")]).toEqual([9, 3]);
  });
});

describe("render integration: mini-bar cols setting", () => {
  let storage: RenderTestStorage | undefined;

  beforeAll(async () => {
    storage = await createRenderTestStorage();
    // codename cards the rule? predicate + render path need
    await seedCard(storage, { id: 5, name: "Cardtype", typeId: 5 });
    await seedCard(storage, { id: 1, name: "Basic", typeId: 5 });
    await seedCard(storage, { id: 10, name: "Set", codename: "set", typeId: 5 });
    await seedCard(storage, { id: 11, name: "Setting", codename: "setting", typeId: 5 });
    await seedCard(storage, { id: 12, name: "User", codename: "user", typeId: 5 });
    // the *thanks setting card + a non-rule leaf
    await seedCard(storage, { id: 20, name: "*thanks", codename: "thanks", typeId: SETTING_TYPE_ID });
    // 2026-09-27 pass-9 gate: *type must exist BEFORE the first render on
    // this engine. The cold render's prelude primes lex_to_id for every
    // set-pattern anchor card (*self, *type, *all) and caches absences as
    // negative entries ("a stored nil is a hit", cache.rb#fetch); a card
    // seeded only later stays invisible to name resolution. The col-6
    // test's compound root kfnvyby+*type+*thanks resolves its *type part
    // through that primed entry.
    await seedCard(storage, { id: 21, name: "*type", codename: "type", typeId: SETTING_TYPE_ID });
    await seedCard(storage, { id: 30, name: "Basic Card", typeId: BASIC_TYPE_ID });
  }, 60_000);

  afterAll(() => {
    storage?.close();
    storage = undefined;
  });

  it("renders col-9 / col-3 for a non-rule card (the *all set module default)", async () => {
    const s = storage!;
    const html = await s.engine.render("Basic Card", "closed");
    expect(html).toContain("bar-left col-9");
    expect(html).toContain("bar-right col-3");
  });

  it("renders col-6 / col-6 for a *rule-pattern card (kfnvyby+*type+*thanks shape)", async () => {
    const s = storage!;
    // Seed the shape from corpus:67: a *thanks setting card (already id=20),
    // a *type card (id=21 — seeded in beforeAll, above the first render:
    // the cold prelude's anchor priming caches *type's absence otherwise),
    // a *type-plus-right set card kfnvyby+*type, and the rule card
    // kfnvyby+*type+*thanks.
    await seedCard(storage!, { id: 31, name: "kfnvyby", typeId: BASIC_TYPE_ID });
    await seedCard(storage!, { id: 32, leftId: 31, rightId: 21, typeId: SET_TYPE_ID }); // kfnvyby+*type
    await seedCard(storage!, {
      id: 33,
      leftId: 32,
      rightId: 20,
      typeId: SETTING_TYPE_ID,
      dbContent: "nfyvlndjxcqqtk",
    });
    const html = await s.engine.render("kfnvyby+*type+*thanks", "closed");
    expect(html).toContain("bar-left col-6");
    expect(html).toContain("bar-right col-6");
    // AND the default col-9/col-3 must NOT appear:
    expect(html).not.toContain("bar-left col-9");
    expect(html).not.toContain("bar-right col-3");
  });

  it("byte-parity for bar cols (corpus:67 :closed view, structure-seeded)", async () => {
    // The captured entry from fixtures/corpus/shard-000000.jsonl, id 67.
    const line = readShardLines().find((l) => l.id === 67);
    expect(line, "shard carries corpus entry 67").toBeDefined();
    const expected = line!.views!["closed"];
    expect(expected, "corpus:67 has captured :closed bytes").toBeDefined();

    // Re-seed from the structure-corpus universe: the same closure the
    // structure-template stream walks. The corpus DB is the source of
    // truth for the captured bytes' card shapes (types, left/right
    // sides, xnhrjk, etc.); seeding from a synthetic subset would diverge
    // on class-list tokens (TYPE-xnhrjk vs TYPE-setting) before the col-X
    // check could ever run.
    const seeded = await createStructureSeededStorage();
    try {
      // The help-rules resolver serves the *help rule popover content the
      // captured :closed bytes carry (the menu view's data-bs-content);
      // without it the menu anchor renders the bare &nbsp; placeholder and
      // the byte diff lands inside the menu anchor, not on the bar cols.
      const helpResolver = installHelpRules(seeded.engine, seeded.fetcher);
      await helpResolver.prepare();
      const html = await seeded.engine.render("kfnvyby+*type+*thanks", "closed");

      // The M2 stream's contract: the col-X numbers on bar-left /
      // bar-right must match the captured bytes. The :bar_right view's
      // nested one_line_content is the *rule set module's behavior
      // (card-mod-rules set/rule/bar_view.rb#rule_short_content) — that
      // is the rules-views stream's territory, not this one.
      expect(html).toContain("bar-left col-6");
      expect(html).toContain("bar-right col-6");
      expect(expected).toContain("bar-left col-6");
      expect(expected).toContain("bar-right col-6");

      // And the col-X markers emitted by M2's prepareBar must align
      // byte-for-byte with the captured slice. M2 owns the `col-9` /
      // `col-3` vs `col-6` / `col-6` decision; the rest of the bar
      // column contents (rule's one_line_content inside bar-right) is
      // the rules-views stream's territory. Pin the M2-owned bytes
      // directly: the bar-left and bar-right opening divs.
      const actualLeftOpen = extractOpening(html, "bar-left");
      const actualRightOpen = extractOpening(html, "bar-right");
      const expectedLeftOpen = extractOpening(expected, "bar-left");
      const expectedRightOpen = extractOpening(expected, "bar-right");
      expect(
        { left: actualLeftOpen, right: actualRightOpen },
        `bar-left/bar-right opening tags must match the captured slice`,
      ).toEqual({ left: expectedLeftOpen, right: expectedRightOpen });
      // Sanity: those openings carry the col-X numbers M2 owns.
      expect(actualLeftOpen).toBe("<div class='bar-left col-6'>");
      expect(actualRightOpen).toBe("<div class='bar-right col-6'>");
    } finally {
      seeded.close();
    }
  });
});

/** Extract the opening `<div class='NAME COL'>...` tag for one of the
 *  bar columns — the bytes M2 owns (the col-X class is decided here).
 *  The inner content of the column is NOT this stream's territory
 *  (bar_right's nested rule one_line_content is the rules-views stream);
 *  only the opening tag is. */
function extractOpening(html: string, name: string): string {
  const marker = `<div class='${name}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const end = html.indexOf(">", start);
  if (end < 0) return html.slice(start);
  return html.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function stubCard(setKeys: string): RenderCard {
  const name = DeckoName.parse("X");
  return {
    record: {
      id: 0,
      codename: undefined,
      leftId: undefined,
      rightId: undefined,
      typeId: undefined,
      dbContent: undefined,
      trash: false,
      creatorId: undefined,
      updaterId: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      currentRevisionId: undefined,
      readRuleClass: undefined,
      readRuleId: undefined,
      referencesExpired: undefined,
      name,
      key: name.key,
      isNew: false,
      fromTrash: false,
      uncacheable: false,
    },
    name,
    key: name.key,
    typeName: undefined,
    typeId: undefined,
    typeCode: undefined,
    id: undefined,
    dbContent: "",
    setKeys,
  };
}

// keep imports used (readFileSync was previously imported for a path the
// shard-line lookup replaces).
void readShardLines;
