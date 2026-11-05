

import { describe, it, expect, afterEach } from "vitest";
import { ModLoader } from "../../../src/card/mod-loader.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import cardModIntegrate, {
  ASSIGN_TYPE_DECLARATIONS,
  OBSERVER_EVENT_DECLARATIONS,
  eventCards,
  executeCardEvents,
  cacheDeleteCardEvents,
  observerRuleCard,
  recursedItemCards,
  type ObserverCardRef,
  type ObserverLookup,
} from "../../../src/card/mod-loader/mods/card-mod-integrate.js";
import { ruleNamesForCard } from "../../../src/card/set-patterns/rule-names.js";

function card(name: string, dbContent = "", typeName?: string): ObserverCardRef {
  return { name, dbContent, typeName };
}

function lookupWith(
  cards: Record<string, ObserverCardRef>,
): ObserverLookup {
  return {
    fetch: (name) => cards[name],
    isListCard: (c) => c.typeName === "list" || c.typeName === "listed",
  };
}

let liveLoader: ModLoader | undefined;

afterEach(() => {
  liveLoader?.reset();
  liveLoader = undefined;
});

describe("card-mod-integrate manifest structure", () => {
  it("names + gemName mirror the gem's metadata (class_methods.rb:26-28)", () => {
    expect(cardModIntegrate.name).toBe("integrate");
    expect(cardModIntegrate.gemName).toBe("card-mod-integrate");
    expect(cardModIntegrate.group).toBe("gem-defaults");
  });

  it("declares exactly the eight set files the gem's set/ tree ships", () => {

    const paths = (cardModIntegrate.setModules ?? []).map((m) => m.setPath);
    expect(paths).toEqual([
      "all/observer",
      "right/on_create",
      "right/on_delete",
      "right/on_update",
      "self/on_create",
      "self/on_delete",
      "self/on_update",
      "self/thanks",
    ]);
  });

  it("declares no views (T6: htmlViewsDeclared 0)", () => {
    for (const module of cardModIntegrate.setModules ?? []) {
      expect(module.formats).toBeUndefined();
    }
  });

  it("the setting_opts registrations carry the Ruby files' exact opts", () => {

    const opts = new Map(
      (cardModIntegrate.setModules ?? [])
        .filter((m) => m.settingOpts !== undefined)
        .map((m) => [m.setPath, m.settingOpts]),
    );
    expect(opts.get("self/on_create")).toEqual({
      group: "event",
      position: 1,
      ruleTypeEditable: false,
      helpText: "Configure events to be executed when card is created",
    });
    expect(opts.get("self/on_update")).toEqual({
      group: "event",
      position: 2,
      ruleTypeEditable: false,
      helpText: "Configure events to be executed when card is updated",
    });
    expect(opts.get("self/on_delete")).toEqual({
      group: "event",
      position: 3,
      ruleTypeEditable: false,
      helpText: "Configure events to be executed when card is deleted",
    });
    expect(opts.get("self/thanks")).toEqual({
      group: "other",
      position: 3,
      ruleTypeEditable: false,
      shortHelpText: "destination after card is created",
      helpText:
        "Destination after card is created. " +
        "[[http://decko.org/Custom_thank_you_messages_for_forms|more]]",
    });
    expect(opts.size).toBe(4);
  });

  it("loads into the baskets: All::Observer base, Right::On* + Self::On* nonbase", () => {
    const loader = new ModLoader([{ manifest: cardModIntegrate }], { ...HTML_VIEWS });
    liveLoader = loader;
    loader.load();
    const basket = loader.setModules();

    const observer = basket.base;
    expect(observer.map((m) => m.shortname)).toContain("All::Observer");
    const observerEntry = observer.find((m) => m.shortname === "All::Observer");
    expect(observerEntry?.modName).toBe("integrate");
    expect(observerEntry?.kind).toBe("base");

    for (const shortname of ["Right::OnCreate", "Right::OnDelete", "Right::OnUpdate"]) {
      const entry = basket.nonbase.get(shortname)?.[0];
      expect(entry?.shortname).toBe(shortname);
      expect(entry?.kind).toBe("nonbase");
      expect(entry?.modName).toBe("integrate");
    }
    for (const shortname of ["Self::OnCreate", "Self::OnDelete", "Self::OnUpdate", "Self::Thanks"]) {
      expect(basket.nonbase.get(shortname)?.[0]?.modName).toBe("integrate");
    }
  });

  it("the setting registry reproduces Ruby's set_position state (setting.rb:101-110)", () => {

    const loader = new ModLoader([{ manifest: cardModIntegrate }], { ...HTML_VIEWS });
    liveLoader = loader;
    loader.load();
    const registry = loader.settingsRegistry();

    const eventGroup = registry.groups.get("event") ?? [];
    expect(eventGroup.map((e) => e?.codename ?? null)).toEqual([
      "on_create",
      "on_update",
      "on_delete",
    ]);
    const otherGroup = registry.groups.get("other") ?? [];
    expect(otherGroup.length).toBe(3);
    expect(otherGroup[0]).toBeNull();
    expect(otherGroup[1]).toBeNull();
    expect(otherGroup[2]?.codename).toBe("thanks");

    const onCreate = registry.findByCodename("on_create");
    expect(onCreate?.ruleTypeEditable).toBe(false);
    expect(onCreate?.rawHelpText).toBe(
      "Configure events to be executed when card is created",
    );
    expect(onCreate?.rightRawHelpText).toBe(onCreate?.rawHelpText);
    const thanks = registry.findByCodename("thanks");
    expect(thanks?.shortHelpText).toBe("destination after card is created");
    expect(thanks?.group).toBe("other");
  });

  it("registers the four observer events on the loader's ModEventRegistry (observer.rb:1-9)", () => {

    const loader = new ModLoader([{ manifest: cardModIntegrate }], { ...HTML_VIEWS });
    liveLoader = loader;
    const report = loader.load();

    expect(report.registeredEvents).toEqual([
      "observer_create",
      "observer_update",
      "observer_delete",
      "cache_delete_card_events",
    ]);

    const registry = loader.eventRegistry();
    expect(registry.size()).toBe(4);
    expect(registry.all().map((e) => `${e.modName}:${e.event}:${e.setPath}`)).toEqual([
      "integrate:observer_create:all/observer",
      "integrate:observer_update:all/observer",
      "integrate:observer_delete:all/observer",
      "integrate:cache_delete_card_events:all/observer",
    ]);

    expect(registry.forStage("integrate").map((e) => e.event)).toEqual([
      "observer_create",
      "observer_update",
      "observer_delete",
    ]);
    expect(registry.forStage("store").map((e) => e.event)).toEqual([
      "cache_delete_card_events",
    ]);

    expect(registry.forStage("finalize")).toEqual([]);
    expect(registry.forStage("prepare_to_store")).toEqual([]);

    const create = registry.forEvent("observer_create");
    expect(create?.setPath).toBe("all/observer");
    expect(create?.modName).toBe("integrate");
    expect(create?.at).toBe("integrate");
    expect(create?.on).toEqual(["create"]);
    expect(typeof create?.fn).toBe("function");

    const update = registry.forEvent("observer_update");
    expect(update?.at).toBe("integrate");
    expect(update?.on).toEqual(["update"]);

    const del = registry.forEvent("observer_delete");
    expect(del?.at).toBe("integrate");
    expect(del?.on).toEqual(["delete"]);

    const cache = registry.forEvent("cache_delete_card_events");
    expect(cache?.setPath).toBe("all/observer");
    expect(cache?.modName).toBe("integrate");
    expect(cache?.at).toBe("store");
    expect(cache?.on).toEqual(["delete"]);
    expect(typeof cache?.fn).toBe("function");
  });
});

