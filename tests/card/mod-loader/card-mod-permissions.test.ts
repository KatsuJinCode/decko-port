// The card-mod-permissions port: structural + behavioral tests for the
// manifest registrations, the setting_opts table, the boot-time role warm,
// and the three headlessly-portable html view bodies the T6 verdict lists
// as missing (tools/compat-report/mod-compat-report.json
// #card-mod-permissions-0.20.0 classification.metrics.htmlViewsMissingNames:
// ["input", "one_line_content", "pointer_core"]).
//
// Tested (every assertion cites the Ruby source it pins):
//   1. manifest structure: the 11 set files register under the gem tree's
//      paths; the abstract/permission module carries exactly the three
//      missing views; the mod's :core override is NOT registered (global
//      view-table clobber - see the port file header) but is exported.
//   2. loader registration: the basket (Abstract::Permission abstract,
//      All::Permissions base, the right/self modules nonbase), the
//      settings registry's permission group (create/read/update/delete at
//      positions 1-4, set/self/{create,read,update,delete}.rb), and
//      reset()'s full restore.
//   3. the set guard: every registered view raises UnsupportedViewError
//      outside the four permission-right sets (the include_set
//      Abstract::Permission applicability, right/*.rb:1).
//   4. :pointer_core bytes (abstract/permission.rb:10-12): the
//      div.pointer-list wrapper, pointer-item item-bar rows joined "\n",
//      items nested through fmt.nest.
//   5. :one_line_content (22-24): render_core items {view: :link} - the
//      link view propagates through core -> pointer_core into the item
//      nests and the wrap_item classes.
//   6. the exported :core override (14-20): the "_left" inherit span
//      (bare + self-set-context forms, permission.rb:98-122), the list
//      branch's pointer-core dispatch.
//   7. :input (26-43): the hidden content field (card-mod-format
//      content.rb:57-59), the inheritance checkbox by trunk-set
//      inheritability (permission.rb:70-96 + card-mod-rules
//      set/type/set.rb:21-23), the Groups/Individuals sections with the
//      name-consumption semantics of permission.rb:49
//      (item_names.delete), the list_input rows (card-mod-list
//      html_views.rb:48-55 + list_input.haml).
//   8. prepareEngine: the role warm (permission.rb:64-68 group_options)
//      fills the sorted registry + the cards_with_account url key.
//
// NOT tested (honest remainder, mirrors the port file header):
//   - the event BODIES (set_read_rule, update_read_rule, check_permissions,
//     cascade_read_rule, update_rule_cache, expire_related, set_field_read_rules):
//     no TS event bus exists; the read-permission half of those semantics
//     is already engine-side (format.ts:637-648 isDenied/taskAllowed,
//     citing permissions.rb:142-157). The DECLARATIONS land on
//     ModEventRegistry (tests 2b); the bodies are no-op stubs.
//   - live-deck render integration (the help-mod A/B pattern): this gem has
//     no captured oracle fixture, so the bar here is the api_key structural
//     pattern - view bodies asserted against the byte shapes the Ruby
//     sources pin, with the fmt/engine surface stubbed.

import { describe, it, expect, afterEach } from "vitest";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModPermissions, {
  isPermissionRuleCard,
  permissionCoreView,
  preparePermissionRoles,
  resetPermissionRolesForTests,
} from "../../../src/card/mod-loader/mods/card-mod-permissions.js";
import { UnsupportedViewError, type RenderFormat, type Voo } from "../../../src/card/render/format.js";
import type { DeckoModManifest, ModEngineHost } from "../../../src/card/mod-loader/mod-manifest.js";
import type { ViewContext, ViewFn } from "../../../src/card/render/format.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import { DeckoName } from "../../../src/card/name.js";

// ---------------------------------------------------------------------------
// shared harness: a stub fmt whose renderView dispatches through the
// manifest's registered views (+ the mod's exported :core body, which is
// what a permission card's "core" resolves to in Ruby), with a name-keyed
// fetchRenderCard map. The nest surface returns markers so the assertions
// pin the MOD's bytes (wrapper, wrap_item classes, join, item view) rather
// than the engine's slot internals.
// ---------------------------------------------------------------------------

interface CardLike {
  name: DeckoName;
  key: string;
  dbContent: string;
  typeCode: string | undefined;
  typeName: string | undefined;
  typeId: number | undefined;
  id: number | undefined;
}

