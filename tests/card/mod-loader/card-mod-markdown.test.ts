// The card-mod-markdown integration + oracle-replay tests.
//
// Proof shape:
// 1. ORACLE REPLAY: every kramdown-conversion byte the port pins was
//    produced by the REAL local gems (ruby 3.3.12, kramdown-2.5.2,
//    kramdown-syntax-coderay-1.0.1, coderay-1.1.3 from
//    C:/Ruby33-x64/lib/ruby/gems/3.3.0/gems/) running the exact option
//    hash the Ruby view passes (card-mod-markdown-0.20.0
//    set/type/markdown.rb:7-12). Capture scripts:
//    C:/Users/jpswi/AppData/Local/Temp/markdown-oracle-capture.rb,
//    markdown-oracle-capture2.rb, markdown-oracle-capture3.rb - each run as
//    `ruby <script> > <out>.json`, bytes embedded verbatim in ORACLE below.
//    Three captured cases are deliberately NOT pinned because the port's
//    honest remainder diverges there (see the mod file header):
//    "codeblock_tokenized", "fenced_ruby" (coderay tokenizer spans), and
//    "setext" (setext headers unported).
// 2. A/B THROUGH THE MOD LOADER (the card-mod-help test's shape): a deck
//    seeded with a Markdown cardtype card (data/real.yml: codename
//    "markdown") and probe cards of that type; WITHOUT the mod, :core is
//    the base core's raw passthrough; WITH the mod, the Type::Markdown set
//    module renders kramdown HTML; a non-Markdown card is byte-identical
//    across the load (the ancestor-chain fallback); reset() restores.
// 3. The README's nest claim (README.md:20-22) end to end: a nest inside
//    Markdown content survives the kramdown stage unstashed - the `{{#...}}`
//    comment nest's asterisks are never markdown-converted.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModMarkdown, {
  kramdownToHtml,
  escapeLiteral,
  inputType,
  aceMode,
} from "../../../src/card/mod-loader/mods/card-mod-markdown.js";

// ---------------------------------------------------------------------------
// oracle bytes (captured from the installed kramdown gems - see header)
// ---------------------------------------------------------------------------

const CODERAY_DIV =
  '<div class="language-ruby highlighter-coderay"><div class="CodeRay">\n' +
  '  <div class="code"><pre>';

const CODERAY_CLOSE = "</pre></div>\n</div>\n</div>\n";

