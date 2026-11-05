

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

const SIGNUP_TYPE_ID = 12;
const TOGGLE_TYPE_ID = 51;
const ANON_ID = 8;
const ADMIN_ID = 393;

async function seedDeck(): Promise<void> {
  const s = storage!;
  await seedCard(s, { id: 1, name: "Set", codename: "set" });
  await seedCard(s, { id: 4, name: "RichText", codename: "rich_text" });
  await seedCard(s, { id: 9, name: "Basic", codename: "basic" });
  await seedCard(s, { id: 12, name: "Sign up", codename: "signup" });
  await seedCard(s, { id: 51, name: "Toggle", codename: "toggle" });
  await seedCard(s, { id: 8, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 1 });
  await seedCard(s, { id: 20, name: "*read", codename: "read", typeId: 2 });
  await seedCard(s, { id: 21, name: "*default", codename: "default", typeId: 2 });
  await seedCard(s, { id: 40, name: "*account", codename: "account", typeId: 2 });

  await seedCard(s, { id: 4037, name: "*version", codename: "version", dbContent: "" });
  await seedCard(s, { id: 22751, name: "*credit", codename: "credit", typeId: 5, dbContent: '<a href="http://decko.org">Decko v{{:version|core}}</a>' });
  await seedCard(s, { id: 5, name: "HTML", codename: "html" });

  await seedCard(s, {
    id: 46001,
    name: "ronald test",
    typeId: SIGNUP_TYPE_ID,
    creatorId: ANON_ID,
    createdAt: "2023-11-18 16:24:47",
    dbContent: "<div>\r\n{{+agree | type:Toggle }}\r\n</div>",
  });
  await seedCard(s, {
    id: 46011,
    name: "tesfaye test",
    typeId: SIGNUP_TYPE_ID,
    creatorId: ADMIN_ID,
    createdAt: "2016-03-11 07:41:27",
    dbContent: "<div>\r\n{{+agree | type:Toggle }}\r\n</div>",
  });
  await seedCard(s, { id: 46002, name: "ronald test+*account", leftId: 46001, rightId: 40, dbContent: "" });
  await seedCard(s, { id: 17692, name: "agree" });
  await seedCard(s, { id: 46003, name: "ronald test+agree", leftId: 46001, rightId: 17692, typeId: TOGGLE_TYPE_ID, dbContent: "" });
  await seedCard(s, { id: 62001, name: "list host", typeId: 9, dbContent: "[[Known Target]] and [[People Green]] and ExampleSite.com, plus [[https://decko.org|the decko site]]" });
  await seedCard(s, { id: 62002, name: "Known Target", dbContent: "known" });
  await seedCard(s, { id: 62010, name: "bar host", typeId: 9, dbContent: "{{+absent item|closed}}" });
  await seedCard(s, { id: 62011, name: "list holder", typeId: 3, dbContent: "absent item" });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck();
  await storage.fetcher.installNameEnvironment();
  await storage.fetcher.warmLexicon([1, 4, 5, 8, 9, 10, 12, 20, 21, 40, 51, 4037, 22751, 46001, 46002, 46011, 62001, 62002, 62010, 62011]);

  await (
    storage.engine as unknown as { prepareItemForRender: (n: string) => Promise<unknown> }
  ).prepareItemForRender("Known Target");
});

afterAll(() => {
  storage?.close();
});

describe("R17 byte-formatting lane pins", () => {
  it("implicit nests render titled-view on the bare lane (railtie config, not the deck rule)", async () => {
    const html = await storage!.engine.render("ronald test", "content");

    expect(html).toContain('agree-titled-view');
    expect(html).not.toContain('agree-content-view');
  });

  it("Sign up core renders the invite-links shape with the corpus created_at", async () => {
    const html = await storage!.engine.render("ronald test", "content");
    expect(html).toContain("<div class='invite-links'>");
    expect(html).toContain(
      "<div><strong>ronald test</strong> signed up on November 18, 2023 16:24:47</div>",
    );

    expect(html).not.toContain("ERROR: signup card missing account");
    expect(html).not.toContain("A verification email has been sent to");

    expect(html).toContain("</div>\n</div>\n</div>");
  });

  it("admin-created signups read 'was signed up on' (invited? via creator_id)", async () => {
    const html = await storage!.engine.render("tesfaye test", "content");
    expect(html).toContain("<strong>tesfaye test</strong> was signed up on March 11, 2016 07:41:27");
  });

  it("the nest type opt types the new card (Toggle body 'no', slot JSON type)", async () => {
    const html = await storage!.engine.render("ronald test", "content");
    expect(html).toContain('data-card-type-id="51" data-card-type-name="Toggle"');
    expect(html).toContain('TYPE-toggle RIGHT-agree TYPE_PLUS_RIGHT-sign_up-agree');

    expect(html).toContain('">no</div>');

    expect(html).toContain("&quot;type&quot;:&quot;Toggle&quot;");
  });

  it("the version code card renders 0.20.0 through the credit chain", async () => {
    const html = await storage!.engine.render("*credit", "content");
    expect(html).toContain('<a href="http://decko.org">Decko v0.20.0</a>');
  });

  it("bare hosts autolink with trailing punctuation outside the anchor; wiki links win by position", async () => {
    const html = await storage!.engine.render("list host", "content");
    expect(html).toContain(
      '<a class="known-card" href="/Known_Target"><span class="card-title" title="Known Target">Known Target</span></a>',
    );

    expect(html).toContain('wanted-card" href="/People_Green"');

    expect(html).toContain(
      '<a target="_blank" class="external-link" href="http://ExampleSite.com">ExampleSite.com</a>,',
    );

    expect(html).toContain(
      '<a class="external-link" href="https://decko.org" target="_blank">the decko site</a>',
    );
  });

  it("non-rule unknown bars keep bar_nav visible (bar_view.rb:11 scope)", async () => {
    const html = await storage!.engine.render("bar host", "content");

    expect(html).toContain("&quot;hide&quot;:[&quot;bar_middle&quot;]");
    expect(html).not.toContain("&quot;bar_nav&quot;");
  });
});
