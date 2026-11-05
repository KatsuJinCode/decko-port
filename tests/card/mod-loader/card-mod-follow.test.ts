// The card-mod-follow mod loader integration test: the mod loaded
// through the loader registers its views and the rendered bytes match
// the Ruby source semantics.
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.ts#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the full gem tree; the setting_opts
//     registrations surface on the Setting registry; the *follow
//     codename is registered as a preference.
//
// Probe cards:
//   - Oracle Following Probe+following (junction): right side = following
//     setting so the right/following set module's :status + :one_line_
//     content are reachable
//   - Oracle Followers Probe+followers (junction): right side = followers
//     setting so the right/followers set module's :core super() is
//     reachable
//   - Oracle User Probe+follow (junction): right side = follow setting
//     so the type_plus_right/user/follow set module's :one_line_content
//     + :edit are reachable
//   - *follow_defaults (the self anchor for the deprecated editor that
//     defines :confirm_update_all)

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

  // codename cards (the codename registry reads cards.codename; their
  // type ids matter to the rule-cache join: set-typed vs setting-typed).
  await seedCard(s, { id: 2, name: "RichText" }); // cardtypes' type card
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  // the *follow setting card (right anchor for Right::Follow and the
  // right anchor for TypePlusRight::User::Follow + the codename the
  // SettingRegistry surfaces as a preference).
  await seedCard(s, {
    id: 110,
    name: "follow",
    codename: "follow",
    typeId: 14,
  });

  // the *following list card (right anchor for Right::Following)
  await seedCard(s, {
    id: 120,
    name: "following",
    codename: "following",
    typeId: 14,
  });

  // the *followers list card (right anchor for Right::Followers)
  await seedCard(s, {
    id: 130,
    name: "followers",
    codename: "followers",
    typeId: 14,
  });

  // the *follow_defaults list card (self anchor for Self::FollowDefaults;
  // holds the :confirm_update_all view)
  await seedCard(s, {
    id: 140,
    name: "*follow defaults",
    codename: "follow_defaults",
    typeId: 14,
    dbContent: "*all\n*always",
  });

  // Oracle Following Probe (left side of the +following junction)
  await seedCard(s, {
    id: 200,
    name: "Oracle Following Probe",
    dbContent: "following probe body",
  });
  await seedCard(s, {
    id: 201,
    leftId: 200,
    rightId: 120, // +following right
    typeId: 14, // setting type (junctions are setting-typed)
    dbContent: "following junction body",
  });

  // Oracle Followers Probe (left side of the +followers junction)
  await seedCard(s, {
    id: 210,
    name: "Oracle Followers Probe",
    dbContent: "followers probe body",
  });
  await seedCard(s, {
    id: 211,
    leftId: 210,
    rightId: 130, // +followers right
    typeId: 14,
    dbContent: "followers junction body",
  });

  // Oracle User Probe (left side of the User+follow junction; typeId 2
  // is the RichText/cardtype default but we need a User-type card so
  // the type_plus_right/user/follow set module applies).
  await seedCard(s, {
    id: 300,
    name: "Oracle User Probe",
    typeId: 2,
    dbContent: "user probe body",
  });
  await seedCard(s, {
    id: 301,
    leftId: 300,
    rightId: 110, // +follow right (User+follow)
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
    // The :confirm_update_all view is mod-specific (self/follow_defaults
    // defines it; the base HTML_VIEWS table has no entry). Same for
    // :one_line_content on the right/following and type_plus_right/
    // user/follow set modules — the baseline :one_line_content is
    // present in HTML_VIEWS so the unsupported-view check would not
    // trip. The :status view on right/following is mod-specific.
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
    // The Ruby body wraps an alert helper inside a `wrap do ... end`:
    //   wrap { alert "info" { %(<h1>Are you sure you want to change the
    //   default follow rules?</h1><p>You may choose to update all
    //   existing users. This may take a while. </p>) } }
    // The wrap helper emits <div>X</div>; the alert helper adds
    // class="alert alert-info". The inner literal h1+p is preserved.
    expect(html).toBe(
      `<div class="alert alert-info"><h1>Are you sure you want to change the default follow rules?</h1>` +
      `<p>You may choose to update all existing users. This may take a while. </p></div>`,
    );
  });

  it("WITH the mod: :status on +*following renders the literal 'No following preference' fallback (right/following.rb:13-22)", async () => {
    const s = storage!;
    // The status view's if-branch walks card.left.preference :follow
    // (Rails runtime); the headless port's no-preference-walk state
    // takes the else branch and emits the literal fallback.
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
    // render :open produces a non-empty slot wrap (card-slot + open-view
    // classes); the edit view's literal render :open dispatch is the
    // exact body, so the result carries the open view's bytes.
    const html = await s.engine.render("Oracle User Probe+follow", "edit");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("open-view");
  });

  it("WITH the mod: :core on +*followers dispatches to the base :core (right/followers.rb:13-15, super())", async () => {
    const s = storage!;
    // The :core override is a literal super() call to the base :core
    // view. The base :core renders the card's content; the +*followers
    // junction's dbContent is "followers junction body", so the
    // resulting bytes include that body verbatim.
    const html = await s.engine.render("Oracle Followers Probe+followers", "core");
    expect(html).toContain("followers junction body");
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();
    // abstract: follow_option
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::FollowOption");
    // the base pattern (setPathPattern === "all"): All::Follow is the
    // only "all"-prefixed file (the all/follow/* subdirs fall under the
    // "all" pattern code too — they share the same code as their parent
    // for the SetLoader walk). Actually setPathPattern splits on "/" so
    // "all/follow/followed_by" has pattern "all" too, which lands in the
    // base bucket (loader.rb#parts_from_path: pattern = first segment).
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
    // right nonbase
    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Account");
    expect(right).toContain("Right::ContextualClass");
    expect(right).toContain("Right::Disappear");
    expect(right).toContain("Right::Follow");
    expect(right).toContain("Right::Followers");
    expect(right).toContain("Right::Following");
    expect(right).toContain("Right::FollowFields");
    expect(right).toContain("Right::Message");
    // self nonbase
    const self = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(self).toContain("Self::Always");
    expect(self).toContain("Self::Created");
    expect(self).toContain("Self::Edited");
    expect(self).toContain("Self::Follow");
    expect(self).toContain("Self::FollowDefaults");
    expect(self).toContain("Self::FollowFields");
    expect(self).toContain("Self::Never");
    // type nonbase
    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::Cardtype");
    expect(type).toContain("Type::NotificationTemplate");
    expect(type).toContain("Type::Set");
    expect(type).toContain("Type::User");
    // type_plus_right nonbase
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
    // The SettingRegistry#preferenceIs method surfaces codenames whose
    // setting_opts was called with preference: true (mod-registrar.ts:
    // 187-189 mirrors setting.rb:95-99 register_preference).
    expect(settings.preferenceIs("follow")).toBe(true);
  });

  it("WITH the mod: the *follow_fields setting_opts is registered without preference (self/follow_fields.rb:1)", () => {
    const settings = loader!.settingsRegistry();
    expect(settings.preferenceIs("follow_fields")).toBe(false);
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Following Probe+following", "content");
    // baseline :content is the format/views.ts#contentView; the mod
    // does NOT redefine :content for any of its set modules, so the
    // existing core content renders unchanged. We assert it renders
    // WITHOUT throwing and produces a non-empty slot.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
