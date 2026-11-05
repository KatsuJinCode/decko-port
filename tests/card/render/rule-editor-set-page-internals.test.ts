

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

const SET_TYPE_ID = 100;
const LIST_TYPE_ID = 101;
const POINTER_TYPE_ID = 102;
const SETTING_TYPE_ID = 103;

async function seedDeck(): Promise<void> {
  const s = storage!;

  await seedCard(s, { id: SET_TYPE_ID, name: "Set", codename: "set" });
  await seedCard(s, { id: LIST_TYPE_ID, name: "List", codename: "list" });
  await seedCard(s, { id: POINTER_TYPE_ID, name: "Pointer", codename: "pointer" });
  await seedCard(s, { id: SETTING_TYPE_ID, name: "Setting", codename: "setting" });

  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });

  const settings: Array<[number, string, string]> = [
    [2, "*read", "read"],
    [3, "*create", "create"],
    [4, "*update", "update"],
    [5, "*delete", "delete"],
    [6, "*captcha", "captcha"],
    [7, "*structure", "structure"],
    [8, "*default", "default"],
    [9, "*autoname", "autoname"],
    [10, "*help", "help"],
    [11, "*input type", "input_type"],
    [12, "*guide", "guide"],
    [13, "*content options", "content_options"],
    [14, "*content option view", "content_option_view"],
    [15, "*head", "head"],
    [16, "*layout", "layout"],
    [17, "*style", "style"],
    [18, "*script", "script"],
    [19, "*on create", "on_create"],
    [20, "*on update", "on_update"],
    [21, "*on delete", "on_delete"],
    [22, "*thanks", "thanks"],
    [23, "*follow fields", "follow_fields"],
    [24, "*follow", "follow"],
  ];
  for (const [id, name, codename] of settings) {
    await seedCard(s, { id, name, codename, typeId: SETTING_TYPE_ID });
  }

  await seedCard(s, { id: 25, name: "*self", codename: "self", typeId: SETTING_TYPE_ID });
  await seedCard(s, { id: 26, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });

  await seedCard(s, {
    id: 31,
    leftId: 1,
    rightId: 2,
    typeId: LIST_TYPE_ID,
    dbContent: "Administrator\nAnyone\nNobody",
  });

  await seedCard(s, { id: 40, name: "Administrator", dbContent: "admin body" });
  await seedCard(s, { id: 41, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 42, name: "Anonymous", codename: "anonymous" });

  await seedReference(s, 31, 40, "administrator");
  await seedReference(s, 31, 41, "anyone");

  await seedCard(s, { id: 30, name: "*home", codename: "home", typeId: POINTER_TYPE_ID });
  await seedCard(s, { id: 32, leftId: 30, rightId: 25, typeId: SET_TYPE_ID });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck();

  const settingNames = [
    "*read", "*create", "*update", "*delete", "*captcha", "*structure",
    "*default", "*autoname", "*help", "*input type", "*guide",
    "*content options", "*content option view", "*head", "*layout",
    "*style", "*script", "*on create", "*on update", "*on delete",
    "*thanks", "*follow fields", "*follow",
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

describe("rule-bar one-line items: known/wanted + url_key href", () => {
  it("classifies a stored item known-card and a missing item wanted-card", async () => {
    const html = await storage!.engine.render("*all+*read", "bar_right");

    expect(html).toContain('<a class="known-card" href="/Administrator">');
    expect(html).toContain(
      '<span class="card-title" title="Administrator">Administrator</span>',
    );

    expect(html).toContain('<a class="wanted-card" href="/Nobody">');

    expect(html).not.toContain('<a class="wanted-card" href="/Administrator">');
  });
});

describe("category accordion group lis", () => {
  it("renders the templating group in registration-position order (structure, default, autoname)", async () => {
    const html = await storage!.engine.render("*all", "content");
    const groupStart = html.indexOf("card-Xall-templating-collapse-id");
    expect(groupStart).toBeGreaterThan(-1);
    const body = html.slice(groupStart, groupStart + 12_000);
    const structureAt = body.indexOf("Xall-Xstructure-bar-view");
    const defaultAt = body.indexOf("Xall-Xdefault-bar-view");
    const autonameAt = body.indexOf("Xall-Xautoname-bar-view");

    expect(structureAt).toBeGreaterThan(-1);
    expect(defaultAt).toBeGreaterThan(structureAt);
    expect(autonameAt).toBeGreaterThan(defaultAt);
  });

  it("keeps the badge the visible-setting count (rule_lists.rb:87 list.size)", async () => {
    const html = await storage!.engine.render("*all", "content");

    expect(html).toContain('_count badge bg-secondary ms-3">3</span>');
    expect(html).toContain('_count badge bg-secondary ms-3">5</span>');
    expect(html).toContain('_count badge bg-secondary ms-3">4</span>');

    const editingStart = html.indexOf("card-Xall-editing-collapse-id");
    const editingBody = html.slice(editingStart, html.indexOf("card-Xall-event-collapse-id"));
    expect(editingBody).not.toMatch(/Xall-Xcontent_options?-bar-view/);
    expect(editingBody).not.toMatch(/Xall-Xcontent_option_view-bar-view/);
    expect(editingBody).toContain("Xall-Xhelp-bar-view");
    expect(editingBody).toContain("Xall-Xinput_type-bar-view");
    expect(editingBody).toContain("Xall-Xguide-bar-view");
  });

  it("shows all five editing settings when the prototype type is Pointer (+*self set of a Pointer card)", async () => {
    const html = await storage!.engine.render("*home+*self", "content");

    const editingStart = html.indexOf("card-Xhome-Xself-editing-collapse-id");
    expect(editingStart).toBeGreaterThan(-1);
    const editingBody = html.slice(
      editingStart,
      html.indexOf("card-Xhome-Xself-event-collapse-id"),
    );
    expect(editingBody).toMatch(/Xhome-Xself-Xcontent_options?-bar-view/);
    expect(editingBody).toContain("Xhome-Xself-Xcontent_option_view-bar-view");
  });
});