describe("card-mod-integrate pinned declarations", () => {
  it("pins the four event declarations (observer.rb:1-9)", () => {

    expect([...OBSERVER_EVENT_DECLARATIONS]).toEqual([
      { event: "observer_create", stage: "integrate", on: "create" },
      { event: "observer_update", stage: "integrate", on: "update" },
      { event: "observer_delete", stage: "integrate", on: "delete" },
      { event: "cache_delete_card_events", stage: "store", on: "delete" },
    ]);
  });

  it("pins the three assign_type :list declarations (right/on_*.rb:1)", () => {

    expect([...ASSIGN_TYPE_DECLARATIONS]).toEqual([
      { setPath: "right/on_create", setModule: "Right::OnCreate", type: "list" },
      { setPath: "right/on_delete", setModule: "Right::OnDelete", type: "list" },
      { setPath: "right/on_update", setModule: "Right::OnUpdate", type: "list" },
    ]);
  });
});

describe("observer rule walk (observer.rb:18-22 -> rule/all.rb:9-11)", () => {
  it("walks the trigger's rule candidates in pattern precedence", () => {

    const seen: string[] = [];
    const ruleName = ruleNamesForCard({ name: "Signup" }, "*on_create").at(-1)!;
    const lookup: ObserverLookup = {
      fetch: (name) => {
        seen.push(name);
        return name === ruleName ? card(ruleName, "A Card") : undefined;
      },
      isListCard: () => false,
    };
    const rule = observerRuleCard({ name: "Signup" }, "on_create", lookup);
    expect(rule?.name).toBe(ruleName);
    expect(seen).toEqual(ruleNamesForCard({ name: "Signup" }, "*on_create"));
  });

  it("a more specific set's rule beats *all (pattern precedence)", () => {

    const candidates = ruleNamesForCard({ name: "Signup" }, "*on_create");
    const selfCandidate = candidates.find((c) => c.includes("+*self+"))!;
    const allCandidate = candidates.find((c) => c.startsWith("*all+"))!;
    const lookup = lookupWith({ [selfCandidate]: card(selfCandidate, "specific") });
    const rule = observerRuleCard({ name: "Signup" }, "on_create", lookup);
    expect(rule?.name).toBe(selfCandidate);
    expect(rule?.name).not.toBe(allCandidate);
  });

  it("no rule card anywhere -> undefined (observer.rb:20's nil rule_card)", () => {
    const lookup = lookupWith({});
    expect(observerRuleCard({ name: "Signup" }, "on_create", lookup)).toBeUndefined();
  });
});