function cardLike(
  name: string,
  opts: {
    dbContent?: string;
    typeCode?: string;
    typeName?: string;
    typeId?: number;
    id?: number;
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
  };
  readonly renderCalls: { view: string; opts: Record<string, unknown> }[] = [];

  constructor(
    card: CardLike,
    private readonly deck: Record<string, CardLike> = {},
  ) {
    this.card = card;
    this.engine = {
      fetchRenderCard: (name: string) => this.deck[name],
    };
  }

  /** Dispatch: the mod's registered views + the exported :core body (the
   *  Ruby resolution on permission cards) + the :link view shape the
   *  engine's linkView emits (views.ts:584-596) for completeness. */
  renderView(view: string, opts: Record<string, unknown> = {}): string {
    this.renderCalls.push({ view, opts });
    const fn = resolveViewFn(view);
    if (fn !== undefined) return this.runView(fn, view, opts);
    if (view === "link") {
      return `<a class="known-card" href="/${this.card.name.urlKey}">${this.card.name.s}</a>`;
    }
    return `[rendered:${view}]`;
  }

  runView(fn: ViewFn, view: string, opts: Record<string, unknown>): string {
    return fn({
      fmt: this as unknown as RenderFormat,
      voo: new StubVoo(view, opts) as unknown as Voo,
    } as unknown as ViewContext);
  }

  nest(nest: { name: string; syntax: string; options: { view: string }; comment: undefined }): string {
    return `[nested:${nest.name}|${nest.options.view}]`;
  }
}

/** Every viewFn the manifest registers, keyed by view name, plus the
 *  exported :core body under "core". */
function resolveViewFn(view: string): ViewFn | undefined {
  if (view === "core") return permissionCoreView;
  for (const module of cardModPermissions.setModules ?? []) {
    for (const block of Object.values(module.formats ?? {})) {
      for (const viewDef of block.views ?? []) {
        if (viewDef.view === view) return viewDef.viewFn;
      }
    }
  }
  return undefined;
}

function makeCtx(
  fmt: StubFmt,
  view: string,
  opts: Record<string, unknown> = {},
): ViewContext {
  return {
    fmt: fmt as unknown as RenderFormat,
    voo: new StubVoo(view, opts) as unknown as Voo,
  } as unknown as ViewContext;
}

function collectViewFns(manifest: DeckoModManifest): Map<string, ViewFn> {
  const views = new Map<string, ViewFn>();
  for (const module of manifest.setModules ?? []) {
    for (const block of Object.values(module.formats ?? {})) {
      for (const view of block.views ?? []) views.set(view.view, view.viewFn);
    }
  }
  return views;
}

/** A ModEngineHost stub for the prepareEngine warm: codenames peek from a
 *  map, batch returns the given role ids for the roles statement, and
 *  fetchById resolves the given id -> name table. cacheFetchedRecord is
 *  counted so the test can pin the engine-cache warm. */
function fakeHost(opts: {
  codenames: Record<string, number>;
  roleIds: number[];
  cardsById: Record<number, string>;
}): ModEngineHost & { cachedRecords: unknown[] } {
  const cachedRecords: unknown[] = [];
  return {
    fetchRenderCard: () => undefined,
    isDenied: () => false,
    batch: async () => [{ rows: opts.roleIds.map((id) => ({ id })) }],
    codenames: {
      ensureLoaded: async () => {},
      peekId: (code: string) => opts.codenames[code],
    },
    fetchById: async (id: number) => {
      const name = opts.cardsById[id];
      if (name === undefined) return undefined;
      return { name: { s: name }, key: DeckoName.parse(name).key };
    },
    cacheFetchedRecord: async (record: unknown) => {
      cachedRecords.push(record);
    },
    cachedRecords,
  };
}

let liveLoader: ModLoader | undefined;

afterEach(() => {
  liveLoader?.reset();
  liveLoader = undefined;
  resetPermissionRolesForTests();
});

// ---------------------------------------------------------------------------
// 1. manifest structure
// ---------------------------------------------------------------------------

