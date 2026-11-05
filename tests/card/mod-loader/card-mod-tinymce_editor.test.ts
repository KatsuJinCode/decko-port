

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import { DeckoName } from "../../../src/card/name.js";
import { ModLoader, modEngineHost } from "../../../src/card/mod-loader.js";
import {
  default as cardModTinymceEditor,
  LinkParser,
  NestParser,
  NestSyntaxError,
} from "../../../src/card/mod-loader/mods/card-mod-tinymce_editor.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();

  await seedCard(storage, {
    id: 3001,
    name: "TinyMCE Probe",
    dbContent: "probe card body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("NestParser (lib/card/reference/nest_parser.rb)", () => {
  it("defaultSnippet: a non-String input yields the empty Nest struct (:12-16)", () => {

    const p = NestParser.defaultSnippet();
    expect(p.raw).toBe("{{+ }}");
    expect(p.field).toBe(true);
    expect(p.name).toBe("");
    expect(p.view).toBeUndefined();
    expect(p.options).toEqual([]);
    expect(p.itemOptions).toEqual([]);
  });

  it("newImage: the pre-built image snippet (:18-24)", () => {

    const p = NestParser.newImage("image01");
    expect(p.raw).toBe("{{image01|view: content; size: medium}}");
    expect(p.field).toBe(false);
    expect(p.name).toBe("image01");
    expect(p.view).toBe("content");
    expect(p.options).toEqual([["size", "medium"]]);
    expect(p.itemOptions).toEqual([]);
    expect(p.isEmpty()).toBe(false);
  });

  it("parses a full snippet through the Chunk::Nest semantics (:43-50)", () => {

    const p = NestParser.parse("{{Foo|view: content; size: medium}}");
    expect(p.raw).toBe("{{Foo|view: content; size: medium}}");
    expect(p.name).toBe("Foo");
    expect(p.field).toBe(false);
    expect(p.view).toBe("content");
    expect(p.options).toEqual([["size", "medium"]]);
  });

  it("field nests: init_name strips the leading + (:33-36, 54-57)", () => {

    const p = NestParser.parse("{{+foo|title: T}}");
    expect(p.field).toBe(true);
    expect(p.name).toBe("foo");
    expect(p.view).toBeUndefined();
    expect(p.options).toEqual([["title", "T"]]);
  });

  it("show/hide expand to one pair per list entry via viz_values (:61-62, 71-73)", () => {

    const p = NestParser.parse("{{Card|hide: bar; show: menu,state}}");
    expect(p.options).toEqual([
      ["show", "menu"],
      ["show", "state"],
      ["hide", "bar"],
    ]);
  });

  it("item options: each piped level collects its own pairs (:79-88)", () => {

    const p = NestParser.parse("{{a|view: content|view: bar}}");
    expect(p.view).toBe("content");
    expect(p.options).toEqual([]);
    expect(p.itemOptions).toEqual([[["view", "bar"]]]);
  });

  it("deep item chains collect one pair list per level, outermost first (:79-88)", () => {
    const p = NestParser.parse("{{a|view: top|view: mid|view: low}}");
    expect(p.view).toBe("top");
    expect(p.itemOptions).toEqual([[["view", "mid"]], [["view", "low"]]]);
  });

  it("the item: key routes to the item level's view (nest.rb option_string_to_hash)", () => {

    const p = NestParser.parse("{{Deck|item: bar}}");
    expect(p.view).toBeUndefined();
    expect(p.options).toEqual([]);
    expect(p.itemOptions).toEqual([[["view", "bar"]]]);
  });

  it("a bare value defaults the key to view (nest.rb DEFAULT_OPTION, each_option)", () => {

    const p = NestParser.parse("{{Foo|content}}");
    expect(p.view).toBe("content");
    expect(p.options).toEqual([]);
  });

  it("a present-but-blank option value stays applicable (Hash#[] nil semantics)", () => {

    const p = NestParser.parse("{{c|wrap: ; size: M}}");
    expect(p.options).toEqual([
      ["wrap", ""],
      ["size", "M"],
    ]);
  });

  it("option_value reads the first matching pair (:39-41)", () => {
    const p = NestParser.parse("{{c|size: large; title: T}}");
    expect(p.optionValue("size")).toBe("large");
    expect(p.optionValue("title")).toBe("T");
    expect(p.optionValue("view")).toBeUndefined();
  });

  it("empty?: the shipped regex's +? is a lazy quantifier on the brace (:26-28)", () => {

    expect(NestParser.defaultSnippet().isEmpty()).toBe(false);
    expect(NestParser.parse("{{foo}}").isEmpty()).toBe(false);
    expect(NestParser.parse("{{ }}").isEmpty()).toBe(true);
  });

  it("field! rewrites the opening {{ to {{+ and sets field (:34-36)", () => {

    const p = NestParser.newImage("image01");
    expect(p.raw).toBe("{{image01|view: content; size: medium}}");
    p.fieldBang();
    expect(p.field).toBe(true);
    expect(p.raw).toBe("{{+image01|view: content; size: medium}}");
  });

  it("a String that does not match the chunk full_re raises (abstract.rb:34-39)", () => {

    expect(() => NestParser.parse("not a nest")).toThrow(NestSyntaxError);
  });

  it("a comment nest raises (nest.rb:20-22 leaves chunk.options nil)", () => {

    expect(() => NestParser.parse("{{#a comment}}")).toThrow(NestSyntaxError);
  });
});

