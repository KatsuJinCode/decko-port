// The card-mod-tinymce_editor mod loader test.
//
// The gem (C:/Ruby33-x64/lib/ruby/gems/3.3.0/gems/
// card-mod-tinymce_editor-0.20.0/) ports three surfaces headlessly:
//
//   1. the two format :js views of set/all/reference_editor/nest_image.rb
//      (:change_create_to_update :41-43, :open_nest_editor :45-50) - proven
//      A/B through the mod loader against a seeded probe card, byte-exact;
//   2. set/self/tiny_mce.rb's raw_help_text heredoc (:2-6) - proven through
//      the Card::Setting registry port (both Self and Right halves,
//      setting.rb:112-114);
//   3. the gem's two parser classes - lib/card/reference/nest_parser.rb
//      (Card::Reference::NestParser) and set/all/reference_editor/
//      link_editor/link_parser.rb (LinkParser, a `#! no set module`
//      helper) - proven as pure string->object semantics against the Ruby
//      source line by line.
//
// The remaining 9 html views the compat report lists
// (tools/compat-report/mod-compat-report.json#card-mod-tinymce_editor-0.20.0
// htmlViewsMissingNames) depend on the card-mod-bootstrap helper layer
// (icon_tag/link_to/text_field_tag/tabs/button_formgroup), the
// create/edit-form machinery, and the request-params surface - none of
// which exist in the headless engine. They stay unported (documented in
// the port file header); the set modules still register passively, which
// the basket assertions below pin.

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
  // the js-view probe card. Its NAME is the only thing the views read
  // (open_nest_editor interpolates card.name.tag, the rightmost part).
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

// ---------------------------------------------------------------------------
// lib/card/reference/nest_parser.rb - Card::Reference::NestParser
// ---------------------------------------------------------------------------

