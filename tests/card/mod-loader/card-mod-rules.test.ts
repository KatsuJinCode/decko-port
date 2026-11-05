// The card-mod-rules mod loader test: the mod loaded through the loader
// registers its five html views (set_label, input, grouped_list, rule_help,
// overlay_title), records all 31 gem-tree set modules in the baskets, and
// warms the rule cache so the rule_help dispatch resolves its rule cards
// synchronously. Each view proves its Ruby-source semantics against a probe
// deck (no captured oracle exists for this mod - fixtures/captured has no
// rules file - so the bytes are pinned against the Ruby sources cited in
// card-mod-rules.ts, the same A/B shape the help mod's test established).
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: rendering the view raises the unsupported-view error
//     (render.rb#view_method - the view does not exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; out-of-set
//     cards raise the same error (the set guard Ruby's set-module inclusion
//     gives the view); the baskets record the full gem tree.
//
// Probe cards:
//   - codename cards: *all(10, Set-typed), *self(11), *help(12),
//     *set(13, codename "set"), *setting(14), *type(15, codename "type"),
//     *create(16), *default(17) - the codename registry + the typeCode
//     enrichment read these.
//   - "RichText+*self" (23, Set-typed) - the set-card probe for :set_label
//     and :input.
//   - "RichText+*self+*help" (24) - a THREE-part rule card (set
//     "RichText+*self", setting *help): the live engine's rule? predicate
//     (render.ts cardIsRule) classifies 3-part rule names, matching the
//     corpus shapes the render layer pinned; the help rule card
//     "*all+*help" (22) resolves through the *all candidate of the
//     rule_names walk (lib/card/rule/all.rb:9-15).
//   - "Cardtype" (30) - the Self::Cardtype probe for :grouped_list.
//   - RichText(2)/PlainText(3)/Number(4) - type cards the grouped_list
//     listing nests; the GROUP names without cards nest as unknown cards
//     ("" - format/error.rb:23), which the Template-section assertion pins.
//
// Exported (unregistered) view bodies - ruleCoreView, ruleOneLineContent-
// View, ruleRawOneLineContentView, setOneLineContentView, and the
// registered ruleHelpView's two-set dispatch - are byte-pinned through the
// stub-fmt harness (the card-mod-permissions test's pattern), because the
// global view table would clobber the render layer's / card-mod-content's
// registrations of those names (docs/mod-loader-port-notes.md "View
// dispatch is global, not set-scoped"). The A/B test additionally pins
// that one_line_content is NOT live-registered: with the mod loaded it
// still raises.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError, type RenderFormat, type Voo, type ViewContext, type ViewFn } from "../../../src/card/render/format.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import {
  default as cardModRules,
  ruleCoreView,
  ruleOneLineContentView,
  ruleRawOneLineContentView,
  setOneLineContentView,
} from "../../../src/card/mod-loader/mods/card-mod-rules.js";
import { DeckoName } from "../../../src/card/name.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  // codename cards (the codename registry reads cards.codename; their type
  // ids drive the typeCode enrichment: Set-typed vs Setting-typed).
  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 3, name: "PlainText" });
  await seedCard(s, { id: 4, name: "Number" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 12, name: "*help", codename: "help", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });
  await seedCard(s, { id: 15, name: "*type", codename: "type", typeId: 13 });
  await seedCard(s, { id: 16, name: "*create", codename: "create", typeId: 14 });
  await seedCard(s, { id: 17, name: "*default", codename: "default", typeId: 14 });

  // set card "RichText+*self" (junction: type card + *self pattern card)
  await seedCard(s, { id: 23, leftId: 2, rightId: 11, typeId: 13 });

  // the help rule card "*all+*help" - the *all candidate the rule_names
  // walk resolves for rule cards' help (help.rb:1-4 -> all.rb:9-15)
  await seedCard(s, {
    id: 22,
    leftId: 10,
    rightId: 12,
    typeId: 14,
    dbContent: "Broad help text for this setting.",
  });

  // the THREE-part rule card probe (set "RichText+*self" + setting *help)
  await seedCard(s, {
    id: 24,
    leftId: 23,
    rightId: 12,
    typeId: 14,
    dbContent: "nonsense rule content",
  });

  // the Self::Cardtype probe (the card NAMED "Cardtype")
  await seedCard(s, { id: 30, name: "Cardtype", codename: "cardtype" });

  // an out-of-set probe (no set membership the mod's views recognize)
  await seedCard(s, { id: 31, name: "Oracle Plain Probe", dbContent: "plain body" });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-rules through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("RichText+*self", "set_label")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("RichText+*self", "input")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Cardtype", "grouped_list")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("RichText+*self+*help", "rule_help")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("RichText+*self+*help", "overlay_title")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :set_label renders the pattern label for the set card (set/type/set/html_views.rb:13-15)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModRules }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    // card.label (set/type/set.rb:38-41) for the *self set of "RichText":
    // the Self pattern's label (set_pattern/09_self.rb) - The card "RichText".
    // wrap_with passes content through the content_tag BLOCK, so the quotes
    // are not HTML-escaped (card-mod-format set/all/html/wrap.rb:128-136).
    const html = await s.engine.render("RichText+*self", "set_label");
    expect(html).toBe(`<strong class="set-label">The card "RichText"</strong>`);
  });

  it("WITH the mod: :input renders the literal message on set cards (set/type/set/html_views.rb:17-19)", async () => {
    const s = storage!;
    const html = await s.engine.render("RichText+*self", "input");
    expect(html).toBe("Cannot currently edit Sets");
  });

  it("WITH the mod: the set guards raise out-of-set (render.rb#view_method for views the card's set does not define)", async () => {
    const s = storage!;
    await expect(s.engine.render("Oracle Plain Probe", "set_label")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Plain Probe", "input")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Plain Probe", "grouped_list")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Plain Probe", "rule_help")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("RichText+*self", "overlay_title")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :grouped_list renders every non-empty GROUP in order, skipping Custom (set/self/cardtype.rb:2-9)", async () => {
    const s = storage!;
    const html = await s.engine.render("Cardtype", "grouped_list");
    // one h5 per group, GROUP declaration order (cardtype_groups.rb:2-12),
    // Custom skipped by `next if type_list.empty?` (cardtype.rb:5)
    const order = ["Text", "Data", "Upload", "Organize", "Template", "Admin", "Styling", "Scripting"].map(
      (group) => html.indexOf(`<h5>${group}</h5>`),
    );
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("<h5>Custom</h5>");
    // each h5 pairs with a p; the listing nests the type cards with the
    // default nest view (titled) - the seeded RichText card's title lands
    // inside the Text section, between the Text and Data headings
    // (card-mod-collection set/all/item.rb:164-176 listing_list, no wrap).
    const textAt = html.indexOf("<h5>Text</h5>");
    const richTextAt = html.indexOf("RichText");
    const dataAt = html.indexOf("<h5>Data</h5>");
    expect(textAt).toBeGreaterThan(-1);
    expect(richTextAt).toBeGreaterThan(textAt);
    expect(dataAt).toBeGreaterThan(richTextAt);
    // every GROUP name without a card nests as an unknown card -> "" bytes
    // (format/error.rb:23); the Template section's three type cards
    // ("Notification template", "Email template", "Twitter template") are
    // unseeded, so their names appear nowhere.
    expect(html).not.toContain("Notification template");
    expect(html).not.toContain("Twitter template");
  });

  it("WITH the mod: :rule_help on a rule card renders the rule-instruction alert over the *all help rule (set/rule/editor.rb:24-28)", async () => {
    const s = storage!;
    // the rule-based help chain resolves the card's *help rule card through
    // the pattern-precedence walk (help.rb:1-4) - the seeded "*all+*help"
    // (id 22) is the *all candidate, warmed into the render map by
    // prepareRuleCache (the Rule::Cache analog, lib/card/rule/cache.rb:10-27)
    const html = await s.engine.render("RichText+*self+*help", "rule_help");
    expect(html).toBe(
      `<div class="alert alert-info rule-instruction">Broad help text for this setting.</div>`,
    );
  });

  it("WITH the mod: :rule_help on a SETTING card nests the *all rule card and renders its rule_help (set/type/setting.rb:59-61)", async () => {
    const s = storage!;
    // "*create" is Setting-typed and not a rule; the dispatch nests
    // "*all+*create". That rule card is NOT seeded in this deck, so the
    // nest is an unknown-card nest whose :rule_help substitutes to
    // :unknown ("" - format/error.rb:23).
    const html = await s.engine.render("*create", "rule_help");
    expect(html).toBe("");
  });

  it("WITH the mod: :overlay_title renders the edit_rule_title h5 with the star-stripped setting title (board_rules_editor.rb:13-15 + editor.rb:64-69, 85-87)", async () => {
    const s = storage!;
    // setting_title = card.name.tag.tr("*", "") -> "RichText+*self+*help"
    // tag "*help" -> "help"
    const html = await s.engine.render("RichText+*self+*help", "overlay_title");
    expect(html).toBe(`<h5 class="title fw-bold">help</h5>`);
  });

  it("WITH the mod: :one_line_content is NOT live-registered (the exported bodies await the set-scoped dispatch pass)", async () => {
    const s = storage!;
    // card-mod-rules.ts exports ruleOneLineContentView/setOneLineContentView
    // instead of registering: the global table would clobber card-mod-
    // content's right/* registrations of the same name.
    await expect(
      s.engine.render("RichText+*self+*help", "one_line_content"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: the load report lists the ported views and NO settings (the gem defines no setting_opts)", () => {
    const report = loader!.load();
    expect(report.modNames).toEqual(["rules"]);
    for (const view of ["set_label", "input", "grouped_list", "rule_help", "overlay_title"]) {
      expect(report.registeredViews).toContain(view);
    }
    expect(report.registeredSettings).toEqual([]);
    // rule_help carries the editor.rb:24 config (view_opts.rb VIEW_SETTINGS)
    const config = loader!.viewConfigFor("rule_help");
    expect(config?.unknown).toBe(true);
    expect(config?.perms).toBe("none");
    expect(config?.cache).toBe("never");
  });

  it("WITH the mod: every set module from the gem tree is in the basket (31 files; rule_set_radio.rb is `#! no set module`)", () => {
    const basket = loader!.setModules();
    // all/* -> base bucket (loader.ts#kindOfSetPath)
    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toEqual(
      expect.arrayContaining(["All::CardtypeGroups", "All::RelatedSets", "All::SetSelect"]),
    );
    // abstract/* -> abstract bucket
    const abstractShortnames = basket.abstract.map((m) => m.shortname);
    expect(abstractShortnames).toEqual(["Abstract::VirtualSet"]);
    // the rest -> nonbase, keyed by shortname
    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbaseShortnames).toEqual(
      expect.arrayContaining([
        "Right::Right",
        "Right::Self",
        "Right::Type",
        "Right::TypePlusRight",
        "Rstar::RuleUser",
        "Rule::Rules",
        "Rule::HtmlViews",
        "Rule::BarView",
        "Rule::BoardRulesEditor",
        "Rule::Editor",
        "Rule::QuickEditor",
        "Rule::RuleForm",
        "Rule::RuleForm::Buttons",
        "Rule::RuleForm::SetSelection",
        "Self::Cardtype",
        "Self::RecentSettings",
        "Type::Cardtype",
        "Type::Set",
        "Type::Set::HtmlViews",
        "Type::Set::HtmlViews::FilteredRuleLists",
        "Type::Set::HtmlViews::RuleLists",
        "Type::Set::HtmlViews::SettingFilter",
        "Type::Set::HtmlViews::Template",
        "Type::Set::SettingCategories",
        "Type::Setting",
        "TypePlusRight::Set::Setting",
        "TypePlusRight::Set::Structure",
      ]),
    );
    expect(nonbaseShortnames).not.toContain("Rule::RuleForm::RuleSetRadio");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Plain Probe", "content");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("plain body");
  });
});

