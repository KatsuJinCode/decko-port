

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

  await seedCard(s, { id: 23, leftId: 2, rightId: 11, typeId: 13 });

  await seedCard(s, {
    id: 22,
    leftId: 10,
    rightId: 12,
    typeId: 14,
    dbContent: "Broad help text for this setting.",
  });

  await seedCard(s, {
    id: 24,
    leftId: 23,
    rightId: 12,
    typeId: 14,
    dbContent: "nonsense rule content",
  });

  await seedCard(s, { id: 30, name: "Cardtype", codename: "cardtype" });

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

    const order = ["Text", "Data", "Upload", "Organize", "Template", "Admin", "Styling", "Scripting"].map(
      (group) => html.indexOf(`<h5>${group}</h5>`),
    );
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("<h5>Custom</h5>");

    const textAt = html.indexOf("<h5>Text</h5>");
    const richTextAt = html.indexOf("RichText");
    const dataAt = html.indexOf("<h5>Data</h5>");
    expect(textAt).toBeGreaterThan(-1);
    expect(richTextAt).toBeGreaterThan(textAt);
    expect(dataAt).toBeGreaterThan(richTextAt);

    expect(html).not.toContain("Notification template");
    expect(html).not.toContain("Twitter template");
  });

  it("WITH the mod: :rule_help on a rule card renders the rule-instruction alert over the *all help rule (set/rule/editor.rb:24-28)", async () => {
    const s = storage!;

    const html = await s.engine.render("RichText+*self+*help", "rule_help");
    expect(html).toBe(
      `<div class="alert alert-info rule-instruction">Broad help text for this setting.</div>`,
    );
  });

  it("WITH the mod: :rule_help on a SETTING card nests the *all rule card and renders its rule_help (set/type/setting.rb:59-61)", async () => {
    const s = storage!;

    const html = await s.engine.render("*create", "rule_help");
    expect(html).toBe("");
  });

  it("WITH the mod: :overlay_title renders the edit_rule_title h5 with the star-stripped setting title (board_rules_editor.rb:13-15 + editor.rb:64-69, 85-87)", async () => {
    const s = storage!;

    const html = await s.engine.render("RichText+*self+*help", "overlay_title");
    expect(html).toBe(`<h5 class="title fw-bold">help</h5>`);
  });

  it("WITH the mod: :one_line_content is NOT live-registered (the exported bodies await the set-scoped dispatch pass)", async () => {
    const s = storage!;

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

    const config = loader!.viewConfigFor("rule_help");
    expect(config?.unknown).toBe(true);
    expect(config?.perms).toBe("none");
    expect(config?.cache).toBe("never");
  });

  it("WITH the mod: every set module from the gem tree is in the basket (31 files; rule_set_radio.rb is `#! no set module`)", () => {
    const basket = loader!.setModules();

    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toEqual(
      expect.arrayContaining(["All::CardtypeGroups", "All::RelatedSets", "All::SetSelect"]),
    );

    const abstractShortnames = basket.abstract.map((m) => m.shortname);
    expect(abstractShortnames).toEqual(["Abstract::VirtualSet"]);

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

  nestRecord(target: CardLike, view: string): string {
    const sub = new StubFmt(target, this.deck);
    return sub.renderView(view);
  }

  renderRaw(): string {
    return this.card.dbContent;
  }
}

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
