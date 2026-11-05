

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

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

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

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(
      '<meta http-equiv="Content-type" content="text/html;charset=UTF-8"/>',
    );
    expect(html).toContain("<style></style>");
    expect(html).toContain('<body class="d0-email-body">');
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");

    expect(html).toContain("email probe body");
  });

  it("WITH the mod: :email_page wrapper shape is byte-exact to the source heredoc", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Email Probe", "email_page");
    expect(html.startsWith("<!DOCTYPE html>\n<html>\n  <head>\n")).toBe(true);

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

    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::EmailField");
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::TestContext");

    expect(basket.base.map((m) => m.shortname)).toContain("All::EmailHtml");
    expect(basket.base.map((m) => m.shortname)).toContain("All::EmailText");

    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Bcc");
    expect(right).toContain("Right::Cc");
    expect(right).toContain("Right::From");
    expect(right).toContain("Right::Subject");
    expect(right).toContain("Right::To");
    expect(right).toContain("Right::TextMessage");
    expect(right).toContain("Right::HtmlMessage");

    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::EmailTemplate");
    expect(type).toContain("Type::EmailTemplate::EmailConfig");
    expect(type).toContain("Type::EmailTemplate::Html");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {

    const report = loader!.load();
    expect(report.registeredViews).toContain("email_page");
    expect(report.registeredViews).toContain("compact_missing");
    expect(report.registeredViews).toContain("last_action");

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

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