describe("card-mod-permissions manifest structure", () => {
  it("names + group mirror the gem metadata (gemspec card-mod-group: gem-defaults)", () => {
    expect(cardModPermissions.name).toBe("permissions");
    expect(cardModPermissions.gemName).toBe("card-mod-permissions");
    expect(cardModPermissions.group).toBe("gem-defaults");
  });

  it("declares exactly the 11 set files the gem's set/ tree ships, path-sorted", () => {
    // the compat report's inv.counts: setRbFiles 11 (abstract 1, all 2,
    // right 4, self 4)
    const paths = (cardModPermissions.setModules ?? []).map((m) => m.setPath);
    expect(paths).toEqual([
      "abstract/permission",
      "all/permissions",
      "all/update_read_rules",
      "right/create",
      "right/delete",
      "right/read",
      "right/update",
      "self/create",
      "self/delete",
      "self/read",
      "self/update",
    ]);
  });

  it("registers exactly the three views the T6 verdict lists as missing", () => {
    const abstract = (cardModPermissions.setModules ?? []).find(
      (m) => m.setPath === "abstract/permission",
    );
    expect(abstract).toBeDefined();
    const html = abstract!.formats?.["html"]?.views ?? [];
    expect(html.map((v) => v.view)).toEqual(["pointer_core", "one_line_content", "input"]);
    // cache configs: one_line_content carries cache: :never
    // (permission.rb:22); pointer_core (:10) and :input (:26) carry none.
    expect(html[0]?.config).toBeUndefined();
    expect(html[1]?.config).toEqual({ cache: "never" });
    expect(html[2]?.config).toBeUndefined();
  });

  it("does NOT register the mod's :core override (global-table clobber) but exports it", () => {
    // see the port file header: the override would replace the engine's
    // highest-traffic view for every card
    const views = collectViewFns(cardModPermissions);
    expect(views.has("core")).toBe(false);
    expect(typeof permissionCoreView).toBe("function");
  });

  it("the passive set files register no views (their events have no TS surface)", () => {
    for (const module of cardModPermissions.setModules ?? []) {
      if (module.setPath === "abstract/permission") continue;
      const formatKeys = Object.keys(module.formats ?? {});
      expect(formatKeys).toEqual([]);
    }
  });

  it("isPermissionRuleCard matches the four permission-right sets (right/*.rb include_set)", () => {
    expect(isPermissionRuleCard(cardLike("*all+*read") as never)).toBe(true);
    expect(isPermissionRuleCard(cardLike("B+*right+*update") as never)).toBe(true);
    expect(isPermissionRuleCard(cardLike("A+B+*self+*delete") as never)).toBe(true);
    expect(isPermissionRuleCard(cardLike("Joe User") as never)).toBe(false);
    expect(isPermissionRuleCard(cardLike("A+*to") as never)).toBe(false);
    expect(isPermissionRuleCard(cardLike("RichText+*type") as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. loader registration
// ---------------------------------------------------------------------------

describe("card-mod-permissions through the loader", () => {
  it("registers all 11 set modules in the basket with the right kinds", () => {
    const loader = new ModLoader([{ manifest: cardModPermissions }]);
    liveLoader = loader;
    const report = loader.load();
    // the loader walks pattern groups outer ([:all], [:abstract], nonbase
    // reversed - set_loader.rb:26-44 + pattern.rb:47-51)
    expect(report.registeredSetModules).toEqual([
      "All::Permissions",
      "All::UpdateReadRules",
      "Abstract::Permission",
      "Right::Create",
      "Right::Delete",
      "Right::Read",
      "Right::Update",
      "Self::Create",
      "Self::Delete",
      "Self::Read",
      "Self::Update",
    ]);
    const basket = loader.setModules();
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::Permission");
    expect(basket.base.map((m) => m.shortname)).toContain("All::Permissions");
    expect(basket.nonbase.get("Right::Read")?.[0]?.modName).toBe("permissions");
  });

  it("registers the three views into the live record and reset restores the pre-load state", () => {
    const liveRecord = { ...HTML_VIEWS };
    expect("pointer_core" in liveRecord).toBe(false);
    const loader = new ModLoader([{ manifest: cardModPermissions }], liveRecord);
    liveLoader = loader;
    loader.load();
    expect(typeof liveRecord["pointer_core"]).toBe("function");
    expect(typeof liveRecord["one_line_content"]).toBe("function");
    expect(typeof liveRecord["input"]).toBe("function");
    expect(loader.viewConfigFor("one_line_content")).toEqual({ cache: "never" });
    loader.reset();
    expect("pointer_core" in liveRecord).toBe(false);
    expect("one_line_content" in liveRecord).toBe(false);
    expect("input" in liveRecord).toBe(false);
    expect(loader.viewConfigFor("one_line_content")).toBeUndefined();
  });

  it("registers the four permission settings at positions 1-4 (self/*.rb setting_opts)", () => {
    const loader = new ModLoader([{ manifest: cardModPermissions }]);
    liveLoader = loader;
    const report = loader.load();
    expect([...report.registeredSettings].sort()).toEqual([
      "create",
      "delete",
      "read",
      "update",
    ]);
    const permissionGroup = loader.settingsRegistry().groups.get("permission");
    // set_position inserts at the requested slot (setting.rb:101-110):
    // the four land at positions 1-4 with no nil holes.
    expect(permissionGroup?.map((entry) => entry?.codename)).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    const [create, read, update, del] = permissionGroup ?? [];
    expect(create?.ruleTypeEditable).toBe(false);
    expect(create?.shortHelpText).toBe("who can create cards");
    expect(create?.rawHelpText).toBe("Who can create new cards");
    expect(read?.shortHelpText).toBe("who can view cards");
    expect(read?.rawHelpText).toBe("Who can view cards in the [[Set]].");
    expect(update?.shortHelpText).toBe("who can update cards");
    expect(update?.rawHelpText).toBe("Who can update cards");
    expect(del?.shortHelpText).toBe("who can delete cards");
    expect(del?.rawHelpText).toBe("Who can delete cards");
  });
});

// ---------------------------------------------------------------------------
// 2b. events[] - the manifest events surface (lane: events)
// ---------------------------------------------------------------------------

describe("card-mod-permissions events[] through the loader", () => {
  it("registers all seven portable events into ModLoadReport.registeredEvents in walk order", () => {
    // the SetLoader phase registers events in pattern-group outer, then mod
    // order, then path-sorted files within a mod, then declaration order
    // within a file (mod-loader.ts:283-293). For card-mod-permissions
    // (gem-defaults group, 11 set files) the walk order is:
    //   All::Permissions    -> set_read_rule, set_field_read_rules,
    //                          update_read_rule, check_permissions
    //   All::UpdateReadRules -> update_rule_cache, expire_related
    //   Right::Read          -> cascade_read_rule
    const loader = new ModLoader([{ manifest: cardModPermissions }]);
    liveLoader = loader;
    const report = loader.load();
    expect(report.registeredEvents).toEqual([
      "set_read_rule",
      "set_field_read_rules",
      "update_read_rule",
      "check_permissions",
      "update_rule_cache",
      "expire_related",
      "cascade_read_rule",
    ]);
  });

  it("populates the loader's event registry with file coordinates + modName injected", () => {
    const loader = new ModLoader([{ manifest: cardModPermissions }]);
    liveLoader = loader;
    loader.load();
    const registry = loader.eventRegistry();
    expect(registry.size()).toBe(7);
    // every entry carries the loader-injected file coordinates
    expect(registry.all().map((e) => `${e.setPath}:${e.event}`)).toEqual([
      "all/permissions:set_read_rule",
      "all/permissions:set_field_read_rules",
      "all/permissions:update_read_rule",
      "all/permissions:check_permissions",
      "all/update_read_rules:update_rule_cache",
      "all/update_read_rules:expire_related",
      "right/read:cascade_read_rule",
    ]);
    // modName on every entry ("permissions", mod-manifest.ts:258-266)
    expect(registry.all().every((e) => e.modName === "permissions")).toBe(true);
  });

  it("pins each event's stage + on + when + changed + after fields from the Ruby declarations", () => {
    // :set_read_rule (permissions.rb:1 - `:store, on: :save, changed:
    // %i[type_id name]`)
    const setReadRule = loaderFor(cardModPermissions).eventRegistry().forEvent("set_read_rule");
    expect(setReadRule?.setPath).toBe("all/permissions");
    expect(setReadRule?.at).toBe("store");
    expect(setReadRule?.on).toEqual(["save"]);
    // `changed: %i[type_id name]` (permissions.rb:1) - verbatim via the
    // ModEventRegistration.changed field (mod-manifest.ts:204-207,
    // mod-event-registry.ts:57)
    expect(setReadRule?.changed).toEqual(["type_id", "name"]);
    expect(setReadRule?.when).toBeUndefined();
    expect(setReadRule?.after).toBeUndefined();
    expect(setReadRule?.priority).toBeUndefined();

    // :set_field_read_rules (permissions.rb:7 - `after: :set_read_rule,
    // on: :update, changed: :type_id`) - both `after` and `changed` land
    // via ModEventRegistration.after/changed (mod-manifest.ts:204-212)
    const setField = loaderFor(cardModPermissions).eventRegistry().forEvent("set_field_read_rules");
    expect(setField?.at).toBeUndefined();
    expect(setField?.on).toEqual(["update"]);
    expect(setField?.after).toBe("set_read_rule");
    expect(setField?.changed).toEqual(["type_id"]);

    // :update_read_rule (permissions.rb:11 - no opts at all)
    const updateReadRule = loaderFor(cardModPermissions).eventRegistry().forEvent("update_read_rule");
    expect(updateReadRule?.at).toBeUndefined();
    expect(updateReadRule?.on).toBeUndefined();
    expect(updateReadRule?.when).toBeUndefined();
    expect(updateReadRule?.after).toBeUndefined();
    expect(updateReadRule?.changed).toBeUndefined();

    // :check_permissions (permissions.rb:22 - `:validate`) - the Ruby
    // validate stage (card-1.110.0 director.rb:18) is in ModEventStage
    // (mod-manifest.ts:155)
    const checkPermissions = loaderFor(cardModPermissions).eventRegistry().forEvent("check_permissions");
    expect(checkPermissions?.setPath).toBe("all/permissions");
    expect(checkPermissions?.at).toBe("validate");
    expect(checkPermissions?.on).toBeUndefined();
    expect(checkPermissions?.when).toBeUndefined();
    expect(checkPermissions?.after).toBeUndefined();
    expect(checkPermissions?.changed).toBeUndefined();

    // :update_rule_cache (update_read_rules.rb:4 - `:finalize, when: :rule?`)
    const updateRuleCache = loaderFor(cardModPermissions).eventRegistry().forEvent("update_rule_cache");
    expect(updateRuleCache?.at).toBe("finalize");
    expect(updateRuleCache?.when).toBe("rule?");

    // :expire_related (update_read_rules.rb:8 - `:finalize`)
    const expireRelated = loaderFor(cardModPermissions).eventRegistry().forEvent("expire_related");
    expect(expireRelated?.at).toBe("finalize");
    expect(expireRelated?.when).toBeUndefined();

    // :cascade_read_rule (right/read.rb:9 - `:finalize, after:
    // :update_rule_cache, when: :rule?`) - all three clauses land
    const cascade = loaderFor(cardModPermissions).eventRegistry().forEvent("cascade_read_rule");
    expect(cascade?.at).toBe("finalize");
    expect(cascade?.after).toBe("update_rule_cache");
    expect(cascade?.when).toBe("rule?");
  });

  it("forStage groups events by stage preserving registration order", () => {
    // forStage: ModEventRegistry#forStage (mod-event-registry.ts:78-80)
    // returns the events declared at the named stage in walk order - the
    // same order Ruby's same-stage execution walks them. For this mod:
    //   validate -> check_permissions (1)
    //   store    -> set_read_rule (1)
    //   finalize -> update_rule_cache, expire_related, cascade_read_rule (3)
    //   <no stage> -> set_field_read_rules, update_read_rule (2)
    const registry = loaderFor(cardModPermissions).eventRegistry();
    expect(registry.forStage("validate").map((e) => e.event)).toEqual([
      "check_permissions",
    ]);
    expect(registry.forStage("store").map((e) => e.event)).toEqual([
      "set_read_rule",
    ]);
    expect(registry.forStage("finalize").map((e) => e.event)).toEqual([
      "update_rule_cache",
      "expire_related",
      "cascade_read_rule",
    ]);
    // the empty-stage stages the mod touches NO event at - confirming the
    // omissions are honest, not "the stage lookup broke"
    expect(registry.forStage("integrate")).toEqual([]);
    expect(registry.forStage("prepare_to_validate")).toEqual([]);
    expect(registry.forStage("prepare_to_store")).toEqual([]);
  });

  it("the registered fns are no-op stubs adapted to (card, host) - the bodies live on Ruby's save path", async () => {
    // every registered fn is `(card, host) => void | Promise<void>` per
    // ModEventFn (mod-manifest.ts:177-180) and a no-op stub - the actual
    // bodies (read_rule_id assignment, Card.where.update_all, Auth.as_bot
    // role warm, Rule::Cache.clear_rule_cache, Director.expirees push,
    // member-walk update_read_rule, permission-error tracking + raise) are
    // DB-write / class-side state with no TS write-path surface. The
    // signature is the contract; the body resolves to undefined.
    const registry = loaderFor(cardModPermissions).eventRegistry();
    const fakeCard = { name: "*all+*read" };
    const fakeHost = {} as ModEngineHost;
    for (const entry of registry.all()) {
      const result = await entry.fn(fakeCard, fakeHost);
      expect(result).toBeUndefined();
    }
  });

  it("reset() empties the loader-owned event registry without touching the process default", () => {
    const loader = new ModLoader([{ manifest: cardModPermissions }]);
    liveLoader = loader;
    loader.load();
    expect(loader.eventRegistry().size()).toBe(7);
    loader.reset();
    expect(loader.eventRegistry().size()).toBe(0);
    expect(loader.eventRegistry().all()).toEqual([]);
  });
});

/** Build a fresh loader for assertions whose loader isn't surfaced (the
 *  shared `liveLoader` is single-slot by afterEach contract). */
function loaderFor(manifest: DeckoModManifest): ModLoader {
  const loader = new ModLoader([{ manifest }]);
  liveLoader = loader;
  loader.load();
  return loader;
}

// ---------------------------------------------------------------------------
// 3-7. the view bodies
// ---------------------------------------------------------------------------

describe("card-mod-permissions view guards (the include_set applicability)", () => {
  it("every registered view raises UnsupportedViewError outside the permission-right sets", () => {
    const views = collectViewFns(cardModPermissions);
    const joe = new StubFmt(cardLike("Joe User", { dbContent: "x" }));
    for (const view of ["pointer_core", "one_line_content", "input"]) {
      expect(() => views.get(view)!(makeCtx(joe, view))).toThrow(UnsupportedViewError);
    }
    expect(() => permissionCoreView(makeCtx(joe, "core"))).toThrow(UnsupportedViewError);
  });
});

describe(":pointer_core (abstract/permission.rb:10-12)", () => {
  it("wraps the items in div.pointer-list, one pointer-item item-bar row per item, joined with newlines", () => {
    const fmt = new StubFmt(
      cardLike("*all+*read", {
        dbContent: "Anyone\n[[Anyone Signed In]]\nu1",
        typeCode: "list",
      }),
    );
    const out = resolveViewFn("pointer_core")!(makeCtx(fmt, "pointer_core"));
    // wrap_with :div, pointer_items, class: "pointer-list"; the [[ ]] strips
    // are raw_item_strings (card-mod-list set/all/item.rb)
    expect(out).toBe(
      `<div class="pointer-list">` +
        `<div class="pointer-item item-bar">[nested:Anyone|bar]</div>\n` +
        `<div class="pointer-item item-bar">[nested:Anyone Signed In|bar]</div>\n` +
        `<div class="pointer-item item-bar">[nested:u1|bar]</div>` +
        `</div>`,
    );
  });

  it("renders the empty wrapper for empty content (output([]) joins to the empty string)", () => {
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "" }));
    const out = resolveViewFn("pointer_core")!(makeCtx(fmt, "pointer_core"));
    expect(out).toBe("<div class=\"pointer-list\"></div>");
  });
});

describe(":one_line_content (abstract/permission.rb:22-24)", () => {
  it("renders core with items {view: :link}; the link view reaches the item nests and wrap_item classes", () => {
    const fmt = new StubFmt(
      cardLike("*all+*read", { dbContent: "Anyone\nAdministrators" }),
    );
    const out = resolveViewFn("one_line_content")!(makeCtx(fmt, "one_line_content"));
    // render_core items: {view: :link} -> core -> render! :pointer_core ->
    // pointer_items with the link view (the voo-items ride item_view_options,
    // card-mod-collection set/all/item.rb:149-151)
    expect(out).toBe(
      `<div class="pointer-list">` +
        `<div class="pointer-item item-link">[nested:Anyone|link]</div>\n` +
        `<div class="pointer-item item-link">[nested:Administrators|link]</div>` +
        `</div>`,
    );
    // the render! chain: core, then pointer_core
    expect(fmt.renderCalls.map((c) => c.view)).toEqual(["core", "pointer_core"]);
    expect(fmt.renderCalls[1]?.opts).toEqual({ items: { view: "link" } });
  });
});

describe("the exported :core override (abstract/permission.rb:14-20, not registered)", () => {
  it("renders the bare inherit span for _left content outside a rule-editor context", () => {
    // core_inherit_content -> in_context_of_self_set? false (no @set_context)
    // -> "Inherit from left card" (permission.rb:98-105)
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "_left" }));
    const out = permissionCoreView(makeCtx(fmt, "core"));
    expect(out).toBe('<span class="inherit-perm">Inherit from left card</span>');
  });

  it("renders the who_can links inside the span in a self-set context (permission.rb:113-122)", () => {
    // set_context "A+B+*self": ancestor = trunk.trunk = "A"; who_can(:read)
    // resolves the ancestor's first existing "<set>+*read" rule card via
    // ruleNamesForCard's candidate walk ("A+*self+*read" first)
    const ancestor = cardLike("A", { typeName: "RichText", typeId: 100, id: 5 });
    const rule = cardLike("A+*self+*read", { dbContent: "Anyone\nAdministrators" });
    const fmt = new StubFmt(cardLike("A+B+*self+*read", { dbContent: "_left" }), {
      "A": ancestor,
      "A+*self+*read": rule,
    });
    const out = permissionCoreView(makeCtx(fmt, "core", { set_context: "A+B+*self" }));
    expect(out).toBe(
      '<span class="inherit-perm">Inherit ( ' +
        '<a href="/Anyone">Anyone</a>, <a href="/Administrators">Administrators</a>' +
        " )</span>",
    );
  });

  it("rescues any resolution failure to the bare Inherit bytes (permission.rb:120-121)", () => {
    const fmt = new StubFmt(cardLike("A+B+*self+*read", { dbContent: "_left" }), {});
    const out = permissionCoreView(makeCtx(fmt, "core", { set_context: "A+B+*self" }));
    expect(out).toBe('<span class="inherit-perm">Inherit</span>');
  });

  it("dispatches to pointer_core for list content (permission.rb:18)", () => {
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "Anyone" }));
    const out = permissionCoreView(makeCtx(fmt, "core"));
    expect(out).toBe(
      '<div class="pointer-list"><div class="pointer-item item-bar">[nested:Anyone|bar]</div></div>',
    );
    expect(fmt.renderCalls.map((c) => c.view)).toEqual(["pointer_core"]);
  });
});

