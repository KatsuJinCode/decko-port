import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { gradeRun as gradeCapturedRun } from "../grade-lib.mjs";
import { canonicalErrorClass, normalizeErrorRecord, normalizeHtml, normalizeRender, sameFailure, sameJson, sortClassTokens } from "../normalize.mjs";
import { HARNESS } from "./helpers.mjs";

const slot = "0123456789abcdef0123";
const other = "fedcba9876543210fedc";
const same = (a, b) => normalizeHtml(a) === normalizeHtml(b);
const sameNoClassOrder = (a, b) => normalizeHtml(a, { classTokenOrder: false }) === normalizeHtml(b, { classTokenOrder: false });
const gradeRun = options => gradeCapturedRun({ candidateCommit: "28f0278139c373237fafb1cd04a35bd7a41d12e3", ...options });

describe("N1: slot ids, the one mask", () => {
  it("masks a 20-hex slot id in either quote style", () => {
    assert.ok(same(`<div class="card-slot" data-slot-id="${slot}">x</div>`, `<div class="card-slot" data-slot-id="${other}">x</div>`));
    assert.ok(same(`<div data-card-type-code='Topic' data-slot-id='${slot}'>x</div>`, `<div data-card-type-code='Topic' data-slot-id='${other}'>x</div>`));
  });

  it("keeps the quote style: single against double quotes still differs", () => {
    assert.ok(!same(`<div data-slot-id='${slot}'>x</div>`, `<div data-slot-id="${slot}">x</div>`));
  });

  it("does not mask a value of another length or case", () => {
    assert.ok(!same(`<div data-slot-id="${slot}a">x</div>`, `<div data-slot-id="${other}a">x</div>`), "21 digits");
    assert.ok(!same(`<div data-slot-id="${slot.slice(1)}">x</div>`, `<div data-slot-id="${other.slice(1)}">x</div>`), "19 digits");
    assert.ok(!same(`<div data-slot-id="${slot.toUpperCase()}">x</div>`, `<div data-slot-id="${other.toUpperCase()}">x</div>`), "upper case");
  });

  it("does not mask other attributes or text that resembles a slot id", () => {
    assert.ok(!same(`<div data-card-id="${slot}">x</div>`, `<div data-card-id="${other}">x</div>`));
    assert.ok(!same(`<div data-slot-ids="${slot}">x</div>`, `<div data-slot-ids="${other}">x</div>`));
    assert.ok(!same(`<p>data-slot-id="${slot}"</p>`, `<p>data-slot-id="${other}"</p>`), "in text, not attribute position");
    assert.ok(!same(`<p>${slot}</p>`, `<p>${other}</p>`), "bare hex in text");
  });

  it("a content change beside a masked slot id still differs", () => {
    assert.ok(!same(`<div data-slot-id="${slot}">Topic 001</div>`, `<div data-slot-id="${other}">Topic 002</div>`));
    assert.ok(!same(`<div class="a" data-slot-id="${slot}">x</div>`, `<div class="b" data-slot-id="${other}">x</div>`));
  });

  it("normalises only the html of a render result", () => {
    assert.deepEqual(normalizeRender({ html: `<i data-slot-id="${slot}"></i>`, status: 200 }), { html: `<i data-slot-id="SLOT"></i>`, status: 200 });
    assert.ok(!sameJson(normalizeRender({ html: "<i></i>", status: 200 }), normalizeRender({ html: "<i></i>", status: 404 })));
  });
});

