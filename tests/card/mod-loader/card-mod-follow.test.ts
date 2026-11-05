

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModFollow from "../../../src/card/mod-loader/mods/card-mod-follow.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, {
    id: 110,
    name: "follow",
    codename: "follow",
    typeId: 14,
  });

  await seedCard(s, {
    id: 120,
    name: "following",
    codename: "following",
    typeId: 14,
  });

  await seedCard(s, {
    id: 130,
    name: "followers",
    codename: "followers",
    typeId: 14,
  });

  await seedCard(s, {
    id: 140,
    name: "*follow defaults",
    codename: "follow_defaults",
    typeId: 14,
    dbContent: "*all\n*always",
  });

  await seedCard(s, {
    id: 200,
    name: "Oracle Following Probe",
    dbContent: "following probe body",
  });
  await seedCard(s, {
    id: 201,
    leftId: 200,
    rightId: 120,
    typeId: 14,
    dbContent: "following junction body",
  });

  await seedCard(s, {
    id: 210,
    name: "Oracle Followers Probe",
    dbContent: "followers probe body",
  });
  await seedCard(s, {
    id: 211,
    leftId: 210,
    rightId: 130,
    typeId: 14,
    dbContent: "followers junction body",
  });

  await seedCard(s, {
    id: 300,
    name: "Oracle User Probe",
    typeId: 2,
    dbContent: "user probe body",
  });
  await seedCard(s, {
    id: 301,
    leftId: 300,
    rightId: 110,
    typeId: 14,
    dbContent: "follow junction body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-follow through the mod loader (A/B)", () => {
  it("WITHOUT the mod: the mod-specific views raise UnsupportedViewError", async () => {
    const s = storage!;

    await expect(s.engine.render("*follow defaults", "confirm_update_all")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :confirm_update_all renders the literal alert markup (self/follow_defaults.rb:24-30)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModFollow }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("*follow defaults", "confirm_update_all");

    expect(html).toBe(
      `<div class="alert alert-info"><h1>Are you sure you want to change the default follow rules?</h1>` +
      `<p>You may choose to update all existing users. This may take a while. </p></div>`,
    );
  });

  it("WITH the mod: :status on +*following renders the literal 'No following preference' fallback (right/following.rb:13-22)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Following Probe+following", "status");
    expect(html).toBe("No following preference");
  });

  it("WITH the mod: :one_line_content on +*following renders the empty string (right/following.rb:24-26)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Following Probe+following", "one_line_content");
    expect(html).toBe("");
  });

  it("WITH the mod: :one_line_content on User+follow renders the empty string (type_plus_right/user/follow.rb:23-25)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle User Probe+follow", "one_line_content");
    expect(html).toBe("");
  });

  it("WITH the mod: :edit on User+follow dispatches to :open (type_plus_right/user/follow.rb:27-29)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle User Probe+follow", "edit");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("open-view");
  });

  it("WITH the mod: :core on +*followers dispatches to the base :core (right/followers.rb:13-15, super())", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Followers Probe+followers", "core");
    expect(html).toContain("followers junction body");
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();

    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::FollowOption");

    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow::FollowedBy");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow::FollowerIds");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow::FollowLink");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow::FollowLinkViews");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow::StartFollowLink");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Follow::StopFollowLink");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Notify");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Notify::BaseViews");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Notify::HtmlViews");

    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Account");
    expect(right).toContain("Right::ContextualClass");
    expect(right).toContain("Right::Disappear");
    expect(right).toContain("Right::Follow");
    expect(right).toContain("Right::Followers");
    expect(right).toContain("Right::Following");
    expect(right).toContain("Right::FollowFields");
    expect(right).toContain("Right::Message");

    const self = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(self).toContain("Self::Always");
    expect(self).toContain("Self::Created");
    expect(self).toContain("Self::Edited");
    expect(self).toContain("Self::Follow");
    expect(self).toContain("Self::FollowDefaults");
    expect(self).toContain("Self::FollowFields");
    expect(self).toContain("Self::Never");

    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::Cardtype");
    expect(type).toContain("Type::NotificationTemplate");
    expect(type).toContain("Type::Set");
    expect(type).toContain("Type::User");

    expect(type).toContain("TypePlusRight::User::Follow");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    const report = loader!.load();
    expect(report.registeredViews).toContain("confirm_update_all");
    expect(report.registeredViews).toContain("status");
    expect(report.registeredViews).toContain("one_line_content");
    expect(report.registeredViews).toContain("edit");
    expect(report.registeredViews).toContain("core");
  });

  it("WITH the mod: the *follow setting_opts registers as a preference (self/follow.rb:1)", () => {
    const settings = loader!.settingsRegistry();

    expect(settings.preferenceIs("follow")).toBe(true);
  });

  it("WITH the mod: the *follow_fields setting_opts is registered without preference (self/follow_fields.rb:1)", () => {
    const settings = loader!.settingsRegistry();
    expect(settings.preferenceIs("follow_fields")).toBe(false);
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Following Probe+following", "content");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
