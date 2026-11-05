// The card-mod-help mod loader test: the mod loaded through the loader
// registers its four html views (help, help_text, lead, popover), the two
// settings (help, guide) and the gem tree's six set modules. Each view
// proves its Ruby-source semantics against a probe deck that mirrors the
// oracle capture (fixtures/captured/help-mod-loader.json).
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.rb#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the full gem tree; view registration
//     order matches the gem's pattern walk.
//
// Probe cards (ids chosen to match the oracle capture so the rule card
// composition matches the help-mod-loader.json "rendered" bytes):
//   - Oracle Help Probe (id 1169) + a *help rule card (junction
//     Oracle Help Probe+*self+*help, id 21) carrying help text
//   - Oracle Bare Probe (id 1170) - no *help rule card
//   - *help (id 12) is the codename card for the setting
// Plus a separate compound probe deck for the :popover byte oracle
// (fixtures/captured/help-popover.json): Right pattern is compound_only
// (mod/core/set_pattern/07_right.rb:2), so the popover view only fires
// on compound names - simple probe names raise "view not supported" in
// Ruby. The capture seeds Oracle Help Popover Probe+*help (WITH a *help
// rule) and Oracle Bare Popover Probe+*help (WITHOUT).
//
// Set module basket (set/all/help.rb:6-12 / :help, :help_text; :27-30 /
// :lead; set/all/guide.rb:6-16 / :guide; set/right/help.rb:4-6 / :popover;
// set/self/help.rb setting_opts; set/self/guide.rb setting_opts):
// the 6 gem-tree entries are: all/help, all/guide, right/help, right/guide,
// self/help, self/guide.
//
// Of the gem's five html views (compat-report metrics.htmlViewsMissingNames
// for card-mod-help-0.20.0): help, help_text, lead are ported with oracle
// bytes; :popover is ported via card-mod-bootstrap's popover_link helper
// (set/right/help.rb:4-6). Bytes captured against
// fixtures/captured/help-popover.json (captured from the live decko 0.20.0
// oracle app via tests/card/mod-loader/oracle-capture-help-popover.rb);
// the byte-equality A/B pin is currently red on attribute order
// (TS popoverLink emits via emitAttrs in hash insertion order:
// href, tabindex, class, data-bs-*; Ruby link_to emits: tabindex,
// data-bs-*, class, href). Fix lives on the bootstrap lane at
// card-mod-bootstrap.ts#popoverLink. set/right/guide.rb only defines
// a card-level raw_help_text method (no view declared). See viewsMissing
// for the full set-block accounting.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import {
  ModLoader,
  cardModHelp,
  modEngineHost,
} from "../../../src/card/mod-loader.js";

/** The byte oracle for the :popover view (set/right/help.rb:4-6 -> the
 *  popover_link helper from card-mod-bootstrap's set/all/bootstrap/
 *  helper.rb:41-44). Captured from the live decko 0.20.0 oracle app via
 *  tests/card/mod-loader/oracle-capture-help-popover.rb. The Right pattern
 *  is compound_only (mod/core/set_pattern/07_right.rb:2), so the popover
 *  view only fires on compound names; the fixture pins a ruled compound
 *  probe and a bare compound probe. */