const ORACLE: { source: string; html: string }[] = [
  // round 1
  { source: "Hello *markdown* world", html: "<p>Hello <em>markdown</em> world</p>\n" },
  {
    source: "# Heading One\n\nBody **bold** text",
    html: '<h1 id="heading-one">Heading One</h1>\n\n<p>Body <strong>bold</strong> text</p>\n',
  },
  {
    source: "# Heading One\n\ntext\n\n# Heading One",
    html: '<h1 id="heading-one">Heading One</h1>\n\n<p>text</p>\n\n<h1 id="heading-one-1">Heading One</h1>\n',
  },
  {
    source: '[decko](http://decko.org "Decko home")',
    html: '<p><a href="http://decko.org" title="Decko home">decko</a></p>\n',
  },
  { source: "a `x *y*` b", html: "<p>a <code>x *y*</code> b</p>\n" },
  { source: "- a\n- b", html: "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n" },
  { source: "1. one\n2. two", html: "<ol>\n  <li>one</li>\n  <li>two</li>\n</ol>\n" },
  { source: "> quoted text", html: "<blockquote>\n  <p>quoted text</p>\n</blockquote>\n" },
  {
    source: 'don\'t "quote" me -- really --- done ... ok',
    html: "<p>don\u2019t \u201cquote\u201d me \u2013 really \u2014 done \u2026 ok</p>\n",
  },
  { source: "5 > 3 & 2 < 4", html: "<p>5 &gt; 3 &amp; 2 &lt; 4</p>\n" },
  { source: "before {{0}} after", html: "<p>before {{0}} after</p>\n" },
  { source: "first line  \nsecond line", html: "<p>first line<br />\nsecond line</p>\n" },
  { source: "***", html: "<hr />\n" },
  { source: "---", html: "<hr />\n" },
  { source: "![alt text](http://image.png)", html: '<p><img src="http://image.png" alt="alt text" /></p>\n' },
  {
    source: "para\n\n    indented code here",
    html: `<p>para</p>\n\n${CODERAY_DIV}indented code here\n${CODERAY_CLOSE}`,
  },
  {
    source: "para\n\n~~~\nplain fence\n~~~",
    html: `<p>para</p>\n\n${CODERAY_DIV}plain fence\n${CODERAY_CLOSE}`,
  },
  {
    source: "Word with *em* and [link](http://x) and `code`",
    html: "<p>Word with <em>em</em> and <a href=\"http://x\">link</a> and <code>code</code></p>\n",
  },
  {
    source: "## Heading with 'quotes' and \"doubles\"",
    html: '<h2 id="heading-with-quotes-and-doubles">Heading with \u2018quotes\u2019 and \u201cdoubles\u201d</h2>\n',
  },
  { source: "Para one.\n\nPara two.", html: "<p>Para one.</p>\n\n<p>Para two.</p>\n" },
  { source: "**bold *both***", html: "<p><strong>bold <em>both</em></strong></p>\n" },
  {
    source: "- item with **bold**\n- item two",
    html: "<ul>\n  <li>item with <strong>bold</strong></li>\n  <li>item two</li>\n</ul>\n",
  },
  { source: '"Leading quote" and trailing"', html: "<p>\u201cLeading quote\u201d and trailing\u201d</p>\n" },
  { source: "the '90s and dogs' bones", html: "<p>the \u201990s and dogs\u2019 bones</p>\n" },
  { source: "{{0}} head\n\nmid {{1}} tail\n\n{{2}}", html: "<p>{{0}} head</p>\n\n<p>mid {{1}} tail</p>\n\n<p>{{2}}</p>\n" },
  // round 2
  { source: "see <http://decko.org> here", html: '<p>see <a href="http://decko.org">http://decko.org</a> here</p>\n' },
  { source: "a `def foo` b", html: "<p>a <code>def foo</code> b</p>\n" },
  { source: "## Title ##\ntext", html: '<h2 id="title">Title</h2>\n<p>text</p>\n' },
  { source: "# Head *em*", html: '<h1 id="head-em">Head <em>em</em></h1>\n' },
  { source: "a \\*not em\\* b \\`code\\`", html: "<p>a *not em* b `code`</p>\n" },
  { source: "a &amp; b &copy; c &#38; d", html: "<p>a &amp; b \u00a9 c &#38; d</p>\n" },
  { source: "<< quoted >>", html: "<p>\u00ab\u00a0quoted\u00a0\u00bb</p>\n" },
  { source: "* a\n* b", html: "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n" },
  { source: "- a\ncontinued\n- b", html: "<ul>\n  <li>a\ncontinued</li>\n  <li>b</li>\n</ul>\n" },
  { source: "", html: "\n" },
  { source: "one\ntwo", html: "<p>one\ntwo</p>\n" },
  { source: "- - -", html: "<hr />\n" },
  { source: "no_intra_word_thing and _em_ here", html: "<p>no_intra_word_thing and <em>em</em> here</p>\n" },
  { source: "a *not closed b", html: "<p>a *not closed b</p>\n" },
  { source: "x ``a ` b`` y", html: "<p>x <code>a ` b</code> y</p>\n" },
  { source: "a\n\n\n\nb", html: "<p>a</p>\n\n<p>b</p>\n" },
  {
    source: "> one\n>\n> two",
    html: "<blockquote>\n  <p>one</p>\n\n  <p>two</p>\n</blockquote>\n",
  },
  { source: "***both***", html: "<p><strong><em>both</em></strong></p>\n" },
  { source: "*text [link](http://x) more*", html: "<p><em>text <a href=\"http://x\">link</a> more</em></p>\n" },
  { source: '![alt](http://i.png "T")', html: '<p><img src="http://i.png" alt="alt" title="T" /></p>\n' },
  { source: "[a](<http://x.com>)", html: '<p><a href="http://x.com">a</a></p>\n' },
  { source: "a&nbsp;b", html: "<p>a\u00a0b</p>\n" },
  { source: "Tom & Jerry > all", html: "<p>Tom &amp; Jerry &gt; all</p>\n" },
  // round 3
  {
    source: "a\n\n    x\n\n    y",
    html: `<p>a</p>\n\n${CODERAY_DIV}x\n\ny\n${CODERAY_CLOSE}`,
  },
  { source: "para\n- a", html: "<p>para\n- a</p>\n" },
  { source: "para\n# Head", html: "<p>para\n# Head</p>\n" },
  {
    source: "a\n\n\tcode",
    html: `<p>a</p>\n\n${CODERAY_DIV}code\n${CODERAY_CLOSE}`,
  },
  { source: "3. three\n4. four", html: "<ol>\n  <li>three</li>\n  <li>four</li>\n</ol>\n" },
  { source: "a\\\\\nb", html: "<p>a<br />\nb</p>\n" },
  {
    source: "- a\n\n- b",
    html: "<ul>\n  <li>\n    <p>a</p>\n  </li>\n  <li>\n    <p>b</p>\n  </li>\n</ul>\n",
  },
  { source: "text\n    indented more", html: "<p>text\n    indented more</p>\n" },
  {
    source: "- a\n\n  continued\n- b",
    html: "<ul>\n  <li>\n    <p>a</p>\n\n    <p>continued</p>\n  </li>\n  <li>\n    <p>b</p>\n  </li>\n</ul>\n",
  },
  { source: "5. not a list, no space", html: "<ol>\n  <li>not a list, no space</li>\n</ol>\n" },
  { source: "### Three", html: '<h3 id="three">Three</h3>\n' },
  { source: "# A\n## B", html: '<h1 id="a">A</h1>\n<p>## B</p>\n' },
];