describe("LinkParser (link_editor/link_parser.rb)", () => {
  it("defaultSnippet: a non-String input yields the Link struct (:10-14)", () => {

    const p = LinkParser.defaultSnippet();
    expect(p.raw).toBe("[[ ]]");
    expect(p.name).toBe("");
    expect(p.field).toBe(false);
    expect(p.title).toBeUndefined();
  });

  it("parses a plain link; title falls back to the name (:16-25)", () => {

    const p = LinkParser.parse("[[Foo]]");
    expect(p.raw).toBe("[[Foo]]");
    expect(p.name).toBe("Foo");
    expect(p.field).toBe(false);
    expect(p.title).toBe("Foo");
  });

  it("parses a titled link (:16-21)", () => {

    const p = LinkParser.parse("[[Foo|Bar]]");
    expect(p.name).toBe("Foo");
    expect(p.title).toBe("Bar");
  });

  it("field links strip the leading + (:33-36)", () => {
    const p = LinkParser.parse("[[+foo]]");
    expect(p.field).toBe(true);
    expect(p.name).toBe("foo");

    expect(p.title).toBe("foo");
  });

  it("a link text that strips to blank WINS the title (Ruby blank is truthy)", () => {

    const p = LinkParser.parse("[[Foo| ]]");
    expect(p.title).toBe("");
  });

  it("the divider skips pipes inside {{nests}} (link.rb#divider_index)", () => {
    const p = LinkParser.parse("[[Foo {{a|b}} | Bar]]");
    expect(p.name).toBe("Foo {{a|b}}");
    expect(p.title).toBe("Bar");
  });

  it("an explicit resource target leaves the chunk name nil (link.rb#interpret)", () => {

    const p = LinkParser.parse("[[http://example.com|Click]]");
    expect(p.name).toBeUndefined();
    expect(p.field).toBe(false);
    expect(p.title).toBe("Click");
  });

  it("a name merely CONTAINING http: stays a name - the anchor covers the whole alternation", () => {

    const p = LinkParser.parse("[[seehttp://x]]");
    expect(p.name).toBe("seehttp://x");
    expect(p.field).toBe(false);
  });

  it("an explicit resource without a link text titles to the empty name", () => {

    const p = LinkParser.parse("[[http://example.com]]");
    expect(p.name).toBeUndefined();
    expect(p.title).toBe("");
  });

  it("a String that does not match the link chunk full_re raises (abstract.rb:34-39)", () => {
    expect(() => LinkParser.parse("not a link")).toThrow(NestSyntaxError);
  });
});

describe("card-mod-tinymce_editor through the mod loader (A/B)", () => {
  it("WITHOUT the mod: both js views raise UnsupportedViewError", async () => {
    const s = storage!;

    await expect(
      s.engine.render("TinyMCE Probe", "change_create_to_update"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(
      s.engine.render("TinyMCE Probe", "open_nest_editor"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: :change_create_to_update emits Ruby's exact bytes (nest_image.rb:41-43)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModTinymceEditor }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("TinyMCE Probe", "change_create_to_update");
    expect(html).toBe('nest.changeCreateToUpdate($(".tinymce-textarea").attr("id"));');
  });

  it("WITH the mod: :open_nest_editor emits the strip_heredoc'd JS (nest_image.rb:45-50)", async () => {
    const s = storage!;

    expect(DeckoName.parse("A+B").tag).toBe("B");
    expect(DeckoName.parse("TinyMCE Probe").tag).toBe("TinyMCE Probe");

    const html = await s.engine.render("TinyMCE Probe", "open_nest_editor");
    expect(html).toBe(
      'tm = tinymce.get($(".tinymce-textarea").attr("id"));\n' +
        'nest.insertNest(tm, "{{+TinyMCE Probe|view: content; size: medium}}");\n',
    );
  });

  it("WITH the mod: the load report lists both ported views", () => {
    const report = loader!.load();
    expect(report.registeredViews).toContain("change_create_to_update");
    expect(report.registeredViews).toContain("open_nest_editor");

    expect(report.registeredViews).toHaveLength(2);
  });

  it("WITH the mod: both views carry Ruby's unknown: true config (nest_image.rb:41,45)", () => {

    expect(loader!.viewConfigFor("change_create_to_update")?.unknown).toBe(true);
    expect(loader!.viewConfigFor("open_nest_editor")?.unknown).toBe(true);
  });

  it("WITH the mod: every gem-tree set module is in the basket", () => {
    const basket = loader!.setModules();

    const base = basket.base.map((m) => m.shortname);
    expect(base).toEqual([
      "All::ReferenceEditor",
      "All::ReferenceEditor::LinkEditor",
      "All::ReferenceEditor::NestEditor",
      "All::ReferenceEditor::NestEditor::NestEditorOptions",
      "All::ReferenceEditor::NestEditor::NestEditorTabs",
      "All::ReferenceEditor::NestImage",
      "All::TinymceEditor",
    ]);
    const nonbase = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbase).toEqual(["Self::TinyMce"]);
  });

  it("WITH the mod: the *tinyMCE setting carries the raw_help_text heredoc (tiny_mce.rb:2-6)", () => {
    const registry = loader!.settingsRegistry();
    const tinyMce = registry.findByCodename("tiny_mce");
    expect(tinyMce).toBeDefined();

    const expected =
      "    Configure [[http://tinymce.com|TinyMCE]], Decko's default\n" +
      "    [[http://en.wikipedia.org/wiki/Wysiwyg|wysiwyg]] editor.\n" +
      "    [[http://decko.org/TinyMCE|more]]\n";
    expect(tinyMce?.rawHelpText).toBe(expected);
    expect(tinyMce?.rightRawHelpText).toBe(expected);

    expect(tinyMce?.group).toBe("other");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("TinyMCE Probe", "content");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("probe card body");
  });
});
