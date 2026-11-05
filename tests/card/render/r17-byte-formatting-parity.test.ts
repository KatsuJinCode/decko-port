// R17 byte-formatting lane regression pins (2026-09-27). The dual-lane
// view/page classes this lane closed, each cited to the Ruby mechanism it
// ports and the oracle byte that pinned it:
//
// 1. LANE-CONFIG DEFAULT NEST VIEW (A-36 correction). Ruby's html
//    default_nest_view reads PROCESS CONFIG (card-mod-format
//    set/all/html.rb:17-19 `Cardio.config.default_html_view`), never a deck
//    rule — the corpus's `*all+*default html view` rule card 22769 is dead
//    in 0.20.0. The two capture environments carry different config: the
//    bare-render boot runs the railtie default :titled
//    (card-mod-format lib/card/mod/format.rb:2 — probe
//    tmp/raw-ground-truth/scripts/r17-nest-default-view-probe.rb) and the
//    page capture applies the production :content
//    (capture-dual-lane-page-and-view.rb:255). The engine models the lane
//    (render.ts pageConfigActive + defaultHtmlViewConfig); an implicit nest
//    renders titled-view bare and content-view inside a page.
// 2. SIGN UP CORE (card-mod-account set/type/signup/core.haml +
//    views.rb:30-61): the invite-links div — signup_line ("signed up on
//    #{format_date card.created_at}", "was" iff creator != AnonymousID) +
//    account_lines (the +*account child via the STAR-form trait fetch;
//    oracle probe r17-junction-fetch-probe.rb) over the processed raw body.
// 3. NEST TYPE OPT (nest/fetch.rb:47-48 new_card_args): `| type:X ` types
//    the NEW card a missing target resolves to — ronald joseph +agree pins
//    data-card-type-id="51" + the toggle core body "no".
// 4. VERSION CARD (card-1.110.0 mod/core set/self/version.rb:6-8 `def
//    content; Cardio::Version.release; end`) — the footer credit chain
//    pins "Decko v0.20.0" on every page.
// 5. URI CHUNKS (card-mod-content lib/card/content/chunk/uri.rb — the
//    DEFAULT chunk list carries Uri/HostUri/EmailUri): bare hosts autolink
//    through link_to_resource (target="_blank" + external-link class,
//    links.rb:142-146), trailing punctuation stays outside the anchor,
//    matches inside HTML tags are skipped (corpus-wide zero tag-internal
//    autolinks), and [[wiki links]] win by position (the parser consumes
//    the earliest chunk first).
// 6. KNOWN/WANTED LINK CLASSES (links.rb:135-140 add_known_or_wanted_class):
//    known = Card.known? — the warm render-card map answers it; absent
//    targets render wanted-card (sabrina mejias [[People Green]] pin).
// 7. BAR NAV HIDE SCOPE (bar_view.rb:11): the hide belongs to RULE bars —
//    non-rule unknown bars keep bar_nav visible (RVW open's mini_bar items
//    pin hide ["bar_middle"] without bar_nav).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

const SIGNUP_TYPE_ID = 12;
const TOGGLE_TYPE_ID = 51;
const ANON_ID = 8; // the seeded Anonymous card id (matches the corpus semantics)
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
  // The version code card: the corpus row stores content "" — the Ruby
  // `def content` override never materializes in the column.
  await seedCard(s, { id: 4037, name: "*version", codename: "version", dbContent: "" });
  await seedCard(s, { id: 22751, name: "*credit", codename: "credit", typeId: 5, dbContent: '<a href="http://decko.org">Decko v{{:version|core}}</a>' });
  await seedCard(s, { id: 5, name: "HTML", codename: "html" });
  // A self-signed-up card (creator Anonymous) with a Toggle-typed missing
  // child nest typed by the opt, and an admin-created one ("was").
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
  await seedCard(s, { id: 62001, name: "list host", typeId: 9, dbContent: "[[Known Target]] and [[People Green]] and Culturesmith.com, plus [[https://decko.org|the decko site]]" });
  await seedCard(s, { id: 62002, name: "Known Target", dbContent: "known" });
  await seedCard(s, { id: 62010, name: "bar host", typeId: 9, dbContent: "{{+absent item|closed}}" });
  await seedCard(s, { id: 62011, name: "list holder", typeId: 3, dbContent: "absent item" });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedDeck();
  await storage.fetcher.installNameEnvironment();
  await storage.fetcher.warmLexicon([1, 4, 5, 8, 9, 10, 12, 20, 21, 40, 51, 4037, 22751, 46001, 46002, 46011, 62001, 62002, 62010, 62011]);
  // The known/wanted link class answers from the warm render-card map
  // (links.rb:135-140 known = Card.known?) — prepare the linked target the
  // way the corpus's reference closure does.
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
    // The +agree nest has NO explicit view — the railtie :titled applies
    // (the deck's *all+*default html view rule would have said content).
    expect(html).toContain('agree-titled-view');
    expect(html).not.toContain('agree-content-view');
  });

  it("Sign up core renders the invite-links shape with the corpus created_at", async () => {
    const html = await storage!.engine.render("ronald test", "content");
    expect(html).toContain("<div class='invite-links'>");
    expect(html).toContain(
      "<div><strong>ronald test</strong> signed up on November 18, 2023 16:24:47</div>",
    );
    // The +*account child exists -> no missing-account line; the +*email
    // child does not -> no verification line (the anonymous outcome).
    expect(html).not.toContain("ERROR: signup card missing account");
    expect(html).not.toContain("A verification email has been sent to");
    // HAML line discipline: the closing sequence carries the newlines.
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
    // The toggle core of the empty card: "no".
    expect(html).toContain('">no</div>');
    // The type opt rides the slot JSON.
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
    // wanted-card: the target is absent from the deck (links.rb:135-140).
    expect(html).toContain('wanted-card" href="/People_Green"');
    // HostUri: http:// prepended, comma outside the anchor.
    expect(html).toContain(
      '<a target="_blank" class="external-link" href="http://Culturesmith.com">Culturesmith.com</a>,',
    );
    // Explicit-resource wiki link keeps the link-chunk shape (position
    // order: the [[...]] chunk consumed its URI; the attribute order is the
    // merge-pass-2 raw-oracle pin for the explicit branch).
    expect(html).toContain(
      '<a class="external-link" href="https://decko.org" target="_blank">the decko site</a>',
    );
  });

  it("non-rule unknown bars keep bar_nav visible (bar_view.rb:11 scope)", async () => {
    const html = await storage!.engine.render("bar host", "content");
    // The absent item's closed view substitutes mini_bar; its slot JSON
    // hides bar_middle only — bar_nav stays out of the hide list.
    expect(html).toContain("&quot;hide&quot;:[&quot;bar_middle&quot;]");
    expect(html).not.toContain("&quot;bar_nav&quot;");
  });
});
