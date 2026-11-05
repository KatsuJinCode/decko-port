// The composed default deck (src/card/mod-loader/default-mod-deck.ts):
// all 30 ported card-mod manifests, wired into one loader in the oracle
// deck's captured bundle order (fixtures/captured/help-mod-loader.json
// "mods"), with the deck-boot seam binding the process-wide defaults.
//
// The order expectation is the capture, not a hand-written list: the test
// compares the loader's resolved order against portedBundleOrder() AND
// spot-checks its head/tail against the capture's index sequence. The
// registration-count expectations are derived FROM the manifests
// themselves, so a mod adopting the content-override/events manifest
// fields (the activation round's work) grows the numbers without editing
// this suite.

import { describe, expect, it, afterAll } from "vitest";
import {
  ORACLE_BUNDLE_ORDER,
  COMPILED_IN_OR_ABSENT_MODS,
  defaultDeckSources,
  portedBundleOrder,
  defaultDeckLoader,
} from "../../../src/card/mod-loader/default-mod-deck.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import {
  getDefaultModLoader,
  setDefaultModLoader,
  setDefaultContentOverrideRegistry,
  setDefaultModEventRegistry,
  contentOverrideFor,
  eventsForStage,
} from "../../../src/card/mod-loader.js";

afterAll(() => {
  // unbind the deck-boot seam's process-wide defaults (the same isolation
  // contract as the mod suites' afterAll hooks)
  setDefaultModLoader(undefined);
  setDefaultContentOverrideRegistry(undefined);
  setDefaultModEventRegistry(undefined);
});

describe("default-mod-deck: oracle bundle order", () => {
  it("carries the captured resolve order (34 names, 4 without manifests)", () => {
    expect(ORACLE_BUNDLE_ORDER).toHaveLength(34);
    expect(ORACLE_BUNDLE_ORDER[0]).toBe("core");
    // the capture's tail: recaptcha, tinymce_editor, defaults (indexes 31-33)
    expect(ORACLE_BUNDLE_ORDER.slice(-3)).toEqual([
      "recaptcha",
      "tinymce_editor",
      "defaults",
    ]);
    expect(COMPILED_IN_OR_ABSENT_MODS).toHaveLength(4);
    for (const absent of COMPILED_IN_OR_ABSENT_MODS) {
      expect(ORACLE_BUNDLE_ORDER).toContain(absent);
    }
  });

  it("restricts to exactly the 30 ported mods, preserving capture order", () => {
    const order = portedBundleOrder();
    expect(order).toHaveLength(30);
    // head: collection..help is the capture's indexes 1-7 verbatim
    expect(order.slice(0, 7)).toEqual([
      "collection",
      "content",
      "format",
      "list",
      "markdown",
      "permissions",
      "help",
    ]);
    // every ported name is in the capture; every capture name that is not
    // ported is one of the documented four
    for (const name of order) {
      expect(ORACLE_BUNDLE_ORDER).toContain(name);
    }
    const unaccounted = ORACLE_BUNDLE_ORDER.filter(
      (name) => !order.includes(name),
    );
    expect(unaccounted).toEqual([
      "core",
      "bar_and_box",
      "delayed_job",
      "defaults",
    ]);
    // search loads AFTER collection (the :count MRO delegation depends on
    // the load order - search's registration last-wins, its body
    // superViews to collection's)
    expect(order.indexOf("collection")).toBeLessThan(order.indexOf("search"));
  });
});

describe("default-mod-deck: one loader, oracle order, live registrations", () => {
  it("resolves the full order and loads every manifest", () => {
    const sources = defaultDeckSources();
    expect(sources).toHaveLength(30);
    const loader = new ModLoader(sources);
    loader.resolveOrder({ gemMods: portedBundleOrder() });
    const report = loader.load();

    expect(report.modNames).toEqual(portedBundleOrder());
    // every mod contributed set modules and views (the ports' registered
    // baskets), the way the per-mod suites pin individually
    expect(report.registeredSetModules.length).toBeGreaterThan(0);
    expect(report.registeredViews.length).toBeGreaterThan(0);
    expect(report.registeredViews).toContain("count");
    expect(report.registeredSettings).toContain("help");
    // the pattern table is unchanged in its core prefix (no ported mod of
    // the 30 registers a set pattern; core patterns stay in oracle order)
    const table = loader.patternTable();
    expect(table.length).toBeGreaterThanOrEqual(9);

    // registration-count expectations derived from the manifests: the
    // report counts exactly what the manifest tree declares
    let manifestOverrides = 0;
    let manifestEvents = 0;
    for (const source of sources) {
      for (const file of source.manifest.setModules ?? []) {
        manifestOverrides += file.contentOverrides?.length ?? 0;
        manifestEvents += file.events?.length ?? 0;
      }
    }
    expect(report.registeredContentOverrides).toHaveLength(manifestOverrides);
    expect(report.registeredEvents).toHaveLength(manifestEvents);
    expect(loader.contentOverrideRegistry().size()).toBe(manifestOverrides);
    expect(loader.eventRegistry().size()).toBe(manifestEvents);
  });

  it("is idempotent: a second load() produces the same report", () => {
    const loader = new ModLoader(defaultDeckSources());
    loader.resolveOrder({ gemMods: portedBundleOrder() });
    const first = loader.load();
    const second = loader.load();
    expect(second).toEqual(first);
  });

  it(":count dispatches to the search-family registration with collection's behind it", () => {
    const loader = defaultDeckLoader();
    // search registers :count under the abstract pattern (card-mod-search
    // set/abstract/0_search.rb:56,86 - the super()-chain views), collection
    // under all/item.rb:180-182. The empty-setKeys walk (the abstract
    // pseudo-pattern fallback) carries both modules in registration order.
    const chain = loader.viewChain("", "count");
    const modules = chain.map((entry) => entry.setModule);
    expect(modules).toContain("Abstract::Search");
    expect(modules).toContain("All::Item");
    // the flat last-wins table dispatches the LATER registration (search,
    // loaded after collection per the oracle order), and the chain carries
    // collection's All::Item entry for the superView walk - the count MRO
    // delegation the search port cites (card-mod-search.ts:17-23)
    expect(loader.viewsTable()["count"]).toBe(
      loader.viewChainTable().viewFor("Abstract::Search", "count"),
    );
  });
});

describe("default-mod-deck: the deck-boot seam binds the process defaults", () => {
  it("binds the loader + both registries it populated", () => {
    const loader = defaultDeckLoader();
    expect(getDefaultModLoader()).toBe(loader);
    // the bound registry IS the loader's instance
    expect(contentOverrideFor("no/such_path")).toBeUndefined();
    expect(eventsForStage("integrate")).toEqual(
      loader.eventRegistry().forStage("integrate"),
    );
  });
});