// ---------------------------------------------------------------------------
// 1. oracle replay of the kramdown subset
// ---------------------------------------------------------------------------

describe("kramdownToHtml vs the live kramdown-2.5.2 oracle", () => {
  for (const entry of ORACLE) {
    it(`converts ${JSON.stringify(entry.source.slice(0, 40))}`, () => {
      expect(kramdownToHtml(entry.source)).toBe(entry.html);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. the set module's method-level surface (markdown.rb:16-26)
// ---------------------------------------------------------------------------

describe("set/type/markdown.rb methods", () => {
  it("escape_literal is the identity (markdown.rb:16-18, format.rb:90-92)", () => {
    expect(escapeLiteral("{{keep *verbatim*}}")).toBe("{{keep *verbatim*}}");
    expect(escapeLiteral("")).toBe("");
  });

  it("input_type is :ace_editor (markdown.rb:20-22)", () => {
    expect(inputType).toBe("ace_editor");
  });

  it("ace_mode is :markdown (markdown.rb:24-26)", () => {
    expect(aceMode).toBe("markdown");
  });
});

// ---------------------------------------------------------------------------
// 3. A/B through the mod loader
// ---------------------------------------------------------------------------

const MARKDOWN_PROBE_CONTENT = "Welcome\n\n# *Styled* heading\n\nBody **text** here";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;
  // the codename carriers (data/real.yml: the Markdown cardtype card,
  // codename "markdown"; the migration
  // data/transform/20150116220621_add_markdown_type.rb Card.ensure's the
  // same card - the TS seed deck plays both roles)
  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 3, name: "Markdown", codename: "markdown" });
  // the probe cards
  await seedCard(s, {
    id: 1169,
    name: "Markdown Probe",
    typeId: 3,
    dbContent: MARKDOWN_PROBE_CONTENT,
  });
  await seedCard(s, {
    id: 1170,
    name: "Rich Probe",
    dbContent: "plain **not converted**",
  });
  await seedCard(s, {
    id: 1171,
    name: "Markdown Nest Probe",
    typeId: 3,
    dbContent: "text {{#no *emphasis* inside}} more",
  });
}, 60_000);

afterAll(() => {
  loader?.reset(); // unregister the mod view from the live record
  storage?.close();
});

describe("card-mod-markdown through the mod loader (A/B)", () => {
  it("WITHOUT the mod: the Markdown cardtype's :core is the base raw passthrough", async () => {
    const s = storage!;
    const html = await s.engine.render("Markdown Probe", "core");
    expect(html).toBe(MARKDOWN_PROBE_CONTENT);
  });

  it("load() registers the Type::Markdown set module and the :core view", () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModMarkdown }]);
    const report = loader.load();
    expect(report.modNames).toEqual(["markdown"]);
    expect(report.registeredSetModules).toEqual(["Type::Markdown"]);
    expect(report.registeredViews).toEqual(["core"]);
    // registrar basket: the nonbase module with its contributing mod
    const nonbase = [...loader.setModules().nonbase.keys()];
    expect(nonbase).toContain("Type::Markdown");
    const module = loader.setModules().nonbase.get("Type::Markdown")?.[0];
    expect(module?.modName).toBe("markdown");
    expect(module?.kind).toBe("nonbase");
    void s;
  });

  it("WITH the mod: the Markdown cardtype's :core renders the kramdown bytes", async () => {
    const s = storage!;
    const html = await s.engine.render("Markdown Probe", "core");
    // the kramdown conversion of MARKDOWN_PROBE_CONTENT (the same bytes the
    // unit section pins: heading auto-id + em + strong + paragraphs)
    expect(html).toBe(
      "<p>Welcome</p>\n\n" +
        '<h1 id="styled-heading"><em>Styled</em> heading</h1>\n\n' +
        "<p>Body <strong>text</strong> here</p>\n",
    );
  });

  it("WITH the mod: nests survive unstashed - nest bytes never kramdown-converted (README.md:20-22)", async () => {
    const s = storage!;
    const html = await s.engine.render("Markdown Nest Probe", "core");
    // stash (content.rb:142-144) -> "text {{0}} more" -> kramdown wraps the
    // paragraph -> unstash (content.rb:151-153) -> process_content renders
    // the comment nest (format.ts:450 passthrough); the asterisks INSIDE
    // the nest were never seen by the markdown processor
    expect(html).toBe("<p>text <!-- #no *emphasis* inside --> more</p>\n");
  });

  it("WITH the mod: a non-Markdown card's :core is byte-identical (ancestor fallback)", async () => {
    const s = storage!;
    const html = await s.engine.render("Rich Probe", "core");
    expect(html).toBe("plain **not converted**");
  });

  it("reset() restores the pre-load :core", async () => {
    const s = storage!;
    loader!.reset();
    const html = await s.engine.render("Markdown Probe", "core");
    expect(html).toBe(MARKDOWN_PROBE_CONTENT);
  });
});

