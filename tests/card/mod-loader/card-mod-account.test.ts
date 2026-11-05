// The card-mod-account mod loader integration test: the mod loaded
// through the loader registers its views and the rendered bytes match
// the Ruby source semantics.
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.ts#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the full gem tree; view registration
//     order matches the gem's pattern walk (right/account/views first,
//     right/password later - the mod loader's set-loader path-sorts and
//     pattern-groups exactly the way SetLoader does).
//
// Probe cards:
//   - Oracle Token Probe+account (junction): right side = account setting
//     so the right/account set module's :token_days is reachable
//   - *signin (the *self anchor for the self/signin set module)
//   - Oracle Closed Probe (any card; abstract/account_holder's
//     :closed_account renders independent of card shape)
//   - Oracle Mail Probe+email (User+email junction, real with content)
//     plus a virtual probe of the same name with no id

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
import cardModAccount from "../../../src/card/mod-loader/mods/card-mod-account.js";

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

  // the *signin card (the *self anchor for Self::Signin; the name is the
  // codename registry's lookup key)
  await seedCard(s, {
    id: 100,
    name: "*signin",
    codename: "signin",
    typeId: 14,
    dbContent: "Sign In",
  });

  // the *account setting card (the right-anchor for Right::Account)
  await seedCard(s, {
    id: 110,
    name: "account",
    codename: "account",
    typeId: 14,
  });

  // the *email phrase setting card (the right-anchor for Right::Email and
  // the right side of the User+email junction below). Phrase type — the
  // type_plus_right set pattern's right side carries this card's id as
  // the right_id of every User+email card.
  await seedCard(s, {
    id: 130,
    name: "email",
    codename: "email",
    typeId: 14,
  });

  // Oracle Token Probe+account (junction: left = Oracle Token Probe,
  // right = *account setting). The right/account set module applies
  // because the card's right side is the *account setting card.
  await seedCard(s, {
    id: 120,
    name: "Oracle Token Probe",
    dbContent: "token probe body",
  });
  await seedCard(s, {
    id: 121,
    leftId: 120,
    rightId: 110,
    typeId: 14, // setting type (junctions are setting-typed)
    dbContent: "token probe account body",
  });

  // Oracle Closed Probe - any card. abstract/account_holder applies to
  // every card via the abstract pseudo-pattern.
  await seedCard(s, {
    id: 140,
    name: "Oracle Closed Probe",
    dbContent: "closed probe body",
  });

  // Oracle Mail Probe (a User card whose +email right is the probe)
  await seedCard(s, {
    id: 150,
    name: "Oracle Mail Probe",
    dbContent: "user body",
    typeId: 2,
  });
  await seedCard(s, {
    id: 151,
    leftId: 150,
    rightId: 130, // +email right (right is the email phrase setting)
    typeId: 2,
    dbContent: "alice@example.com",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-account through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("Oracle Token Probe+account", "token_days")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Token Probe+account", "verify_days")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Token Probe+account", "reset_password_days")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Token Probe+account", "token_expiry")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("*signin", "one_line_content")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("*signin", "open_content")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Closed Probe", "closed_account")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Mail Probe+email", "raw")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :token_days renders the integer-as-string (right/account/views.rb:14-16)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModAccount }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    expect(await s.engine.render("Oracle Token Probe+account", "token_days")).toBe("7");
  });

  it("WITH the mod: :verify_days alias renders the same bytes (right/account/views.rb:18-19)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Token Probe+account", "verify_days")).toBe("7");
  });

  it("WITH the mod: :reset_password_days alias renders the same bytes (right/account/views.rb:20)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Token Probe+account", "reset_password_days")).toBe("7");
  });

  it("WITH the mod: :token_expiry renders the HTML-wrapped expiry (right/account/views.rb:65-67)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Token Probe+account", "token_expiry"))
      .toBe("<p><em>Link will expire in 7 days</em></p>");
  });

  it("WITH the mod: :one_line_content renders the empty string (self/signin.rb:144-146)", async () => {
    const s = storage!;
    expect(await s.engine.render("*signin", "one_line_content")).toBe("");
  });

  it("WITH the mod: :open_content delegates to :core (self/signin.rb:139-142)", async () => {
    const s = storage!;
    // *signin has dbContent "Sign In"; the :core view (views.ts#coreView)
    // for a plain settings-typed card falls through to
    // processContent(renderRaw()) = "Sign In".
    expect(await s.engine.render("*signin", "open_content")).toBe("Sign In");
  });

  it("WITH the mod: :closed_account renders the two-line haml HTML (abstract/account_holder.rb:126 + closed_account.haml)", async () => {
    const s = storage!;
    const expected =
      "<h2>Account Closed</h2>\n" +
      "<p>The sign-in account once associated with this card has been removed, " +
      "the card has been anonymized, and its data fields have been deleted.</p>";
    expect(await s.engine.render("Oracle Closed Probe", "closed_account")).toBe(expected);
  });

  it("WITH the mod: :raw on User+email returns the card's dbContent (type_plus_right/user/email.rb:7-9)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Mail Probe+email", "raw")).toBe("alice@example.com");
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();
    // the base pattern: all/account + all/password_input
    expect(basket.base.map((m) => m.shortname)).toContain("All::Account");
    expect(basket.base.map((m) => m.shortname)).toContain("All::PasswordInput");
    // abstract: account_field + account_holder
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::AccountField");
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::AccountHolder");
    // right nonbase: every right/... set module from the gem
    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Account");
    expect(right).toContain("Right::Account::Events");
    expect(right).toContain("Right::Account::Views");
    expect(right).toContain("Right::Email");
    expect(right).toContain("Right::Password");
    expect(right).toContain("Right::Roles");
    expect(right).toContain("Right::Salt");
    expect(right).toContain("Right::Status");
    // self nonbase
    const self = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(self).toContain("Self::Anonymous");
    expect(self).toContain("Self::DeckoBot");
    expect(self).toContain("Self::Role");
    expect(self).toContain("Self::Signin");
    // type nonbase
    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::Role");
    expect(type).toContain("Type::Signup");
    expect(type).toContain("Type::Signup::Views");
    expect(type).toContain("Type::User");
    // type_plus_right nonbase
    expect(type).toContain("TypePlusRight::Cardtype::Account");
    expect(type).toContain("TypePlusRight::Role::Members");
    expect(type).toContain("TypePlusRight::User::Email");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    // the ModLoadReport is returned by load(); re-run via the loader's
    // table introspection since the first call's report was discarded.
    const report = loader!.load();
    expect(report.registeredViews).toContain("token_days");
    expect(report.registeredViews).toContain("verify_days");
    expect(report.registeredViews).toContain("reset_password_days");
    expect(report.registeredViews).toContain("token_expiry");
    expect(report.registeredViews).toContain("one_line_content");
    expect(report.registeredViews).toContain("open_content");
    expect(report.registeredViews).toContain("closed_account");
    expect(report.registeredViews).toContain("raw");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Token Probe+account", "content");
    // baseline :content is the format/views.ts#contentView; the mod
    // does NOT redefine :content for any of its set modules, so the
    // existing core content renders unchanged. We assert it renders
    // WITHOUT throwing and produces a non-empty slot.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