describe(":input (abstract/permission.rb:26-43)", () => {
  it("emits the hidden content field with the card content (content.rb:57-59 hidden_field)", () => {
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "Anyone" }));
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).toContain(
      '<input type="hidden" name="card[content]" id="card_content" class="d0-card-content" value="Anyone" />',
    );
  });

  it("omits the inheritance checkbox when the trunk set is not inheritable (*all)", () => {
    // "*all+*read": trunk "*all" IS a set card, but the all pattern is not
    // compound_only and not self (set/type/set.rb:21-23) -> inheritable? false
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "Anyone" }), {
      "*all": cardLike("*all", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).not.toContain("perm-inheritance");
  });

  it("renders the inheritance checkbox for a right-pattern set (compound_only, set.rb:21-23)", () => {
    // "B+*right+*read": trunk "B+*right" is a set card whose pattern (*right)
    // is compound_only -> inheritable? true; not inheriting -> unchecked
    const fmt = new StubFmt(cardLike("B+*right+*read", { dbContent: "Anyone" }), {
      "B+*right": cardLike("B+*right", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).toContain('<div class="perm-inheritance perm-section">');
    expect(out).toContain(
      '<input type="checkbox" name="inherit" id="inherit" value="inherit" />',
    );
    // the "?" explainer's title reads the card's tag (permission.rb:92);
    // Rails' attribute escape turns the apostrophe into &#39; (h = ERB::Util)
    expect(out).toContain('<a title="use left&#39;s *read rule">?</a>');
    // the label carries the inherit span
    expect(out).toContain('<span class="inherit-perm">Inherit from left card</span>');
  });

  it("checks the inherit box and empties the item list when inheriting (permission.rb:27)", () => {
    // "A+B+*self+*update" with "_left": inheritable (self pattern + compound
    // anchor) AND inheriting -> item_names = []
    const fmt = new StubFmt(cardLike("A+B+*self+*update", { dbContent: "_left" }), {
      "A+B+*self": cardLike("A+B+*self", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).toContain(
      '<input type="checkbox" name="inherit" id="inherit" value="inherit" checked="checked" />',
    );
    expect(out).toContain('<ul class="pointer-list-editor perm-indiv-ul"></ul>');
  });

  it("no checkbox when the trunk is not a set card (permission.rb:74-77 not_set branch)", () => {
    const fmt = new StubFmt(cardLike("Joe User+*read", { dbContent: "" }), {
      "Joe User": cardLike("Joe User", { typeName: "User" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).not.toContain("perm-inheritance");
  });

  it("renders the Groups checkboxes from the warmed roles and consumes grouped names from the individuals (permission.rb:47-62)", async () => {
    const host = fakeHost({
      codenames: { role: 8, cards_with_account: 90 },
      roleIds: [31, 30, 32],
      cardsById: { 30: "Administrators", 31: "Anyone", 32: "Anyone Signed In", 90: "Cards with account" },
    });
    await preparePermissionRoles(host);
    expect(host.cachedRecords).toHaveLength(4);

    const fmt = new StubFmt(
      cardLike("*all+*read", { dbContent: "Administrators\nu1" }),
      { "*all": cardLike("*all", { typeCode: "set" }) },
    );
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    // group rows, name-sorted (sort_by: "name"); Administrators is in
    // item_names -> checked AND consumed. The checkbox name uses the
    // option's KEY (permission.rb:52) - DeckoName keys singularize.
    expect(out).toContain(
      '<input type="checkbox" name="administrator-perm-checkbox" id="administrator-perm-checkbox" value="Administrators" class="perm-checkbox-button" checked="checked" />',
    );
    expect(out).toContain(
      '<input type="checkbox" name="anyone-perm-checkbox" id="anyone-perm-checkbox" value="Anyone" class="perm-checkbox-button" />',
    );
    expect(out).toContain(
      '<input type="checkbox" name="anyone_signed_in-perm-checkbox" id="anyone_signed_in-perm-checkbox" value="Anyone Signed In" class="perm-checkbox-button" />',
    );
    expect(out).toContain('href="/Anyone" target="decko_role"');
    expect(out).toContain("close_fullscreen");
    // the individuals list carries ONLY the un-grouped items
    expect(out).toContain('<ul class="pointer-list-editor perm-indiv-ul">');
    expect(out).toContain('value="u1"');
    // Administrators appears only in its group row (label + checkbox), not
    // as a pointer_item input row
    expect(out).not.toContain(
      'name="pointer_item" id="pointer_item" value="Administrators"',
    );
    // list_input.haml rows: handle icon, delete button, add-another
    expect(out).toContain('<span class="input-group-text handle">');
    expect(out).toContain('class="pointer-item-text form-control"');
    expect(out).toContain('data-options-card="Cards_with_account"');
    expect(out).toContain('class="_pointer-item-add btn btn-secondary" type="submit"');
    expect(out).toContain("add another");
  });

  it("renders an empty Groups section and no data-options-card without the prepareEngine warm", () => {
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "u1" }), {
      "*all": cardLike("*all", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).toContain("perm-group");
    expect(out).not.toContain("perm-checkbox-button");
    expect(out).not.toContain("data-options-card");
    expect(out).toContain('value="u1"');
  });

  it("escapes html-significant content in the field values (h())", () => {
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: 'a"b<c>' }), {
      "*all": cardLike("*all", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).toContain('value="a&quot;b&lt;c&gt;"');
  });
});

// ---------------------------------------------------------------------------
// 8. prepareEngine - the role warm (permission.rb:64-68)
// ---------------------------------------------------------------------------

describe("preparePermissionRoles (the group_options warm)", () => {
  it("fills the sorted role registry and caches every record into the engine", async () => {
    const host = fakeHost({
      codenames: { role: 8 },
      roleIds: [31, 30, 32],
      cardsById: { 30: "Administrators", 31: "Anyone", 32: "Anyone Signed In" },
    });
    await preparePermissionRoles(host);
    expect(host.cachedRecords).toHaveLength(3);
    // the registry is name-sorted (Card.search sort_by: "name")
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "" }), {
      "*all": cardLike("*all", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    const adminIdx = out.indexOf("administrator-perm-checkbox");
    const anyoneIdx = out.indexOf("anyone-perm-checkbox");
    const signedInIdx = out.indexOf("anyone_signed_in-perm-checkbox");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(anyoneIdx).toBeGreaterThan(-1);
    expect(signedInIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeLessThan(anyoneIdx);
    expect(anyoneIdx).toBeLessThan(signedInIdx);
  });

  it("degenerate decks (no Role cardtype) leave the registry empty without throwing", async () => {
    const host = fakeHost({ codenames: {}, roleIds: [], cardsById: {} });
    await expect(preparePermissionRoles(host)).resolves.toBeUndefined();
    const fmt = new StubFmt(cardLike("*all+*read", { dbContent: "u1" }), {
      "*all": cardLike("*all", { typeCode: "set" }),
    });
    const out = resolveViewFn("input")!(makeCtx(fmt, "input"));
    expect(out).not.toContain("perm-checkbox-button");
  });
});