describe("NestParser (lib/card/reference/nest_parser.rb)", () => {
  it("defaultSnippet: a non-String input yields the empty Nest struct (:12-16)", () => {
    // Nest.new name: "", field?: true, options: [], item_options: [],
    //          raw: "{{+ }}"
    const p = NestParser.defaultSnippet();
    expect(p.raw).toBe("{{+ }}");
    expect(p.field).toBe(true);
    expect(p.name).toBe("");
    expect(p.view).toBeUndefined();
    expect(p.options).toEqual([]);
    expect(p.itemOptions).toEqual([]);
  });

  it("newImage: the pre-built image snippet (:18-24)", () => {
    // Nest.new name: name, field?: false, view: "content",
    //          options: [%i[size medium]], item_options: [],
    //          raw: "{{#{name}|view: content; size: medium}}"
    const p = NestParser.newImage("image01");
    expect(p.raw).toBe("{{image01|view: content; size: medium}}");
    expect(p.field).toBe(false);
    expect(p.name).toBe("image01");
    expect(p.view).toBe("content");
    expect(p.options).toEqual([["size", "medium"]]);
    expect(p.itemOptions).toEqual([]);
    expect(p.isEmpty()).toBe(false); // :26-28 - raw does not match the empty shape
  });

  it("parses a full snippet through the Chunk::Nest semantics (:43-50)", () => {
    // name from before the first "|"; view lifted out of the pairs
    // (:62-64); size stays a pair (:66); NEST_OPTIONS order (:6, 75-77)
    const p = NestParser.parse("{{Foo|view: content; size: medium}}");
    expect(p.raw).toBe("{{Foo|view: content; size: medium}}");
    expect(p.name).toBe("Foo");
    expect(p.field).toBe(false);
    expect(p.view).toBe("content");
    expect(p.options).toEqual([["size", "medium"]]);
  });

  it("field nests: init_name strips the leading + (:33-36, 54-57)", () => {
    // name.to_name.simple_relative? (cardname contextual.rb:22-24: starts
    // with the joint, no _relative fragment)
    const p = NestParser.parse("{{+foo|title: T}}");
    expect(p.field).toBe(true);
    expect(p.name).toBe("foo");
    expect(p.view).toBeUndefined();
    expect(p.options).toEqual([["title", "T"]]);
  });

  it("show/hide expand to one pair per list entry via viz_values (:61-62, 71-73)", () => {
    // Card::View.normalize_list (card-1.110.0 lib/card/view.rb:39-45:
    // String -> split(/[\s,]+/)); show entries precede hide entries because
    // extract_options walks NEST_OPTIONS declaration order (:6)
    const p = NestParser.parse("{{Card|hide: bar; show: menu,state}}");
    expect(p.options).toEqual([
      ["show", "menu"],
      ["show", "state"],
      ["hide", "bar"],
    ]);
  });

  it("item options: each piped level collects its own pairs (:79-88)", () => {
    // extract_item_options walks options[:items]; on item levels the view
    // key STAYS a pair (extract_options' item_options flag, :63). At the
    // TOP level the view key goes to @view instead (:62-64), so the top
    // pairs list is empty here.
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
    // nest.rb#option_string_to_hash checks `key == :item` BEFORE the shark
    // filter: options_hash[:items] ||= {}; [:items][:view] = value. (The
    // shared render/nest-syntax.ts port tests the shark set first and drops
    // item: - this parser ports the fold locally, nest.rb-faithful.)
    const p = NestParser.parse("{{Deck|item: bar}}");
    expect(p.view).toBeUndefined();
    expect(p.options).toEqual([]);
    expect(p.itemOptions).toEqual([[["view", "bar"]]]);
  });

  it("a bare value defaults the key to view (nest.rb DEFAULT_OPTION, each_option)", () => {
    // each_option: `value, key = pair.split(':', 2).reverse; key ||=
    // DEFAULT_OPTION` - "content" alone is view: content
    const p = NestParser.parse("{{Foo|content}}");
    expect(p.view).toBe("content");
    expect(p.options).toEqual([]);
  });

  it("a present-but-blank option value stays applicable (Hash#[] nil semantics)", () => {
    // applicable_options' `options[key]` truthiness keeps Ruby-blank
    // strings: "wrap:" produces value "" which is TRUTHY in Ruby
    // (:75-77) - the port's presence check is undefined-vs-value, not
    // JS falsiness
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
    expect(p.optionValue("view")).toBeUndefined(); // view lives in @view (:63-64)
  });

  it("empty?: the shipped regex's +? is a lazy quantifier on the brace (:26-28)", () => {
    // Ruby's regex /\{\{+?\s*\|?\s*\}\}/ reads as: "{{" PLUS one-or-more
    // additional "{" (lazy), so the + counts BRACES, not the +-joint.
    // Verified against the target Ruby 3.3 this session
    // (C:/Ruby33-x64/bin/ruby.exe -e '...'):
    //   "{{+ }}" => nil      "{{ }}" => match
    //   "{{foo}}" => nil     "{{{}}" => match
    // i.e. the gem's own default snippet is NOT empty?, while a pipe-less
    // "{{ }}" IS. The port carries the identical regex, so the identical
    // (non-intuitive) verdicts are pinned here.
    expect(NestParser.defaultSnippet().isEmpty()).toBe(false);
    expect(NestParser.parse("{{foo}}").isEmpty()).toBe(false);
    expect(NestParser.parse("{{ }}").isEmpty()).toBe(true);
  });

  it("field! rewrites the opening {{ to {{+ and sets field (:34-36)", () => {
    // sub!(/\{\{\s*\+?/, "{{+")
    const p = NestParser.newImage("image01");
    expect(p.raw).toBe("{{image01|view: content; size: medium}}");
    p.fieldBang();
    expect(p.field).toBe(true);
    expect(p.raw).toBe("{{+image01|view: content; size: medium}}");
  });

  it("a String that does not match the chunk full_re raises (abstract.rb:34-39)", () => {
    // Chunk::Abstract#initialize: @text = match[0] with match =
    // /\A\{\{([^{}]*)\}\}/.match(string) - nil[0] raises in Ruby
    expect(() => NestParser.parse("not a nest")).toThrow(NestSyntaxError);
  });

  it("a comment nest raises (nest.rb:20-22 leaves chunk.options nil)", () => {
    // nest_parser.rb:48 extract_item_options reads nil[:items]
    expect(() => NestParser.parse("{{#a comment}}")).toThrow(NestSyntaxError);
  });
});