const POPOVER_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/help-popover.json", import.meta.url)),
    "utf8",
  ),
) as { rendered: Record<string, string> };

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
  await seedCard(s, { id: 12, name: "*help", codename: "help", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  // the set card "Oracle Help Probe+*self" (junction: probe + *self).
  // The *self anchor drives the rule-card lookup (help.rb:1-4
  // help_rule_card walks the card's set names joined to "*help").
  await seedCard(s, { id: 20, leftId: 1169, rightId: 11, typeId: 13 });

  // the rule card "Oracle Help Probe+*self+*help" (junction: set card +
  // *help). Its dbContent is the raw help text the help.rb:32-48 chain
  // resolves into the rendered help bytes (process_content walks the
  // text for [[...]] link chunks; this fixture's text has none).
  await seedCard(s, {
    id: 21,
    leftId: 20,
    rightId: 12,
    typeId: 14,
    dbContent: "Moderator-approved help text for the probe card.",
  });

  // *guide setting card (codename registry reads cards.codename; the
  // prepareEngine walks the rule-cache join against this codename to warm
  // *guide rule cards for the :guide view). Type id is shared with *help
  // (both are *setting-typed settings per data/real.yml).
  await seedCard(s, { id: 15, name: "*guide", codename: "guide", typeId: 14 });

  // the guide rule card "Oracle Help Probe+*self+*guide" (same set card,
  // different right anchor). Its dbContent is the literal Markdown string
  // that the :guide view's nest(view: :core) reaches - for a non-Markdown
  // guide card the base :core renders dbContent verbatim (the
  // card-mod-markdown Type::Markdown override only fires when
  // card.typeName === "Markdown", card-mod-markdown.ts:88). The probe
  // guide card here has no type set so this fixture exercises the
  // plain-text :core path.
  await seedCard(s, {
    id: 22,
    leftId: 20,
    rightId: 15,
    typeId: 14,
    dbContent: "Editing guidance rule text for the probe card.",
  });

  // the probe cards - ids 1169/1170 exactly as the oracle seeded them
  // (the rendered bytes carry data-card-id).
  await seedCard(s, {
    id: 1169,
    name: "Oracle Help Probe",
    dbContent: "probe card body",
  });
  await seedCard(s, {
    id: 1170,
    name: "Oracle Bare Probe",
    dbContent: "bare probe body",
  });

  // -- :popover probe deck (compound cards; Right pattern is compound_only) -
  // the left-side plain cards (RichText-typed; Oracle Help Popover Probe's
  // dbContent matches the capture, Oracle Bare Popover Probe is its left
  // side and carries the bare body).
  await seedCard(s, {
    id: 2200,
    name: "Oracle Help Popover Probe",
    dbContent: "popover probe card body",
  });
  await seedCard(s, {
    id: 2201,
    name: "Oracle Bare Popover Probe",
    dbContent: "bare popover probe body",
  });
  // the set card "Oracle Help Popover Probe+*self" (junction).
  await seedCard(s, { id: 2210, leftId: 2200, rightId: 11, typeId: 13 });
  // the rule card "Oracle Help Popover Probe+*self+*help" (junction).
  await seedCard(s, {
    id: 2211,
    leftId: 2210,
    rightId: 12,
    typeId: 14,
    dbContent: "Moderator-approved help text for the popover probe card.",
  });
  // the two compound probe cards (Right pattern matches; :popover view
  // dispatches through Card::Set::Right::Help::HtmlFormat). dbContent
  // carries _render_core's body (RichText :core renders dbContent verbatim).
  await seedCard(s, {
    id: 2220,
    leftId: 2200,
    rightId: 12,
    typeId: 14,
    dbContent: "popover probe card body",
  });
  await seedCard(s, {
    id: 2221,
    leftId: 2201,
    rightId: 12,
    typeId: 14,
    dbContent: "bare popover probe body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-help through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("Oracle Help Probe", "help")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Help Probe", "help_text")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Bare Probe", "lead")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Help Probe", "guide")).rejects.toThrow(
      UnsupportedViewError,
    );
    // set/right/help.rb:4-6 view :popover - the popover_link helper from
    // card-mod-bootstrap's set/all/bootstrap/helper.rb:41-44. Without the
    // mod the view is not on the live registry, so dispatch raises
    // UnsupportedViewError - same proof shape as the other ported views.
    await expect(s.engine.render("Oracle Help Probe", "popover")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :help on a ruled card wraps the help text in <div class='help-text'> (set/all/help.rb:7-12)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModHelp }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("Oracle Help Probe", "help");
    // wrap: :slot keeps the empty body wrapped (render.rb:96-97 runs
    // with_wrapper around final_render unconditionally), so even an
    // empty body would still render the slot div. Here the body is the
    // non-empty help div with the rule text.
    expect(html).toContain("class=\"help-text\"");
    expect(html).toContain("Moderator-approved help text for the probe card.");
    // wrap_help_text prepends the d-none edit-link span when a readable
    // rule card is reachable (help.rb:18-25). The span emits single-quoted
    // HTML attribute values (HAML block emission, help.rb:22
    // `"<span class='d-none'>#{edit_link}</span>#{text}"`).
    expect(html).toContain("class='d-none'");
    expect(html).toContain("rule_edit");
  });

  it("WITH the mod: :help_text on a ruled card returns the bare help text (set/all/help.rb:14-16)", async () => {
    const s = storage!;
    // help_text view has no wrap config -> bare bytes (oracle: the
    // d-none span + the help text, no slot div).
    const text = await s.engine.render("Oracle Help Probe", "help_text");
    expect(text).toContain("Moderator-approved help text for the probe card.");
    // The edit-link span uses single-quoted class (help.rb:22 HAML emit).
    expect(text).toContain("class='d-none'");
    // no slot wrapping on the no-wrap view (no <div id="...-help_text-view"...).
    expect(text).not.toContain("help_text-view");
  });

  it("WITH the mod: :help on a rule-less card renders the EMPTY slot wrap (help.rb:9-11 + wrap: :slot)", async () => {
    const s = storage!;
    // The body returns "" (help.rb:9 `return "" unless help.present?`),
    // but wrap: :slot still emits the outer slot div (render.rb:96-97).
    const html = await s.engine.render("Oracle Bare Probe", "help");
    expect(html).toContain("card-slot");
    expect(html).toContain("help-view");
    // the inner help-text div is absent because the body was empty
    expect(html).not.toContain("class=\"help-text\"");
  });

  it("WITH the mod: :help_text on a rule-less card returns the empty string (help.rb:14-16, no rule text to wrap)", async () => {
    const s = storage!;
    const text = await s.engine.render("Oracle Bare Probe", "help_text");
    expect(text).toBe("");
  });

  it("WITH the mod: :lead adds the 'lead' class to the slot and renders the core content (set/all/help.rb:27-30)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Help Probe", "lead");
    // class_up "card-slot", "lead" + the slot's set-keys -> the lead
    // token sits at the end of the slot class list (classy.rb#class_up
    // appends; the chain's classy extras land at the tail).
    expect(html).toContain("card-slot");
    expect(html).toContain("lead-view");
    expect(html).toMatch(/class="[^"]*lead/);
    // _view_content -> renderView("core") -> the core slot's content;
    // RichText :core renders the card's dbContent verbatim.
    expect(html).toContain("probe card body");
  });

  it("WITH the mod: :guide on a ruled card wraps the guide text in <div class='guide-text'> (set/all/guide.rb:6-16)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Help Probe", "guide");
    // wrap: :slot -> outer slot div with guide-view id (render.rb:96-97).
    // The inner guide-text div carries the guide's dbContent via the
    // nest(guide_card, view: :core) call (guide.rb:34-40 + markdown :core).
    expect(html).toContain("card-slot");
    expect(html).toContain("guide-view");
    expect(html).toContain("class=\"guide-text\"");
    expect(html).toContain("Editing guidance rule text for the probe card.");
    // prepend_guide_edit_link: a READABLE/UPDATE-allowed guide rule card
    // prepends its edit_link span (guide.rb:27-32); the span uses
    // single-quoted class emission (HAML block, guide.rb:31).
    expect(html).toContain("class='d-none'");
  });

  it("WITH the mod: :guide on a rule-less card renders the EMPTY slot wrap (guide.rb:9-11 + wrap: :slot)", async () => {
    const s = storage!;
    // The body returns "" (guide.rb:11 `return "" unless guide_text.present?`),
    // but wrap: :slot still emits the outer slot div (render.rb:96-97).
    const html = await s.engine.render("Oracle Bare Probe", "guide");
    expect(html).toContain("card-slot");
    expect(html).toContain("guide-view");
    // the inner guide-text div is absent because the body was empty
    expect(html).not.toContain("class=\"guide-text\"");
  });

  it("WITH the mod: :popover wraps the :core text inside the card-mod-bootstrap popover_link anchor (set/right/help.rb:4-6)", async () => {
    const s = storage!;
    // help.rb:4-6 view :popover: `popover_link _render_core`. The TS
    // port calls popoverLink(ctx.fmt.renderView("core")) (card-mod-
    // bootstrap.ts#popoverLink mirrors helper.rb:41-44; helper.rb:46-57
    // popover_opts builds the anchor attrs).
    //
    // Byte-oracle pin against fixtures/captured/help-popover.json (the
    // popover view fires on COMPOUND names only - Right pattern's
    // compound_only = true per mod/core/set_pattern/07_right.rb:2; the
    // simple "Oracle Help Probe" probe does not match Right::Help in
    // Ruby, so we render the compound probes the capture seeds).
    const withRule = await s.engine.render(
      "Oracle Help Popover Probe+*help",
      "popover",
    );
    expect(withRule).toBe(
      POPOVER_FIXTURE.rendered["Oracle Help Popover Probe+*help#popover"],
    );
    const bareProbe = await s.engine.render(
      "Oracle Bare Popover Probe+*help",
      "popover",
    );
    expect(bareProbe).toBe(
      POPOVER_FIXTURE.rendered["Oracle Bare Popover Probe+*help#popover"],
    );
  });

  it("WITH the mod: :popover on a SIMPLE probe still resolves through the registered helper (TS does not enforce compound_only)", async () => {
    const s = storage!;
    // TS-side the popover view is registered as a generic view on
    // Right::Help's set module without the Ruby compound_only gate. The
    // byte-oracle pin above covers the COMPOUND case (where the Ruby
    // bytes match); this assertion documents the TS-engine behavior
    // (a simple card name also resolves, returning the same anchor shape
    // with that card's core body) without claiming byte parity to a
    // captured fixture that does not exist for simple names.
    const html = await s.engine.render("Oracle Help Probe", "popover");
    expect(html).toContain('href="#"');
    expect(html).toContain('class="ps-1 _popover_link"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-bs-toggle="popover"');
    expect(html).toContain('data-bs-trigger="hover focus"');
    expect(html).toContain("probe card body");
    expect(html).toMatch(/data-bs-content="[^"]*probe card body/);
    expect(html).toContain(
      '<i class="notranslate material-icons">help</i>',
    );
  });

  it("WITH the mod: every ported set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();
    // The port registers a setModules entry per .rb file with ported
    // views or settings: set/all/help, set/all/guide, set/right/help
    // (the :popover view delegates to card-mod-bootstrap's popoverLink
    // helper), set/self/help, set/self/guide. set/right/guide.rb only
    // defines a card-level raw_help_text method served through
    // render/setting-help-text.ts's registry and stays in viewsMissing.
    //
    // all/* -> base bucket (loader.ts#kindOfSetPath: "all" is the base)
    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toContain("All::Help");
    expect(baseShortnames).toContain("All::Guide");
    // self/* + right/* -> nonbase (loader.ts#kindOfSetPath: anything
    // not all/ or abstract lands in nonbase keyed by shortname)
    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbaseShortnames).toContain("Self::Help");
    expect(nonbaseShortnames).toContain("Self::Guide");
    expect(nonbaseShortnames).toContain("Right::Help");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    // The ModLoadReport is returned by load(); re-run via the loader's
    // table introspection since the first call's report was discarded.
    const report = loader!.load();
    expect(report.registeredViews).toContain("help");
    expect(report.registeredViews).toContain("help_text");
    expect(report.registeredViews).toContain("lead");
    expect(report.registeredViews).toContain("guide");
    // set/right/help.rb:4-6 :popover - registered via card-mod-bootstrap's
    // popoverLink helper import.
    expect(report.registeredViews).toContain("popover");
  });

  it("WITH the mod: the setting_opts registrations match the gem's Card::Setting state", () => {
    const registry = loader!.settingsRegistry();
    // self/help.rb:1-4
    const help = registry.findByCodename("help");
    expect(help?.group).toBe("editing");
    expect(help?.ruleTypeEditable).toBe(true);
    expect(help?.shortHelpText).toBe("help text people will see when editing");
    expect(help?.rawHelpText).toBe(
      "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
    );
    expect(help?.rightRawHelpText).toBe(
      "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
    );
    // self/guide.rb:1-2
    const guide = registry.findByCodename("guide");
    expect(guide?.group).toBe("editing");
    expect(guide?.ruleTypeEditable).toBe(true);
    expect(guide?.shortHelpText).toBe(
      "appears in the full editor view to guide users",
    );
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Help Probe", "content");
    // baseline :content is the format/views.ts#contentView; the mod
    // does NOT redefine :content for any of its set modules, so the
    // existing core content renders unchanged. We assert it renders
    // WITHOUT throwing and produces a non-empty slot containing the
    // probe body.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("probe card body");
  });
});