// ---------------------------------------------------------------------------
// stub harness for the exported / dispatched view bodies (the
// card-mod-permissions test's pattern): a stub fmt whose renderView
// dispatches through the manifest's registered views, with a name-keyed
// fetchRenderCard map and an explicit isRule flag per card. This pins the
// Ruby dispatch semantics the live engine's 3-part rule? predicate cannot
// reach (2-part rule cards like "*all+*create").
// ---------------------------------------------------------------------------

interface CardLike {
  name: DeckoName;
  key: string;
  dbContent: string;
  typeCode: string | undefined;
  typeName: string | undefined;
  typeId: number | undefined;
  id: number | undefined;
  isRule: boolean;
}

function cardLike(
  name: string,
  opts: {
    dbContent?: string;
    typeCode?: string;
    typeName?: string;
    typeId?: number;
    id?: number;
    isRule?: boolean;
  } = {},
): CardLike {
  const deckoName = DeckoName.parse(name);
  return {
    name: deckoName,
    key: deckoName.key,
    dbContent: opts.dbContent ?? "",
    typeCode: opts.typeCode,
    typeName: opts.typeName,
    typeId: opts.typeId,
    id: opts.id,
    isRule: opts.isRule ?? false,
  };
}

class StubVoo {
  readonly requestedView: string;
  readonly opts: Record<string, unknown>;
  constructor(requestedView: string, opts: Record<string, unknown> = {}) {
    this.requestedView = requestedView;
    this.opts = opts;
  }
}