describe("N1 masks only a real attribute token", () => {
  it("text in element content is never masked, whatever precedes it", () => {
    assert.ok(!same(`<p>Example data-slot-id="${slot}"</p>`, `<p>Example data-slot-id="${other}"</p>`), "a preceding word is not attribute position");
    assert.ok(!same(`<p>Example data-slot-id="${slot}"</p>`, `<p>Other data-slot-id="${slot}"</p>`), "the visible text itself still counts");
  });

  it("text inside a comment is never masked", () => {
    assert.ok(!same(`<!-- data-slot-id="${slot}" -->`, `<!-- data-slot-id="${other}" -->`));
    assert.ok(!same(`<div><!-- data-slot-id="${slot}" --></div>`, `<div><!-- data-slot-id="${other}" --></div>`));
  });

  it("text inside a quoted attribute value is never masked", () => {
    assert.ok(!same(`<div title=" data-slot-id='${slot}'">x</div>`, `<div title=" data-slot-id='${other}'">x</div>`), "a quoted value is value text, not an attribute");
    assert.ok(!same(`<div title="note: data-slot-id=${slot} done">x</div>`, `<div title="note: data-slot-id=${other} done">x</div>`));
  });

  it("text inside script and style bodies is never masked, even when shaped like a tag", () => {
    assert.ok(!same(`<script>var s = " data-slot-id='${slot}'";</script>`, `<script>var s = " data-slot-id='${other}'";</script>`));
    assert.ok(!same(`<style>.a::after { content: " data-slot-id='${slot}'" }</style>`, `<style>.a::after { content: " data-slot-id='${other}'" }</style>`));
    assert.ok(!same(`<script>document.write('<i data-slot-id="${slot}">')</script>`, `<script>document.write('<i data-slot-id="${other}">')</script>`), "a pseudo-tag in a script body");
    assert.ok(!same(`<script>if (a<b) x="${slot}";</script>`, `<script>if (a<b) x="${other}";</script>`), "a bare < in a body is not a tag boundary");
  });

  it("a real attribute is masked whatever whitespace precedes it, and on a raw text element itself", () => {
    assert.ok(same(`<div class="c"\n  data-slot-id="${slot}">x</div>`, `<div class="c"\n  data-slot-id="${other}">x</div>`), "newline between attributes");
    assert.ok(same(`<script data-slot-id="${slot}">var x = 1;</script>`, `<script data-slot-id="${other}">var x = 1;</script>`));
    assert.ok(!same(`<script data-slot-id="${slot}">var x = 1;</script>`, `<script data-slot-id="${other}">var y = 2;</script>`), "the body still counts");
  });

  it("everything outside the masked value is kept byte for byte", () => {
    const h = `<p>Example data-slot-id="${slot}"</p><!-- x>y --><!DOCTYPE html>\n<div title="t'a>b" data-x=00123456789012345678ab>a > b</div>`;
    assert.equal(normalizeHtml(h), h);
  });
});

describe("N1 and the raw text elements xmp and plaintext", () => {
  it("inside <xmp> a slot-id look-alike is DISPLAYED text, never masked", () => {
    assert.ok(!same(`<xmp><b data-slot-id="${slot}"></b></xmp>`, `<xmp><b data-slot-id="${other}"></b></xmp>`), "inside xmp the content counts");
    assert.equal(normalizeHtml(`<xmp><b data-slot-id="${slot}"></b></xmp>`), `<xmp><b data-slot-id="${slot}"></b></xmp>`, "the xmp body is copied byte for byte");
  });

  it("xmp closes at </xmp>: a real attribute after it is masked, and a real difference there still counts", () => {
    assert.ok(same(`<xmp><i data-slot-id="${slot}"></i></xmp><div data-slot-id="${slot}">x</div>`, `<xmp><i data-slot-id="${slot}"></i></xmp><div data-slot-id="${other}">x</div>`), "markup resumes after xmp");
    assert.ok(!same(`<xmp>a</xmp><div data-slot-id="${slot}">x</div>`, `<xmp>b</xmp><div data-slot-id="${other}">x</div>`), "a visible difference after xmp is never masked away");
  });

  it("inside <plaintext> everything to EOF is displayed text — pseudo-tags, a pseudo end tag, and a self-closing slash are all text", () => {
    assert.ok(!same(`<plaintext><b data-slot-id="${slot}"></b>`, `<plaintext><b data-slot-id="${other}"></b>`), "plaintext has no end tag; the body runs to EOF");
    assert.ok(!same(`<plaintext>${slot}</plaintext><div data-slot-id="${slot}">`, `<plaintext>${other}</plaintext><div data-slot-id="${other}">`), "</plaintext> is text, not a close tag");
    assert.ok(!same(`<plaintext/>${slot}`, `<plaintext/>${other}`), "browsers ignore the self-closing slash on plaintext");
  });

  it("negative control: a real attribute inside a normal tag is still masked", () => {
    assert.ok(same(`<div data-slot-id="${slot}">x</div>`, `<div data-slot-id="${other}">x</div>`));
    assert.ok(same(`<b data-slot-id="${slot}">x</b>`, `<b data-slot-id="${other}">x</b>`), "the tag, outside xmp, masks");
  });
});

