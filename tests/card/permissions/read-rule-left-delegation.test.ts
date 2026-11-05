

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { quietDenial } from "../../../src/card/permissions/index.js";

const SET_TYPE_ID = 2;
const BASIC_TYPE_ID = 4;

let storage: RenderTestStorage | undefined;

async function seedSetting(
  s: RenderTestStorage,
  id: number,
  name: string,
  codename: string,
): Promise<void> {
  await seedCard(s, { id, name, codename });
}

async function seedDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "Role A" });
  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });
  await seedCard(s, { id: 17, name: "*all plus", codename: "all_plus" });
  await seedCard(s, { id: 18, name: "*right", codename: "right" });
  await seedCard(s, { id: 20, name: "Anyone Signed In", codename: "anyone_signed_in" });

  await seedCard(s, { id: 8, leftId: 1, rightId: 3, dbContent: "[[Anyone]]" });
  await seedReference(s, 8, 5, "anyone");

  await seedCard(s, { id: 21, leftId: 17, rightId: 3, dbContent: "[[_left]]" });
  await seedCard(s, { id: 22, name: "_left" });
  await seedReference(s, 21, 22, "_left");

  await seedCard(s, {
    id: 30, name: "Parent Thing", typeId: BASIC_TYPE_ID,
    dbContent: "parent body", readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, { id: 32, name: "child" });
  await seedCard(s, {
    id: 31, leftId: 30, rightId: 32, typeId: BASIC_TYPE_ID,
    dbContent: "child body",
  });

  await seedCard(s, {
    id: 33, name: "Locked Parent", typeId: BASIC_TYPE_ID,
    dbContent: "locked body", readRuleId: 37, readRuleClass: "*self",
  });
  await seedCard(s, { id: 36, leftId: 33, rightId: 16, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 37, leftId: 36, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 37, 7, "role_a");
  await seedCard(s, {
    id: 34, leftId: 33, rightId: 32, typeId: BASIC_TYPE_ID,
    dbContent: "locked child body",
  });

  await seedCard(s, { id: 40, name: "*sidebar" });
  await seedCard(s, { id: 42, leftId: 40, rightId: 16, typeId: SET_TYPE_ID });
  const settings: Array<[number, string, string]> = [
    [50, "*structure", "structure"],
    [51, "*default", "default"],
    [52, "*autoname", "autoname"],
    [53, "*create", "create"],

    [55, "*update", "update"],
    [56, "*delete", "delete"],
    [57, "*captcha", "captcha"],
    [58, "*head", "head"],
    [59, "*layout", "layout"],
    [60, "*style", "style"],
    [61, "*script", "script"],
    [62, "*help", "help"],
    [63, "*input type", "input_type"],
    [64, "*guide", "guide"],
    [65, "*on_create", "on_create"],
    [66, "*on_update", "on_update"],
    [67, "*on_delete", "on_delete"],
    [68, "*thanks", "thanks"],
    [69, "*follow fields", "follow_fields"],
    [70, "*follow", "follow"],
  ];
  for (const [id, name, codename] of settings) await seedSetting(s, id, name, codename);

  await seedCard(s, { id: 72, leftId: 50, rightId: 18, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 71, leftId: 72, rightId: 3, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 71, 20, "anyone_signed_in");

  await seedCard(s, { id: 81, name: "Pointer", codename: "pointer" });
  await seedCard(s, {
    id: 80, name: "Tag Collection", typeId: 81,
    dbContent: "[[Parent Thing]]\n[[Locked Parent]]",
  });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck(storage);
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("read-rule _left delegation (permissions.rb:55-71, read side)", () => {
  it("renders a compound card whose winning read rule says _left through its LEFT card's rule", async () => {
    const s = storage!;

    const html = await s.engine.render("Parent Thing+child", "content");
    expect(html).toContain("child body");
    expect(html).not.toContain('class="denied"');
  });

  it("denies the compound when the LEFT card's rule denies (the lock inherits)", async () => {
    const s = storage!;

    expect(await s.engine.render("Locked Parent+child", "content")).toBe(quietDenial());
  });

  it("the left card's own verdict still comes from its stored rule", async () => {
    const s = storage!;
    expect(await s.engine.render("Parent Thing", "content")).toContain("parent body");
    expect(await s.engine.render("Locked Parent", "content")).toBe(quietDenial());
  });
});

describe("set-card rules editor (the *sidebar+*self corpus shape)", () => {
  let html = "";
  beforeAll(async () => {
    html = await storage!.engine.render("*sidebar+*self", "content");
  }, 60_000);

  it("renders the per-setting rule bars, not quiet denials", () => {

    expect(html).toContain('data-card-name="*sidebar+*self+*default"');
    expect(html).toContain('data-card-name="*sidebar+*self+*autoname"');
    expect(html).toContain('data-card-name="*sidebar+*self+*create"');
    expect(html.match(/class="denied"/g)?.length).toBe(1);
  });

  it("orders templating [structure, default, autoname] with the *structure bar denied", () => {

    const order = [
      ...html.matchAll(/<li class="nav-item">(<span class="denied">|<div id="[^"]+"[^>]*data-card-name="([^"]*)")/g),
    ].map((m) => (m[1].startsWith("<span") ? "DENIED" : m[2]));
    const templating = order.slice(0, 3);
    expect(templating).toEqual([
      "DENIED",
      "*sidebar+*self+*default",
      "*sidebar+*self+*autoname",
    ]);
  });

  it("excludes the deck-wide-invisible content settings from the editing group", () => {

    expect(html).not.toContain("content_options");
    expect(html).not.toContain("content_option_view");
    expect(html).toContain('data-card-name="*sidebar+*self+*input');
  });

  it("badge counts read the VISIBLE setting list (editing 3, not 5)", () => {
    const badges = [
      ...html.matchAll(/_count badge bg-secondary ms-3">(\d+)</g),
    ].map((m) => m[1]);
    expect(badges).toEqual(["3", "5", "4", "3", "3", "3"]);
  });
});

describe("pointer-item denial shapes (expected-v2 census)", () => {
  it("renders a real read-denied pointer item as the bare quiet span, not a mini_bar wrap", async () => {
    const s = storage!;

    const html = await s.engine.render("Tag Collection", "content");
    expect(html).toContain("pointer-item item-bar\"><span class=\"denied\">");
    expect(html).not.toContain("mini_bar-view");
  });
});