class StubFmt {
  readonly card: CardLike;
  readonly engine: {
    fetchRenderCard(name: string): CardLike | undefined;
    isDenied(card: unknown): boolean;
    cardIsRule(card: CardLike): boolean;
  };

  constructor(
    card: CardLike,
    private readonly deck: Record<string, CardLike> = {},
  ) {
    this.card = card;
    this.engine = {
      fetchRenderCard: (name: string) => this.deck[name],
      isDenied: () => false,
      cardIsRule: (c: CardLike) => c.isRule,
    };
  }

  renderView(view: string, _opts: Record<string, unknown> = {}): string {
    const fn = resolveViewFn(view);
    if (fn !== undefined) {
      return fn({
        fmt: this as unknown as RenderFormat,
        voo: new StubVoo(view) as unknown as Voo,
      } as unknown as ViewContext);
    }
    return `[rendered:${view}]`;
  }

  /** collection.rb#nest_item shape for the setting branch: the nested view
   *  runs on a subformat carrying the TARGET card. */
  nestRecord(target: CardLike, view: string): string {
    const sub = new StubFmt(target, this.deck);
    return sub.renderView(view);
  }

  renderRaw(): string {
    return this.card.dbContent;
  }
}

/** Every viewFn the manifest registers, keyed by view name (the exported
 *  :core override is handed to assertions directly). */