// ---------------------------------------------------------------------------
// set/all/reference_editor/link_editor/link_parser.rb - LinkParser
// ---------------------------------------------------------------------------

describe("LinkParser (link_editor/link_parser.rb)", () => {
  it("defaultSnippet: a non-String input yields the Link struct (:10-14)", () => {
    // Link.new("", {}, "[[ ]]") - title and field? nil (falsy)
    const p = LinkParser.defaultSnippet();
    expect(p.raw).toBe("[[ ]]");
    expect(p.name).toBe("");
    expect(p.field).toBe(false);
    expect(p.title).toBeUndefined();
  });

  it("parses a plain link; title falls back to the name (:16-25)", () => {
    // link.rb#options: { title: link_text || @name.to_name.fully_stripped }
    const p = LinkParser.parse("[[Foo]]");
    expect(p.raw).toBe("[[Foo]]");
    expect(p.name).toBe("Foo");
    expect(p.field).toBe(false);
    expect(p.title).toBe("Foo");
  });

  it("parses a titled link (:16-21)", () => {
    // target_and_link_text splits at the first "|" not inside a {{nest}}
    const p = LinkParser.parse("[[Foo|Bar]]");
    expect(p.name).toBe("Foo");
    expect(p.title).toBe("Bar");
  });

  it("field links strip the leading + (:33-36)", () => {
    const p = LinkParser.parse("[[+foo]]");
    expect(p.field).toBe(true);
    expect(p.name).toBe("foo");
    // the chunk name "+foo" drives the title fallback: fully_stripped drops
    // the blank leading part, so the title renders "foo" (link.rb#options)
    expect(p.title).toBe("foo");
  });

  it("a link text that strips to blank WINS the title (Ruby blank is truthy)", () => {
    // objectify(" ") -> "" (a Ruby truthy string), so options[:title]
    // is "" and the fully_stripped fallback does not fire (link.rb)
    const p = LinkParser.parse("[[Foo| ]]");
    expect(p.title).toBe("");
  });

  it("the divider skips pipes inside {{nests}} (link.rb#divider_index)", () => {
    const p = LinkParser.parse("[[Foo {{a|b}} | Bar]]");
    expect(p.name).toBe("Foo {{a|b}}");
    expect(p.title).toBe("Bar");
  });

  it("an explicit resource target leaves the chunk name nil (link.rb#interpret)", () => {
    // %r{^(/|https?:|mailto:)} targets set @explicit_link, not @name;
    // init_name(nil): field false, name stays nil (:33-36)
    const p = LinkParser.parse("[[http://example.com|Click]]");
    expect(p.name).toBeUndefined();
    expect(p.field).toBe(false);
    expect(p.title).toBe("Click");
  });

  it("a name merely CONTAINING http: stays a name - the anchor covers the whole alternation", () => {
    // Ruby: target.match? %r{^(/|https?:|mailto:)} - ^ anchors the GROUP,
    // so "seehttp://x" (no leading /|http(s):|mailto:) is @name. An
    // ungrouped port of the alternation would misread it as explicit.
    const p = LinkParser.parse("[[seehttp://x]]");
    expect(p.name).toBe("seehttp://x");
    expect(p.field).toBe(false);
  });

  it("an explicit resource without a link text titles to the empty name", () => {
    // nil.to_name is the empty name (cardname core_ext.rb:2-4), whose
    // fully_stripped renders ""
    const p = LinkParser.parse("[[http://example.com]]");
    expect(p.name).toBeUndefined();
    expect(p.title).toBe("");
  });

  it("a String that does not match the link chunk full_re raises (abstract.rb:34-39)", () => {
    expect(() => LinkParser.parse("not a link")).toThrow(NestSyntaxError);
  });
});