describe("recursedItemCards (card-mod-collection set/all/recursed.rb:1-31)", () => {
  it("a non-list rule card recurses to [self] (recursed.rb:13-15)", () => {

    const rule = card("*on create template", "body text", "plain");
    const out = recursedItemCards(rule, lookupWith({}));
    expect(out).toEqual([rule]);
  });

  it("a list rule expands to its item cards in order (raw_item_strings)", () => {

    const rule = card("*on create rule", "A Card\n[[Second Card]]", "list");
    const aCard = card("A Card");
    const secondCard = card("Second Card");
    const out = recursedItemCards(rule, lookupWith({ "A Card": aCard, "Second Card": secondCard }));
    expect(out).toEqual([aCard, secondCard]);
  });

  it("nested lists recurse depth-first, order preserved (recursed.rb:26-27 unshift)", () => {
    const rule = card("rule", "Outer\nB", "list");
    const outer = card("Outer", "A1\nA2", "list");
    const b = card("B");
    const a1 = card("A1");
    const a2 = card("A2");
    const out = recursedItemCards(
      rule,
      lookupWith({ Outer: outer, B: b, A1: a1, A2: a2 }),
    );
    expect(out).toEqual([a1, a2, b]);
  });

  it("item loops terminate; list members in a cycle never become leaves", () => {

    const rule = card("rule", "A\nB", "list");
    const a = card("A", "B", "list");
    const b = card("B", "A", "list");
    const out = recursedItemCards(rule, lookupWith({ A: a, B: b }));
    expect(out).toEqual([]);
  });

  it("a leaf named twice lands once (recursed.rb:19-24 book covers leaves too)", () => {

    const rule = card("rule", "Dup\nDup", "list");
    const dup = card("Dup");
    const out = recursedItemCards(rule, lookupWith({ Dup: dup }));
    expect(out).toEqual([dup]);
  });

  it("a NESTED unfetchable item drops (recursed.rb:27's compact)", () => {

    const rule = card("rule", "Outer\nReal", "list");
    const outer = card("Outer", "Ghost\nReal", "list");
    const real = card("Real");
    const out = recursedItemCards(rule, lookupWith({ Outer: outer, Real: real }));
    expect(out).toEqual([real]);
  });

  it("a TOP-LEVEL unfetchable item crashes (recursed.rb:34 nil.recursable_items?)", () => {

    const rule = card("rule", "Ghost\nReal", "list");
    const real = card("Real");
    expect(() =>
      recursedItemCards(rule, lookupWith({ Real: real })),
    ).toThrowError(/nil\.recursable_items\?/);
  });

  it("strip_item removes EVERY [[/]] in the item line (item.rb:270-272 gsub)", () => {

    const rule = card("rule", "[[A]] [[B]]", "list");
    const ab = card("A B");
    const out = recursedItemCards(rule, lookupWith({ "A B": ab }));
    expect(out).toEqual([ab]);
  });

  it("whitespace-only content keeps its empty items - which crash (Ruby's split)", () => {

    const rule = card("rule", " \n", "list");
    expect(() => recursedItemCards(rule, lookupWith({}))).toThrowError();
  });
});