// ---------------------------------------------------------------------------
// 4. EXTENDED ORACLE REPLAY - entries the sections above do not cover, from
//    a SECOND capture session (this port's verification pass, 2026-09-22):
//    C:/Users/jpswi/AppData/Local/Temp/md-oracle-veritas/
//    kramdown-capture{,2,3}.rb against the same installed gems, plus one
//    full view-level capture through the live decko 0.20.0 oracle app
//    (Temp/md-oracle-veritas/decko-view-capture.rb -> decko-view-oracle.json:
//    a real Markdown card's :core through safe_process_content, the
//    RichText ancestor fallback, and the escape_literal identity).
//    Focus: nested lists (list.rb's group split), the per-item transparency
//    condition, blockquote/codeblock converter indentation (html.rb inner()),
//    fence info-string rules, coderay's own plain-content escaping, entity
//    edges, and the ATX boundary/id edges.
// ---------------------------------------------------------------------------

/** the coderay div with an explicit convert indent on the outer wrapper's
 *  first and closing lines (the middle lines keep CodeRay's builtin shape) */
function codeDivPad(lang: string, content: string, pad = ""): string {
  return (
    `${pad}<div class="language-${lang} highlighter-coderay"><div class="CodeRay">\n` +
    `  <div class="code"><pre>${content}</pre></div>\n` +
    `</div>\n${pad}</div>\n`
  );
}