// ---------------------------------------------------------------------------
// the two format :js views through the mod loader (A/B)
// ---------------------------------------------------------------------------

describe("card-mod-tinymce_editor through the mod loader (A/B)", () => {
  it("WITHOUT the mod: both js views raise UnsupportedViewError", async () => {
    const s = storage!;
    // render.rb#view_method - the views are not in the live registry yet
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

    // tinymce_id's params-present branch needs Env.params; the headless
    // render has none, so Ruby's absent-params default branch is the
    // reachable one (nest_image.rb:52-58). One line, no trailing newline.
    const html = await s.engine.render("TinyMCE Probe", "change_create_to_update");
    expect(html).toBe('nest.changeCreateToUpdate($(".tinymce-textarea").attr("id"));');
  });

  it("WITH the mod: :open_nest_editor emits the strip_heredoc'd JS (nest_image.rb:45-50)", async () => {
    const s = storage!;
    // card.name.tag - the rightmost name part (cardname parts.rb #tag; the
    // shared DeckoName.tag carries it, name.ts:405-407)
    expect(DeckoName.parse("A+B").tag).toBe("B");
    expect(DeckoName.parse("TinyMCE Probe").tag).toBe("TinyMCE Probe");

    // the heredoc body's 6-space indent is stripped; the trailing newline
    // is heredoc content; the interpolation is `{{+#{card.name.tag}|
    // view: content; size: medium}}` verbatim
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
    // the mod declares exactly two view definitions (both js); the html
    // remainder stays unregistered
    expect(report.registeredViews).toHaveLength(2);
  });

  it("WITH the mod: both views carry Ruby's unknown: true config (nest_image.rb:41,45)", () => {
    // view_opts.rb:49-57 stores the `unknown:` setting per view; the
    // render-path consultation is the coordinator seam
    // (docs/mod-loader-port-notes.md) - the config table is what the
    // loader wrote and introspection can prove today
    expect(loader!.viewConfigFor("change_create_to_update")?.unknown).toBe(true);
    expect(loader!.viewConfigFor("open_nest_editor")?.unknown).toBe(true);
  });

  it("WITH the mod: every gem-tree set module is in the basket", () => {
    const basket = loader!.setModules();
    // the 8 set-module files (link_parser.rb is `#! no set module` and
    // registers nothing - set_template.rb:47-53 via mod-manifest.ts:141-145)
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
    // the <<-TEXT heredoc bytes: 4-space indents, trailing newline before
    // the terminator. Ruby serves this as a plain `def raw_help_text` on
    // the Self::TinyMce set (the *tinyMCE card answers card.try
    // (:raw_help_text), help/all/help.rb:36-37); the gem makes NO
    // setting_opts call, so Ruby's Card::Setting.groups never lists
    // tiny_mce and its Right set serves nothing. The manifest schema has
    // no method-only channel, so (ace_editor precedent for the identical
    // set/self/ace.rb shape) the string rides settingOpts.helpText, whose
    // registrar record dual-stores it - the Self half matches Ruby; the
    // Right half is a documented schema approximation (render-path truth
    // is setting-help-text.ts:75-77, self-only).
    const expected =
      "    Configure [[http://tinymce.com|TinyMCE]], Decko's default\n" +
      "    [[http://en.wikipedia.org/wiki/Wysiwyg|wysiwyg]] editor.\n" +
      "    [[http://decko.org/TinyMCE|more]]\n";
    expect(tinyMce?.rawHelpText).toBe(expected);
    expect(tinyMce?.rightRawHelpText).toBe(expected);
    // the schema requires A group; "other" is the register_setting default
    // (Ruby itself registers no group for tiny_mce - no setting_opts call)
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