describe("eventCards (observer.rb:18-22)", () => {
  const candidates = (trigger: { name: string }) =>
    ruleNamesForCard(trigger, "*on_create");
  const selfRuleName = (trigger: { name: string }) =>
    candidates(trigger).find((c) => c.includes("+*self+"))!;

  it("no rule -> [] (observer.rb:20-21 nil && -> || [])", () => {
    const out = eventCards({ name: "Signup" }, "on_create", lookupWith({}));
    expect(out).toEqual([]);
  });

  it("a list rule answers its recursed items; empty expansion STAYS empty", () => {

    const ruleName = selfRuleName({ name: "Signup" });
    const rule = card(ruleName, "", "list");
    const out = eventCards(
      { name: "Signup" },
      "on_create",
      lookupWith({ [ruleName]: rule }),
    );
    expect(out).toEqual([]);
  });

  it("the cache branch wins over re-resolution (observer.rb:19 @card_event_cache)", () => {

    const ruleName = selfRuleName({ name: "Signup" });
    const liveRule = card(ruleName, "Live Card", "list");
    const liveCard = card("Live Card");
    const memo = [card("Cached Card")];
    let consulted = false;
    const lookup: ObserverLookup = {
      fetch: (name) => {
        if (name === ruleName) {
          consulted = true;
          return liveRule;
        }
        return name === "Live Card" ? liveCard : undefined;
      },
      isListCard: () => true,
    };
    const out = eventCards({ name: "Signup" }, "on_create", lookup, memo);
    expect(out).toEqual(memo);
    expect(consulted).toBe(false);
  });
});

describe("executeCardEvents (observer.rb:11-16)", () => {
  it("delivers each event card in item order with the trigger (observer.rb:13-15)", () => {
    const ruleName = ruleNamesForCard({ name: "Signup" }, "*on_create").find(
      (c) => c.includes("+*self+"),
    )!;
    const rule = card(ruleName, "A Card\nSecond Card", "list");
    const aCard = card("A Card");
    const secondCard = card("Second Card");
    const signup = { name: "Signup" };
    const lookup = lookupWith({
      [ruleName]: rule,
      "A Card": aCard,
      "Second Card": secondCard,
    });
    const delivered: string[] = [];
    let deliveredTrigger: unknown;
    executeCardEvents(
      { on: "create" },
      signup,
      lookup,
      (eventCard, trigger) => {
        delivered.push(eventCard.name);
        deliveredTrigger = trigger;
      },
    );
    expect(delivered).toEqual(["A Card", "Second Card"]);
    expect(deliveredTrigger).toBe(signup);
  });

  it("builds the setting from the action: on_update walks *on update rules", () => {

    const candidates = (code: string) =>
      ruleNamesForCard({ name: "Doc" }, `*${code}`);
    const createRule = candidates("on_create").find((c) => c.includes("+*self+"))!;
    const updateRule = candidates("on_update").find((c) => c.includes("+*self+"))!;
    const updateCard = card("Update Watcher");
    const lookup = lookupWith({
      [createRule]: card(createRule, "Create Watcher", "list"),
      [updateRule]: card(updateRule, "Update Watcher", "list"),
      "Create Watcher": card("Create Watcher"),
      "Update Watcher": updateCard,
    });
    const delivered: string[] = [];
    executeCardEvents({ on: "update" }, { name: "Doc" }, lookup, (eventCard) => {
      delivered.push(eventCard.name);
    });
    expect(delivered).toEqual(["Update Watcher"]);
  });

  it("no rule -> no deliveries (the silent no-rule path)", () => {
    const delivered: string[] = [];
    executeCardEvents({ on: "delete" }, { name: "Doc" }, lookupWith({}), () => {
      delivered.push("fired");
    });
    expect(delivered).toEqual([]);
  });
});

describe("cacheDeleteCardEvents (observer.rb:7-9)", () => {
  it("memoizes the *on delete rule's items (the :store-stage body)", () => {

    const deleteCandidates = ruleNamesForCard({ name: "Doc" }, "*on_delete");
    const deleteRuleName = deleteCandidates.find((c) => c.includes("+*self+"))!;
    const rule = card(deleteRuleName, "Delete Watcher", "list");
    const watcher = card("Delete Watcher");
    const lookup = lookupWith({
      [deleteRuleName]: rule,
      "Delete Watcher": watcher,
    });
    const memo = cacheDeleteCardEvents({ name: "Doc" }, lookup);
    expect(memo).toEqual([watcher]);

    const delivered: string[] = [];
    executeCardEvents(
      { on: "delete" },
      { name: "Doc" },
      lookupWith({}),
      (eventCard) => delivered.push(eventCard.name),
      memo,
    );
    expect(delivered).toEqual(["Delete Watcher"]);
  });
});