const EXTENDED_PARITY: [string, string, string][] = [
  // entities (capture 1 + 2)
  ["entity_hex", "A &#x41; B", "<p>A A B</p>\n"],
  ["entity_numeric_emoji", "emoji &#128512; ok", "<p>emoji \u{1F600} ok</p>\n"],
  ["entity_unknown_declines", "a &foobar; b", "<p>a &amp;foobar; b</p>\n"],
  // typographic / smart quotes leftovers
  ["ellipsis_word", "wait...", "<p>wait\u2026</p>\n"],
  ["smart_it_is", "it's fine", "<p>it\u2019s fine</p>\n"],
  ["escape_dash", "a \\- b", "<p>a - b</p>\n"],
  ["hr_spaced", "- - -", "<hr />\n"],
  // atx edges (captures 2+3)
  ["atx_level6", "###### six", "<h6 id=\"six\">six</h6>\n"],
  ["heading_id_specials", "## A B & C!", "<h2 id=\"a-b--c\">A B &amp; C!</h2>\n"],
  ["atx_no_space", "#No space", "<h1 id=\"no-space\">No space</h1>\n"],
  ["atx_tab_after", "#\tTabbed", "<h1 id=\"tabbed\">Tabbed</h1>\n"],
  ["atx_mid_hash", "## Ti # tle", "<h2 id=\"ti--tle\">Ti # tle</h2>\n"],
  ["atx_only_hashes_declines", "####", "<p>####</p>\n"],
  ["atx_id_xml_chars", "## My {#sec-2.title}", "<h2 id=\"sec-2.title\">My</h2>\n"],
  ["header_then_list_no_boundary_needed", "# H\n- a", "<h1 id=\"h\">H</h1>\n<ul>\n  <li>a</li>\n</ul>\n"],
  ["para_then_star_list", "text\n* a", "<p>text\n* a</p>\n"],
  // links / images / codespans
  ["link_bare_brackets", "a [b] c", "<p>a [b] c</p>\n"],
  ["img_empty_alt", "![](http://x)", "<p><img src=\"http://x\" alt=\"\" /></p>\n"],
  ["link_empty_text", "[](http://x)", "<p><a href=\"http://x\"></a></p>\n"],
  ["autolink_mailto", "mail <mailto:a@b.org> here", "<p>mail <a href=\"mailto:a@b.org\">a@b.org</a> here</p>\n"],
  ["codespan_spaced", "a ` x ` b", "<p>a ` x ` b</p>\n"],
  ["codespan_unclosed", "a ` b", "<p>a ` b</p>\n"],
  ["em_across_lines", "*a\nb*", "<p><em>a\nb</em></p>\n"],
  // lists: marker shapes, ends, transparency mixes (captures 2+3)
  ["list_marker_plus", "+ plus\n+ two", "<ul>\n  <li>plus</li>\n  <li>two</li>\n</ul>\n"],
  ["list_marker_multispace", "-   a", "<ul>\n  <li>a</li>\n</ul>\n"],
  ["ol_marker_indent", " 1. a\n 2. b", "<ol>\n  <li>a</li>\n  <li>b</li>\n</ol>\n"],
  ["ol_loose", "1. a\n\n2. b", "<ol>\n  <li>\n    <p>a</p>\n  </li>\n  <li>\n    <p>b</p>\n  </li>\n</ol>\n"],
  ["li_block_with_em", "- a\n\n- b\n\n- c", "<ul>\n  <li>\n    <p>a</p>\n  </li>\n  <li>\n    <p>b</p>\n  </li>\n  <li>\n    <p>c</p>\n  </li>\n</ul>\n"],
  ["list_blank_end_tight_last_item", "- a\n\nnot marker", "<ul>\n  <li>a</li>\n</ul>\n\n<p>not marker</p>\n"],
  ["hr_after_blank_in_list", "- a\n\n***", "<ul>\n  <li>a</li>\n</ul>\n\n<hr />\n"],
  ["list_then_quote_noblank", "- a\n> q", "<ul>\n  <li>a\n&gt; q</li>\n</ul>\n"],
  ["ul_then_para_lazy", "- a\nb\n- c", "<ul>\n  <li>a\nb</li>\n  <li>c</li>\n</ul>\n"],
  // nested lists: the group split + per-item recursion (capture 3)
  ["nested_list", "- a\n  - b", "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n"],
  ["nested_list_loose", "- a\n\n  - b", "<ul>\n  <li>\n    <p>a</p>\n\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n"],
  // blockquotes: lazy collection + converter indentation (captures 1-3)
  ["blockquote_nested_lazy", "> a\n> > b", "<blockquote>\n  <p>a\n&gt; b</p>\n</blockquote>\n"],
  ["blockq_blank_nested", "> a\n>\n> > b", "<blockquote>\n  <p>a</p>\n\n  <blockquote>\n    <p>b</p>\n  </blockquote>\n</blockquote>\n"],
  ["blockq_multi_line", "> a\n> b\n> c", "<blockquote>\n  <p>a\nb\nc</p>\n</blockquote>\n"],
  ["blockq_hr", "> x\n>\n> ***", "<blockquote>\n  <p>x</p>\n\n  <hr />\n</blockquote>\n"],
  ["blockq_hard_break", "> line  \n> next", "<blockquote>\n  <p>line<br />\nnext</p>\n</blockquote>\n"],
  ["blockq_smart", "> she said \"hi\"", "<blockquote>\n  <p>she said \u201chi\u201d</p>\n</blockquote>\n"],
  ["blockquote_then_list", "> q\n- a", "<blockquote>\n  <p>q\n- a</p>\n</blockquote>\n"],
  ["blockquote_eob_end", "> a\nb", "<blockquote>\n  <p>a\nb</p>\n</blockquote>\n"],
  ["blockq_then_para_after", "> q\n\nafter", "<blockquote>\n  <p>q</p>\n</blockquote>\n\n<p>after</p>\n"],
  ["list_marker_in_quote_cont", "> - a\n- b", "<blockquote>\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n</blockquote>\n"],
  ["blockq_list", "> - a\n> - b", "<blockquote>\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n</blockquote>\n"],
  ["blockq_code", "> para\n>\n>     indented code", `<blockquote>\n  <p>para</p>\n\n${codeDivPad("ruby", "indented code\n", "  ")}</blockquote>\n`],
  ["blockq_fenced", "> ~~~\n> plain\n> ~~~", `<blockquote>\n${codeDivPad("ruby", "plain\n", "  ")}</blockquote>\n`],
  // code blocks: lazy continuation, gsubs, fence rules (captures 1+3 + probes)
  ["indented_lazy", "a\n\n    x\nplain", `<p>a</p>\n\n${codeDivPad("ruby", "x plain\n")}`],
  ["indented_lazy_2spaces", "a\n\n    x\n  y", `<p>a</p>\n\n${codeDivPad("ruby", "x   y\n")}`],
  ["codeblock_lazy_quote", "a\n\n    x\n> q", `<p>a</p>\n\n${codeDivPad("ruby", "x &gt; q\n")}`],
  ["codeblock_lazy_list", "a\n\n    x\n- b", `<p>a</p>\n\n${codeDivPad("ruby", "x - b\n")}`],
  ["deep_indent_marker", "    - a", codeDivPad("ruby", "- a\n")],
  ["fence_unclosed", "para\n\n~~~\nnot closed", "<p>para</p>\n\n<p>~~~\nnot closed</p>\n"],
  ["fence_indented_close", "~~~\na\n  ~~~", "<p>~~~\na\n  ~~~</p>\n"],
  ["para_before_fence_noblank", "text\n~~~\nx\n~~~", "<p>text\n~~~\nx\n~~~</p>\n"],
  [
    "fence_tilde_lang_opts",
    "~~~ruby?a=1\nx\n~~~",
    "<pre><code class=\"language-ruby\">x\n</code></pre>\n",
  ],
  [
    "fence_lang_opts_escapes",
    "~~~ruby?a=1\nsay \"hi\" & <b>\n~~~",
    "<pre><code class=\"language-ruby\">say \"hi\" &amp; &lt;b&gt;\n</code></pre>\n",
  ],
  [
    "fence_unknown_lang_plain",
    "~~~notalang\nsay \"hi\" & <b> it's\n~~~",
    codeDivPad("notalang", "say &quot;hi&quot; &amp; &lt;b&gt; it's\n"),
  ],
  // a BACKTICK fence is not kramdown fence syntax - the run becomes a
  // codespan and the coincidental bytes match the oracle exactly
  [
    "backtick_fence_codespan",
    "```ruby\ndef x\n  1\nend\n```",
    "<p><code>ruby\ndef x\n  1\nend\n</code></p>\n",
  ],
];