describe("N4: collapse-id contexts, a volatile value canonical form", () => {
  const accordion = (n) =>
    `<button class='accordion-button collapsed' data-bs-target='#card-mod_style-${n}-collapse-id' data-bs-toggle='collapse' type='button'>\nStyles\n</button>\n<div class='accordion-collapse collapse' id='card-mod_style-${n}-collapse-id'>`;
  const other = (n) => n.replace(/-?\d+/, (d) => String(Number(d) + 77777));

  it("normalizes the digits of a collapse id to first-appearance placeholders", () => {
    assert.ok(same(accordion(419010129), accordion(-900385456)));
    const page = (a, b) => `<div id='card-mod_style-${a}-collapse-id'></div><div id='card-mod_style-${b}-collapse-id'></div>`;
    assert.equal(
      normalizeHtml(page(419010129, -900385456)).match(/N4#\d/g).join(","),
      "N4#1,N4#2",
    );
    assert.equal(
      normalizeHtml(page(-900385456, 419010129)).match(/N4#\d/g).join(","),
      "N4#1,N4#2",
      "the first appearance on a page becomes N4#1 whichever value it is",
    );
  });

  it("a button target and its panel id must still agree across the normalization", () => {
    assert.ok(!same(
      accordion(419010129),
      accordion(419010129).replace(/-collapse-id'/g, "-collapse-id'").replace("id='card-mod_style-419010129", "id='card-mod_style--900385456"),
    ));
  });

  it("does not touch literal-context collapse ids or unrelated numbers", () => {
    assert.ok(!same(
      "<div id='card-mod_format-files-collapse-id'></div>",
      "<div id='card-mod_format-depends_on-collapse-id'></div>",
    ), "the gem_info literal contexts are real bytes");
    assert.ok(!same("<p>419010129</p>", "<p>-900385456</p>"), "bare numbers in text");
    assert.ok(!same("<div id='card-Topic-419010129'></div>", "<div id='card-Topic--900385456'></div>"), "no collapse-id suffix, no rule");
  });

  it("a content change beside a normalized collapse id still differs", () => {
    assert.ok(!same(
      accordion(419010129) + "<h3>Styles</h3>",
      accordion(-900385456) + "<h3>Tasks</h3>",
    ));
  });
});

describe("literal durations remain meaningful rendered content", () => {
  const credit = (span) =>
    `<div class="cred"><a class="known-card" href="/Decko_Bot">Decko Bot</a> ${span}</div>`;

  it("preserves every former duration vocabulary instead of erasing it", () => {
    for (const span of [
      "less than a minute",
      "1 minute",
      "2 minutes",
      "44 minutes",
      "about 1 hour",
      "about 3 hours",
      "1 day",
      "20 days",
      "about 1 month",
      "3 months",
      "about 1 year",
      "over 2 years",
      "almost 3 years",
    ]) {
      assert.equal(same(credit(span), credit("20 days")), span === "20 days", span);
      assert.ok(same(credit(span), credit(span)), "identical duration remains equal");
    }
  });

  it("the surrounding sentence still counts: a change outside the span fails", () => {
    assert.ok(!same(credit("less than a minute ago"), credit("20 days")), 'the "ago" tail is an anchor: present on one side only');
    assert.ok(!same(credit("less than a minute ago"), credit("20 days ago")), "a matching tail cannot erase a changed duration");
    assert.ok(!same(
      "<span class=\"last-update\">\n        added less than a minute ago by\n      </span>",
      "<span class=\"last-update\">\n        updated 20 days ago by\n      </span>",
    ));
    assert.ok(!same(credit("less than a minute"), credit("less than a minute") + "<p>more</p>"));
  });

  it("canonicalizes only the span: bare dates and other numbers are real bytes", () => {
    assert.ok(!same("<p>2026-09-19</p>", "<p>less than a minute</p>"), "the date view's encoding is not a relative-time span");
    assert.ok(!same("<p>2026-09-19</p>", "<p>2026-09-20</p>"));
    assert.ok(!same("<p>in 20 days</p>", "<p>in 3 weeks</p>"), "only the Rails vocabulary matches, and weeks is not in it");
  });

  it("does not swallow numbers outside Rails' table or digits that merely contain them", () => {
    assert.ok(!same("<p>120 days</p>", "<p>20 days</p>"), "Rails emits at most 30 days; prose keeps its real bytes");
    assert.ok(!same("<p>x120 days</p>", "<p>x20 days</p>"), "no word boundary, no rule");
  });

  it("preserves each duration when several occur on a page", () => {
    const page = (a, b) => `<div>${a}</div><div>${b}</div>`;
    assert.ok(!same(page("less than a minute", "2 minutes"), page("20 days", "1 day")));
    assert.ok(same(page("1 day", "2 minutes"), page("1 day", "2 minutes")));
    assert.ok(!same(page("less than a minute", "2 minutes"), page("20 days", "x")));
  });
});

describe("meaningful literal durations and localhost ports", () => {
  it("preserves ordinary duration text, tooltips and navigation targets", () => {
    for (const [a,b] of [
      ["<p>The trial lasts 3 days.</p>", "<p>The trial lasts 4 days.</p>"],
      ["<p>Allocate 3 hours.</p>", "<p>Allocate 4 hours.</p>"],
      ["<p>Wait less than 3 seconds.</p>", "<p>Wait less than 4 seconds.</p>"],
      ['<a title="Trial: 3 days">plan</a>', '<a title="Trial: 4 days">plan</a>'],
      ['<a href="/plans/3 days">plan</a>', '<a href="/plans/4 days">plan</a>'],
    ]) assert.notEqual(normalizeHtml(a), normalizeHtml(b));
    assert.throws(() => normalizeHtml("<p>3 days</p>", {rules:["N5"]}), /RetiredRelativeTimeNormalization/);
  });
  it("preserves localhost ports in arbitrary semantic and HTML strings", () => {
    assert.equal(sameJson({text:"Use 127.0.0.1:1001"}, {text:"Use 127.0.0.1:1002"}), false);
    assert.equal(sameJson({html:'<p>127.0.0.1:1001</p>'}, {html:'<p>127.0.0.1:1002</p>'}), false);
    assert.equal(sameJson({b:"127.0.0.1:1001",a:1}, {a:1,b:"127.0.0.1:1001"}), true);
  });
});

describe("N7: capture-host content in debug-page titles, the capture-machine canonical form", () => {
  const debugTitle = (message, frames) =>
    `<span class="render-error alert alert-danger">Error rendering: <span title="\n      &lt;h3&gt;Error message (visible to admin only)&lt;/h3&gt;\n      &lt;p&gt;&lt;strong&gt;${message}&lt;/strong&gt;&lt;/p&gt;\n      &lt;div&gt;${frames}&lt;/div&gt;\n    ">Ada Admin+*account</span> (verify_url view)</span>`;
  const frames = (host) =>
    `C:/${host}/lib/ruby/gems/3.3.0/gems/jwt-2.10.3/lib/jwt/jwa/hmac.rb:40:in &lt;code&gt;ensure_valid_key!&lt;br&gt;\nC:/${host}/reference-harness/oracle/adapter.rb:56:in &lt;code&gt;`;

  it("canonicalizes capture-host content in the message and title outside the div", () => {
    assert.ok(same(
      debugTitle("private method `closure_deletions' called for #&lt;Card:0x000073a1c2d3e4f0&gt;", frames("capture-host")),
      debugTitle("private method `closure_deletions' called for #&lt;Card:0x000073a1c2d3e4f8&gt;", frames("capture-host")),
    ), "heap addresses in the message are capture-machine noise");
    assert.ok(!same(
      debugTitle("uninitialized constant Card::Set::All::Html::Error::BetterErrors", frames("capture-host")),
      debugTitle("uninitialized constant Card::Set::All::Html::Error::Other", frames("capture-host")),
    ), "the message text itself is oracle semantics");
    const m = normalizeHtml(debugTitle("msg", frames("capture-host"))).match(/N7#path/g);
    assert.ok(!m, "frame lines inside the div are N6's, not N7's");
    const outside = `<span title="\n      &lt;h3&gt;Error message (visible to admin only)&lt;/h3&gt;\nC:/capture-host/loose.rb">card</span>`;
    assert.equal([...normalizeHtml(outside).matchAll(/N7#path/g)].length, 1, "title content outside the message and div still gets N7");
  });

  it("the anchors still count", () => {
    assert.ok(!same(debugTitle("HMAC key cannot be empty", frames("capture-host")), debugTitle("HMAC key cannot be empty", frames("capture-host")).replace("(verify_url view)", "(reset_password_url view)")));
    assert.ok(!same(debugTitle("HMAC key cannot be empty", frames("capture-host")), `<span class="render-error alert alert-danger">Error rendering: <span title="">Ada Admin+*account</span> (verify_url view)</span>`), "an engine that emits no debug page still differs structurally");
  });

  it("does not touch paths or addresses outside a debug title", () => {
    assert.ok(!same("<p>C:/capture-host/gems/jwt.rb</p>", "<p>C:/other/gems/jwt.rb</p>"));
    assert.ok(!same("<p>0xdeadbeef</p>", "<p>0xfeedface</p>"));
    assert.ok(!same("<p>title=\"C:/a.rb\"</p>", "<p>title=\"C:/b.rb\"</p>"), "an ordinary title attribute is not the debug page");
  });

  it("the rule keys on the debug page's own first bytes, not the span class alone", () => {
    const plainError = `<span title="something went wrong C:/capture-host/x.rb">card</span>`;
    assert.ok(!same(plainError, plainError.replace("capture-host", "other")), "no debug-page marker, no rule");
  });
});

describe("N6: the backtrace frame list, masked on both sides", () => {
  const debugTitle = (frames) =>
    `<span class="render-error alert alert-danger">Error rendering: <span title="\n      &lt;h3&gt;Error message (visible to admin only)&lt;/h3&gt;\n      &lt;p&gt;&lt;strong&gt;HMAC key cannot be empty&lt;/strong&gt;&lt;/p&gt;\n      &lt;div&gt;${frames}&lt;/div&gt;\n    ">Ada Admin+*account</span> (verify_url view)</span>`;
  const rubyFrame = (gem, line, method) =>
    `C:/capture-host/lib/ruby/gems/3.3.0/gems/${gem}:${line}:in \`${method}&#39;`;
  const v8Frame = (fn, file) =>
    `at ${fn} (file:///checkout/src/card/render/${file})`;
  const join = (frames) => frames.join("&lt;br&gt;\n");

  it("masks the whole frame list to one marker whichever VM produced it", () => {
    const ruby = debugTitle(join([rubyFrame("jwt-2.10.3/lib/jwt/jwa/hmac.rb", 40, "ensure_valid_key!"), "&lt;internal:kernel&gt;:90:in `tap&#39;", "script/decko:6:in `&lt;main&gt;&#39;"]));
    const v8 = debugTitle(join([v8Frame("tokenUrlBody", "views.ts"), v8Frame("renderView", "format.ts"), v8Frame("renderPage", "run.mjs")]));
    assert.ok(same(ruby, v8), "three Ruby frames and three V8 frames carry the same compared content");
    assert.equal([...normalizeHtml(ruby).matchAll(/N6#frames/g)].length, 1, "one marker for the whole list");
    assert.ok(!normalizeHtml(ruby).includes("hmac.rb") && !normalizeHtml(v8).includes("tokenUrlBody"), "no frame text survives");
  });

  it("the frame count is not compared: a backtrace's depth is the raising engine's own", () => {
    const three = debugTitle(join([v8Frame("a", "x.ts"), v8Frame("b", "y.ts"), v8Frame("c", "z.ts")]));
    const sixtyThree = debugTitle(join(Array.from({ length: 63 }, (_, i) => rubyFrame("card/lib/card.rb", i + 1, "m"))));
    assert.ok(same(three, sixtyThree), "3 engine frames against 63 Ruby frames carry the same compared content");
    assert.ok(same(three, debugTitle("")), "an empty frame list too");
  });

  it("the heading, the message and the div's anchors still count", () => {
    const ruby3 = () => join([rubyFrame("jwt-2.10.3/lib/jwt/jwa/hmac.rb", 40, "ensure_valid_key!"), "&lt;internal:kernel&gt;:90:in `tap&#39;", "script/decko:6:in `&lt;main&gt;&#39;"]);
    assert.ok(!same(debugTitle(ruby3()), debugTitle(ruby3()).replace("HMAC key cannot be empty", "other failure")), "the message is oracle semantics");
    assert.ok(!same(debugTitle(ruby3()), debugTitle(ruby3()).replace("(verify_url view)", "(reset_password_url view)")), "the span's anchors are oracle semantics");
    assert.ok(!same(debugTitle(ruby3()), debugTitle(ruby3()).replace("&lt;/div&gt;\n    ", "&lt;/div&gt;\n      ")), "the div's tail is oracle semantics");
    assert.ok(!same(debugTitle(ruby3()), debugTitle(ruby3()).replace("&lt;div&gt;", "&lt;section&gt;")), "the div itself is oracle semantics");
    assert.ok(!same(debugTitle(ruby3()), `<span class="render-error alert alert-danger">Error rendering: <span title="">Ada Admin+*account</span> (verify_url view)</span>`), "no debug page at all still differs structurally");
  });

  it("fires only inside the debug title's backtrace div", () => {
    assert.ok(!same("<p>at fn (file:///C:/a/x.ts:1:1)&lt;br&gt;\nat g (file:///C:/a/y.ts:2:2)</p>", "<p>at fn (file:///C:/b/x.ts:1:1)&lt;br&gt;\nat g (file:///C:/b/y.ts:2:2)</p>"), "frames outside a debug title are real bytes");
    const ordinaryTitle = (frames) => `<span title="${frames}">card</span>`;
    assert.ok(!same(ordinaryTitle(join([v8Frame("a", "x.ts"), v8Frame("b", "y.ts")])), ordinaryTitle(join([v8Frame("c", "x.ts"), v8Frame("d", "y.ts")]))), "no debug-page marker, no rule");
    const messageDiv = (msg) =>
      `<span title="\n      &lt;h3&gt;Error message (visible to admin only)&lt;/h3&gt;\n      &lt;p&gt;&lt;strong&gt;${msg}&lt;/strong&gt;&lt;/p&gt;\n      &lt;div&gt;${join([v8Frame("a", "x.ts")])}&lt;/div&gt;\n    ">card</span>`;
    assert.ok(!same(messageDiv("a &lt;div&gt; b"), messageDiv("a &lt;div&gt; c")), "a div-shaped token in the message is message text, not the backtrace div");
  });
});

describe("removed rules: these now count", () => {
  it("hexadecimal numbers in HTML are compared (the former address mask)", () => {
    assert.ok(!same("<p>0xdeadbeef</p>", "<p>0xfeedface</p>"));
    assert.ok(!same("#<Card::Format::HtmlFormat:0x000073a1c2d3e4f0>", "#<Card::Format::HtmlFormat:0x000073a1c2d3e4f8>"));
  });

  it("a write result's card id is compared (the former id drop)", () => {
    const r = (id) => ({ saved: true, errors: [], card: { name: "Note 1", id }, mail: [] });
    assert.ok(!sameJson(r(911), r(912)));
  });

  it("mail text is compared byte for byte (the former whitespace trim)", () => {
    const r = (text) => ({ saved: true, errors: [], card: null, mail: [{ to: ["a@example.test"], subject: "s", text }] });
    assert.ok(!sameJson(r("line\n"), r("line  \n")), "trailing spaces");
    assert.ok(!sameJson(r("a\nb"), r("a\r\nb")), "line ends");
    assert.ok(!sameJson(r("a"), r("\na\n")), "surrounding blank lines");
  });

  it("row deltas are compared raw: ids and timestamp text count", () => {
    const rows = (id, at) => ({ cards: { inserted: [{ id, name: "Note 1", updated_at: at }], updated: [], deleted: [] } });
    assert.ok(sameJson(rows(911, "2026-09-19 12:00:00"), rows(911, "2026-09-19 12:00:00")));
    assert.ok(!sameJson(rows(911, "2026-09-19 12:00:00"), rows(912, "2026-09-19 12:00:00")), "a new row's id");
    assert.ok(!sameJson(rows(911, "2026-09-19 12:00:00"), rows(911, "2026-09-19T12:00:00.000Z")), "the same instant in another text form");
  });
});

describe("N2: key order, a canonical form", () => {
  it("object key order never counts; array order always does", () => {
    assert.ok(sameJson({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
    assert.ok(!sameJson({ names: ["A", "B"] }, { names: ["B", "A"] }));
    assert.ok(!sameJson({ a: 1 }, { a: "1" }), "type counts");
    assert.ok(!sameJson({ a: null }, {}), "a null field is not an absent one");
  });
});

describe("N3: class-token order, a canonical form", () => {
  it("compares class tokens as a set, in either quote style", () => {
    assert.ok(same(`<div class="card-new card-abstract">x</div>`, `<div class="card-abstract card-new">x</div>`));
    assert.ok(same(`<div class='b a c'>x</div>`, `<div class='a b c'>x</div>`));
    assert.ok(!same(`<div class="a b">x</div>`, `<div class='a b'>x</div>`), "the quote character is kept, exactly as N1 keeps it");
  });

  it("the token set, the count and the tokens themselves all still count", () => {
    assert.ok(!same(`<div class="a b">x</div>`, `<div class="a b c">x</div>`), "a missing token");
    assert.ok(!same(`<div class="a b">x</div>`, `<div class="a b b">x</div>`), "a repeated token");
    assert.ok(!same(`<div class="a b">x</div>`, `<div class="a B">x</div>`), "token case");
    assert.ok(!same(`<div class="a b">x</div>`, `<div class="">x</div>`), "an emptied value");
    assert.ok(!same(`<div class="a b">x</div>`, `<div class="a b c">x</div>`), "a different set, not an order");
  });

  it("only a real class attribute token is reordered", () => {
    assert.ok(!same(`<p>class="b a"</p>`, `<p>class="a b"</p>`), "element text is content, not an attribute");
    assert.ok(!same(`<!-- class="b a" -->`, `<!-- class="a b" -->`), "inside a comment");
    assert.ok(!same(`<div title='class="b a"'>x</div>`, `<div title='class="a b"'>x</div>`), "inside another attribute's value");
    assert.ok(!same(`<script>var c = "b a";</script>`, `<script>var c = "a b";</script>`), "inside a script body");
    assert.ok(!same(`<div data-class="b a">x</div>`, `<div data-class="a b">x</div>`), "an attribute whose name merely ends in class");
    assert.ok(!same(`<div class=b a>x</div>`, `<div class=a b>x</div>`), "an unquoted value");
  });

  it("the attribute name itself, and everything around it, still count", () => {
    assert.ok(!same(`<div class="b a">x</div>`, `<div CLASS="a b">x</div>`), "attribute name case is a byte difference in the tag");
    assert.ok(same(`<div id="q" class="b a" data-x="1">x</div>`, `<div id="q" class="a b" data-x="1">x</div>`));
    assert.ok(!same(`<div class="b a" data-x="1">x</div>`, `<div class="b a" data-x="2">x</div>`), "a difference beside the class still counts");
    assert.ok(!same(`<div class="b a">y</div>`, `<div class="a b">z</div>`), "a difference in the element content still counts");
  });

  it("class is matched case-insensitively, as HTML attribute names are", () => {
    assert.ok(same(`<div CLASS="b a">x</div>`, `<div CLASS="a b">x</div>`));
    assert.ok(same(`<div Class="b a">x</div>`, `<div Class="a b">x</div>`));
  });

  it("a closing tag's text is never touched", () => {
    assert.equal(normalizeHtml(`</div class="b a">`), `</div class="b a">`);
  });

  it("with the rule off, class-token order is compared byte for byte", () => {
    assert.ok(!sameNoClassOrder(`<div class="card-new card-abstract">x</div>`, `<div class="card-abstract card-new">x</div>`));
    assert.ok(sameNoClassOrder(`<div class="a b">x</div>`, `<div class="a b">x</div>`));
    assert.ok(sameNoClassOrder(`<div data-slot-id="${slot}">x</div>`, `<div data-slot-id="${other}">x</div>`), "N1 is unaffected");
  });

  it("a value with one token, none, or unusual whitespace", () => {
    assert.equal(sortClassTokens(""), "");
    assert.equal(sortClassTokens("solo"), "solo");
    assert.equal(sortClassTokens("  a  b  "), "a b", "separator runs collapse");
    assert.equal(sortClassTokens("a\nb"), "a b", "a newline separator is a separator, not content");
    assert.equal(sortClassTokens("b a a"), "b a a", "a repeated token leaves the value exactly as it is");
  });

  it("normalizeRender applies N3 to the html of a render result only", () => {
    assert.deepEqual(normalizeRender({ html: `<i class="b a"></i>`, status: 200 }), { html: `<i class="a b"></i>`, status: 200 });
    assert.deepEqual(normalizeRender({ html: `<i class="b a"></i>`, status: 200 }, { classTokenOrder: false }), { html: `<i class="b a"></i>`, status: 200 });
    assert.ok(!sameJson(normalizeRender({ html: `<i class="a b"></i>`, status: 200 }), normalizeRender({ html: `<i class="a b"></i>`, status: 404 })));
  });
});

describe("N8: an error record's class name, the host-language naming canonical form", () => {
  const ruby = { class: "Card::Error::CodenameNotFound", message: "unknown codename: test_context" };
  const engine = { class: "CodenameNotFoundError", message: "unknown codename: test_context" };

  it("the same failure named by each host language compares equal", () => {
    assert.ok(sameFailure(ruby, engine), "the ruby-named and engine-named records are one failure");
    assert.ok(sameFailure(engine, ruby), "the rule is two-sided");
    assert.equal(canonicalErrorClass("Card::Error::CodenameNotFound"), "CodenameNotFound", "the terminal :: segment is the name proper");
    assert.equal(canonicalErrorClass("CodenameNotFoundError"), "CodenameNotFound", "the JS Error suffix drops");
  });

  it("a genuinely different failure still fails: another class proper or another message", () => {
    assert.ok(!sameFailure(ruby, { ...ruby, message: "a different fault" }), "the message compares byte-exact");
    assert.ok(!sameFailure(ruby, { class: "SomeOtherFaultError", message: ruby.message }), "another class proper");
    assert.ok(!sameFailure(ruby, { class: "Card::Error::NotFound", message: ruby.message }), "a different name under the same namespace");
  });

  it("every other field of the record counts", () => {
    assert.ok(!sameFailure(ruby, { ...ruby, backtrace: "..." }));
    assert.ok(!sameFailure({ class: "X", message: "y", status: 1 }, { class: "X", message: "y", status: 2 }));
  });

  it("only host naming is erased, and the erasure is narrow", () => {
    assert.equal(canonicalErrorClass("CodenameNotFound"), "CodenameNotFound", "a bare name without the suffix stays");
    assert.equal(canonicalErrorClass("FakeError"), "Fake");
    assert.equal(canonicalErrorClass("Error"), "Error", "a bare Error would empty; it stays");
    assert.equal(canonicalErrorClass("Card::Error::CodenameNotFoundError"), "CodenameNotFound", "namespace and suffix drop together");
    assert.equal(canonicalErrorClass(""), "");
    assert.equal(canonicalErrorClass(undefined), undefined);
  });

  it("non-error records pass through untouched", () => {
    assert.equal(normalizeErrorRecord(undefined), undefined);
    assert.equal(normalizeErrorRecord("str"), "str");
    assert.deepEqual(normalizeErrorRecord({ class: "X", message: "y" }), { class: "X", message: "y" });
  });
});

describe("N9: the address inside a default object inspect, a volatile value canonical form", () => {
  const plain = (addr) => `private method \`closure_deletions' called for #<Card:0x${addr}>`;
  const escapedTitle = (addr) =>
    `<span title="&lt;p&gt;&lt;strong&gt;private method &#39;closure_deletions&#39; called for #&amp;lt;Card:0x${addr}&amp;gt;&lt;/strong&gt;">Ada</span>`;
  const a = "000001bd38e4f4c0";
  const b = "0000028dfcc01048";

  it("masks the sixteen digits in a plain error message, on both sides, so two processes compare equal", () => {
    const applied = new Set();
    assert.ok(sameFailure({ class: "NoMethodError", message: plain(a) }, { class: "NoMethodError", message: plain(b) }, applied));
    assert.ok(applied.has("N9"), "the reached form is named");
    assert.equal(normalizeErrorRecord({ class: "X", message: plain(a) }).message, "private method `closure_deletions' called for #<Card:N9#addr>");
  });

  it("masks the address inside an html-escaped debug title and names N9", () => {
    const applied = new Set();
    const out = normalizeHtml(escapedTitle(a), { applied });
    assert.equal(out, escapedTitle("N9#addr").replace("Card:0xN9#addr", "Card:N9#addr"), "the address alone becomes the marker, in the escaped spelling");
    assert.ok(applied.has("N9"));
    assert.ok(!applied.has("N7"), "N9 claims the address, so the heap-address rule does not also reach it");
  });

  it("the class name and the attributes after the address are compared byte for byte", () => {
    assert.ok(!sameFailure({ class: "NoMethodError", message: plain(a) }, { class: "NoMethodError", message: plain(a).replace("Card", "Cardio::Mod") }), "another class name fails");
    const withAttrs = (x) => `#<Card:0x${x} @name="Ada">`;
    assert.ok(!sameFailure({ class: "E", message: withAttrs(a) }, { class: "E", message: withAttrs(a).replace('"Ada"', '"Mira"') }), "a different attribute fails");
    assert.ok(sameFailure({ class: "E", message: withAttrs(a) }, { class: "E", message: withAttrs(b) }), "the address alone is masked");
  });

  it("only the address shape is masked: a short or a non-inspect hex run is not", () => {
    assert.ok(!sameFailure({ class: "E", message: "#<Card:0x000001bd38e4f4c" }, { class: "E", message: "#<Card:0x000001bd38e4f4c0" }), "a fifteen-digit run is not an address");
    assert.ok(!sameFailure({ class: "E", message: "id 0x000001bd38e4f4c0" }, { class: "E", message: "id 0x000002bd38e4f4c0" }), "a bare hex run outside an inspect string is not masked");
    assert.ok(!sameFailure({ class: "E", message: "#<Card:0x000001bd38e4f4cg>" }, { class: "E", message: "#<Card:0x000001bd38e4f4c0>" }), "a non-hex digit is not an address");
  });

  it("a text without an inspect string is returned unchanged and names no rule", () => {
    const applied = new Set();
    assert.equal(normalizeHtml("<p>nothing here</p>", { applied }), "<p>nothing here</p>");
    assert.ok(!applied.has("N9"));
  });
});

describe("synthetic-v1: the masks are the measured nondeterminism", () => {
  const fixture = path.join(HARNESS, "fixtures", "synthetic-v1");
  const manifest = JSON.parse(readFileSync(path.join(fixture, "expected", "MANIFEST.json"), "utf8"));

  it("two stock oracle runs differ only where N1 masks, and N1 never masks an equal value", () => {
    const n = manifest.provenance.nondeterminism;
    assert.deepEqual(n.unexplained, []);
    assert.ok(n.masks.N1.differing_pairs > 0, "N1 matched values that really vary");
    assert.equal(n.masks.N1.differing_pairs, n.masks.N1.matched_pairs);
    assert.deepEqual(Object.keys(n.masks), ["N1"], "evidence exists for every mask and no other");
  });

  it("the oracle's own outputs, regraded as an engine's results, pass", () => {
    const report = gradeRun({ fixture, actual: path.join(fixture, "expected") });
    assert.deepEqual(report.problems, []);
    assert.equal(report.verdict, "pass");
    assert.equal(report.summary.rendering.graded, 1754);
    assert.equal(report.summary.semantics.graded, 2389);
    assert.equal(report.summary.persistence.graded, 16);
    assert.equal(report.summary.side_effects.graded, 19);
    assert.equal(report.read_writes.graded, 8);
  });

  it("a grade names exactly the canonical forms it reached: N1 to N3 on synthetic-v1", () => {
    assert.deepEqual(gradeRun({ fixture, actual: path.join(fixture, "expected") }).normalization, ["N1", "N2", "N3"]);
    assert.deepEqual(gradeRun({ fixture, actual: path.join(fixture, "expected"), classTokenOrder: false }).normalization, ["N1", "N2"]);
  });

  it("N3 changes nothing on the committed expected bytes, which are already in sorted class-token order", () => {
    const on = gradeRun({ fixture, actual: path.join(fixture, "expected") });
    const off = gradeRun({ fixture, actual: path.join(fixture, "expected"), classTokenOrder: false });
    assert.equal(off.verdict, "pass", "the expected outputs also pass with N3 off, so N3 hides nothing here");
    assert.equal(on.summary.rendering.pass, off.summary.rendering.pass);
  });
});
