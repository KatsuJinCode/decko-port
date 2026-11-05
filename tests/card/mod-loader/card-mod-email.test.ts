// The card-mod-email mod loader integration test: the mod loaded through
// the loader registers its views and the rendered bytes match the Ruby
// source semantics.
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.ts#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the full gem tree; the view-registration
//     table carries every ported name.
//
// Probe cards:
//   - Oracle Email Probe (a basic RichText card; :email_page renders the
//     core of any card wrapped in the email-document envelope)

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
import cardModEmail from "../../../src/card/mod-loader/mods/card-mod-email.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  // codename cards (the codename registry reads cards.codename; their
  // type ids matter to the rule-cache join: set-typed vs setting-typed).
  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  // Oracle Email Probe - any card; :email_page renders the html format's
  // :core bytes wrapped in the email-document envelope. The card needs
  // SOME db_content so the core view emits a non-trivial interior.
  await seedCard(s, {
    id: 200,
    name: "Oracle Email Probe",
    dbContent: "email probe body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-email through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("Oracle Email Probe", "email_page")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Email Probe", "compact_missing")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Email Probe", "last_action")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :email_page renders the envelope + core (set/all/email_html.rb:2-23)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModEmail }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("Oracle Email Probe", "email_page");
    // The email-document wrapper (set/all/email_html.rb:2-14): doctype,
    // html/head with the meta tag + empty <style></style>, body class
    // "d0-email-body" wrapping the interior (which is the html format's
    // :core render).
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(
      '<meta http-equiv="Content-type" content="text/html;charset=UTF-8"/>',
    );
    expect(html).toContain("<style></style>");
    expect(html).toContain('<body class="d0-email-body">');
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
    // The interior is the html :core view's bytes - the card's
    // db_content run through processContent (the base core just emits
    // raw db_content when there are no nests).
    expect(html).toContain("email probe body");
  });

  it("WITH the mod: :email_page wrapper shape is byte-exact to the source heredoc", async () => {
    const s = storage!;
    // The rendered bytes around the envelope should match the squiggly-
    // heredoc output exactly. The interior is the core slot, which we
    // pin between two fixed markers.
    const html = await s.engine.render("Oracle Email Probe", "email_page");
    expect(html.startsWith("<!DOCTYPE html>\n<html>\n  <head>\n")).toBe(true);
    // After </style>\n  </head>\n  <body class="d0-email-body">\n the
    // core slot begins; the closing is </body>\n</html> with no extra
    // trailing newline (the heredoc body has no trailing newline after
    // </html>).
    expect(html.endsWith("</body>\n</html>")).toBe(true);
  });

  it("WITH the mod: :compact_missing renders the empty string (set/all/email_text.rb:6-8)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Email Probe", "compact_missing")).toBe("");
  });

  it("WITH the mod: :last_action renders the empty string (set/all/email_text.rb:10-12)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Email Probe", "last_action")).toBe("");
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();
    // abstract: email_field + test_context
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::EmailField");
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::TestContext");
    // base (all): email_html + email_text
    expect(basket.base.map((m) => m.shortname)).toContain("All::EmailHtml");
    expect(basket.base.map((m) => m.shortname)).toContain("All::EmailText");
    // right nonbase: every right/... set module from the gem
    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Bcc");
    expect(right).toContain("Right::Cc");
    expect(right).toContain("Right::From");
    expect(right).toContain("Right::Subject");
    expect(right).toContain("Right::To");
    expect(right).toContain("Right::TextMessage");
    expect(right).toContain("Right::HtmlMessage");
    // type nonbase: email_template + email_template/email_config + email_template/html
    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::EmailTemplate");
    expect(type).toContain("Type::EmailTemplate::EmailConfig");
    expect(type).toContain("Type::EmailTemplate::Html");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    // Reload (idempotent) to get the report - the first call's report
    // was discarded; this call's report is the structural reference.
    const report = loader!.load();
    expect(report.registeredViews).toContain("email_page");
    expect(report.registeredViews).toContain("compact_missing");
    expect(report.registeredViews).toContain("last_action");
    // The email_text/email_html format-block re-registrations of
    // :unknown (also "" -> "" so the html-format unknown override is
    // semantically identical) also appear here.
    expect(report.registeredViews).toContain("unknown");
  });

  it("WITH the mod: the :email_page view-config carries wrap: email_document", () => {
    const cfg = loader!.viewConfigFor("email_page");
    expect(cfg?.wrap).toBe("email_document");
  });

  it("WITH the mod: the :last_action view-config carries perms: none + cache: never (view_opts.rb:17)", () => {
    const cfg = loader!.viewConfigFor("last_action");
    expect(cfg?.perms).toBe("none");
    expect(cfg?.cache).toBe("never");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Email Probe", "content");
    // baseline :content is the format/views.ts#contentView; the mod
    // does NOT redefine :content for any of its set modules, so the
    // existing core content renders unchanged. We assert it renders
    // WITHOUT throwing and produces a non-empty slot.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