describe("kramdownToHtml vs the live kramdown-2.5.2 oracle (extended replay)", () => {
  for (const [name, source, html] of EXTENDED_PARITY) {
    it(`converts ${name}`, () => {
      expect(kramdownToHtml(source)).toBe(html);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. the honest remainder - the port's bytes pinned, the ORACLE bytes in the
//    comments (each case RUNS through the local kramdown and diverges; see
//    the mod file's header). Any drift in either direction is visible.
// ---------------------------------------------------------------------------

const DIVERGENCES: [string, string, string, string][] = [
  [
    "setext_header_unported",
    "Title\n=====\n\ntext",
    "<p>Title\n=====</p>\n\n<p>text</p>\n",
    "<h1 id=\"title\">Title</h1>\n\n<p>text</p>\n",
  ],
  [
    "setext_dashes_unported",
    "text\n---",
    "<p>text\n\u2014</p>\n",
    "<h2 id=\"text\">text</h2>\n",
  ],
  [
    "raw_html_span_unported",
    "a <b>bold</b> c",
    "<p>a &lt;b&gt;bold&lt;/b&gt; c</p>\n",
    "<p>a <b>bold</b> c</p>\n",
  ],
  [
    "table_unported",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "<p>| a | b |\n|\u2014|\u2014|\n| 1 | 2 |</p>\n",
    "<table>\n  <thead>\n    <tr>\n      <th>a</th>\n      <th>b</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td>1</td>\n      <td>2</td>\n    </tr>\n  </tbody>\n</table>\n",
  ],
  [
    "coderay_tokenization_js",
    "para\n\n~~~js\nvar x\n~~~",
    `<p>para</p>\n\n${codeDivPad("js", "var x\n")}`,
    `<p>para</p>\n\n${codeDivPad("js", "<span style=\"color:#080;font-weight:bold\">var</span> x\n")}`,
  ],
  [
    "coderay_tokenization_ruby",
    "para\n\n~~~\ndef foo\n  1\nend\n~~~",
    `<p>para</p>\n\n${codeDivPad("ruby", "def foo\n  1\nend\n")}`,
    `<p>para</p>\n\n${codeDivPad(
      "ruby",
      "<span style=\"color:#080;font-weight:bold\">def</span> <span style=\"color:#06B;font-weight:bold\">foo</span>\n  <span style=\"color:#00D\">1</span>\n<span style=\"color:#080;font-weight:bold\">end</span>\n",
    )}`,
  ],
  [
    "coderay_tokenization_indented_ruby",
    "para\n\n    say \"hi\" & <b>\n",
    `<p>para</p>\n\n${codeDivPad("ruby", "say &quot;hi&quot; &amp; &lt;b&gt;\n")}`,
    `<p>para</p>\n\n${codeDivPad(
      "ruby",
      "say <span style=\"background-color:hsla(0,100%,50%,0.05)\"><span style=\"color:#710\">&quot;</span><span style=\"color:#D20\">hi</span><span style=\"color:#710\">&quot;</span></span> &amp; &lt;b&gt;\n",
    )}`,
  ],
  [
    "autolink_www_is_raw_html_to_kramdown",
    "<www.example.com>",
    "<p>&lt;www.example.com&gt;</p>\n",
    "<www.example.com>\n</www.example.com>\n",
  ],
  [
    "emphasis_unclosed_strong_fallback",
    "**a *b* c",
    "<p>*<em>a *b</em> c</p>\n",
    "<p><em>*a *b</em> c</p>\n",
  ],
];

describe("the honest remainder (port bytes pinned; oracle bytes documented)", () => {
  for (const [name, source, portHtml, oracleHtml] of DIVERGENCES) {
    it(`${name}: port bytes stable, oracle divergence documented`, () => {
      expect(kramdownToHtml(source)).toBe(portHtml);
      expect(portHtml).not.toBe(oracleHtml);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. manifest shape + the live-app escape_literal oracle
// ---------------------------------------------------------------------------

describe("card-mod-markdown manifest and the decko oracle app", () => {
  it("the manifest transcribes the gem tree: one set module, type/markdown, one core view, no config", () => {
    expect(cardModMarkdown.name).toBe("markdown");
    expect(cardModMarkdown.gemName).toBe("card-mod-markdown");
    expect(cardModMarkdown.group).toBe("gem-defaults");
    expect(cardModMarkdown.setPatterns).toBeUndefined();
    expect(cardModMarkdown.prepareEngine).toBeUndefined();
    expect(cardModMarkdown.setModules).toHaveLength(1);
    const setModule = cardModMarkdown.setModules![0]!;
    expect(setModule.setPath).toBe("type/markdown");
    expect(setModule.settingOpts).toBeUndefined();
    const views = setModule.formats?.html?.views ?? [];
    expect(views).toHaveLength(1);
    expect(views[0]!.view).toBe("core");
    expect(views[0]!.config).toBeUndefined(); // Ruby: plain `view :core`
    expect(typeof views[0]!.viewFn).toBe("function");
  });

  it("escape_literal is the identity through the LIVE decko app too (decko-view-oracle.json)", () => {
    // decko-view-oracle.json registered_views.escape_literal_identity:
    // Card.fetch("Markdown Probe").format.escape_literal("<b>&amp;") =>
    // "<b>&amp;" - the set module's method shadows Format#escape_literal
    // with the identity (markdown.rb:16-18)
    expect(escapeLiteral("<b>&amp;")).toBe("<b>&amp;");
  });
});
