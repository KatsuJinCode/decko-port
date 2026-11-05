

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

const SET_TYPE_ID = 1;
const SETTING_TYPE_ID = 2;
const LIST_TYPE_ID = 3;
const RICH_TYPE_ID = 4;
const HTML_TYPE_ID = 5;

async function seedDeck(): Promise<void> {
  const s = storage!;

  await seedCard(s, { id: 1, name: "Set", codename: "set" });
  await seedCard(s, { id: 2, name: "Setting", codename: "setting" });
  await seedCard(s, { id: 3, name: "List", codename: "list" });
  await seedCard(s, { id: 4, name: "RichText", codename: "rich_text" });
  await seedCard(s, { id: 5, name: "HTML", codename: "html" });
  await seedCard(s, { id: 9, name: "Basic", codename: "basic" });

  await seedCard(s, { id: 6, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 7, name: "Anyone Signed In", codename: "anyone_signed_in" });
  await seedCard(s, { id: 8, name: "Anonymous", codename: "anonymous" });

  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: SET_TYPE_ID, dbContent: "{}" });
  const settings: Array<[number, string, string]> = [
    [20, "*read", "read"],
    [21, "*default", "default"],
    [22, "*autoname", "autoname"],
    [23, "*structure", "structure"],
    [24, "*create", "create"],
    [25, "*update", "update"],
    [26, "*delete", "delete"],
    [27, "*captcha", "captcha"],
    [28, "*head", "head"],
    [29, "*layout", "layout"],
    [30, "*style", "style"],
    [31, "*script", "script"],
    [32, "*help", "help"],
    [33, "*input type", "input_type"],
    [34, "*guide", "guide"],
    [35, "*thanks", "thanks"],
    [36, "*follow", "follow"],
  ];
  for (const [id, name, codename] of settings) {
    await seedCard(s, { id, name, codename, typeId: SETTING_TYPE_ID });
  }
  await seedCard(s, { id: 39, name: "*self", codename: "self", typeId: SETTING_TYPE_ID });
  await seedCard(s, { id: 40, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });
  await seedCard(s, { id: 41, name: "*type", codename: "type", typeId: SETTING_TYPE_ID });

  await seedCard(s, { id: 50, leftId: 10, rightId: 20, typeId: LIST_TYPE_ID, dbContent: "[[Anyone]]" });
  await seedReference(s, 50, 6, "anyone");

  await seedCard(s, { id: 51, leftId: 10, rightId: 21, typeId: LIST_TYPE_ID, dbContent: "", readRuleId: 52, readRuleClass: "*type" });
  await seedCard(s, { id: 61, leftId: 9, rightId: 41, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 52, leftId: 61, rightId: 20, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 52, 7, "anyone_signed_in");
  void SETTING_TYPE_ID;

  await seedCard(s, { id: 53, leftId: 23, rightId: 40, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 54, leftId: 53, rightId: 20, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 54, 7, "anyone_signed_in");

  await seedCard(s, { id: 70, name: "*home", codename: "home", typeId: HTML_TYPE_ID });
  await seedCard(s, { id: 71, leftId: 70, rightId: 39, typeId: SET_TYPE_ID, dbContent: "{}" });
  await seedCard(s, { id: 72, leftId: 5, rightId: 41, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 73, leftId: 72, rightId: 21, typeId: RICH_TYPE_ID, dbContent: "" });
  void SET_TYPE_ID;
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck();

  const settingNames = [
    "*read", "*default", "*autoname", "*structure", "*create", "*update",
    "*delete", "*captcha", "*head", "*layout", "*style", "*script", "*help",
    "*input type", "*guide", "*thanks", "*follow",
  ];
  for (const name of settingNames) {
    try {
      await storage.engine.render(name, "open");
    } catch {

    }
  }
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("stored rule children: stored-wins + verdict coverage", () => {
  it("renders the stored *all+*default as the quiet denial span (stored read rule denies)", async () => {
    const html = await storage!.engine.render("*all", "content");

    const templating = html.indexOf("card-Xall-templating-collapse-id");
    const body = html.slice(templating, html.indexOf("card-Xall-webpage-collapse-id"));
    const structureAt = body.indexOf("Xall-Xstructure-bar-view");
    const defaultAt = body.indexOf("Xall-Xdefault-bar-view");
    const autonameAt = body.indexOf("Xall-Xautoname-bar-view");
    const spanCount = body.split('<span class="denied">').length - 1;

    expect(spanCount).toBe(2);
    expect(defaultAt).toBe(-1);
    expect(autonameAt).toBeGreaterThan(-1);
    void structureAt;
  });
});

describe("2-part virtual rule bars: set/rule membership + categories", () => {
  it("renders the *all+*autoname bar with rule-item classes, three cols, hidden bar_nav, wanted/create menu", async () => {
    const html = await storage!.engine.render("*all", "content");
    const at = html.indexOf("Xall-Xautoname-bar-view");
    expect(at).toBeGreaterThan(-1);
    const slotStart = html.lastIndexOf("<div", at);
    const slot = html.slice(slotStart, slotStart + 3000);

    expect(slot).toContain("_rule-item");
    expect(slot).toContain("_category-all");

    expect(slot).not.toContain("_category-recent");

    expect(slot).toContain("col-md-5");

    expect(slot).toContain("&quot;hide&quot;:[&quot;bar_nav&quot;]");

    expect(slot).toContain("wanted-card");
    expect(slot).toContain("create</a>");

    expect(slot).toContain("col-md-4");
  });

  it("shows default/structure lis with their own category memberships", async () => {
    const html = await storage!.engine.render("*home+*self", "content");

    const at = html.indexOf("Xhome-Xself-Xdefault-bar-view");
    expect(at).toBeGreaterThan(-1);
    const slotStart = html.lastIndexOf("<div", at);
    const slot = html.slice(slotStart, slotStart + 800);
    expect(slot).toContain("_category-all _category-field _category-recent _category-common");
  });
});

describe("existing-rule resolution for virtual rule cards", () => {
  it("nests the prototype's winning default rule one-line with bar_nav shown", async () => {
    const html = await storage!.engine.render("*home+*self", "content");
    const at = html.indexOf("Xhome-Xself-Xdefault-bar-view");
    expect(at).toBeGreaterThan(-1);
    const slotStart = html.lastIndexOf("<div", at);
    const slot = html.slice(slotStart, slotStart + 1600);

    expect(slot).not.toContain("&quot;hide&quot;:[&quot;bar_nav&quot;]");
    expect(slot).toContain("RichText : <em>empty</em>");
  });
});