function resolveViewFn(view: string): ViewFn | undefined {
  for (const module of cardModRules.setModules ?? []) {
    for (const block of Object.values(module.formats ?? {})) {
      for (const viewDef of block.views ?? []) {
        if (viewDef.view === view) return viewDef.viewFn;
      }
    }
  }
  return undefined;
}

function makeCtx(fmt: StubFmt, view: string): ViewContext {
  return {
    fmt: fmt as unknown as RenderFormat,
    voo: new StubVoo(view) as unknown as Voo,
  } as unknown as ViewContext;
}

describe("card-mod-rules exported view bodies (stub harness)", () => {
  const deck: Record<string, CardLike> = {
    "*all+*create": cardLike("*all+*create", {
      id: 41,
      typeCode: "setting",
      typeName: "Setting",
      typeId: 14,
      isRule: true,
      dbContent: "",
    }),
    // the ONLY *help rule card in the stub deck: every higher-precedence
    // candidate of the rule_names walk (self/rule/rstar/star/type/all_plus)
    // misses, so the *all candidate resolves - the same shape the live deck
    // pins.
    "*all+*help": cardLike("*all+*help", {
      id: 42,
      typeCode: "setting",
      typeName: "Setting",
      typeId: 14,
      dbContent: "Broad help text for this setting.",
    }),
  };

  it("ruleCoreView: a Search-type rule card renders RAW (set/rule/html_views.rb:7-8)", () => {
    const searchRule = new StubFmt(
      cardLike("*all+*search+*create", {
        id: 45,
        typeCode: "search_type",
        typeName: "Search",
        typeId: 20,
        isRule: true,
        dbContent: '{"keyword":"_left"}',
      }),
      deck,
    );
    let baseCalled = false;
    const baseCore: ViewFn = () => {
      baseCalled = true;
      return "[base-core]";
    };
    const out = ruleCoreView(makeCtx(searchRule, "core"), baseCore);
    expect(out).toBe('{"keyword":"_left"}');
    expect(baseCalled).toBe(false);
  });

  it("ruleCoreView: a non-search rule card delegates to the displaced base :core (super(), html_views.rb:10)", () => {
    const plainRule = new StubFmt(deck["*all+*create"]!, deck);
    const out = ruleCoreView(makeCtx(plainRule, "core"), () => "[base-core]");
    expect(out).toBe("[base-core]");
  });

  it("ruleCoreView: out-of-set cards raise (the rule-set guard)", () => {
    const plain = new StubFmt(
      cardLike("Oracle Plain Probe", { id: 31, typeName: "RichText", typeId: 2 }),
      deck,
    );
    expect(() => ruleCoreView(makeCtx(plain, "core"), () => "")).toThrow(
      UnsupportedViewError,
    );
  });

  it("ruleOneLineContentView: right::*default rules render 'type : raw' in the muted one-line div (bar_view.rb:15-22 + card-mod-content right/default.rb:3-7)", () => {
    const defaultRule = new StubFmt(
      cardLike("*all+*default", {
        id: 46,
        typeCode: "setting",
        typeName: "RichText",
        typeId: 2,
        isRule: true,
        dbContent: "Page",
      }),
      deck,
    );
    const out = ruleOneLineContentView(makeCtx(defaultRule, "one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">RichText : Page</div>`);
  });

  it("ruleOneLineContentView: right::*structure rules render 'type : raw' (bar_view.rb:15-22 + card-mod-content right/structure.rb:14-16)", () => {
    const structureRule = new StubFmt(
      cardLike("*all+*structure", {
        id: 47,
        typeCode: "setting",
        typeName: "RichText",
        typeId: 2,
        isRule: true,
        dbContent: "{\"type\":\"RichText\"}",
      }),
      deck,
    );
    const out = ruleOneLineContentView(makeCtx(structureRule, "one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">RichText : {"type":"RichText"}</div>`);
  });

  it("ruleOneLineContentView: other rules truncate the core at 60 chars with the Rails omission (bar_view.rb:19-21 bare call -> card-mod-format set/all/content.rb:47-49, ONE_LINE_CHARACTER_LIMIT = 60 content.rb:1)", () => {
    const long = "a".repeat(70);
    const plainRule = new StubFmt(
      cardLike("*all+*create", {
        id: 41,
        typeCode: "setting",
        typeName: "Setting",
        typeId: 14,
        isRule: true,
        dbContent: long,
      }),
      deck,
    );
    const out = ruleOneLineContentView(makeCtx(plainRule, "one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">${"a".repeat(60)}...</div>`);
  });

  it("ruleOneLineContentView: content of exactly 60 chars is NOT truncated (content.rb:48 truncate only when longer)", () => {
    const exact = "b".repeat(60);
    const plainRule = new StubFmt(
      cardLike("*all+*create", {
        id: 41,
        typeCode: "setting",
        typeName: "Setting",
        typeId: 14,
        isRule: true,
        dbContent: exact,
      }),
      deck,
    );
    const out = ruleOneLineContentView(makeCtx(plainRule, "one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">${exact}</div>`);
  });

  it("ruleOneLineContentView: right::*default whitespace-only content renders the <em>empty</em> marker (right/default.rb:5 raw.present? - Rails blank? semantics)", () => {
    const defaultRule = new StubFmt(
      cardLike("*all+*default", {
        id: 46,
        typeCode: "setting",
        typeName: "RichText",
        typeId: 2,
        isRule: true,
        dbContent: "  \n ",
      }),
      deck,
    );
    const out = ruleOneLineContentView(makeCtx(defaultRule, "one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">RichText : <em>empty</em></div>`);
  });

  it("ruleRawOneLineContentView: renders the raw content truncated at 60 in the muted one-line div (bar_view.rb:24-29 + card-mod-format set/all/content.rb:43-45)", () => {
    const long = "c".repeat(70);
    const plainRule = new StubFmt(
      cardLike("*all+*create", {
        id: 41,
        typeCode: "setting",
        typeName: "Setting",
        typeId: 14,
        isRule: true,
        dbContent: long,
      }),
      deck,
    );
    const out = ruleRawOneLineContentView(makeCtx(plainRule, "raw_one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">${"c".repeat(60)}...</div>`);
  });

  it("ruleRawOneLineContentView: NO right-part dispatch - a right::*default rule card still takes the content.rb:43-45 raw body (no Right-pattern module defines :raw_one_line_content)", () => {
    const defaultRule = new StubFmt(
      cardLike("*all+*default", {
        id: 46,
        typeCode: "setting",
        typeName: "RichText",
        typeId: 2,
        isRule: true,
        dbContent: "Page",
      }),
      deck,
    );
    const out = ruleRawOneLineContentView(makeCtx(defaultRule, "raw_one_line_content"));
    expect(out).toBe(`<div class="text-muted one-line">Page</div>`);
  });

  it("ruleRawOneLineContentView: an unpersisted rule card takes the render_mini_unknown branch (bar_view.rb:26; error.rb:15-17)", () => {
    const newRule = new StubFmt(
      cardLike("*all+*create", {
        typeCode: "setting",
        typeName: "Setting",
        typeId: 14,
        isRule: true,
      }),
      deck,
    );
    expect(ruleRawOneLineContentView(makeCtx(newRule, "raw_one_line_content"))).toBe("");
  });

  it("ruleRawOneLineContentView: out-of-set cards raise (the rule-set guard)", () => {
    const plain = new StubFmt(
      cardLike("Oracle Plain Probe", { id: 31, typeName: "RichText", typeId: 2 }),
      deck,
    );
    expect(() =>
      ruleRawOneLineContentView(makeCtx(plain, "raw_one_line_content")),
    ).toThrow(UnsupportedViewError);
  });

  it("ruleOneLineContentView: an unpersisted rule card takes the render_mini_unknown branch (bar_view.rb:17 - the prototype walk is engine state)", () => {
    const newRule = new StubFmt(
      cardLike("*all+*create", {
        typeCode: "setting",
        typeName: "Setting",
        typeId: 14,
        isRule: true,
      }),
      deck,
    );
    expect(ruleOneLineContentView(makeCtx(newRule, "one_line_content"))).toBe("");
  });

  it("setOneLineContentView: set cards render the bare empty string (set/type/set/html_views.rb:21-23)", () => {
    const setCard = new StubFmt(
      cardLike("RichText+*self", { id: 23, typeCode: "set", typeName: "Set", typeId: 13 }),
      deck,
    );
    expect(setOneLineContentView(makeCtx(setCard, "one_line_content"))).toBe("");
    expect(() =>
      setOneLineContentView(
        makeCtx(
          new StubFmt(cardLike("Oracle Plain Probe", { id: 31 }), deck),
          "one_line_content",
        ),
      ),
    ).toThrow(UnsupportedViewError);
  });

  it("ruleHelpView: the registered viewFn carries Ruby's two-set dispatch - rule card -> alert (editor.rb:24-28)", () => {
    const ruleHelp = resolveViewFn("rule_help");
    expect(ruleHelp).toBeDefined();
    // the *help walk's first EXISTING candidate in pattern precedence is
    // "*all+*help" (the self/rule/type candidates miss in this deck)
    const ruleCard = new StubFmt(deck["*all+*create"]!, deck);
    const out = ruleHelp!(makeCtx(ruleCard, "rule_help"));
    expect(out).toBe(
      `<div class="alert alert-info rule-instruction">Broad help text for this setting.</div>`,
    );
  });

  it("ruleHelpView: Setting-type card -> nest *all+<setting>, render ITS rule_help (set/type/setting.rb:59-61)", () => {
    const ruleHelp = resolveViewFn("rule_help");
    const settingCard = new StubFmt(
      cardLike("*create", { id: 16, typeCode: "setting", typeName: "Setting", typeId: 14 }),
      deck,
    );
    const out = ruleHelp!(makeCtx(settingCard, "rule_help"));
    // the nested "*all+*create" rule card's own :rule_help is the alert
    expect(out).toBe(
      `<div class="alert alert-info rule-instruction">Broad help text for this setting.</div>`,
    );
  });

  it("ruleHelpView: Setting-type card with NO *all rule -> the unknown-card substitution bytes (format/error.rb:23)", () => {
    const ruleHelp = resolveViewFn("rule_help");
    const settingCard = new StubFmt(
      cardLike("*default", { id: 17, typeCode: "setting", typeName: "Setting", typeId: 14 }),
      deck,
    );
    expect(ruleHelp!(makeCtx(settingCard, "rule_help"))).toBe("");
  });
});
