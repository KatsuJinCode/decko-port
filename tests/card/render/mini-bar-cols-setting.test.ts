

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

    await seedCard(storage, { id: 5, name: "Cardtype", typeId: 5 });
    await seedCard(storage, { id: 1, name: "Basic", typeId: 5 });
    await seedCard(storage, { id: 10, name: "Set", codename: "set", typeId: 5 });
    await seedCard(storage, { id: 11, name: "Setting", codename: "setting", typeId: 5 });
    await seedCard(storage, { id: 12, name: "User", codename: "user", typeId: 5 });

    await seedCard(storage, { id: 20, name: "*thanks", codename: "thanks", typeId: SETTING_TYPE_ID });

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

    await seedCard(storage!, { id: 31, name: "kfnvyby", typeId: BASIC_TYPE_ID });
    await seedCard(storage!, { id: 32, leftId: 31, rightId: 21, typeId: SET_TYPE_ID });
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

    expect(html).not.toContain("bar-left col-9");
    expect(html).not.toContain("bar-right col-3");
  });

  it("byte-parity for bar cols (corpus:67 :closed view, structure-seeded)", async () => {

    const line = readShardLines().find((l) => l.id === 67);
    expect(line, "shard carries corpus entry 67").toBeDefined();
    const expected = line!.views!["closed"];
    expect(expected, "corpus:67 has captured :closed bytes").toBeDefined();

    const seeded = await createStructureSeededStorage();
    try {

      const helpResolver = installHelpRules(seeded.engine, seeded.fetcher);
      await helpResolver.prepare();
      const html = await seeded.engine.render("kfnvyby+*type+*thanks", "closed");

      expect(html).toContain("bar-left col-6");
      expect(html).toContain("bar-right col-6");
      expect(expected).toContain("bar-left col-6");
      expect(expected).toContain("bar-right col-6");

      const actualLeftOpen = extractOpening(html, "bar-left");
      const actualRightOpen = extractOpening(html, "bar-right");
      const expectedLeftOpen = extractOpening(expected, "bar-left");
      const expectedRightOpen = extractOpening(expected, "bar-right");
      expect(
        { left: actualLeftOpen, right: actualRightOpen },
        `bar-left/bar-right opening tags must match the captured slice`,
      ).toEqual({ left: expectedLeftOpen, right: expectedRightOpen });

      expect(actualLeftOpen).toBe("<div class='bar-left col-6'>");
      expect(actualRightOpen).toBe("<div class='bar-right col-6'>");
    } finally {
      seeded.close();
    }
  });
});

function extractOpening(html: string, name: string): string {
  const marker = `<div class='${name}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const end = html.indexOf(">", start);
  if (end < 0) return html.slice(start);
  return html.slice(start, end + 1);
}

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

void readShardLines;
